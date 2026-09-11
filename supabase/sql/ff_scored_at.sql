-- When a pick was judged.
--
-- WHAT IT IS FOR
-- The wire on the Precinct says how current it is: "as of friday, september
-- 11th 9:32 am central". That line used to quote NFL_SCORE_FETCHED_AT, which is
-- when somebody last ran tools/update-nfl-scores.mjs - the age of the
-- scoreboard FILE, not of the league's own results. The two can be a day apart:
-- the file is regenerated on Monday and the week is not scored until Tuesday,
-- and the wire was claiming Monday.
--
-- What a reader actually wants to know is when SCORE THE WEEK was last run,
-- because that is when the sentences on the strip last changed. So every row
-- carries the moment its verdict was written, and the wire reports the newest
-- one it can see.
--
-- WHY A TRIGGER AND NOT THE SCORING FUNCTION
-- _2026_admin_score_week could set this itself, but then the column would only
-- ever be right for rows that function touched, and anything that writes a
-- result by another route - a hand correction in the SQL editor, a future
-- backfill - would leave the timestamp lying. A trigger is the narrower claim:
-- this column means "when this row's result last changed", whoever changed it.
--
-- WHAT COUNTS AS A VERDICT
-- SURVIVED and DUN DUN. Not 'Pick Is In', which is the absence of a verdict and
-- is what a row is born with, and not SKIP, which is a tombstone for a released
-- week rather than a judgement on anything. Stamping those would make an
-- ordinary pick change look like a scoring run.
--
-- WHO CAN READ IT
-- Everybody, including signed-out visitors - the Precinct is a public page and
-- the wire is the first thing on it. There is nothing private in a timestamp
-- that says when the league was last scored.
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

alter table public._2026_picks
  add column if not exists scored_at timestamptz;

comment on column public._2026_picks.scored_at is
  'When this row''s result last became a verdict (SURVIVED or DUN DUN). Set by '
  'the _2026_stamp_scored_at trigger, read by the wire on the Precinct to say '
  'how current it is. Null on a pick that has not been judged.';

-- Case-insensitive and whitespace-tolerant, because `result` is free text that
-- has arrived as 'DUN DUN', 'Dun Dun' and 'dun dun' at different times and the
-- readers in js/ all match it loosely too.
create or replace function public._2026_is_verdict(result text)
returns boolean
language sql
immutable
as $$
  select upper(btrim(coalesce(result, ''))) in ('SURVIVED', 'DUN DUN');
$$;

create or replace function public._2026_stamp_scored_at()
returns trigger
language plpgsql
as $$
begin
  -- An insert that arrives already carrying a verdict is the scorer filing a
  -- NO PICK row against somebody who never named a victim. That is a scoring
  -- run too, and the wire should date from it.
  if tg_op = 'INSERT' then
    if public._2026_is_verdict(new.result) then
      new.scored_at := now();
    end if;
    return new;
  end if;

  -- Only when the verdict itself changes. A pick edited for any other reason
  -- must not move the timestamp, or every change anybody makes would read as a
  -- scoring run on the Precinct.
  if new.result is distinct from old.result and public._2026_is_verdict(new.result) then
    new.scored_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_2026_stamp_scored_at on public._2026_picks;

create trigger trg_2026_stamp_scored_at
  before insert or update on public._2026_picks
  for each row
  execute function public._2026_stamp_scored_at();

-- Readable by the browser, both signed in and signed out. Column-level, to stay
-- in step with how the rest of this table is granted.
grant select (scored_at) on public._2026_picks to anon, authenticated;

-- NOT added to _2026_active_picks. That view is defined with SELECT *, which
-- Postgres expands once, when the view is created - a column added to the table
-- afterwards never shows up in it, and asking the view for scored_at returns
-- 42703. js/wire.js therefore reads this off the table. If the view is ever
-- rebuilt for other reasons the column will come along, and nothing needs
-- changing here.

-- Backfill, so the wire has something to say before the next scoring run rather
-- than falling back to the scoreboard file's age. created_at is the best
-- available stand-in: it is when the row was filed, which for a NO PICK row IS
-- the scoring run, and for a judged pick is at worst an underestimate.
update public._2026_picks
   set scored_at = created_at
 where scored_at is null
   and public._2026_is_verdict(result);

-- What the wire will read: one row, newest first.
select max(scored_at) as last_scored_at,
       count(*) filter (where scored_at is not null) as rows_stamped
  from public._2026_picks;
