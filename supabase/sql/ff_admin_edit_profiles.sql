-- Admin: read and edit every league member's record.
--
-- The roster panel used to be read-plus-remove. This adds editing: username,
-- first and last name, email and mugshot, for anyone in the league. Password is
-- not here and is not editable by anyone but its owner — Supabase stores it as
-- a hash and the reset-by-email flow is the only way to change it, which is the
-- correct answer rather than a limitation.
--
-- Same reasoning as ff_admin_delete_user.sql: the check that matters is the one
-- in here. The username test in js/admin.js only decides what is drawn on
-- screen; anyone can call an RPC with curl and the publishable key. And note
-- that supabase/sql/ff_own_mugshot_only.sql deliberately leaves the browser
-- role with UPDATE on one column of one row, so an admin edit cannot go through
-- the table at all — it has to come through a SECURITY DEFINER function.
--
-- Run this whole file once in the Supabase SQL editor. Needs
-- ff_admin_delete_user.sql to have been run first: ff_is_admin() lives there.

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
-- The roster, with the editable fields attached. Separate from
-- ff_admin_list_users() rather than a widening of it, because that function is
-- what the Remove panel reads and it has no business carrying 32 mugshots.
-- ---------------------------------------------------------------------------
create or replace function public.ff_admin_list_profiles()
returns table (
  id uuid,
  username text,
  first_name text,
  last_name text,
  email text,
  login_email text,
  avatar_data_url text,
  created_at timestamptz,
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
    p.username::text,
    p.first_name::text,
    p.last_name::text,
    p.email::text,
    u.email::text as login_email,
    p.avatar_data_url::text,
    p.created_at,
    (select count(*) from public.ff_picks k where k.user_id = p.id) as pick_count
  from public.ff_profiles p
  join auth.users u on u.id = p.id
  order by lower(p.username);
end;
$$;

revoke all on function public.ff_admin_list_profiles() from public, anon;
grant execute on function public.ff_admin_list_profiles() to authenticated;


-- ---------------------------------------------------------------------------
-- Edit one member's record.
--
-- Every argument is optional: null means "leave this field alone", so the page
-- can send only what changed and a blank box can never wipe a field by
-- accident. To actually clear first name, last name or the mugshot, send the
-- empty string.
--
-- EMAIL IS THE LOGIN, AND THE LOGIN IS SHARED.
-- ff_profiles.email is what resolveLoginEmail() in js/auth-corner.js trades a
-- username for at sign-in, so it has to stay equal to auth.users.email or
-- signing in by username stops working. This function therefore writes both.
-- On this project that means changing an email here also changes how that
-- person signs in to the OTHER site sharing these logins. That is a real
-- consequence and the admin page says so above the field; it is allowed
-- because keeping the two copies in sync is the only version of "edit email"
-- that is not quietly broken.
-- ---------------------------------------------------------------------------
create or replace function public.ff_admin_update_profile(
  target_user_id       uuid,
  new_username         text default null,
  new_first_name       text default null,
  new_last_name        text default null,
  new_email            text default null,
  new_avatar_data_url  text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, auth
as $$
declare
  clean_username text;
  clean_email    text;
begin
  if not public.ff_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if not exists (select 1 from public.ff_profiles where id = target_user_id) then
    raise exception 'That account is not a member of this league'
      using errcode = 'P0002';
  end if;

  clean_username := nullif(btrim(coalesce(new_username, '')), '');
  clean_email    := nullif(lower(btrim(coalesce(new_email, ''))), '');

  -- A blank username would leave a member with no name anywhere on the site,
  -- and a duplicate would make two people indistinguishable in the ticker and
  -- the archive. Both are refused rather than written and regretted.
  if new_username is not null and clean_username is null then
    raise exception 'Username cannot be blank' using errcode = '22023';
  end if;

  if clean_username is not null and exists (
    select 1 from public.ff_profiles
    where lower(username) = lower(clean_username)
      and id <> target_user_id
  ) then
    raise exception 'That username is already booked' using errcode = '23505';
  end if;

  if new_email is not null and clean_email is null then
    raise exception 'Email cannot be blank' using errcode = '22023';
  end if;

  if clean_email is not null and exists (
    select 1 from auth.users where lower(email) = clean_email and id <> target_user_id
  ) then
    raise exception 'That email belongs to another account' using errcode = '23505';
  end if;

  update public.ff_profiles set
    username        = coalesce(clean_username, username),
    first_name      = case
                        when new_first_name is null then first_name
                        when btrim(new_first_name) = '' then null
                        else btrim(new_first_name)
                      end,
    last_name       = case
                        when new_last_name is null then last_name
                        when btrim(new_last_name) = '' then null
                        else btrim(new_last_name)
                      end,
    email           = coalesce(clean_email, email),
    avatar_data_url = case
                        when new_avatar_data_url is null then avatar_data_url
                        when new_avatar_data_url = ''    then null
                        else new_avatar_data_url
                      end
  where id = target_user_id;

  -- Keep the login in step with the profile copy. See the note above.
  if clean_email is not null then
    update auth.users set email = clean_email where id = target_user_id;
  end if;

  return jsonb_build_object(
    'id',       target_user_id,
    'username', (select username from public.ff_profiles where id = target_user_id)
  );
end;
$$;

revoke all on function public.ff_admin_update_profile(uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.ff_admin_update_profile(uuid, text, text, text, text, text)
  to authenticated;


-- PostgREST caches the schema and will answer "Could not find the function"
-- until it reloads, which looks exactly like this script having been ignored.
notify pgrst, 'reload schema';


-- Verify. Expect two rows, both can_execute = true.
select
  p.proname as function_name,
  has_function_privilege('authenticated', p.oid, 'execute') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('ff_admin_list_profiles', 'ff_admin_update_profile')
order by p.proname;
