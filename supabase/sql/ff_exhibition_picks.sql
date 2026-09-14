-- Eliminated suspects keep playing, for fun, and stop counting.
--
-- THE RULE
-- A case that has closed stays closed. The suspect can still name a victim
-- every week and still be told whether it won or lost - that is the whole point,
-- it keeps somebody in the group chat in October - but none of it counts. They
-- are not a survivor, they cannot come back, and no tally anywhere on the site
-- includes them.
--
-- WHY THIS FILE EXISTS AT ALL
-- `game_status` was defined as THE NEWEST WEEK'S RESULT:
--
--     coalesce(latest_pick.result, 'SUSPECT')   -- newest week, any result
--
-- which was correct while a DUN DUN was the last thing that could ever happen
-- to you. The moment an eliminated suspect files again and their team loses,
-- that expression returns SURVIVED and they are alive again - on the Case File
-- scoreboard, the wire, the Suspects board, the Suspect Tracker, the APB and
-- the Sergeant's Notes at once, because every one of them reads this column.
-- Not a display bug: the site would genuinely believe it.
--
-- So elimination becomes STICKY. If any week in the season holds a DUN DUN for
-- this suspect, the column says DUN DUN whatever they have done since. Nothing
-- on the client changes - every reader already asks this column the question,
-- and now it gives the right answer.
--
-- WHY STICKY AND NOT A COLUMN ON THE PROFILE
-- A stored `eliminated_at` would have to be written by the scorer and could
-- drift from the picks it was derived from - and the picks are the record.
-- A DUN DUN row is never deleted (picks are append-only, results are the one
-- exception and only ever move to a verdict), so "has a DUN DUN anywhere" is
-- already permanent and already true.
--
-- Run in the Supabase SQL editor. Safe to re-run.

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
-- IS THIS SUSPECT OUT. One place, so the view and the function below cannot
-- come to different conclusions about the same person.
-- ---------------------------------------------------------------------------
create or replace function public._2026_is_out(p_user_id uuid)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public._2026_active_picks ap
    where ap.user_id = p_user_id
      and upper(btrim(coalesce(ap.result, ''))) = 'DUN DUN'
  );
$$;

revoke all on function public._2026_is_out(uuid) from public;
grant execute on function public._2026_is_out(uuid) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- THE LINEUP VIEW. Same columns in the same order - create or replace cannot
-- reorder or drop them - with the standing made sticky.
-- ---------------------------------------------------------------------------
create or replace view public._2026_current_suspects as
select
  profiles.id,
  profiles.username,
  profiles.first_name,
  profiles.avatar_data_url,
  -- Out stays out. Otherwise the newest week's result, which for somebody still
  -- in the game is the only thing that can be true.
  case
    when public._2026_is_out(profiles.id) then 'DUN DUN'
    else coalesce(latest_pick.result, 'SUSPECT')
  end as game_status,
  profiles.color_primary,
  profiles.color_secondary
from public._2026_profiles as profiles
left join lateral (
  select active_picks.result
  from public._2026_active_picks as active_picks
  where active_picks.user_id = profiles.id
    and coalesce(upper(btrim(active_picks.result)), '') <> 'SKIP'
  order by active_picks.week desc,
           active_picks.submitted_at_utc desc,
           active_picks.created_at desc
  limit 1
) as latest_pick on true;


-- ---------------------------------------------------------------------------
-- THE ADMIN ROSTER. Same change, because the APB and Suspect Records read this
-- one and would otherwise disagree with every page that reads the view.
--
-- Recreated whole rather than patched: this is the definition from
-- supabase/sql/ff_suspect_colors.sql with one expression changed, and a
-- half-described function is worse than a repeated one.
--
-- THE RETURN TYPE IS COPIED EXACTLY, COLUMN FOR COLUMN AND IN ORDER.
-- An earlier draft of this file retyped the column list from memory, dropped
-- `pick_count` and moved `created_at`. Postgres refused it - "cannot change
-- return type of existing function" - which was lucky: the hint says to DROP
-- first, and following that hint would have created a function missing a column
-- that js/admin.js reads in three places, and the Suspect Records table would
-- have shown every suspect with zero picks. If this list ever genuinely needs
-- to change, change it here AND in the readers, deliberately.
-- ---------------------------------------------------------------------------
create or replace function public._2026_admin_list_profiles(
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
as $profiles$
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
    -- THE ONE CHANGED EXPRESSION. Out stays out: one DUN DUN in any week and
    -- this reads DUN DUN forever, whatever they have filed since. Otherwise the
    -- newest week's result, which for somebody still in the game is the only
    -- thing that can be true.
    case
      when public._2026_is_out(p.id) then 'DUN DUN'
      else coalesce(
        (
          select ap.result::text
          from public._2026_active_picks ap
          where ap.user_id = p.id
            and coalesce(upper(btrim(ap.result)), '') <> 'SKIP'
          order by ap.week desc, ap.submitted_at_utc desc, ap.created_at desc
          limit 1
        ),
        'SUSPECT'
      )
    end as game_status
  from public._2026_profiles p
  join auth.users u on u.id = p.id
  order by lower(p.username);
end;
$profiles$;

revoke all on function public._2026_admin_list_profiles(integer, integer) from public, anon;
grant execute on function public._2026_admin_list_profiles(integer, integer) to authenticated;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- Verify. Anybody with a DUN DUN anywhere reads as DUN DUN, whatever they have
-- filed since - and the two counts should match what the Case File shows.
-- ---------------------------------------------------------------------------
select count(*) filter (where upper(btrim(game_status)) = 'DUN DUN') as case_closed,
       count(*) filter (where upper(btrim(game_status)) <> 'DUN DUN') as still_a_suspect,
       count(*) as roster
  from public._2026_current_suspects;

-- Anyone who has kept playing after their case closed: picks filed for a week
-- later than the one that ended them. Empty until somebody does it.
select cs.username,
       (select min(ap.week) from public._2026_active_picks ap
         where ap.user_id = cs.id
           and upper(btrim(coalesce(ap.result, ''))) = 'DUN DUN') as closed_in_week,
       max(later.week) as latest_pick_week,
       count(later.*) as exhibition_picks
  from public._2026_current_suspects cs
  join public._2026_active_picks later on later.user_id = cs.id
 where public._2026_is_out(cs.id)
   and later.week > (
        select min(ap.week) from public._2026_active_picks ap
         where ap.user_id = cs.id
           and upper(btrim(coalesce(ap.result, ''))) = 'DUN DUN')
   and coalesce(upper(btrim(later.result)), '') <> 'SKIP'
 group by cs.username, cs.id
 order by cs.username;
