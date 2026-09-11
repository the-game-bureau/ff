-- The league scores itself.
--
-- WHAT IT DOES
-- Every fifteen minutes, Postgres asks ESPN for the open week's scoreboard and
-- runs the same scoring the admin button runs. Finished games get their
-- verdicts; unfinished ones are left alone. Nobody has to be at a computer, and
-- nothing has to be deployed.
--
-- This does not replace the button. admin/index.html still previews and scores
-- on demand, through the same core function, so a week can always be taken by
-- hand - after a correction, or when you simply want to watch it happen.
--
-- WHY THIS REVERSES SOMETHING WRITTEN IN ff_score_week.sql
-- That file says a Postgres function has no business making an outbound call to
-- a scoreboard. That was right while the only caller was a browser that could
-- fetch for itself and show the admin what was about to be written. It stops
-- being right the moment the requirement is "score with nobody present": there
-- is no browser to do the fetching then, and the alternatives are this or a
-- second deployable service. The objection was about *blind* writes, and the
-- answer to that is below - every run is recorded, with what it wrote.
--
-- WHY THE HTTP CALL AND THE SCORING ARE TWO DIFFERENT RUNS
-- pg_net does not block. net.http_get queues a request, returns an id, and the
-- reply lands in net._http_response some time later - so a single job cannot
-- both ask and read the answer. Each run therefore does two things:
--     1. consume the reply to the request the PREVIOUS run made, and score it
--     2. ask again, for whoever runs next
-- At a fifteen minute cadence that means results land within half an hour of a
-- game going final, which is well inside how fast anybody needs this.
--
-- WHY ESPN AND NOT PLAIN TEXT SPORTS
-- It answers with JSON. Postgres can take that apart with jsonb operators;
-- taking apart a page of HTML in plpgsql would be a parser nobody should have
-- to maintain in SQL. It is also the same source js/nfl-live-scores.js reads in
-- the browser, so the scheduled run and the button cannot disagree about what
-- the score was.
--
-- Run in the Supabase SQL editor. Safe to re-run.

do $guard$
begin
  if to_regclass('public._2026_picks') is null then
    raise exception
      'Wrong database: public._2026_picks does not exist here. Open the project '
      'named in js/supabase-config.js and run this again.';
  end if;

  if to_regprocedure('public._2026_score_week_core(integer,jsonb,boolean,boolean)') is null then
    raise exception
      'public._2026_score_week_core is missing. Run supabase/sql/ff_score_week.sql '
      'first - it was split out of the admin function and this depends on it.';
  end if;
end
$guard$;

-- pg_net is already here: supabase/sql/ff_notify_new_suspect.sql uses it to
-- post to GitHub when somebody joins. Named again because this file should be
-- runnable on a fresh project without reading that one.
create extension if not exists pg_net;
create extension if not exists pg_cron;


-- ---------------------------------------------------------------------------
-- THE LOG. One row per run, whatever happened.
--
-- The whole reason an unattended writer is acceptable: every run says what it
-- asked for, what came back, and what it wrote. A season that scored itself
-- wrongly and silently would be unrecoverable; one that scored itself wrongly
-- and said so is a Tuesday afternoon.
-- ---------------------------------------------------------------------------
create table if not exists public._2026_auto_score_log (
  id           bigint generated always as identity primary key,
  ran_at       timestamptz not null default now(),
  week         integer,
  -- The pg_net request this run consumed, and the one it queued.
  consumed_id  bigint,
  queued_id    bigint,
  http_status  integer,
  finals_count integer,
  outcome      text not null,
  report       jsonb
);

comment on table public._2026_auto_score_log is
  'One row per scheduled scoring run - see supabase/sql/ff_auto_score.sql. '
  'Read it when a week scored itself unexpectedly, or did not.';

create index if not exists _2026_auto_score_log_ran_at
  on public._2026_auto_score_log (ran_at desc);

alter table public._2026_auto_score_log enable row level security;

-- The admin reads it; nobody writes it but the job, which runs as the table's
-- owner and is not subject to these policies.
drop policy if exists "_2026_auto_score_log admin reads" on public._2026_auto_score_log;
create policy "_2026_auto_score_log admin reads"
  on public._2026_auto_score_log for select
  to authenticated
  using (public._2026_is_admin());

grant select on public._2026_auto_score_log to authenticated;


-- ---------------------------------------------------------------------------
-- WHICH WEEK IS OPEN. The same rule js/nfl-schedule.js applies in the browser:
-- the first week whose last kickoff is still ahead, so the week rolls over once
-- Monday night starts.
--
-- Weeks whose kickoff times are not announced yet cannot answer the question
-- and are skipped rather than treated as never starting - otherwise the season
-- would pin itself on the first flex-scheduled week forever.
-- ---------------------------------------------------------------------------
create or replace function public._2026_open_week()
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select s.week
      from public._2026_nfl_schedule s
      where s.season = 2026
        and s.kickoff_at_utc is not null
      group by s.week
      having max(s.kickoff_at_utc) > now()
      order by s.week
      limit 1
    ),
    -- Past the last announced kickoff: the season is over, or the schedule
    -- needs regenerating. Either way the last week is the one to keep scoring.
    (select max(s.week) from public._2026_nfl_schedule s where s.season = 2026),
    1
  );
$$;


-- ---------------------------------------------------------------------------
-- HAVE THE PICKS CLOSED. Also the browser's rule: the last game of the week has
-- kicked off, so there is no way left to file one and a missing pick is now an
-- elimination. A week still holding a game with no announced time cannot be
-- judged and counts as open.
-- ---------------------------------------------------------------------------
create or replace function public._2026_picks_closed(p_week integer)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when not exists (
      select 1 from public._2026_nfl_schedule s
      where s.season = 2026 and s.week = p_week
    ) then false
    when exists (
      select 1 from public._2026_nfl_schedule s
      where s.season = 2026 and s.week = p_week and s.kickoff_at_utc is null
    ) then false
    else (
      select max(s.kickoff_at_utc) <= now()
      from public._2026_nfl_schedule s
      where s.season = 2026 and s.week = p_week
    )
  end;
$$;


-- ---------------------------------------------------------------------------
-- THE SCOREBOARD, TURNED INTO WHAT THE SCORER WANTS.
--
-- Two entries per finished game, because a pick names one side:
--     [{"team": "Seattle Seahawks", "outcome": "won"},
--      {"team": "New England Patriots", "outcome": "lost"}]
--
-- `completed` rather than the status name, because a game can end as
-- STATUS_FINAL_OVERTIME and matching on the name alone would drop it. Equal
-- scores are reported as a tie and not flattened into a win: a tie eliminates
-- the same way, but the log should say which happened.
-- ---------------------------------------------------------------------------
create or replace function public._2026_finals_from_espn(p_body jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(entry), '[]'::jsonb)
  from (
    select jsonb_build_object(
             'team', side->'team'->>'displayName',
             'outcome', case
               when (side->>'score')::numeric > (other->>'score')::numeric then 'won'
               when (side->>'score')::numeric < (other->>'score')::numeric then 'lost'
               else 'tied'
             end
           ) as entry
    from jsonb_array_elements(coalesce(p_body->'events', '[]'::jsonb)) as event,
         lateral (
           select competition
           from jsonb_array_elements(coalesce(event->'competitions', '[]'::jsonb)) as competition
           limit 1
         ) as game,
         lateral jsonb_array_elements(coalesce(game.competition->'competitors', '[]'::jsonb)) as side,
         lateral (
           select c
           from jsonb_array_elements(coalesce(game.competition->'competitors', '[]'::jsonb)) as c
           where c->'team'->>'displayName' is distinct from side->'team'->>'displayName'
           limit 1
         ) as opponent(other)
    where (game.competition->'status'->'type'->>'completed')::boolean
      and side->>'score' is not null
      and other->>'score' is not null
  ) as finals;
$$;


-- ---------------------------------------------------------------------------
-- THE RUN. Consume the previous request, score it, queue the next one.
-- ---------------------------------------------------------------------------
create or replace function public._2026_auto_score()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp, net
as $auto$
declare
  v_week        integer := public._2026_open_week();
  v_previous    record;
  v_response    record;
  v_finals      jsonb := '[]'::jsonb;
  v_report      jsonb;
  v_outcome     text := 'queued';
  v_consumed    bigint;
  v_queued      bigint;
  v_url         text;
begin
  -- ---- 1. the reply to whatever the last run asked for ----
  select l.queued_id, l.week
    into v_previous
  from public._2026_auto_score_log l
  where l.queued_id is not null
  order by l.ran_at desc
  limit 1;

  if v_previous.queued_id is not null then
    select r.status_code, r.content
      into v_response
    from net._http_response r
    where r.id = v_previous.queued_id;

    if found and v_response.status_code = 200 then
      v_consumed := v_previous.queued_id;
      v_finals := public._2026_finals_from_espn(v_response.content::jsonb);

      -- Nothing final yet is not a failure and not worth a write. Said in the
      -- log, so a quiet week is distinguishable from a broken one.
      if jsonb_array_length(v_finals) = 0
         and not public._2026_picks_closed(v_previous.week) then
        v_outcome := 'nothing final yet';
      else
        v_report := public._2026_score_week_core(
          v_previous.week,
          v_finals,
          public._2026_picks_closed(v_previous.week),
          true
        );
        v_outcome := 'scored';
      end if;
    elsif found then
      v_outcome := 'http ' || v_response.status_code;
      v_consumed := v_previous.queued_id;
    else
      -- pg_net prunes responses after a while, and a reply that has not landed
      -- yet looks identical to one that was cleaned up. Either way: ask again.
      v_outcome := 'no reply';
    end if;
  end if;

  -- ---- 2. ask again, for whoever runs next ----
  v_url := format(
    'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
    '?dates=2026&seasontype=2&week=%s', v_week);

  select net.http_get(url := v_url, timeout_milliseconds := 8000) into v_queued;

  insert into public._2026_auto_score_log
    (week, consumed_id, queued_id, http_status, finals_count, outcome, report)
  values
    (v_week, v_consumed, v_queued, v_response.status_code,
     jsonb_array_length(v_finals), v_outcome, v_report);

  return jsonb_build_object(
    'week', v_week, 'outcome', v_outcome,
    'finals', jsonb_array_length(v_finals), 'queued', v_queued);
exception when others then
  -- A scheduled job that throws is a job that stops being looked at. Record it
  -- and return, so the next run still happens and the log says what went wrong.
  insert into public._2026_auto_score_log (week, outcome)
  values (v_week, 'error: ' || sqlerrm);
  return jsonb_build_object('week', v_week, 'outcome', 'error', 'error', sqlerrm);
end;
$auto$;

revoke all on function public._2026_auto_score() from public;


-- ---------------------------------------------------------------------------
-- THE SCHEDULE. Every fifteen minutes, all week.
--
-- Not narrowed to game days on purpose: a run on a quiet Wednesday costs one
-- HTTP request and writes one log row saying nothing was final, and the cost of
-- getting the window wrong - a Thursday night game in a week the cron does not
-- cover - is a week that silently never scores.
-- ---------------------------------------------------------------------------
select cron.unschedule('2026-auto-score')
where exists (select 1 from cron.job where jobname = '2026-auto-score');

select cron.schedule(
  '2026-auto-score',
  '*/15 * * * *',
  $cron$ select public._2026_auto_score(); $cron$
);


-- ---------------------------------------------------------------------------
-- Verify. The job should be listed, and the first run happens within fifteen
-- minutes - it will only queue a request, because there is nothing to consume
-- yet. The run after that is the one that scores.
-- ---------------------------------------------------------------------------
select jobname, schedule, active from cron.job where jobname = '2026-auto-score';

select public._2026_open_week() as open_week,
       public._2026_picks_closed(public._2026_open_week()) as picks_closed;

-- After a few minutes:
--   select ran_at, week, outcome, finals_count, http_status
--     from public._2026_auto_score_log order by ran_at desc limit 10;
