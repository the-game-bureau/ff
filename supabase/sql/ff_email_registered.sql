-- Tell a password reset apart from "you were never rolled over".
--
-- WHY THIS EXISTS
-- auth.resetPasswordForEmail() succeeds whether or not the address has an
-- account — Supabase does that on purpose so a stranger cannot probe a project
-- for valid addresses. Correct for a public sign-up, wrong for this pool: the
-- 2026 project is brand new and nobody from 2025 was carried over, so a
-- returning player asks for a reset, is told the mail is on its way, and then
-- waits forever for an email that was never going to be sent. They need to be
-- told to JOIN, not to check their spam folder.
--
-- So the reset button asks this function first and only sends when the address
-- actually has a 2026 account.
--
-- THE TRADE
-- This is an email-enumeration oracle: anyone can type an address in and learn
-- whether it plays in this pool. That is the thing Supabase's silence was
-- protecting, and it is being given up knowingly. The pool is ~32 people who
-- know each other, the answer leaks nothing but pool membership, and no
-- password, session or profile data is reachable through it. If that trade ever
-- stops being worth it, drop the grant to anon and let the button go back to
-- the vague message.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

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

create or replace function public._2026_email_registered(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(trim(p_email))
      and u.deleted_at is null
  );
$$;

revoke all on function public._2026_email_registered(text) from public;
-- anon needs it: the person asking for a reset is by definition signed out.
grant execute on function public._2026_email_registered(text) to anon, authenticated;

notify pgrst, 'reload schema';


-- Verify. First should be true, second false.
select
  public._2026_email_registered('kevinmkolb@gmail.com') as should_be_true,
  public._2026_email_registered('nobody@example.invalid') as should_be_false;
