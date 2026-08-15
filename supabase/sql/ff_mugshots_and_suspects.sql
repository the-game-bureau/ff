
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

alter table public.ff_profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists avatar_data_url text;

create or replace view public.ff_current_suspects as
select
  profiles.id,
  profiles.username,
  profiles.first_name,
  profiles.avatar_data_url,
  coalesce(latest_pick.result, 'SUSPECT') as game_status
from public.ff_profiles as profiles
left join lateral (
  select picks.result
  from public.ff_picks as picks
  where picks.user_id = profiles.id
  order by picks.week desc, picks.created_at desc
  limit 1
) as latest_pick on true
order by profiles.username;

revoke all on public.ff_current_suspects from anon, authenticated;
grant select (id, username, avatar_data_url, game_status)
  on public.ff_current_suspects to anon;
grant select on public.ff_current_suspects to authenticated;
