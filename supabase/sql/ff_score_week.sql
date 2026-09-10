-- Turning NFL results into league results.
--
-- WHAT WAS MISSING
-- Nothing on the site ever wrote SURVIVED or DUN DUN. Every reference to them in
-- js/ reads; the only writer of `result` is the pick flow, writing PICK IS IN
-- and SKIP. Scoring a week meant opening the Supabase table editor and typing
-- thirty rows by hand, and nothing anywhere said so.
--
-- WHAT SCORING IS
--   picked a team that LOST  -> SURVIVED
--   picked a team that WON   -> DUN DUN
--   picked a team that TIED  -> DUN DUN   (the rules say win or tie)
--   filed no pick at all     -> DUN DUN   (once the last game has kicked off)
--
-- The finals come in from the browser, out of js/nfl-scores.js, which
-- tools/update-nfl-scores.mjs regenerates from the same Plain Text Sports page
-- the schedule is built from. The database is told the outcome, not asked to go
-- and find it: a Postgres function has no business making an outbound HTTP call
-- to a scoreboard, and this way the admin can see exactly what is about to be
-- written before any of it is.
--
-- WHY THIS UPDATES A TABLE THAT IS DOCUMENTED AS APPEND-ONLY
-- CLAUDE.md says nothing is ever updated in the picks table, and that rule is
-- about CHANGING A PICK: the newest row for a (user, week) wins, so a change is
-- an insert and history is never rewritten. A result is not a pick. It is the
-- world's verdict on one that was already made, it arrives after the fact, and
-- it belongs on the row it judges. So this function updates `result` and
-- nothing else - not user, not week, not team - and it is the only thing that
-- may.
--
-- Run in the Supabase SQL editor. Safe to re-run, and safe to run twice on the
-- same week: scoring is idempotent.

-- ---------------------------------------------------------------------------
-- WRONG-DATABASE GUARD. The Supabase editor gives no hint which project is
-- open, and these scripts have been run against the wrong one: they succeed,
-- report a clean pass, and change nothing the site can see. _2026_picks is the
-- marker because it exists only in the project js/supabase-config.js points at.
-- The editor runs a file as one transaction, so this raise rolls back
-- everything after it.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public._2026_picks') is null then
    raise exception
      'Wrong database: public._2026_picks does not exist here. Open the project '
      'named in js/supabase-config.js and run this again.';
  end if;

  if to_regprocedure('public._2026_is_admin()') is null then
    raise exception
      'public._2026_is_admin() is missing. Run the admin migrations first.';
  end if;
end
$guard$;


-- ---------------------------------------------------------------------------
-- The team on a row that stands for "this suspect never filed". It is not a
-- real club, deliberately: the readers show it as a missed week rather than as
-- a pick, and nothing can collide with it because no NFL team is called this.
-- ---------------------------------------------------------------------------
create or replace function public._2026_no_pick_team()
returns text language sql immutable as $nopick$ select 'NO PICK'::text $nopick$;

revoke all on function public._2026_no_pick_team() from public;
grant execute on function public._2026_no_pick_team() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- The insert trigger, with one addition: an admin is let past the window
-- checks.
--
-- Everything below the guard is the original from
-- supabase/migration-2026/020_after_restore_prefix_public_objects.sql, verbatim.
-- The guard is at the top because the checks it skips all exist to stop a
-- PLAYER filing a late or duplicate pick, and none of them describe what the
-- scoring function does: writing a "never filed" row for a week that is
-- already over is exactly the thing they are built to refuse, and exactly the
-- thing that has to be recorded.
--
-- An admin cannot use this to file a real pick late either, because the only
-- thing that inserts as admin is _2026_admin_score_week below, and it only ever
-- inserts the NO PICK sentinel.
-- ---------------------------------------------------------------------------
create or replace function public._2026_apply_pick_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  schedule_row public._2026_nfl_schedule%rowtype;
  current_pick_team text;
  current_pick_schedule public._2026_nfl_schedule%rowtype;
begin
  if new.season is null then
    new.season := 2026;
  end if;

  if new.submitted_at_utc is null then
    new.submitted_at_utc := now();
  end if;

  if new.result is null then
    new.result := 'SUSPECT';
  end if;

  -- The scoring function's row. No schedule to attach, no window to be inside,
  -- and no team to have used up somewhere else.
  if new.team = public._2026_no_pick_team() and public._2026_is_admin() then
    return new;
  end if;

  select * into schedule_row
  from public._2026_nfl_schedule
  where season = new.season
    and week = new.week
    and team = new.team;

  if not found then
    raise exception 'No scheduled NFL game found for % in Week %', new.team, new.week;
  end if;

  if schedule_row.kickoff_at_utc is not null
     and now() >= schedule_row.kickoff_at_utc - interval '2 minutes' then
    raise exception 'Pick window closed for % in Week %', new.team, new.week;
  end if;

  select latest_pick.team into current_pick_team
  from (
    select team
    from public._2026_picks
    where user_id = new.user_id
      and season = new.season
      and week = new.week
    order by submitted_at_utc desc, created_at desc
    limit 1
  ) latest_pick;

  if current_pick_team is not null and current_pick_team <> new.team then
    select * into current_pick_schedule
    from public._2026_nfl_schedule
    where season = new.season
      and week = new.week
      and team = current_pick_team;

    if found
       and current_pick_schedule.kickoff_at_utc is not null
       and now() >= current_pick_schedule.kickoff_at_utc - interval '2 minutes' then
      raise exception 'Week % is locked because % already reached its pick window', new.week, current_pick_team;
    end if;
  end if;

  if exists (
    select 1
    from (
      select distinct on (week) week, team, result
      from public._2026_picks
      where user_id = new.user_id
        and season = new.season
        and week <> new.week
      order by week, submitted_at_utc desc, created_at desc
    ) latest_by_week
    where latest_by_week.team = new.team
      and coalesce(upper(btrim(latest_by_week.result)), '') <> 'SKIP'
  ) then
    raise exception '% has already been named in another week', new.team;
  end if;

  new.opponent := schedule_row.opponent;
  new.home_away := schedule_row.home_away;
  new.kickoff_at_utc := schedule_row.kickoff_at_utc;
  new.schedule_source_url := schedule_row.source_url;
  return new;
end;
$$;

drop trigger if exists _2026_apply_pick_schedule_before_insert on public._2026_picks;
create trigger _2026_apply_pick_schedule_before_insert
before insert on public._2026_picks
for each row
execute function public._2026_apply_pick_schedule();


-- ---------------------------------------------------------------------------
-- SCORE A WEEK.
--
-- p_finals is what the browser read out of js/nfl-scores.js, one entry per team
-- in a finished game:
--     [{"team": "Seattle Seahawks", "outcome": "won"},
--      {"team": "New England Patriots", "outcome": "lost"}]
--
-- p_picks_closed says the last game of the week has kicked off. Only then is a
-- missing pick an elimination, because only then was it possible to file one:
-- mid-week somebody with no pick has not run out of time yet, and a Thursday
-- night result must not end their season.
--
-- The last KICKOFF, not the last final. Picks lock five minutes before their own
-- team's game, so once the last game of the week has started there is no way
-- left to file - waiting for that game to end would just be waiting.
--
-- p_commit false returns exactly what a commit would do, and writes nothing.
-- Nothing about this is worth doing blind.
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced: PostgreSQL will not let CREATE OR REPLACE
-- rename an argument, and this one used to be called p_week_complete.
drop function if exists public._2026_admin_score_week(integer, jsonb, boolean, boolean);

create or replace function public._2026_admin_score_week(
  p_week         integer,
  p_finals       jsonb,
  p_picks_closed boolean default false,
  p_commit       boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $score$
declare
  v_season   integer := 2026;
  v_survived jsonb := '[]'::jsonb;
  v_dun_dun  jsonb := '[]'::jsonb;
  v_no_pick  jsonb := '[]'::jsonb;
  v_pending  jsonb := '[]'::jsonb;
  v_row      record;
  v_outcome  text;
  v_verdict  text;
begin
  if not public._2026_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if p_week is null or p_week < 1 then
    raise exception 'Which week?' using errcode = '22023';
  end if;

  -- ---- picks that were actually filed ----
  for v_row in
    select ap.user_id, ap.week, ap.team, ap.result,
           coalesce(p.username, ap.username, '(unknown)') as username
    from public._2026_active_picks ap
    left join public._2026_profiles p on p.id = ap.user_id
    where ap.season = v_season
      and ap.week = p_week
      and coalesce(upper(btrim(ap.result)), '') <> 'SKIP'
      and ap.team <> public._2026_no_pick_team()
  loop
    -- Read straight out of the argument. This used to build a temporary table,
    -- which is the one thing in here that could fail on a second run in the same
    -- pooled connection - and being run over and over through the week is the
    -- whole point.
    select lower(btrim(entry->>'outcome')) into v_outcome
    from jsonb_array_elements(coalesce(p_finals, '[]'::jsonb)) as entry
    where lower(btrim(entry->>'team')) = lower(btrim(v_row.team))
    limit 1;

    if v_outcome is null then
      -- The game has not finished. Left exactly as it is.
      v_pending := v_pending || jsonb_build_object(
        'username', v_row.username, 'team', v_row.team);
      continue;
    end if;

    -- Win or tie is an elimination. The whole game is picking a loser.
    v_verdict := case when v_outcome = 'lost' then 'SURVIVED' else 'DUN DUN' end;

    if v_verdict = 'SURVIVED' then
      v_survived := v_survived || jsonb_build_object(
        'username', v_row.username, 'team', v_row.team);
    else
      v_dun_dun := v_dun_dun || jsonb_build_object(
        'username', v_row.username, 'team', v_row.team);
    end if;

    if p_commit then
      -- The newest row for the week, and only its result. Written even when it
      -- already says the same thing, so re-scoring a week is a no-op rather
      -- than an error.
      update public._2026_picks pk
      set result = v_verdict
      where pk.user_id = v_row.user_id
        and pk.season = v_season
        and pk.week = p_week
        and pk.team = v_row.team
        and pk.created_at = (
          select max(inner_pick.created_at)
          from public._2026_picks inner_pick
          where inner_pick.user_id = v_row.user_id
            and inner_pick.season = v_season
            and inner_pick.week = p_week
        );
    end if;
  end loop;

  -- ---- suspects who never filed ----
  -- Only once the last game has started, and only for suspects still in the
  -- game: a season that ended in Week 3 does not end again every week after it.
  if p_picks_closed then
    for v_row in
      select p.id as user_id, p.username
      from public._2026_profiles p
      where not exists (
              select 1 from public._2026_active_picks ap
              where ap.user_id = p.id
                and ap.season = v_season
                and ap.week = p_week
                and coalesce(upper(btrim(ap.result)), '') <> 'SKIP'
            )
        and not exists (
              select 1 from public._2026_active_picks out_pick
              where out_pick.user_id = p.id
                and out_pick.season = v_season
                and upper(btrim(out_pick.result)) = 'DUN DUN'
            )
      order by p.username
    loop
      v_no_pick := v_no_pick || jsonb_build_object('username', v_row.username);

      if p_commit then
        insert into public._2026_picks (user_id, season, week, team, username, result)
        values (v_row.user_id, v_season, p_week, public._2026_no_pick_team(),
                v_row.username, 'DUN DUN');
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'week', p_week,
    'committed', p_commit,
    'picks_closed', p_picks_closed,
    'survived', v_survived,
    'dun_dun', v_dun_dun,
    'no_pick', v_no_pick,
    'pending', v_pending
  );
end;
$score$;

revoke all on function public._2026_admin_score_week(integer, jsonb, boolean, boolean) from public;
grant execute on function public._2026_admin_score_week(integer, jsonb, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Verify. Expect the function to exist and be executable by authenticated only,
-- and a dry run on Week 1 with no finals to report everything as pending.
-- ---------------------------------------------------------------------------
select p.proname, r.rolname as granted_to
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (
  select rolname from pg_roles
  where rolname in ('anon', 'authenticated')
    and has_function_privilege(rolname, p.oid, 'EXECUTE')
) as r
where n.nspname = 'public'
  and p.proname in ('_2026_admin_score_week', '_2026_no_pick_team')
order by p.proname, r.rolname;
