-- Make the server close the pick window at the same moment the browser does.
--
-- WHY THIS EXISTS
-- The house rule is that a team stops being pickable five minutes before
-- kickoff. js/season.js carries that number for the client (PICK_LOCK_MINUTES),
-- but the browser is only ever the polite half of the rule: ff_apply_pick_
-- schedule() re-checks every insert, and it was written with a two minute
-- window. So for three minutes before every kickoff the grid showed a card as
-- UNAVAILABLE while the database would still have accepted it. Anyone posting
-- straight at PostgREST — or running an older cached copy of the site — could
-- pick a team the site had already closed.
--
-- WHY IT REWRITES RATHER THAN REPLACES
-- The obvious version of this file is `create or replace function` with the
-- whole body pasted in. That is how the earlier migrations in this folder are
-- written, and here it is the dangerous option: this project's trigger has been
-- amended more than once (ff_schedule_access_fix.sql pinned its attributes,
-- ff_release_future_pick.sql taught it about SKIP rows), and pasting a body
-- from a file silently reverts anything applied since. create or replace also
-- resets function attributes to their defaults, which is how security definer
-- and the pinned search_path got lost once already.
--
-- So this reads the function that is actually installed, changes only the
-- interval, and puts it back. pg_get_functiondef() emits the attributes too,
-- so security definer and search_path survive. Everything else is untouched
-- because nothing else is looked at.
--
-- It is deliberately loud: if the function cannot be found, or if the interval
-- is not what this migration expects, it raises instead of quietly doing
-- nothing. A migration that no-ops is worse than one that fails, because the
-- gap it was meant to close stays open and looks closed.
--
-- Run in the Supabase SQL editor. Safe to re-run — the second run finds five
-- minutes already in place and says so.
--
-- This file was once run against the wrong project: it found a trigger, rewrote
-- it, and reported a clean pass while the live project stayed at two minutes.
-- The tell was in the verify output — a project whose site writes to
-- _2026_picks reporting the function as public.ff_apply_pick_schedule. Hence
-- the guard below, now on every script in this folder.

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
-- 1. Look first. Run this on its own if you want to see what is installed
--    before changing it: name, attributes, and the intervals in the body.
-- ---------------------------------------------------------------------------
select
  n.nspname || '.' || p.proname                                as function_name,
  p.prosecdef                                                  as security_definer,
  p.proconfig                                                  as settings,
  (select count(*)
     from regexp_matches(pg_get_functiondef(p.oid),
                         'interval\s+''\d+\s+minutes?''', 'g')) as interval_count,
  (select string_agg(m[1], ', ')
     from regexp_matches(pg_get_functiondef(p.oid),
                         '(interval\s+''\d+\s+minutes?'')', 'g') as m)
                                                               as intervals_found
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like '%apply_pick_schedule%';

-- ---------------------------------------------------------------------------
-- 2. Change it. Handles the 2026 name and the older ff_ one, and any number of
--    kickoff guards in the body — there are two today (the team being named,
--    and the pick already standing for that week) and both must move together.
-- ---------------------------------------------------------------------------
do $do$
declare
  target      record;
  old_def     text;
  new_def     text;
  changed     integer;
  touched     integer := 0;
  already     integer := 0;
begin
  for target in
    select p.oid, n.nspname || '.' || p.proname as full_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like '%apply_pick_schedule%'
  loop
    old_def := pg_get_functiondef(target.oid);

    -- Already done? Say so and leave it alone, so re-running is a no-op rather
    -- than a rewrite.
    if old_def !~ 'interval\s+''\d+\s+minutes?''' then
      raise exception
        'No kickoff interval found in %. This migration does not understand '
        'the installed function; inspect it with the query above before going '
        'further.', target.full_name;
    end if;

    new_def := regexp_replace(old_def,
                              'interval\s+''\d+\s+minutes?''',
                              'interval ''5 minutes''',
                              'g');

    -- Nothing to do: every guard already reads 5. Compared as text rather than
    -- pattern-matched, so this cannot be fooled by a body with a mix of values.
    if new_def = old_def then
      already := already + 1;
      raise notice '% already closes the window at 5 minutes. Left alone.', target.full_name;
      continue;
    end if;

    select count(*) into changed
    from regexp_matches(new_def, 'interval\s+''5\s+minutes?''', 'g');

    execute new_def;
    touched := touched + 1;
    raise notice 'Rewrote % — % kickoff guard(s) now at 5 minutes.',
      target.full_name, changed;
  end loop;

  if touched = 0 and already = 0 then
    raise exception
      'No function matching %%apply_pick_schedule%% exists in public. Nothing '
      'was changed, and the server is still enforcing its old window.';
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 3. Verify. Expect security_definer = true, settings still pinning
--    search_path, and every interval reading 5 minutes.
-- ---------------------------------------------------------------------------
select
  n.nspname || '.' || p.proname as function_name,
  p.prosecdef                   as security_definer,
  p.proconfig                   as settings,
  (select string_agg(m[1], ', ')
     from regexp_matches(pg_get_functiondef(p.oid),
                         '(interval\s+''\d+\s+minutes?'')', 'g') as m)
                                as intervals_now,
  position('SKIP' in pg_get_functiondef(p.oid)) > 0 as still_knows_about_skips
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname like '%apply_pick_schedule%';
