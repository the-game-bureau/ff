-- Who signed up but never landed on the board.
--
-- THE SYMPTOM
-- Somebody says they joined and they are not on the Suspects page, not in the
-- Suspect Tracker, not in the APB list. Every page on the site reads
-- _2026_profiles, so anybody without a row there is invisible everywhere at
-- once - even though their account exists and they can sign in.
--
-- HOW THAT HAPPENS
-- Joining is two steps: Supabase creates the auth user, then the site writes
-- the profile row. Anything that interrupts the second step - closing the tab on
-- the confirmation screen, a failed insert, confirming the email days later on a
-- device that never reopened the site - leaves an auth user with no profile.
--
-- THE FIX IS USUALLY NOTHING
-- js/username-gate.js repairs this on the next sign-in: it rebuilds the profile
-- from the signup metadata where it can and asks for a username where it
-- cannot. So the useful outcome of this query is normally "tell these people to
-- log in again", not a repair run by hand.
--
-- READ ONLY. Nothing here writes anything.

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
-- 1. THE ANSWER. Accounts with no profile row, newest first.
--
-- confirmed_at tells you which kind of stuck they are: null means they never
-- clicked the link in the email, so the account is half-made and they may not
-- even know. A confirmed account with no profile got further and is the one a
-- single sign-in will fix.
-- ---------------------------------------------------------------------------
select u.email,
       u.created_at                       as signed_up,
       u.email_confirmed_at               as confirmed_at,
       u.last_sign_in_at,
       u.raw_user_meta_data ->> 'username' as username_they_chose
  from auth.users u
  left join public._2026_profiles p on p.id = u.id
 where p.id is null
 order by u.created_at desc;


-- ---------------------------------------------------------------------------
-- 2. THE COUNTS, so the number on the board can be reconciled without counting
--    names by hand.
-- ---------------------------------------------------------------------------
select (select count(*) from auth.users)                  as auth_accounts,
       (select count(*) from public._2026_profiles)        as profiles,
       (select count(*) from public._2026_current_suspects) as on_the_board,
       (select count(*)
          from auth.users u
          left join public._2026_profiles p on p.id = u.id
         where p.id is null)                               as missing_a_profile;


-- ---------------------------------------------------------------------------
-- 3. THE OTHER DIRECTION, which should always be empty: a profile whose auth
--    user is gone. One of these means somebody was deleted from Authentication
--    without their profile going with them, and the board is showing a suspect
--    who can never sign in again.
-- ---------------------------------------------------------------------------
select p.username, p.id
  from public._2026_profiles p
  left join auth.users u on u.id = p.id
 where u.id is null
 order by p.username;


-- ---------------------------------------------------------------------------
-- 4. THE LAST FEW SIGNUPS, profile or not. If somebody insists they joined and
--    they are not in query 1 either, this says whether an account was ever
--    created at all - which usually means they filled the form in and never
--    submitted it.
-- ---------------------------------------------------------------------------
select u.email,
       u.created_at as signed_up,
       u.email_confirmed_at is not null as confirmed,
       p.username
  from auth.users u
  left join public._2026_profiles p on p.id = u.id
 order by u.created_at desc
 limit 15;
