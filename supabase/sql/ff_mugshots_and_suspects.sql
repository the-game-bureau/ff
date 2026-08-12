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
