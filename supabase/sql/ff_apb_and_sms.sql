-- SMS on the roster, and the two facts the APB panel needs to address it.
--
-- Two things happen here:
--
--   1. _2026_profiles gains an `sms` column, edited from Suspect Records the
--      same way first/last/email already are. Stored as typed, because a
--      readable "(555) 123-4567" is easier to check against a phone than a
--      normalised blob; anything that has to dial it strips the formatting at
--      the point of use.
--
--   2. _2026_admin_list_profiles() learns the season and week being asked
--      about, and returns that week's pick plus the player's standing. The APB
--      needs "who has not named a victim this week", and that question cannot
--      be answered from pick_count: picks are append-only with SKIP
--      tombstones, so a bare count says nothing about any particular week. The
--      view _2026_active_picks already collapses the history to the newest row
--      per (user, season, week); this drops SKIP on top of that, which is the
--      same rule js/victims.js applies in the browser.
--
-- Standing comes back too so the APB does not nag players who are already out.
-- It is the same expression _2026_current_suspects uses, kept here rather than
-- read from that view because the view has no season/week to filter on.
--
-- Both functions are dropped and recreated rather than replaced: their
-- signatures change, and adding a defaulted parameter to the live one would
-- leave two overloads for PostgREST to choose between.
--
-- Run this whole file once in the Supabase SQL editor. Needs the 2026
-- migration to have been run first: _2026_is_admin() lives there.

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
-- The column. Nothing but the admin functions below ever reads or writes it:
-- ff_profiles_hide_contact.sql keeps the browser role off the contact columns,
-- so a phone number is no more exposed than the email beside it.
-- ---------------------------------------------------------------------------
alter table public._2026_profiles
  add column if not exists sms text;

comment on column public._2026_profiles.sms is
  'Mobile number for APB texts. Admin-visible only; free text as typed.';


-- ---------------------------------------------------------------------------
-- The roster, now answering "did this person pick in week N".
--
-- for_season / for_week default to null, which returns a null week_pick for
-- everyone — the shape the page gets if it ever calls this without arguments.
-- ---------------------------------------------------------------------------
drop function if exists public._2026_admin_list_profiles();
drop function if exists public._2026_admin_list_profiles(integer, integer);

create function public._2026_admin_list_profiles(
  for_season integer default null,
  for_week   integer default null
)
returns table (
  id uuid,
  username text,
  first_name text,
  last_name text,
  email text,
  login_email text,
  sms text,
  avatar_data_url text,
  created_at timestamptz,
  pick_count bigint,
  week_pick text,
  game_status text
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
    p.sms::text,
    p.avatar_data_url::text,
    p.created_at,
    (select count(*) from public._2026_picks k where k.user_id = p.id) as pick_count,
    -- The team named for the week being asked about, or null for "no victim
    -- named". A SKIP row is a release, not a pick, so it reads as null here.
    (
      select ap.team::text
      from public._2026_active_picks ap
      where ap.user_id = p.id
        and ap.season = for_season
        and ap.week = for_week
        and coalesce(upper(btrim(ap.result)), '') <> 'SKIP'
      limit 1
    ) as week_pick,
    -- Standing, from the newest week that still holds a real pick.
    coalesce(
      (
        select ap.result::text
        from public._2026_active_picks ap
        where ap.user_id = p.id
          and coalesce(upper(btrim(ap.result)), '') <> 'SKIP'
        order by ap.week desc, ap.submitted_at_utc desc, ap.created_at desc
        limit 1
      ),
      'SUSPECT'
    ) as game_status
  from public._2026_profiles p
  join auth.users u on u.id = p.id
  order by lower(p.username);
end;
$$;

revoke all on function public._2026_admin_list_profiles(integer, integer) from public, anon;
grant execute on function public._2026_admin_list_profiles(integer, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- The editor, now taking the phone number. new_sms follows the same three-way
-- convention as the name fields: null leaves it alone, '' clears it, anything
-- else is trimmed and stored.
-- ---------------------------------------------------------------------------
drop function if exists public._2026_admin_update_profile(uuid, text, text, text, text, text);
drop function if exists public._2026_admin_update_profile(uuid, text, text, text, text, text, text);

create function public._2026_admin_update_profile(
  target_user_id       uuid,
  new_username         text default null,
  new_first_name       text default null,
  new_last_name        text default null,
  new_email            text default null,
  new_avatar_data_url  text default null,
  new_sms              text default null
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
    sms             = case
                        when new_sms is null then sms
                        when btrim(new_sms) = '' then null
                        else btrim(new_sms)
                      end,
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

revoke all on function public._2026_admin_update_profile(uuid, text, text, text, text, text, text)
  from public, anon;
grant execute on function public._2026_admin_update_profile(uuid, text, text, text, text, text, text)
  to authenticated;
