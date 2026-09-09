-- Suspect colours move from a source file into the database.
--
-- WHAT THIS REPLACES
-- Each suspect's two-tone theme is sampled from their mugshot at render time by
-- dominantPair(). Where the sampler picks the wall instead of the person, the
-- pair was overridden by hand in js/suspect-colors.js — a source file the
-- Colour Lab could only produce text for, leaving a copy, paste, commit and
-- deploy between choosing a colour and seeing it. That file also had to be
-- merged by hand every time, and one bad merge left it with five duplicate keys
-- and a missing comma: a syntax error that silently took every override on the
-- site down with it.
--
-- The colours are per-suspect data, the same as their mugshot, and belong in
-- the same row. After this the Lab writes them directly and the pages read them
-- straight back; js/suspect-colors.js keeps its name and its job of answering
-- suspectColorOverride(), but reads these columns instead of a list in its own
-- source.
--
-- WHO CAN READ AND WRITE
-- Read: everyone. These colours are painted on a public page, so they are as
-- public as the mugshot they were sampled from — both browser roles get the two
-- columns added to the column grants that supabase/sql/ff_profiles_hide_contact.sql
-- hands out. That file is the authority on this table's column privileges and
-- has been updated to match, so re-running it will not strip these again.
--
-- Write: the admin alone, through the SECURITY DEFINER function below. The
-- browser roles keep no UPDATE on these columns, so a suspect cannot repaint
-- themselves and nobody can repaint anyone else.
--
-- ORDER MATTERS. Run supabase/sql/ff_apb_and_sms.sql BEFORE this file. Both
-- rebuild _2026_admin_list_profiles(), and the version at the bottom of this
-- one is the complete definition: sms, this week's pick, standing and now the
-- two colours. Run them the other way round and the colours drop back off the
-- roster the admin page reads, and the mugshot editor opens with nothing on
-- file for anyone.
--
-- Run this whole file once in the Supabase SQL editor. Needs the 2026 migration
-- to have been run first: _2026_is_admin() lives there.

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
-- The columns. Null means "no override" — the same thing an absent key meant in
-- the old file — and the page falls back to sampling the mugshot.
-- ---------------------------------------------------------------------------
alter table public._2026_profiles
  add column if not exists color_primary   text,
  add column if not exists color_secondary text;

comment on column public._2026_profiles.color_primary is
  'Hand-picked #RRGGBB overriding the sampled mugshot colour. Null = sample it.';
comment on column public._2026_profiles.color_secondary is
  'Second half of the pair. Null = sample it.';

-- Both halves or neither: a lone colour would leave the page sampling one and
-- reading the other, which is the grey-on-grey problem this exists to fix.
alter table public._2026_profiles
  drop constraint if exists _2026_profiles_colors_paired;
alter table public._2026_profiles
  add constraint _2026_profiles_colors_paired check (
    (color_primary is null) = (color_secondary is null)
  );

alter table public._2026_profiles
  drop constraint if exists _2026_profiles_colors_hex;
alter table public._2026_profiles
  add constraint _2026_profiles_colors_hex check (
    (color_primary   is null or color_primary   ~ '^#[0-9A-Fa-f]{6}$') and
    (color_secondary is null or color_secondary ~ '^#[0-9A-Fa-f]{6}$')
  );


-- ---------------------------------------------------------------------------
-- Read access. Additive: a column GRANT adds to the column list a role already
-- has rather than replacing it, so this leaves the contact-column lockdown in
-- ff_profiles_hide_contact.sql exactly as it is.
-- ---------------------------------------------------------------------------
grant select (color_primary, color_secondary)
  on public._2026_profiles to anon, authenticated;


-- ---------------------------------------------------------------------------
-- The lineup view carries them too. Both readers try the table first and fall
-- back to this view, so a colour that is on one and not the other would appear
-- and disappear depending on which path answered.
--
-- Columns are appended; create or replace cannot reorder or drop the existing
-- ones, which is why these two go on the end.
-- ---------------------------------------------------------------------------
create or replace view public._2026_current_suspects as
select
  profiles.id,
  profiles.username,
  profiles.first_name,
  profiles.avatar_data_url,
  coalesce(latest_pick.result, 'SUSPECT') as game_status,
  profiles.color_primary,
  profiles.color_secondary
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

grant select (id, username, avatar_data_url, game_status, color_primary, color_secondary)
  on public._2026_current_suspects to anon;
grant select on public._2026_current_suspects to authenticated;


-- ---------------------------------------------------------------------------
-- The write path. Its own function rather than two more parameters on
-- _2026_admin_update_profile: the Lab saves one card at a time and has no
-- business carrying a username or an email it might overwrite.
--
-- Passing null for either colour clears both, which is how a suspect is handed
-- back to the sampler.
-- ---------------------------------------------------------------------------
create or replace function public._2026_admin_set_suspect_colors(
  target_user_id uuid,
  new_primary    text default null,
  new_secondary  text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  clean_primary   text;
  clean_secondary text;
begin
  if not public._2026_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  if not exists (select 1 from public._2026_profiles where id = target_user_id) then
    raise exception 'That account is not a member of this league'
      using errcode = 'P0002';
  end if;

  clean_primary   := nullif(btrim(coalesce(new_primary, '')), '');
  clean_secondary := nullif(btrim(coalesce(new_secondary, '')), '');

  -- One without the other is a mistake on the caller's part, not a request to
  -- half-clear. Say so rather than writing something the check would reject
  -- with a constraint name nobody can read.
  if (clean_primary is null) <> (clean_secondary is null) then
    raise exception 'Both colours are needed, or neither' using errcode = '22023';
  end if;

  if clean_primary is not null and clean_primary !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Primary colour must look like #RRGGBB' using errcode = '22023';
  end if;

  if clean_secondary is not null and clean_secondary !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Secondary colour must look like #RRGGBB' using errcode = '22023';
  end if;

  update public._2026_profiles set
    color_primary   = upper(clean_primary),
    color_secondary = upper(clean_secondary)
  where id = target_user_id;

  return jsonb_build_object(
    'id',        target_user_id,
    'primary',   upper(clean_primary),
    'secondary', upper(clean_secondary)
  );
end;
$$;

revoke all on function public._2026_admin_set_suspect_colors(uuid, text, text)
  from public, anon;
grant execute on function public._2026_admin_set_suspect_colors(uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The admin roster carries the colours too. The mugshot editor opens from a row
-- of this table and has to show what is already on file before it offers to
-- change it; without these two columns every suspect would open looking
-- unpainted and the first save would overwrite a colour that was already there.
--
-- This is ff_apb_and_sms.sql's function with two columns added. It is repeated
-- in full rather than patched because create or replace cannot add to a
-- returns table, and because one complete definition is easier to trust than
-- two halves.
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
  color_primary text,
  color_secondary text,
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
    p.color_primary::text,
    p.color_secondary::text,
    p.created_at,
    -- Weeks this suspect currently holds a victim in, at most one each.
    -- Counting _2026_picks directly counts the history instead: picks are
    -- append-only, so changing a pick three times counted four, and a released
    -- week still counted its SKIP tombstone. _2026_active_picks is already
    -- distinct on (user_id, season, week) and keeps only the newest row, so
    -- dropping the skips off that leaves exactly the live picks.
    (
      select count(*)
      from public._2026_active_picks ap
      where ap.user_id = p.id
        and coalesce(upper(btrim(ap.result)), '') <> 'SKIP'
    ) as pick_count,
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

notify pgrst, 'reload schema';
