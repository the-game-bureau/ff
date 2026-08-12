-- Let a player change their pick.
--
-- THE PROBLEM
-- ff_picks carries a unique constraint on (user_id, week). Submitting a second
-- pick for a week is an INSERT, so it hits that constraint and the page reports
--   duplicate key value violates unique constraint "ff_picks_user_week_key"
-- A player who wants to switch teams before kickoff simply cannot.
--
-- THE FIX
-- Drop the constraint and let the change be a new row. Nothing is overwritten
-- and nothing is deleted: the earlier pick stays as a record of what they
-- originally said.
--
-- This works because the site never reads the raw table. Every consumer runs
-- the picks through activePicksFromHistory(), which keeps only the newest row
-- per player per week — js/victims.js for the grid and the lock state,
-- js/app.js for the standings, the timeline and the Pick Ticker. Adding a row
-- is therefore the same as replacing one, with the history kept for free.
--
-- Run once in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- 1. Confirm the constraint is there and see its exact name. It is normally
--    ff_picks_user_week_key, but a table rebuilt by hand may name it something
--    else, and step 2 needs the real name.
-- ---------------------------------------------------------------------------
select con.conname as constraint_name,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'ff_picks'
  and con.contype in ('u', 'p')
order by con.conname;

-- ---------------------------------------------------------------------------
-- 2. Drop them. Adjust the names if step 1 reported different ones.
--    IF EXISTS so re-running the file is harmless.
--
--    THERE ARE TWO, and both have to go:
--
--    ff_picks_user_week_key  (user_id, week)
--      Blocks changing your mind at all — a second pick for the same week is a
--      second row.
--
--    ff_picks_user_team_key  (user_id, team)
--      Blocks going back to a team you once picked and then moved off. Say you
--      pick Miami in Week 1 and switch to Buffalo: the superseded Miami row is
--      still there, so naming Miami again in any week collides with it. The
--      constraint was enforcing "one team per season" at the table, which no
--      longer works now that superseded picks are kept as history.
--
--      That rule is not lost. usedInOtherWeek() in js/victims.js checks it
--      against the de-duplicated active picks, which is the only version that
--      is actually correct: a team you picked and then abandoned was never
--      really used, and the database cannot tell the difference.
-- ---------------------------------------------------------------------------
alter table public.ff_picks
  drop constraint if exists ff_picks_user_week_key;

alter table public.ff_picks
  drop constraint if exists ff_picks_user_team_key;

-- A unique index created outside a constraint enforces the same rule and would
-- survive the statements above, so remove those forms too.
drop index if exists public.ff_picks_user_week_key;
drop index if exists public.ff_picks_user_team_key;

-- ---------------------------------------------------------------------------
-- 3. Verify. The constraint should be gone; only the primary key remains.
-- ---------------------------------------------------------------------------
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'ff_picks'
  and con.contype in ('u', 'p');

-- ---------------------------------------------------------------------------
-- 4. Optional, for later: how often anyone actually changed their mind. Rows
--    beyond the first for a player and week are superseded picks, kept but
--    never shown.
-- ---------------------------------------------------------------------------
-- select user_id, week, count(*) as submissions
-- from public.ff_picks
-- group by user_id, week
-- having count(*) > 1
-- order by week, submissions desc;
