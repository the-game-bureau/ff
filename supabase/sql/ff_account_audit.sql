-- UNBOOKED: accounts that exist but never made it onto the board.
--
-- WHAT THIS IS FOR
-- Somebody says they joined and they are not on the Suspects page, not in the
-- Suspect Tracker, not in the APB list. Every page reads _2026_profiles, so an
-- account without a row there is invisible everywhere at once - even though it
-- exists, and even though they can sign in with it.
--
-- WHY A NEW FUNCTION
-- _2026_admin_list_users already exists and cannot answer this. It reads
--   from public._2026_profiles p join auth.users u on u.id = p.id
-- - an INNER join starting from profiles, so it can only ever return people who
-- already have one. The whole question here is who does not, which needs the
-- join the other way round and outer.
--
-- WHY A FUNCTION AT ALL
-- auth.users is not reachable from the browser under any role, and should not
-- be. This is SECURITY DEFINER and checks _2026_is_admin() first, so the admin
-- screen can ask the question and nobody else can.
--
-- WHAT COMES BACK
-- One jsonb object: the unbooked accounts, the counts to reconcile against, and
-- the reverse case (a profile whose auth user is gone), which should always be
-- empty. Emails are in it, which is the point - they are what identifies the
-- person - and it is behind the admin check for that reason.
--
-- Run in the Supabase SQL editor. Safe to re-run. Read only.

do $guard$
begin
  if to_regclass('public._2026_picks') is null then
    raise exception
      'Wrong database: public._2026_picks does not exist here. Open the project '
      'named in js/supabase-config.js and run this again.';
  end if;

  if to_regprocedure('public._2026_is_admin()') is null then
    raise exception
      'public._2026_is_admin() is missing. Run the admin migrations first.';
  end if;
end
$guard$;

create or replace function public._2026_admin_account_audit()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $audit$
declare
  v_unbooked jsonb;
  v_ghosts   jsonb;
begin
  if not public._2026_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- Accounts with no profile row, newest first.
  --
  -- confirmed_at is the useful column: null means they never clicked the link
  -- in the signup email, so the account is half-made and they may not know.
  -- Confirmed but no profile means they got further, and one sign-in fixes it -
  -- js/username-gate.js rebuilds the profile from the metadata below.
  select coalesce(jsonb_agg(row_to_json(a) order by a.signed_up desc), '[]'::jsonb)
    into v_unbooked
  from (
    select u.id                                   as id,
           u.email::text                          as email,
           u.created_at                           as signed_up,
           u.email_confirmed_at                   as confirmed_at,
           u.last_sign_in_at                      as last_sign_in,
           u.raw_user_meta_data ->> 'username'    as chose,
           u.raw_user_meta_data ->> 'first_name'  as first_name
    from auth.users u
    left join public._2026_profiles p on p.id = u.id
    where p.id is null
  ) a;

  -- The reverse, which should always be empty: a profile whose auth user is
  -- gone. One of these means somebody was removed from Authentication without
  -- their profile going too, and the board is showing a suspect who can never
  -- sign in again.
  select coalesce(jsonb_agg(jsonb_build_object('username', p.username, 'id', p.id)
                            order by lower(p.username)), '[]'::jsonb)
    into v_ghosts
  from public._2026_profiles p
  left join auth.users u on u.id = p.id
  where u.id is null;

  return jsonb_build_object(
    'unbooked', v_unbooked,
    'ghosts', v_ghosts,
    'accounts', (select count(*) from auth.users),
    'profiles', (select count(*) from public._2026_profiles),
    'on_the_board', (select count(*) from public._2026_current_suspects),
    'checked_at', now()
  );
end;
$audit$;

revoke all on function public._2026_admin_account_audit() from public, anon;
grant execute on function public._2026_admin_account_audit() to authenticated;


-- ---------------------------------------------------------------------------
-- DELETE AN UNBOOKED ACCOUNT.
--
-- For the half-made ones only: a signup that never became a member, holding an
-- email address that its owner may want to use properly later. Supabase will
-- not let the same address sign up twice, so an abandoned account is not just
-- clutter - it can lock somebody out of joining.
--
-- WHY THIS IS NOT _2026_admin_remove_member
-- That one removes a MEMBER: it deletes their picks and their profile and
-- deliberately KEEPS the login (`login_kept: true`). This is the opposite
-- operation - there is no profile and no picks, and the login is the only thing
-- there is to remove. Pointing the existing function at one of these accounts
-- raises 'That account is not a member of this league', which is correct.
--
-- THE GUARD THAT MATTERS
-- It refuses any account that HAS a profile. That is what makes this button
-- safe to put next to a list: it is incapable of deleting a suspect, however it
-- is called and whatever id it is handed. Deleting a real member stays behind
-- the type-the-name dialog where it belongs.
-- ---------------------------------------------------------------------------
create or replace function public._2026_admin_delete_unbooked(target_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $unbook$
declare
  v_email text;
begin
  if not public._2026_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Refusing to delete the account you are signed in as'
      using errcode = '22023';
  end if;

  if exists (select 1 from public._2026_profiles p where p.id = target_user_id) then
    raise exception 'That account is a booked suspect. Remove them from FF Players instead.'
      using errcode = '22023';
  end if;

  select u.email::text into v_email from auth.users u where u.id = target_user_id;

  if v_email is null then
    raise exception 'No such account' using errcode = 'P0002';
  end if;

  -- Nothing to cascade: an unbooked account owns no profile, and picks are
  -- keyed to profiles. The login is the whole of it.
  delete from auth.users where id = target_user_id;

  return jsonb_build_object('email', v_email, 'deleted', true);
end;
$unbook$;

revoke all on function public._2026_admin_delete_unbooked(uuid) from public, anon;
grant execute on function public._2026_admin_delete_unbooked(uuid) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Verify: authenticated only, and anon cannot reach it.
-- ---------------------------------------------------------------------------
select p.proname, r.rolname as granted_to
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join lateral (
  select rolname from pg_roles
  where rolname in ('anon', 'authenticated')
    and has_function_privilege(rolname, p.oid, 'EXECUTE')
) as r
where n.nspname = 'public'
  and p.proname in ('_2026_admin_account_audit', '_2026_admin_delete_unbooked')
order by p.proname;
