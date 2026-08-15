-- Finding and removing a stuck account.
--
-- An account lives in TWO places and deleting one does not remove the other:
--
--   auth.users     the login itself (email + password). Created by signUp.
--                  Lives in the `auth` schema, which the Table Editor hides
--                  behind the schema dropdown — switch it from `public` to
--                  `auth`, or use Authentication > Users in the sidebar.
--
--   ff_profiles    the game record (username, mugshot, names). Created by the
--                  join form right after signUp succeeds.
--
-- Deleting only the ff_profiles row leaves the login in place, and the join
-- form then reports "That email is already booked" — which is Supabase telling
-- the truth about auth.users.
--
-- Run the SELECTs first. Only run the DELETE once you have seen what it will
-- remove. Replace the address in both places.

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


-- 1. Is the login still there?
--    deleted_at matters: a soft-deleted user is still a row, still owns the
--    address, and still makes signUp answer "User already registered" — while
--    being hidden from the Authentication > Users list. banned_until behaves
--    the same way. If either is set, the row must still be deleted outright.
select id, email, created_at, last_sign_in_at, deleted_at, banned_until,
       email_confirmed_at
from auth.users
where email ilike 'you@example.com';

-- 1b. Cast a wider net. If the address above returns nothing, the account may
--     be under a variation you have forgotten (a +tag, a different domain, a
--     stray space). This lists every login, newest first.
select id, email, created_at, deleted_at
from auth.users
order by created_at desc
limit 50;

-- 2. Is a game record still there? A leftover row here trips the separate
--    "that username is already booked" error even after the login is gone.
select id, username, email, created_at
from public.ff_profiles
where email ilike 'you@example.com'
   or username ilike 'the_username';

-- 3. Everything that account touched, so nothing is deleted by surprise.
select p.week, p.team, p.result, p.created_at
from public.ff_picks p
join auth.users u on u.id = p.user_id
where u.email ilike 'you@example.com'
order by p.week;

-- 4. Remove it. Deleting the auth user cascades to its identities and
--    sessions; ff_profiles and ff_picks are removed explicitly here because
--    they may or may not carry ON DELETE CASCADE, and a silent orphan is
--    exactly what caused the confusion in the first place.
--
-- begin;
--   delete from public.ff_picks
--    where user_id in (select id from auth.users where email ilike 'you@example.com');
--
--   delete from public.ff_profiles
--    where id in (select id from auth.users where email ilike 'you@example.com');
--
--   delete from auth.users where email ilike 'you@example.com';
-- commit;

-- 5. Confirm both are gone. Both counts should be 0.
select
  (select count(*) from auth.users        where email ilike 'you@example.com') as logins_left,
  (select count(*) from public.ff_profiles where email ilike 'you@example.com') as profiles_left;
