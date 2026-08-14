-- Verification for the 2026 Supabase destination after restore/prefixing.

do $$
declare
  leftover_tables text;
begin
  select string_agg(format('%I.%I', table_schema, table_name), ', ' order by table_name)
    into leftover_tables
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
    and table_name not like '\_2026\_%' escape '\';

  if leftover_tables is not null then
    raise exception 'Public base tables without the _2026 prefix remain: %', leftover_tables;
  end if;
end $$;

do $$
declare
  missing_objects text;
begin
  with expected(kind, name) as (
    values
      ('table', 'public._2026_profiles'),
      ('table', 'public._2026_picks'),
      ('table', 'public._2026_nfl_schedule'),
      ('table', 'public._2026_archive_players'),
      ('view', 'public._2026_active_picks'),
      ('view', 'public._2026_current_suspects')
  )
  select string_agg(name, ', ' order by name)
    into missing_objects
  from expected
  where to_regclass(name) is null;

  if missing_objects is not null then
    raise exception 'Missing expected objects: %', missing_objects;
  end if;
end $$;

select
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public._2026_profiles) as profiles,
  (select count(*) from public._2026_picks) as picks,
  (select count(*) from public._2026_nfl_schedule) as schedule_rows,
  (select count(*) from public._2026_archive_players) as archive_players;

select
  count(*) as league_auth_users,
  count(*) filter (where nullif(encrypted_password, '') is not null) as users_with_password_hash
from auth.users u
join public._2026_profiles p on p.id = u.id;

select
  p.proname as function_name,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    '_2026_is_admin',
    '_2026_admin_list_users',
    '_2026_admin_remove_member',
    '_2026_admin_list_profiles',
    '_2026_admin_update_profile',
    '_2026_admin_list_archive_players'
  )
order by p.proname;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename in (
    '_2026_profiles',
    '_2026_picks',
    '_2026_nfl_schedule',
    '_2026_archive_players'
  )
order by tablename, policyname;

select
  tgname as trigger_name,
  tgrelid::regclass::text as table_name,
  tgenabled
from pg_trigger
where tgrelid in ('public._2026_profiles'::regclass, 'public._2026_picks'::regclass)
  and not tgisinternal
order by table_name, trigger_name;
