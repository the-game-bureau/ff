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
    select u.email::text                          as email,
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
  and p.proname = '_2026_admin_account_audit';
