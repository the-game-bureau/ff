-- Admin: list league members and remove one from the league.
--
-- THIS PROJECT'S auth.users IS SHARED WITH ANOTHER SITE.
-- That single fact shapes everything below. auth.users is login
-- infrastructure for more than this game, so it is NOT this game's roster and
-- must not be treated as one:
--
--   * The roster lists only accounts that have an ff_profiles row. Anyone who
--     has never joined this league is invisible here and therefore cannot be
--     removed from here by accident.
--
--   * Removing a member deletes their ff_picks and ff_profiles rows and
--     nothing else. The login survives. Deleting from auth.users would revoke
--     that person's access to the other site as well, with no warning and no
--     way back — a game admin should not be able to do that by clicking a
--     button in a football pool.
--
-- To delete a login outright — an account that exists only for this game, or a
-- genuinely half-finished join — use ff_find_and_delete_account.sql, where it
-- is a deliberate, one-at-a-time act with the id in front of you.
--
-- WHY THESE ARE DATABASE FUNCTIONS AND NOT BROWSER CODE
-- The site ships a publishable (anon) key, which cannot read auth.users and
-- must never be able to. The alternative, a service_role key in the page,
-- would bypass every RLS policy on the project and hand the whole database to
-- anyone who opened admin/index.html. Hence SECURITY DEFINER, with the
-- authorisation check made here, server-side, where the caller cannot edit it.
-- The username check in js/admin.js only hides the UI; anyone can call an RPC
-- with curl and the publishable key. These functions are what actually decide.
--
-- Run this whole file once in the Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- Retired. An earlier version of this file created a function that deleted the
-- login itself. On a shared project that is too destructive to leave callable,
-- so it is dropped rather than merely unused.
-- ---------------------------------------------------------------------------
drop function if exists public.ff_admin_delete_user(uuid);


-- ---------------------------------------------------------------------------
-- Who counts as an admin. One definition, so every function agrees and
-- promoting a second admin later is a one-line change.
-- ---------------------------------------------------------------------------
create or replace function public.ff_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ff_profiles p
    where p.id = auth.uid()
      and lower(p.username) = 'theclarinetofjustice'
  );
$$;

revoke all on function public.ff_is_admin() from public, anon;
grant execute on function public.ff_is_admin() to authenticated;


-- ---------------------------------------------------------------------------
-- The roster. Driven from ff_profiles, not auth.users: this is the league, and
-- the league is exactly the set of people who joined it. auth.users is joined
-- only to show the email and last sign-in, and an INNER join is what keeps
-- other sites' accounts out of the result.
-- ---------------------------------------------------------------------------
create or replace function public.ff_admin_list_users()
returns table (
  id uuid,
  email text,
  username text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  pick_count bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.ff_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.username::text,
    p.created_at,
    u.last_sign_in_at,
    (select count(*) from public.ff_picks k where k.user_id = p.id) as pick_count
  from public.ff_profiles p
  join auth.users u on u.id = p.id
  order by lower(p.username);
end;
$$;

revoke all on function public.ff_admin_list_users() from public, anon;
grant execute on function public.ff_admin_list_users() to authenticated;


-- ---------------------------------------------------------------------------
-- Remove a member from the league: their picks and their profile, and nothing
-- outside the ff_ tables. A function body is a single transaction, so this
-- either takes both or neither.
--
-- Not reversible: the picks are gone. But the person can still sign in, and
-- anything they have on another site sharing this project is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.ff_admin_remove_member(target_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  target_username text;
  removed_picks   integer;
begin
  if not public.ff_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  -- Removing yourself would drop the profile the admin check reads, locking
  -- you out of this page entirely.
  if target_user_id = auth.uid() then
    raise exception 'Refusing to remove the account you are signed in as'
      using errcode = '22023';
  end if;

  -- Membership is the profile row. No row means they are not in this league,
  -- which on a shared project most likely means another site's user.
  select p.username::text into target_username
  from public.ff_profiles p
  where p.id = target_user_id;

  if target_username is null then
    raise exception 'That account is not a member of this league'
      using errcode = 'P0002';
  end if;

  delete from public.ff_picks where user_id = target_user_id;
  get diagnostics removed_picks = row_count;

  delete from public.ff_profiles where id = target_user_id;

  return jsonb_build_object(
    'username',      target_username,
    'picks_deleted', removed_picks,
    'login_kept',    true
  );
end;
$$;

revoke all on function public.ff_admin_remove_member(uuid) from public, anon;
grant execute on function public.ff_admin_remove_member(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- PostgREST serves RPCs from a cached copy of the schema and will answer
-- "Could not find the function" until it is refreshed. Supabase usually does
-- this within a few seconds on its own, but not always — and that delay looks
-- exactly like the script having been ignored.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Verify. Needs no login. Expect three rows, all can_execute = true, and
-- ff_admin_delete_user absent.
-- ---------------------------------------------------------------------------
select
  p.proname as function_name,
  has_function_privilege('authenticated', p.oid, 'execute') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ff_is_admin', 'ff_admin_list_users',
                    'ff_admin_remove_member', 'ff_admin_delete_user')
order by p.proname;

-- How many accounts in this project are NOT league members — i.e. how many the
-- roster is now correctly hiding. On a shared project this should be non-zero.
select
  (select count(*) from public.ff_profiles) as league_members,
  (select count(*) from auth.users u
     where not exists (select 1 from public.ff_profiles p where p.id = u.id))
    as accounts_outside_the_league;
