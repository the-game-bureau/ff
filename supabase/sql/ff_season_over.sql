-- The season is over. Stop scoring it.
--
-- WHY
-- The 2026 season was decided in Week 5: Honore_de_Ballsack is the last suspect
-- standing. The league does not play on. But the auto-scorer (ff_auto_score.sql)
-- does not know that - it keeps asking _2026_open_week() what to score, and
-- once the last game of Week 6 kicks off it marks every surviving suspect who
-- filed nothing as NO PICK. The winner has filed nothing for Week 6, because
-- there is nothing to file for. Left running, the job would close the winner's
-- case a week after they won.
--
-- WHAT THIS DOES
-- Unschedules the '2026-auto-score' cron job. Nothing else: no picks are
-- touched, no verdicts change, and the functions stay in place so the job can
-- be put back by re-running ff_auto_score.sql if the season is ever reopened.
--
-- THE SCORE THE WEEK BUTTON STILL WORKS. It calls the same core by hand, so do
-- not press it for Week 6 or later - it would write the same NO PICK.
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


select cron.unschedule('2026-auto-score')
where exists (select 1 from cron.job where jobname = '2026-auto-score');


-- ---------------------------------------------------------------------------
-- Verify. Should return no rows.
-- ---------------------------------------------------------------------------
select jobname, schedule, active from cron.job where jobname = '2026-auto-score';
