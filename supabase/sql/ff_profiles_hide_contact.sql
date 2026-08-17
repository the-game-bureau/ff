-- Stop handing every player's email and surname to the whole internet.
--
-- WHAT WAS WRONG
-- _2026_profiles granted SELECT on the whole row to anon, so anyone with the
-- publishable key — which ships in the page source, by design — could read
-- every member's email, first name and last name:
--
--   curl '.../rest/v1/_2026_profiles?select=username,email,first_name,last_name' \
--        -H "apikey: <the public key>"
--
-- and get the entire roster's contact details back. The key is not the secret;
-- row-level security and the column grants are. This closes the column half.
--
-- WHAT THE SITE ACTUALLY READS FROM THIS TABLE
--   - signed out: id, username, avatar_data_url  (the lineup and the tracker)
--   - signed in:  the above plus first_name       (league members see each
--                 other's first names on the board)
-- Nothing in the browser ever reads email or last_name from this table. Those
-- two reach the admin screen only through _2026_admin_list_profiles, a
-- SECURITY DEFINER function that re-checks the caller — it runs as the function
-- owner, so these column grants do not touch it.
--
-- So: revoke the blanket column SELECT and hand each browser role back only the
-- columns it uses. INSERT and UPDATE are left exactly as they were — this is
-- about who can READ contact details, not about joining or editing.
--
-- WHY COLUMN GRANTS AND NOT A POLICY
-- Column privileges are enforced whatever the RLS policies say, and they cannot
-- be widened by a crafted request the way a row filter sometimes can. email and
-- last_name simply stop being selectable by anon or authenticated, full stop.
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- AFTER RUNNING, CHECK THREE THINGS — this could not be tested before shipping:
--   1. Signed OUT, the Suspects page and the Case File tracker still show the
--      lineup (needs id, username, avatar_data_url for anon).
--   2. Signed IN, first names still appear on the tracker.
--   3. The admin Suspect Records table still shows emails (that path is the RPC,
--      and must be unaffected).
-- If step 1 or 2 breaks, a needed column was missed — add it to the grant.

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


-- ---------------------------------------------------------------------------
-- Reset both browser roles to no column access, then grant back only what each
-- one reads. A plain REVOKE SELECT with no column list drops the table-wide
-- grant AND any column grants, so the state after this is exactly what the
-- GRANTs below spell out and nothing inherited from before.
-- ---------------------------------------------------------------------------
revoke select on public._2026_profiles from anon;
revoke select on public._2026_profiles from authenticated;

-- Signed out: the lineup and tracker, nothing personal.
grant select (id, username, avatar_data_url)
  on public._2026_profiles to anon;

-- Signed in: the same, plus the first name the board shows to league members.
grant select (id, username, first_name, avatar_data_url)
  on public._2026_profiles to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Verify. Expect email and last_name to appear for NEITHER role, and each role
-- to hold exactly the columns granted above.
-- ---------------------------------------------------------------------------
select grantee, string_agg(column_name, ', ' order by column_name) as selectable_columns
from information_schema.column_privileges
where table_schema = 'public'
  and table_name = '_2026_profiles'
  and privilege_type = 'SELECT'
  and grantee in ('anon', 'authenticated')
group by grantee
order by grantee;

-- Expected:
--   anon           avatar_data_url, id, username
--   authenticated  avatar_data_url, first_name, id, username
--
-- If either row lists email or last_name, the revoke did not take — check for a
-- separate grant to PUBLIC:
--   select grantee, privilege_type
--   from information_schema.column_privileges
--   where table_name = '_2026_profiles' and column_name = 'email';
