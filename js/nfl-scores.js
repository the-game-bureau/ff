// Generated from Plain Text Sports NFL week scoreboards
// Fetched: 2026-09-11T14:32:57.510Z
const NFL_SCORE_SEASON = 2026;
// When this file was built. Exposed as a value and not just the comment above,
// so the admin screen can say how old the scores are - a stale file is the one
// failure of this whole arrangement that looks exactly like "no games have
// finished yet".
const NFL_SCORE_FETCHED_AT = "2026-09-11T14:32:57.510Z";
const NFL_SCORE_GAMES = [
  {
    "season": 2026,
    "week": 1,
    "away": "New England Patriots",
    "awayAbbr": "NE",
    "awayScore": 10,
    "home": "Seattle Seahawks",
    "homeAbbr": "SEA",
    "homeScore": 13,
    "status": "Final",
    "final": true,
    "sourceUrl": "https://plaintextsports.com/nfl/2026/schedule"
  },
  {
    "season": 2026,
    "week": 1,
    "away": "San Francisco 49ers",
    "awayAbbr": "SF",
    "awayScore": 27,
    "home": "Los Angeles Rams",
    "homeAbbr": "LAR",
    "homeScore": 7,
    "status": "Final",
    "final": true,
    "sourceUrl": "https://plaintextsports.com/nfl/2026/schedule"
  }
];

function getNflWeekScores(week){
  return NFL_SCORE_GAMES.filter(game => game.week === Number(week));
}

function getNflScoreGameForTeams(teamA, teamB, week){
  const a = normalizeNflScoreTeam(teamA);
  const b = normalizeNflScoreTeam(teamB);
  if(!a || !b) return null;

  return getNflWeekScores(week).find(game => {
    const away = normalizeNflScoreTeam(game.away);
    const home = normalizeNflScoreTeam(game.home);
    return (away === a && home === b) || (away === b && home === a);
  }) || null;
}

function getNflTeamScoreFromGame(game, teamName){
  if(!game) return null;
  const team = normalizeNflScoreTeam(teamName);
  if(team === normalizeNflScoreTeam(game.away)) return game.awayScore;
  if(team === normalizeNflScoreTeam(game.home)) return game.homeScore;
  return null;
}

function getNflTeamResultFromGame(game, teamName){
  if(!game || !game.final) return '';
  const score = getNflTeamScoreFromGame(game, teamName);
  if(score === null) return '';
  const opponentScore = normalizeNflScoreTeam(teamName) === normalizeNflScoreTeam(game.away)
    ? game.homeScore
    : game.awayScore;
  if(score < opponentScore) return 'lost';
  if(score > opponentScore) return 'won';
  return 'tied';
}

function normalizeNflScoreTeam(value){
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

window.NFL_SCORE_SEASON = NFL_SCORE_SEASON;
window.NFL_SCORE_FETCHED_AT = NFL_SCORE_FETCHED_AT;
window.NFL_SCORE_GAMES = NFL_SCORE_GAMES;
window.NFL_SCORE_HELPERS = {
  getWeekScores: getNflWeekScores,
  getGameForTeams: getNflScoreGameForTeams,
  getTeamScoreFromGame: getNflTeamScoreFromGame,
  getTeamResultFromGame: getNflTeamResultFromGame
};
