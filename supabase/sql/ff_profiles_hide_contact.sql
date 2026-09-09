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
--   - signed out: id, username, avatar_data_url, color_primary,
--                 color_secondary                 (the lineup and the tracker)
--   - signed in:  the above plus first_name       (league members see each
--                 other's first names on the board)
-- The two colour columns arrived with supabase/sql/ff_suspect_colors.sql and
-- are as public as the mugshot they were sampled from — they are painted onto a
-- page anyone can open. They are listed here because this file revokes before
-- it grants: leave them out and re-running it silently takes every hand-picked
-- suspect colour off the site.
--
-- email and last_name reach the admin screen through _2026_admin_list_profiles,
-- a SECURITY DEFINER function that re-checks the caller. It runs as the function
-- owner, so these column grants do not touch it.
--
-- ONE PATH DID READ email, AND THIS BROKE IT
-- The header used to claim nothing in the browser read email from this table.
-- Sign-in did. resolveLoginEmail() in js/app.js and js/auth-corner.js accepted a
-- username, looked up that member's address here, and handed it to Supabase.
-- As anon, that select now fails with 42501, the fallback passed the raw
-- username on as if it were an address, and every username sign-in failed as
-- "invalid credentials" with nothing on screen to explain it. Reset Password was
-- already reading the same field as an address, so a typed name broke that too.
-- Fixed by making the email address the credential: both modules were rewritten
-- to sign in with what is typed, and the field is type="email". Do not restore
-- the lookup through an RPC - a function turning any public username into a
-- private address is this same leak through a narrower straw.
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
grant select (id, username, avatar_data_url, color_primary, color_secondary)
  on public._2026_profiles to anon;

-- Signed in: the same, plus the first name the board shows to league members.
grant select (id, username, first_name, avatar_data_url, color_primary, color_secondary)
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
