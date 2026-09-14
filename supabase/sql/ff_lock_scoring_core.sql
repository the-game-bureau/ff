-- The scoring engine is reachable by anybody with the publishable key.
--
-- WHAT IS WRONG
-- Two SECURITY DEFINER functions that are supposed to be unreachable from a
-- browser are not:
--
--   _2026_score_week_core(integer, jsonb, boolean, boolean)
--   _2026_auto_score()
--
-- The core is the one that matters. It takes the finals as an ARGUMENT and
-- writes SURVIVED / DUN DUN from them, and it has no admin check inside -
-- deliberately, because _2026_admin_score_week is the door that checks and the
-- cron job has nobody signed in to check. With it reachable as `anon`, anybody
-- who reads js/supabase-config.js (it is public by design, that is not the bug)
-- can post a made-up p_finals with p_commit => true and write whatever results
-- they like into the league. Verified against the live project: a signed-out
-- request reached it and came back with the whole roster.
--
-- WHY THE EXISTING REVOKE DID NOT DO IT
-- Both files say:
--
--     revoke all on function public._2026_score_week_core(...) from public;
--
-- `public` there is the PSEUDO-ROLE every role inherits - it is not the same
-- thing as the `public` SCHEMA in the name beside it, which is what makes this
-- so easy to misread. Supabase ships a default privilege:
--
--     alter default privileges in schema public
--       grant all on functions to postgres, anon, authenticated, service_role;
--
-- so every new function gets EXECUTE granted to `anon` and `authenticated`
-- BY NAME at creation. Revoking from the pseudo-role leaves both named grants
-- sitting there untouched. The revoke looks like it locked the door and did
-- nothing at all.
--
-- The scripts that got this right - ff_account_audit.sql, ff_suspect_colors.sql,
-- ff_admin_edit_profiles.sql, ff_apb_and_sms.sql - all say `from public, anon`.
-- That is the pattern. `from public` alone is not a lock.
--
-- THE RULE, for anything added later: revoking is not a default you can rely
-- on. Name every role you mean to exclude, and then run the check at the bottom
-- of this file, which asks the database rather than the script what is true.
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
-- THE LOCK. Both browser roles by name, both functions.
--
-- Nothing loses access that had it legitimately: `postgres` owns these and the
-- cron job runs as the owner, so the scheduled scoring is unaffected, and
-- js/admin-score.js goes through _2026_admin_score_week, which keeps its grant
-- to `authenticated` and its admin check.
-- ---------------------------------------------------------------------------
revoke all on function public._2026_score_week_core(integer, jsonb, boolean, boolean)
  from public, anon, authenticated;

revoke all on function public._2026_auto_score()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- And stop it happening to the next function somebody writes. This turns the
-- default off for functions created from here on; it cannot reach back and fix
-- the ones already made, which is what the revokes above are for.
--
-- Scoped to the role that creates them in the SQL editor. Anything created by a
-- different owner keeps the old default, which is the reason the check below
-- exists rather than trusting this line.
-- ---------------------------------------------------------------------------
alter default privileges in schema public
  revoke execute on functions from anon;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- THE CHECK. Every SECURITY DEFINER function in public that a browser role can
-- execute, and which role. A SECURITY DEFINER function runs as its owner, so
-- this list is the whole set of things the site can do that row-level security
-- does not get a say in.
--
-- What should be in it after this runs: the admin wrappers (each one checks
-- _2026_is_admin() itself), the rap-sheet pair (each scoped to auth.uid()),
-- and the small read-only helpers - _2026_is_out, _2026_no_pick_team,
-- _2026_email_registered. Anything that WRITES and does not check who is
-- asking should not be here. If a new one shows up, that is the bug.
-- ---------------------------------------------------------------------------
select p.proname as function_name,
       r.rolname as reachable_by,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (
  select rolname from pg_roles
  where rolname in ('anon', 'authenticated')
    and has_function_privilege(rolname, p.oid, 'EXECUTE')
) as r
where n.nspname = 'public'
  and p.prosecdef
order by p.proname, r.rolname;


-- The two this file is about. Both should come back with no rows at all.
select p.proname, r.rolname as still_reachable_by
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (
  select rolname from pg_roles
  where rolname in ('anon', 'authenticated')
    and has_function_privilege(rolname, p.oid, 'EXECUTE')
) as r
where n.nspname = 'public'
  and p.proname in ('_2026_score_week_core', '_2026_auto_score');
