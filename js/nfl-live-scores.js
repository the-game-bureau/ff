// ===== LIVE NFL SCORES =====
// Finals fetched straight from the scoreboard, in the browser, at the moment
// the admin asks for them.
//
// WHY THIS EXISTS
// js/nfl-scores.js is a generated file: somebody runs tools/update-nfl-scores.mjs,
// commits it and deploys before a week can be scored. That is three steps at a
// particular desk, and the whole of the friction in scoring a week - the scoring
// itself has been one button for a while. This module removes the three steps.
//
// WHY IT CAN BE DONE FROM THE BROWSER AT ALL
// ESPN's scoreboard answers with `Access-Control-Allow-Origin: *`, so a page can
// read it directly. That is the only reason this needs no server, no proxy and
// no deploy. If that ever stops being true the fetch fails, admin-score.js falls
// back to the generated file, and nothing breaks - it just goes back to needing
// the three steps.
//
// WHY THE TEAM NAMES ARE NOT MAPPED
// All 32 of ESPN's displayName values are character-for-character the names in
// js/teams.js, checked both directions. A mapping table would be one more thing
// to keep in step for no gain, so there isn't one - but normalise() below is
// what every comparison goes through, so a stray suffix would still match.
//
// The shape returned is deliberately the same as NFL_SCORE_GAMES, so callers do
// not care which source they got.
(function () {
  const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

  // 2 is the regular season. 1 is preseason, which arrived as 36 Week 18 finals
  // the last time a scraper was pointed at the wrong part of a season.
  const REGULAR_SEASON = 2;

  function urlFor(season, week) {
    return `${SCOREBOARD_URL}?dates=${Number(season)}&seasontype=${REGULAR_SEASON}&week=${Number(week)}`;
  }

  // Exported for a test to call without a network: given the JSON, this is the
  // whole of the translation.
  function parseScoreboard(payload, season, week) {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const games = [];

    for (const event of events) {
      const game = event?.competitions?.[0];
      const sides = game?.competitors;
      if (!Array.isArray(sides) || sides.length !== 2) continue;

      const home = sides.find((side) => side.homeAway === 'home') || sides[0];
      const away = sides.find((side) => side.homeAway === 'away') || sides[1];

      const homeName = home?.team?.displayName || '';
      const awayName = away?.team?.displayName || '';
      if (!homeName || !awayName) continue;

      const status = game?.status?.type || {};
      // `completed` and not the STATUS_FINAL name: a game can end as
      // STATUS_FINAL_OVERTIME, and matching on the name alone would drop it.
      const final = Boolean(status.completed);

      games.push({
        season: Number(season),
        week: Number(week),
        away: awayName,
        awayAbbr: away?.team?.abbreviation || '',
        awayScore: final ? Number(away?.score) : null,
        home: homeName,
        homeAbbr: home?.team?.abbreviation || '',
        homeScore: final ? Number(home?.score) : null,
        status: status.shortDetail || status.description || status.name || '',
        final,
        sourceUrl: urlFor(season, week)
      });
    }

    return games;
  }

  // 'won' | 'lost' | 'tied', which is what the scoring function is told. A tie
  // eliminates exactly like a win, but it is reported honestly rather than
  // flattened into one, because the report the admin reads says which happened.
  function outcomeFor(game, team) {
    if (!game?.final) return null;

    const wanted = normalise(team);
    const isAway = normalise(game.away) === wanted;
    const isHome = normalise(game.home) === wanted;
    if (!isAway && !isHome) return null;

    const own = isAway ? game.awayScore : game.homeScore;
    const other = isAway ? game.homeScore : game.awayScore;
    if (!Number.isFinite(own) || !Number.isFinite(other)) return null;

    if (own > other) return 'won';
    if (own < other) return 'lost';
    return 'tied';
  }

  function normalise(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  async function fetchWeek(season, week) {
    const response = await fetch(urlFor(season, week), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Scoreboard returned ${response.status}`);
    return parseScoreboard(await response.json(), season, week);
  }

  window.ffLiveScores = { fetchWeek, parseScoreboard, outcomeFor, urlFor };
})();
