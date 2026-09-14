-- The open week is decided by the LEAGUE, not by the clock.
--
-- THE OLD RULE
-- `_2026_open_week()` returned the first week whose last kickoff was still in
-- the future, and js/nfl-schedule.js said the same thing in JavaScript. So the
-- board rolled over the moment the Monday night game STARTED - while a suspect
-- whose case turned on that game was still waiting on it, and while the week
-- they were still in was already being called last week.
--
-- THE NEW RULE
-- A week is done when both of these are true:
--
--   1. Every pick that still counts has a verdict. "Relevant" means a surviving
--      suspect picked in it; a closed case filing for fun holds up nothing.
--   2. Either every surviving suspect filed for that week, or nobody can file
--      any more - five minutes past the last kickoff of the week.
--
-- The open week is the first week for which that is NOT true.
--
-- Why (2) has two halves: (1) alone stalls forever on somebody who never files,
-- because a pick that does not exist never gets a verdict. The second half is
-- the backstop. It is five minutes AFTER the last kickoff rather than before it
-- for slack only - picks already lock five minutes BEFORE their own game, so by
-- the time the last one starts there has been nothing to file for some minutes.
--
-- WHY "GONE FINAL" IS READ AS "HAS A VERDICT"
-- public._2026_nfl_schedule holds kickoff times and nothing else - no scores, no
-- final flag - so the database cannot see a whistle. What it can see is the
-- scorer's verdict, and the scorer only writes one for a game that is final.
-- That makes the verdict the database's one honest signal of finality, and it
-- has a second virtue: the week cannot advance past results that have not been
-- written yet, which is the state somebody reloading the page is asking about.
--
-- THE COST OF THAT, STATED PLAINLY: the roll now waits on the scorer having
-- run. supabase/sql/ff_auto_score.sql runs every five minutes through the
-- window either side of a game finishing, so the lag is minutes - but if
-- scoring is broken, the week stays put. That is the right failure: a league
-- whose results are not in has not finished the week.
--
-- WHY THIS LIVES HERE AND NOT IN THE BROWSER
-- It needs the picks, the results and the roster together, which is what this
-- database is. And the auto-scorer already calls this function to decide what
-- to score - so if the rule were reimplemented in JavaScript the two would
-- drift, and the failure mode is the scorer writing results for one week while
-- the site shows another. One definition, both readers.
--
-- Run in the Supabase SQL editor. Safe to re-run. Changes no data.

do $guard$
begin
  if to_regclass('public._2026_picks') is null then
    raise exception
      'Wrong database: public._2026_picks does not exist here. Open the project '
      'named in js/supabase-config.js and run this again.';
  end if;
end
$guard$;


create or replace function public._2026_open_week()
returns integer
language sql
stable
set search_path = public, pg_temp
as $$
with
-- Everybody still in it going into each week: no DUN DUN in any EARLIER week.
-- The week that closed somebody still counts them, because they were playing
-- when it happened - the same boundary the board draws.
alive as (
  select w.week, p.id
  from generate_series(1, 18) as w(week)
  cross join public._2026_profiles p
  where not exists (
    select 1
    from public._2026_active_picks ap
    where ap.user_id = p.id
      and ap.week < w.week
      and upper(btrim(coalesce(ap.result, ''))) = 'DUN DUN'
  )
),
-- What each of them has on file for that week, if anything. SKIP is a tombstone
-- for a released week, not a pick, so it reads here as nothing filed.
filed as (
  select a.week,
         (ap.user_id is not null) as has_pick,
         upper(btrim(coalesce(ap.result, ''))) as verdict
  from alive a
  left join public._2026_active_picks ap
    on ap.user_id = a.id
   and ap.week = a.week
   and coalesce(upper(btrim(ap.result)), '') <> 'SKIP'
),
per_week as (
  select f.week,
         count(*) as alive_count,
         count(*) filter (where f.has_pick) as picked,
         -- Filed and still unanswered: the game it turns on has not gone final,
         -- or has and is not scored yet.
         count(*) filter (
           where f.has_pick and f.verdict not in ('SURVIVED', 'DUN DUN')
         ) as awaiting
  from filed f
  group by f.week
),
last_kickoff as (
  select s.week, max(s.kickoff_at_utc) as at
  from public._2026_nfl_schedule s
  where s.season = 2026
  group by s.week
),
state as (
  select pw.week,
         pw.awaiting = 0                     as settled,
         pw.picked   = pw.alive_count        as everyone_filed,
         (lk.at is not null and now() >= lk.at + interval '5 minutes') as shut
  from per_week pw
  left join last_kickoff lk on lk.week = pw.week
)
select coalesce(
  -- The first week that has not finished. Note what makes this stable once a
  -- week is behind us: `shut` is permanent, so a late joiner turning
  -- everyone_filed false again cannot reopen a week that has already rolled.
  (select min(s.week) from state s where not (s.settled and (s.everyone_filed or s.shut))),
  -- Everything has finished: the season is over. Keep the last week rather than
  -- running off the end of the schedule.
  (select max(s.week) from state s),
  1
);
$$;

revoke all on function public._2026_open_week() from public;
grant execute on function public._2026_open_week() to anon, authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Verify. The middle three columns are the rule, spelled out per week; the open
-- week is the first row where `done` is false.
-- ---------------------------------------------------------------------------
with
alive as (
  select w.week, p.id
  from generate_series(1, 18) as w(week)
  cross join public._2026_profiles p
  where not exists (
    select 1 from public._2026_active_picks ap
    where ap.user_id = p.id and ap.week < w.week
      and upper(btrim(coalesce(ap.result, ''))) = 'DUN DUN'
  )
),
filed as (
  select a.week, (ap.user_id is not null) as has_pick,
         upper(btrim(coalesce(ap.result, ''))) as verdict
  from alive a
  left join public._2026_active_picks ap
    on ap.user_id = a.id and ap.week = a.week
   and coalesce(upper(btrim(ap.result)), '') <> 'SKIP'
),
per_week as (
  select f.week, count(*) as alive_count,
         count(*) filter (where f.has_pick) as picked,
         count(*) filter (where f.has_pick and f.verdict not in ('SURVIVED','DUN DUN')) as awaiting
  from filed f group by f.week
),
last_kickoff as (
  select s.week, max(s.kickoff_at_utc) as at
  from public._2026_nfl_schedule s where s.season = 2026 group by s.week
)
select pw.week,
       pw.alive_count,
       pw.picked,
       pw.awaiting,
       lk.at as last_kickoff,
       pw.awaiting = 0 as settled,
       pw.picked = pw.alive_count as everyone_filed,
       (lk.at is not null and now() >= lk.at + interval '5 minutes') as shut,
       (pw.awaiting = 0 and (pw.picked = pw.alive_count
         or (lk.at is not null and now() >= lk.at + interval '5 minutes'))) as done
from per_week pw
left join last_kickoff lk on lk.week = pw.week
order by pw.week
limit 6;

select public._2026_open_week() as open_week;
