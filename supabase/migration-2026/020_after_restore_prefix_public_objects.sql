-- Run after restoring the old Supabase project into the new project.
--
-- Goal: keep Supabase-managed schemas such as auth/storage intact, but move
-- this repo's public tables/views/functions to the _2026 namespace expected by
-- the 2026 site config.

do $$
begin
  if to_regclass('public.ff_picks') is not null then
    execute 'drop trigger if exists ff_apply_pick_schedule_before_insert on public.ff_picks';
  end if;

  if to_regclass('public.ff_profiles') is not null then
    execute 'drop trigger if exists ff_notify_new_suspect_after_insert on public.ff_profiles';
  end if;
end $$;

drop view if exists public.ff_current_suspects cascade;
drop view if exists public.ff_active_picks cascade;

drop function if exists public.ff_admin_update_profile(uuid, text, text, text, text, text);
drop function if exists public.ff_admin_list_profiles();
drop function if exists public.ff_admin_list_archive_players(integer);
drop function if exists public.ff_admin_remove_member(uuid);
drop function if exists public.ff_admin_list_users();
drop function if exists public.ff_admin_delete_user(uuid);
drop function if exists public.ff_is_admin();
drop function if exists public.ff_notify_new_suspect();
drop function if exists public.ff_apply_pick_schedule();

do $$
begin
  if to_regclass('public.ff_profiles') is not null and to_regclass('public._2026_profiles') is null then
    alter table public.ff_profiles rename to _2026_profiles;
  elsif to_regclass('public.ff_profiles') is not null and to_regclass('public._2026_profiles') is not null then
    raise exception 'Both public.ff_profiles and public._2026_profiles exist; resolve before continuing';
  end if;

  if to_regclass('public.ff_picks') is not null and to_regclass('public._2026_picks') is null then
    alter table public.ff_picks rename to _2026_picks;
  elsif to_regclass('public.ff_picks') is not null and to_regclass('public._2026_picks') is not null then
    raise exception 'Both public.ff_picks and public._2026_picks exist; resolve before continuing';
  end if;

  if to_regclass('public.ff_nfl_schedule') is not null and to_regclass('public._2026_nfl_schedule') is null then
    alter table public.ff_nfl_schedule rename to _2026_nfl_schedule;
  elsif to_regclass('public.ff_nfl_schedule') is not null and to_regclass('public._2026_nfl_schedule') is not null then
    raise exception 'Both public.ff_nfl_schedule and public._2026_nfl_schedule exist; resolve before continuing';
  end if;

  if to_regclass('public.ff_archive_players') is not null and to_regclass('public._2026_archive_players') is null then
    alter table public.ff_archive_players rename to _2026_archive_players;
  elsif to_regclass('public.ff_archive_players') is not null and to_regclass('public._2026_archive_players') is not null then
    raise exception 'Both public.ff_archive_players and public._2026_archive_players exist; resolve before continuing';
  end if;
end $$;

do $$
begin
  if to_regclass('public._2026_profiles') is null then
    raise exception 'Missing required table public._2026_profiles';
  end if;

  if to_regclass('public._2026_picks') is null then
    raise exception 'Missing required table public._2026_picks';
  end if;

  if to_regclass('public._2026_nfl_schedule') is null then
    raise exception 'Missing required table public._2026_nfl_schedule';
  end if;
end $$;

create table if not exists public._2026_archive_players (
  season      integer     not null default 2025,
  username    text        not null,
  name        text,
  email       text,
  joined_at   timestamptz,
  pick_count  integer     not null default 0,
  primary key (season, username)
);

create or replace function public._2026_apply_pick_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  schedule_row public._2026_nfl_schedule%rowtype;
  current_pick_team text;
  current_pick_schedule public._2026_nfl_schedule%rowtype;
begin
  if new.season is null then
    new.season := 2026;
  end if;

  if new.submitted_at_utc is null then
    new.submitted_at_utc := now();
  end if;

  if new.result is null then
    new.result := 'SUSPECT';
  end if;

  select * into schedule_row
  from public._2026_nfl_schedule
  where season = new.season
    and week = new.week
    and team = new.team;

  if not found then
    raise exception 'No scheduled NFL game found for % in Week %', new.team, new.week;
  end if;

  if schedule_row.kickoff_at_utc is not null
     and now() >= schedule_row.kickoff_at_utc - interval '2 minutes' then
    raise exception 'Pick window closed for % in Week %', new.team, new.week;
  end if;

  select latest_pick.team into current_pick_team
  from (
    select team
    from public._2026_picks
    where user_id = new.user_id
      and season = new.season
      and week = new.week
    order by submitted_at_utc desc, created_at desc
    limit 1
  ) latest_pick;

  if current_pick_team is not null and current_pick_team <> new.team then
    select * into current_pick_schedule
    from public._2026_nfl_schedule
    where season = new.season
      and week = new.week
      and team = current_pick_team;

    if found
       and current_pick_schedule.kickoff_at_utc is not null
       and now() >= current_pick_schedule.kickoff_at_utc - interval '2 minutes' then
      raise exception 'Week % is locked because % already reached its pick window', new.week, current_pick_team;
    end if;
  end if;

  if exists (
    select 1
    from (
      select distinct on (week) week, team, result
      from public._2026_picks
      where user_id = new.user_id
        and season = new.season
        and week <> new.week
      order by week, submitted_at_utc desc, created_at desc
    ) latest_by_week
    where latest_by_week.team = new.team
      and coalesce(upper(btrim(latest_by_week.result)), '') <> 'SKIP'
  ) then
    raise exception '% has already been named in another week', new.team;
  end if;

  new.opponent := schedule_row.opponent;
  new.home_away := schedule_row.home_away;
  new.kickoff_at_utc := schedule_row.kickoff_at_utc;
  new.schedule_source_url := schedule_row.source_url;
  return new;
end;
$$;

drop trigger if exists _2026_apply_pick_schedule_before_insert on public._2026_picks;
create trigger _2026_apply_pick_schedule_before_insert
before insert on public._2026_picks
for each row
execute function public._2026_apply_pick_schedule();

create or replace view public._2026_active_picks as
select distinct on (user_id, season, week) *
from public._2026_picks
order by user_id, season, week, submitted_at_utc desc, created_at desc;

create or replace view public._2026_current_suspects as
select
  profiles.id,
  profiles.username,
  profiles.first_name,
  profiles.avatar_data_url,
  coalesce(latest_pick.result, 'SUSPECT') as game_status
from public._2026_profiles as profiles
left join lateral (
  select active_picks.result
  from public._2026_active_picks as active_picks
  where active_picks.user_id = profiles.id
    and coalesce(upper(btrim(active_picks.result)), '') <> 'SKIP'
  order by active_picks.week desc, active_picks.submitted_at_utc desc, active_picks.created_at desc
  limit 1
) as latest_pick on true
order by profiles.username;

alter table public._2026_profiles enable row level security;
alter table public._2026_picks enable row level security;
alter table public._2026_nfl_schedule enable row level security;
alter table public._2026_archive_players enable row level security;

drop policy if exists ff_profiles_update_own on public._2026_profiles;
drop policy if exists ff_profiles_insert_own on public._2026_profiles;
drop policy if exists ff_profiles_select_own on public._2026_profiles;
drop policy if exists _2026_profiles_read on public._2026_profiles;
drop policy if exists _2026_profiles_insert_own on public._2026_profiles;
drop policy if exists _2026_profiles_update_own on public._2026_profiles;
drop policy if exists ff_picks_insert_own on public._2026_picks;
drop policy if exists ff_picks_select_public on public._2026_picks;
drop policy if exists _2026_picks_read on public._2026_picks;
drop policy if exists _2026_picks_insert_own on public._2026_picks;
drop policy if exists ff_nfl_schedule_read on public._2026_nfl_schedule;
drop policy if exists _2026_nfl_schedule_read on public._2026_nfl_schedule;

create policy _2026_profiles_read
  on public._2026_profiles
  for select
  to anon, authenticated
  using (true);

create policy _2026_profiles_insert_own
  on public._2026_profiles
  for insert
  to authenticated
  with check (id = auth.uid());

create policy _2026_profiles_update_own
  on public._2026_profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy _2026_picks_read
  on public._2026_picks
  for select
  to anon, authenticated
  using (true);

create policy _2026_picks_insert_own
  on public._2026_picks
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy _2026_nfl_schedule_read
  on public._2026_nfl_schedule
  for select
  to anon, authenticated
  using (true);

grant select on public._2026_profiles to anon, authenticated;
grant insert on public._2026_profiles to authenticated;
revoke update on public._2026_profiles from authenticated;
revoke update on public._2026_profiles from anon;
grant update (avatar_data_url) on public._2026_profiles to authenticated;

grant select on public._2026_picks to anon, authenticated;
grant insert on public._2026_picks to authenticated;
grant select on public._2026_nfl_schedule to anon, authenticated;
grant select on public._2026_active_picks to anon, authenticated;

revoke all on public._2026_current_suspects from anon, authenticated;
grant select (id, username, avatar_data_url, game_status)
  on public._2026_current_suspects to anon;
grant select on public._2026_current_suspects to authenticated;

revoke all on public._2026_archive_players from anon, authenticated;

do $$
declare
  seq_name text;
begin
  select pg_get_serial_sequence('public._2026_picks', 'id') into seq_name;
  if seq_name is not null then
    execute format('grant usage, select on sequence %s to authenticated', seq_name);
  end if;
end $$;

create or replace function public._2026_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public._2026_profiles p
    where p.id = auth.uid()
      and lower(p.username) = 'theclarinetofjustice'
  );
$$;

revoke all on function public._2026_is_admin() from public, anon;
grant execute on function public._2026_is_admin() to authenticated;

create or replace function public._2026_admin_list_users()
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
  if not public._2026_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    u.email::text,
    p.username::text,
    p.created_at,
    u.last_sign_in_at,
    (select count(*) from public._2026_picks k where k.user_id = p.id) as pick_count
  from public._2026_profiles p
  join auth.users u on u.id = p.id
  order by lower(p.username);
end;
$$;

revoke all on function public._2026_admin_list_users() from public, anon;
grant execute on function public._2026_admin_list_users() to authenticated;

create or replace function public._2026_admin_remove_member(target_user_id uuid)
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
  if not public._2026_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if target_user_id = auth.uid() then
    raise exception 'Refusing to remove the account you are signed in as'
      using errcode = '22023';
  end if;

  select p.username::text into target_username
  from public._2026_profiles p
  where p.id = target_user_id;

  if target_username is null then
    raise exception 'That account is not a member of this league'
      using errcode = 'P0002';
  end if;

  delete from public._2026_picks where user_id = target_user_id;
  get diagnostics removed_picks = row_count;

  delete from public._2026_profiles where id = target_user_id;

  return jsonb_build_object(
    'username',      target_username,
    'picks_deleted', removed_picks,
    'login_kept',    true
  );
end;
$$;

revoke all on function public._2026_admin_remove_member(uuid) from public, anon;
grant execute on function public._2026_admin_remove_member(uuid) to authenticated;

create or replace function public._2026_admin_list_profiles()
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
  if not public._2026_is_admin() then
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
    (select count(*) from public._2026_picks k where k.user_id = p.id) as pick_count
  from public._2026_profiles p
  join auth.users u on u.id = p.id
  order by lower(p.username);
end;
$$;

revoke all on function public._2026_admin_list_profiles() from public, anon;
grant execute on function public._2026_admin_list_profiles() to authenticated;

create or replace function public._2026_admin_update_profile(
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
  if not public._2026_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if not exists (select 1 from public._2026_profiles where id = target_user_id) then
    raise exception 'That account is not a member of this league'
      using errcode = 'P0002';
  end if;

  clean_username := nullif(btrim(coalesce(new_username, '')), '');
  clean_email    := nullif(lower(btrim(coalesce(new_email, ''))), '');

  if new_username is not null and clean_username is null then
    raise exception 'Username cannot be blank' using errcode = '22023';
  end if;

  if clean_username is not null and exists (
    select 1 from public._2026_profiles
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

  update public._2026_profiles set
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

  if clean_email is not null then
    update auth.users set email = clean_email where id = target_user_id;
  end if;

  return jsonb_build_object(
    'id',       target_user_id,
    'username', (select username from public._2026_profiles where id = target_user_id)
  );
end;
$$;

revoke all on function public._2026_admin_update_profile(uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public._2026_admin_update_profile(uuid, text, text, text, text, text)
  to authenticated;

create or replace function public._2026_admin_list_archive_players(target_season integer default 2025)
returns table (
  username text,
  name text,
  email text,
  joined_at timestamptz,
  pick_count integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._2026_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select a.username, a.name, a.email, a.joined_at, a.pick_count
  from public._2026_archive_players a
  where a.season = target_season
  order by lower(a.username);
end;
$$;

revoke all on function public._2026_admin_list_archive_players(integer) from public, anon;
grant execute on function public._2026_admin_list_archive_players(integer) to authenticated;

create extension if not exists pg_net with schema extensions;

create or replace function public._2026_notify_new_suspect()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions, vault
as $$
declare
  github_token text;
begin
  select decrypted_secret into github_token
  from vault.decrypted_secrets
  where name = 'github_dispatch_token';

  if github_token is null then
    raise warning '_2026_notify_new_suspect: no github_dispatch_token in vault, skipping';
    return new;
  end if;

  perform net.http_post(
    url     := 'https://api.github.com/repos/the-game-bureau/ff/dispatches',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || github_token,
      'Accept',        'application/vnd.github+json',
      'Content-Type',  'application/json',
      'User-Agent',    'ff-supabase-trigger'
    ),
    body    := jsonb_build_object(
      'event_type',     'new-suspect',
      'client_payload', jsonb_build_object('username', new.username)
    )
  );

  return new;
exception
  when others then
    raise warning '_2026_notify_new_suspect failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists _2026_notify_new_suspect_after_insert on public._2026_profiles;
create trigger _2026_notify_new_suspect_after_insert
after insert on public._2026_profiles
for each row
execute function public._2026_notify_new_suspect();

notify pgrst, 'reload schema';
