-- Fixes: "No scheduled NFL game found for <team> in Week <n>" on pick save.
--
-- The trigger ff_apply_pick_schedule() looks the game up in ff_nfl_schedule.
-- It is a plain (SECURITY INVOKER) function, so that SELECT runs under the
-- calling user's row-level security. With RLS enabled on ff_nfl_schedule and
-- no SELECT policy, the trigger sees zero rows and raises — even though the
-- schedule is loaded. The table grants alone are not enough; RLS still applies.
--
-- Symptom check: this returns 0 for anon even when the table is populated.
--   select count(*) from public.ff_nfl_schedule;
--
-- Run this whole file in the Supabase SQL editor.

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
end
$guard$;


-- 1. The schedule is public reference data. Let anyone read it, so the client
--    can show matchups and kickoff times.
alter table public.ff_nfl_schedule enable row level security;

drop policy if exists ff_nfl_schedule_read on public.ff_nfl_schedule;
create policy ff_nfl_schedule_read
  on public.ff_nfl_schedule
  for select
  to anon, authenticated
  using (true);

-- 2. Belt and braces: the trigger should be able to validate a pick whatever
--    RLS says about the caller. SECURITY DEFINER runs it as the owner.
--    search_path is pinned so the function cannot be hijacked by a caller
--    putting a lookalike table earlier on their own search_path.
alter function public.ff_apply_pick_schedule() security definer;
alter function public.ff_apply_pick_schedule() set search_path = public, pg_temp;

-- 3. Verify. Expect 544 rows (32 teams x 17 games) and one row for the team
--    that was failing. If these come back empty, the schedule INSERT never
--    ran — re-run ff_schedule_and_pick_history.sql.
select count(*) as schedule_rows from public.ff_nfl_schedule;

select season, week, team, opponent, home_away, kickoff_at_utc
from public.ff_nfl_schedule
where season = 2026 and week = 1 and team = 'New York Jets';
