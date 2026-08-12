-- Let a player take back a team they had already named in a LATER week.
--
-- THE PROBLEM
-- One team per season. The victims grid showed any team used in another week as
-- "Previous Selection" and made the card dead, which is right for a week that
-- has already been played but wrong for one that has not: a player who parked
-- the Jets in Week 12 and now wants them in Week 6 had no way to move them.
--
-- ff_apply_pick_schedule() enforces the same rule server-side:
--   raise exception '% has already been named in another week', new.team
-- so no client change alone can do it.
--
-- THE FIX
-- A week is released rather than deleted. Nothing is ever removed from
-- ff_picks — the newest row for a (user, week) IS the pick, per
-- ff_allow_pick_changes.sql — so releasing Week 12 means writing another Week 12
-- row carrying result = 'SKIP'. That row wins on recency, so the week reads as
-- unpicked and the team is free. The original pick stays in the table as a
-- record of what was said, exactly like a changed pick does.
--
-- The team on a skip row is the team being released, not a sentinel: this
-- trigger only accepts a team with a real scheduled game that week, and a
-- sentinel would be rejected before it reached the table.
--
-- js/victims.js writes the skip row and then the new pick, in that order —
-- the reverse fails on the cross-week check below. Both js/victims.js and
-- js/app.js drop a skipped latest row in activePicksFromHistory(), so every
-- reader (grid, standings, timeline, Pick Ticker, Evidence Locker) treats the
-- released week as empty.
--
-- WHAT CHANGES HERE
--   1. The cross-week uniqueness check ignores skipped weeks, so a released
--      team is genuinely free.
--   2. ff_current_suspects ignores skipped weeks when reading a player's
--      latest status, so a release does not put 'SKIP' on their mugshot.
--
-- Everything else in the trigger is unchanged from
-- ff_schedule_and_pick_history.sql. Note what is deliberately NOT relaxed: the
-- kickoff guard still applies to the skip row itself, so a week whose game has
-- started cannot be released. That is the server-side twin of the client's
-- "locked into Week N" refusal.
--
-- Run this whole file in the Supabase SQL editor. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The trigger.
--
--    security definer and the pinned search_path are re-declared here on
--    purpose: create or replace resets function attributes to their defaults,
--    which would silently undo ff_schedule_access_fix.sql and bring back
--    "No scheduled NFL game found for <team> in Week <n>".
-- ---------------------------------------------------------------------------
create or replace function public.ff_apply_pick_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  schedule_row public.ff_nfl_schedule%rowtype;
  current_pick_team text;
  current_pick_schedule public.ff_nfl_schedule%rowtype;
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
  from public.ff_nfl_schedule
  where season = new.season
    and week = new.week
    and team = new.team;

  if not found then
    raise exception 'No scheduled NFL game found for % in Week %', new.team, new.week;
  end if;

  -- Applies to skip rows too: a week whose game has started cannot be released.
  if schedule_row.kickoff_at_utc is not null
     and now() >= schedule_row.kickoff_at_utc - interval '2 minutes' then
    raise exception 'Pick window closed for % in Week %', new.team, new.week;
  end if;

  select latest_pick.team into current_pick_team
  from (
    select team
    from public.ff_picks
    where user_id = new.user_id
      and season = new.season
      and week = new.week
    order by submitted_at_utc desc, created_at desc
    limit 1
  ) latest_pick;

  if current_pick_team is not null and current_pick_team <> new.team then
    select * into current_pick_schedule
    from public.ff_nfl_schedule
    where season = new.season
      and week = new.week
      and team = current_pick_team;

    if found
       and current_pick_schedule.kickoff_at_utc is not null
       and now() >= current_pick_schedule.kickoff_at_utc - interval '2 minutes' then
      raise exception 'Week % is locked because % already reached its pick window', new.week, current_pick_team;
    end if;
  end if;

  -- One team per season. THE CHANGE: a week whose newest row is a skip has been
  -- released, so it no longer holds its team.
  --
  -- The skip test sits in the OUTER query, not in the subquery's where clause.
  -- Inside, it would pick the newest NON-skipped row per week and the released
  -- week would keep claiming its team forever.
  if exists (
    select 1
    from (
      select distinct on (week) week, team, result
      from public.ff_picks
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

-- The trigger itself is unchanged; recreated so this file stands alone.
drop trigger if exists ff_apply_pick_schedule_before_insert on public.ff_picks;
create trigger ff_apply_pick_schedule_before_insert
before insert on public.ff_picks
for each row
execute function public.ff_apply_pick_schedule();

-- ---------------------------------------------------------------------------
-- 2. The suspects view.
--
--    game_status is read off the player's latest week. Without the filter, a
--    player who releases their furthest-out week shows 'SKIP' on their mugshot
--    instead of the verdict from the week they are actually still alive in.
--
--    ff_active_picks is left alone on purpose: it is the raw "newest row per
--    week" view, and skip rows are newest rows. Nothing in the site reads it;
--    anything that starts to must drop skipped rows itself.
-- ---------------------------------------------------------------------------
create or replace view public.ff_current_suspects as
select
  profiles.id,
  profiles.username,
  profiles.first_name,
  profiles.avatar_data_url,
  coalesce(latest_pick.result, 'SUSPECT') as game_status
from public.ff_profiles as profiles
left join lateral (
  select active_picks.result
  from public.ff_active_picks as active_picks
  where active_picks.user_id = profiles.id
    and coalesce(upper(btrim(active_picks.result)), '') <> 'SKIP'
  order by active_picks.week desc, active_picks.submitted_at_utc desc, active_picks.created_at desc
  limit 1
) as latest_pick on true
order by profiles.username;

revoke all on public.ff_current_suspects from anon, authenticated;
grant select (id, username, avatar_data_url, game_status)
  on public.ff_current_suspects to anon;
grant select on public.ff_current_suspects to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Verify. Expect security definer = true and the SKIP clause present.
-- ---------------------------------------------------------------------------
select p.proname,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       position('SKIP' in pg_get_functiondef(p.oid)) > 0 as knows_about_skips
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'ff_apply_pick_schedule';

-- Every week a player has released, newest first. Empty until someone moves a
-- future pick.
select user_id, week, team, submitted_at_utc
from public.ff_active_picks
where coalesce(upper(btrim(result)), '') = 'SKIP'
order by submitted_at_utc desc;
