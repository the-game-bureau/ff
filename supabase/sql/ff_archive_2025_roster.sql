-- The 2025 roster, with the names and addresses, held where only an admin can
-- read it.
--
-- WHY THIS EXISTS
-- These 32 names and emails were briefly kept in 2025/data/profiles.json so the
-- admin page could list them. That file is a static asset on a public site:
-- anyone who knows the URL can fetch it, and the case-file gate on the archive
-- page does not cover it. Publishing 32 people's email addresses to get a table
-- onto one admin screen is not a trade worth making, so the sensitive half of
-- the roster moved in here and the public file went back to usernames only.
--
-- The 2025 Supabase project is gone, so this data is seeded from the CSV export
-- rather than migrated: it is a historical record and nothing writes to it
-- again. Names were typed in by hand — the old profiles table had no name
-- columns — which is the other reason this cannot be regenerated on demand.
--
-- Run once in the Supabase SQL editor. Needs ff_admin_delete_user.sql first:
-- ff_is_admin() lives there. Safe to re-run; it replaces the rows.

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


create table if not exists public.ff_archive_players (
  season      integer     not null default 2025,
  username    text        not null,
  name        text,
  email       text,
  joined_at   timestamptz,
  pick_count  integer     not null default 0,
  primary key (season, username)
);

-- No policies are created on purpose. RLS with zero policies denies everything
-- to anon and authenticated, which is exactly right: the only way in is the
-- SECURITY DEFINER function below, and that function checks for an admin.
alter table public.ff_archive_players enable row level security;

revoke all on public.ff_archive_players from anon, authenticated;

-- Replace rather than append, so re-running does not double the roster.
delete from public.ff_archive_players where season = 2025;

insert into public.ff_archive_players (season, username, name, email, joined_at, pick_count)
select 2025, v.username, nullif(v.name, ''), nullif(v.email, ''), v.joined_at, v.pick_count
from (values
  ('4thewin', 'Alison Ficociello', 'alison.nola@gmail.com', '2025-09-04T20:06:06.162781Z'::timestamptz, 3),
  ('Adammay5', 'Adam May', 'amservices2009@yahoo.com', '2025-09-04T20:05:43.720142Z'::timestamptz, 1),
  ('AuntMooney', 'Mary King', 'maryking18@gmail.com', '2025-09-04T19:46:54.645329Z'::timestamptz, 4),
  ('Bucephalus', 'John Womack', 'johnwomack@gmail.com', '2025-09-05T17:49:53.852813Z'::timestamptz, 3),
  ('Case1974', 'Melanie Pettingill', 'bigmel100@aol.com', '2025-09-04T20:04:50.868431Z'::timestamptz, 2),
  ('CouchCoachConnie', 'Connie Demarest', 'connie21975@gmail.com', '2025-09-04T20:00:08.911576Z'::timestamptz, 2),
  ('CrispyPigSkin', 'George Steele', 'gsteele227@yahoo.com', '2025-09-04T19:54:02.36053Z'::timestamptz, 4),
  ('Dang_Brah', 'Gary Lassere', 'gjlasserejr@gmail.com', '2025-09-04T20:07:28.665043Z'::timestamptz, 2),
  ('DEH501', 'David Haller', 'davidhaller09@gmail.com', '2025-09-04T21:59:05.255037Z'::timestamptz, 6),
  ('EspeciallyHeinous', 'Chris May', 'chrisomay@icloud.com', '2025-09-04T19:53:27.316656Z'::timestamptz, 1),
  ('Fivedollarshakes', 'Catherine Alford', 'catherinealford@aol.com', '2025-09-04T23:32:55.987172Z'::timestamptz, 13),
  ('Fuji', 'Todd Fujimoto', 'todd.fujimoto@gmail.com', '2025-09-04T20:56:59.627545Z'::timestamptz, 9),
  ('GoodellBlows', 'Bill Healy', 'kk-football@billhealy.com', '2025-09-04T20:44:38.623769Z'::timestamptz, 7),
  ('Jacobm14', 'Jacob May', 'jacobmay25@yahoo.com', '2025-09-04T20:40:27.109858Z'::timestamptz, 2),
  ('Katnola', 'Kat Edmundson', 'katnola@gmail.com', '2025-09-04T20:32:42.903937Z'::timestamptz, 4),
  ('LogansHeroes', 'Adrienne Mabe', 'adrienne.j.mabe@gmail.com', '2025-09-04T20:36:30.906219Z'::timestamptz, 2),
  ('munch', 'Prasanth Nannapaneni', 'pnanny@gmail.com', '2025-09-04T20:12:59.872302Z'::timestamptz, 13),
  ('PrincessChiara', 'Susan Hislop', 'susanhislop@gmail.com', '2025-09-04T19:50:43.859066Z'::timestamptz, 5),
  ('RadioactiveShrimp', 'Jill Womack', 'jillswomack@gmail.com', '2025-09-04T20:43:05.960035Z'::timestamptz, 5),
  ('rammerbammer', 'Nicole Wetta', 'nicolewetta@gmail.com', '2025-09-04T23:50:18.767219Z'::timestamptz, 1),
  ('RLMACJR', 'Robert Lee Mason Andrew Chilton, Jr.', 'rlmacjr@icloud.com', '2025-09-04T20:06:09.277057Z'::timestamptz, 3),
  ('Shawn', 'Shawn Wenzel', 'otweezle@usa.net', '2025-09-04T21:12:25.132725Z'::timestamptz, 9),
  ('StablersStallions', 'Allie Shapiro Dandry', 'allieshap@gmail.com', '2025-09-05T21:58:56.526584Z'::timestamptz, 3),
  ('SurvivorVictimsUnit', 'Nathan Paculba', 'nathanpaculba@gmail.com', '2025-09-04T20:33:46.384121Z'::timestamptz, 5),
  ('Swaddle', 'Michelle Pettingill', 'michellepettingill@gmail.com', '2025-09-04T20:28:40.388528Z'::timestamptz, 9),
  ('TampaBayHawkeye', 'Staci Williams', 'stacisteinerwilliams@gmail.com', '2025-09-04T20:02:17.53377Z'::timestamptz, 5),
  ('TheClarinetOfJustice', 'Kevin Kolb', 'kevinmkolb@gmail.com', '2025-09-04T20:30:23.641643Z'::timestamptz, 12),
  ('ViKens', 'Kenneth Kolb', 'kennethkolb41@gmail.com', '2025-09-04T19:59:20.5771Z'::timestamptz, 1),
  ('WastinTme', 'Chad Maness', 'chadmaness@hotmail.com', '2025-09-05T01:23:23.559948Z'::timestamptz, 1),
  ('WhoDatScot', 'Ian Crozier', 'igcrozier@att.net', '2025-09-05T00:19:56.671586Z'::timestamptz, 6),
  ('Wholelottalosing', 'Michael Gale', 'mgalenola@gmail.com', '2025-09-04T22:32:59.254245Z'::timestamptz, 10),
  ('Wine_Ninja', 'Jeanne Charlebois', 'jcharlebois@martinwine.com', '2025-09-04T19:51:07.563486Z'::timestamptz, 6)
) as v(username, name, email, joined_at, pick_count);


-- ---------------------------------------------------------------------------
-- The read path. Same shape the admin page used to build from the JSON files.
-- ---------------------------------------------------------------------------
create or replace function public.ff_admin_list_archive_players(target_season integer default 2025)
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
  if not public.ff_is_admin() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;

  return query
  select a.username, a.name, a.email, a.joined_at, a.pick_count
  from public.ff_archive_players a
  where a.season = target_season
  order by lower(a.username);
end;
$$;

revoke all on function public.ff_admin_list_archive_players(integer) from public, anon;
grant execute on function public.ff_admin_list_archive_players(integer) to authenticated;

notify pgrst, 'reload schema';


-- Verify. Expect 32 rows, all with a name, all with an email.
select
  count(*)                            as players,
  count(*) filter (where name is not null)  as named,
  count(*) filter (where email is not null) as emailed
from public.ff_archive_players
where season = 2025;
