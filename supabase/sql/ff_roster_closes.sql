-- The suspect list is final once Week 1 has kicked off.
--
-- THE RULE
-- Five minutes after the last game of Week 1 starts, nobody else joins this
-- season. The same instant the Week 1 pick window shuts, which is not a
-- coincidence: anybody who has not filed by then has not played week one, and a
-- survivor pool somebody enters in week four is a different game from the one
-- everybody else entered.
--
-- WHY THIS EXISTS AND NOT JUST THE BUTTONS
-- js/join-modal.js turns away every route into the booking form once the
-- deadline passes, which is what an honest visitor meets. This is the rule. The
-- form is a page anybody can read, the publishable key is public by design, and
-- an insert is one request - so a closed roster enforced only in the browser is
-- a request away from being open. Same reasoning as ff_apply_pick_schedule():
-- the client's rules are enforced twice, and a client change alone cannot
-- loosen them.
--
-- WHAT IT DOES NOT DO
-- It does not touch auth. Signing up for an account still works, and so it
-- should - somebody mid-signup when the whistle goes has an account and no
-- profile, which is the Unbooked state the admin page already lists and which
-- js/username-gate.js already understands. What they cannot do is appear on the
-- board. Turning off signup would also lock out the recovery and login paths,
-- which belong to the people already playing.
--
-- AN EXISTING SUSPECT IS UNAFFECTED. This fires on INSERT only, so every
-- profile already on the board keeps working and can still be edited.
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


-- ---------------------------------------------------------------------------
-- WHEN THE DOOR SHUTS. One expression, so the trigger below and anything that
-- wants to show the deadline cannot come to different conclusions.
--
-- Derived from the schedule rather than stored, like every other deadline here.
-- Null when Week 1 has no announced kickoff yet, which reads downstream as "not
-- closed" - the safe direction, since the failure it guards against is turning
-- somebody away by mistake.
-- ---------------------------------------------------------------------------
create or replace function public._2026_roster_closes_at()
returns timestamptz
language sql
stable
set search_path = public, pg_temp
as $$
  select max(s.kickoff_at_utc) + interval '5 minutes'
  from public._2026_nfl_schedule s
  where s.season = 2026
    and s.week = 1
    and s.kickoff_at_utc is not null;
$$;

revoke all on function public._2026_roster_closes_at() from public;
grant execute on function public._2026_roster_closes_at() to anon, authenticated;


create or replace function public._2026_roster_is_closed()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(now() >= public._2026_roster_closes_at(), false);
$$;

revoke all on function public._2026_roster_is_closed() from public;
grant execute on function public._2026_roster_is_closed() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- THE LOCK ITSELF.
--
-- The admin is exempt: adding somebody who joined on time and got lost between
-- the auth signup and the profile insert is a real repair, and it should not
-- need this file edited to do it. _2026_is_admin() is the same check every
-- admin function here makes.
-- ---------------------------------------------------------------------------
create or replace function public._2026_roster_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $guard$
begin
  if public._2026_roster_is_closed() and not public._2026_is_admin() then
    raise exception
      'The suspect list is final for this season. Please play next year.'
      using errcode = '22023';
  end if;

  return new;
end;
$guard$;

drop trigger if exists trg_2026_roster_closed on public._2026_profiles;

create trigger trg_2026_roster_closed
before insert on public._2026_profiles
for each row
execute function public._2026_roster_closed_guard();


-- ---------------------------------------------------------------------------
-- Verify. When the door shuts, whether it has, and that the trigger is on.
-- ---------------------------------------------------------------------------
select public._2026_roster_closes_at() as closes_at,
       public._2026_roster_is_closed() as closed_now,
       now() as checked_at;

select tgname, tgenabled
from pg_trigger
where tgrelid = 'public._2026_profiles'::regclass
  and not tgisinternal
order by tgname;
