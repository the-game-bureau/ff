// Generated from Plain Text Sports NFL week scoreboards
// Fetched: 2026-08-15T16:59:52.070Z
const NFL_SCORE_SEASON = 2026;
const NFL_SCORE_GAMES = [];

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
window.NFL_SCORE_GAMES = NFL_SCORE_GAMES;
window.NFL_SCORE_HELPERS = {
  getWeekScores: getNflWeekScores,
  getGameForTeams: getNflScoreGameForTeams,
  getTeamScoreFromGame: getNflTeamScoreFromGame,
  getTeamResultFromGame: getNflTeamResultFromGame
};
