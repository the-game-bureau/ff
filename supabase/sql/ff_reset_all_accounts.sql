-- FULL ACCOUNT RESET — every login in this Supabase project.
--
-- ============================================================================
-- READ THIS FIRST
-- This empties auth.users, not just this game's tables. Every account in the
-- project is destroyed, including any belonging to another site that shares
-- it. Those people can no longer log in anywhere, and whatever rows they own
-- in that other site's tables are left with no owner.
--
-- There is no undo. There is no soft-delete. Supabase does not keep a copy.
--
-- You will also lock yourself out of admin/index.html. That page checks for an
-- ff_profiles row with username 'theclarinetofjustice'; after this runs, no
-- such row exists. Getting back in means joining again through /join/ and
-- claiming that username. Do that first, before you need the admin page.
-- ============================================================================
--
-- Run sections 1 and 2 and read the output. Only then uncomment section 4.

-- ---------------------------------------------------------------------------
-- 1. Inventory. What is about to be destroyed, and how much of it belongs to
--    something other than this game.
-- ---------------------------------------------------------------------------
select
  (select count(*) from auth.users)          as logins_total,
  (select count(*) from public.ff_profiles)  as league_members,
  (select count(*) from public.ff_picks)     as picks,
  (select count(*) from auth.users u
     where not exists (select 1 from public.ff_profiles p where p.id = u.id))
                                             as logins_not_in_this_league;

-- ---------------------------------------------------------------------------
-- 2. What else points at auth.users. This is the section that decides whether
--    section 4 succeeds or errors out.
--
--    Any foreign key listed here that is NOT "CASCADE" will block the delete
--    until that table is cleared first. Rows in tables you do not recognise
--    belong to the other site — they are the reason this operation is not
--    reversible in any meaningful sense.
-- ---------------------------------------------------------------------------
select
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  rc.delete_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
 and kcu.constraint_schema = tc.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.constraint_schema = tc.constraint_schema
join information_schema.referential_constraints rc
  on rc.constraint_name = tc.constraint_name
 and rc.constraint_schema = tc.constraint_schema
where tc.constraint_type = 'FOREIGN KEY'
  and ccu.table_schema = 'auth'
  and ccu.table_name = 'users'
order by rc.delete_rule, tc.table_schema, tc.table_name;

-- ---------------------------------------------------------------------------
-- 3. Last look at who is being removed. Skim it. This is the only chance to
--    notice an address that should have been kept.
-- ---------------------------------------------------------------------------
select u.email, u.created_at, u.last_sign_in_at,
       (p.id is not null) as was_league_member
from auth.users u
left join public.ff_profiles p on p.id = u.id
order by u.created_at;

-- ---------------------------------------------------------------------------
-- 4. THE WIPE. Uncomment to run.
--
--    Order matters: the game's own tables go first so their foreign keys stop
--    referencing auth.users, then the logins themselves. Deleting auth.users
--    cascades to auth.identities, auth.sessions and auth.refresh_tokens.
--
--    If this errors with a foreign key violation, the blocking table is one
--    listed in section 2 with a delete_rule other than CASCADE — almost
--    certainly the other site's. Clear that table first, or add ON DELETE
--    CASCADE to its constraint, then run this again.
-- ---------------------------------------------------------------------------
-- begin;
--   delete from public.ff_picks;
--   delete from public.ff_profiles;
--   delete from auth.users;
-- commit;

-- ---------------------------------------------------------------------------
-- 5. Confirm. All three should be 0.
-- ---------------------------------------------------------------------------
select
  (select count(*) from auth.users)         as logins_left,
  (select count(*) from public.ff_profiles) as profiles_left,
  (select count(*) from public.ff_picks)    as picks_left;

-- ---------------------------------------------------------------------------
-- AFTERWARDS
--   * Go to /join/ and register 'theclarinetofjustice' again, or the admin
--     page stays locked.
--   * Any browser still holding a session will keep sending a token for a user
--     that no longer exists. Those requests fail until the person signs out or
--     clears site data.
--   * Emails are free for reuse immediately.
-- ---------------------------------------------------------------------------
