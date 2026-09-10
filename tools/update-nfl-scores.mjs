#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Reads finals off the season schedule page - the same page js/nfl-schedule.js
// was generated from - because that is where Plain Text Sports now publishes
// them. It used to fetch a scoreboard per week at /nfl/<season>/week<N>/, and
// that URL has since become a stub that redirects to "today's scoreboard": the
// fetch still returned HTTP 200, the parser found nothing in it, and the tool
// reported "Wrote 0 final NFL scores" every time without ever saying why.
//
// A played game on the schedule page carries a score pair where an unplayed one
// carries a kickoff time:
//
//   Patriots    0-1 @ Seahawks    1-0    10-13     <- final, 10 to 13
//   49ers       0-0 @ Rams        0-0  @  8:35 PM  <- not played
//
// The 0-1 and 1-0 are win-loss records, which is why the score is taken from the
// LAST pair on the line and not the first one that matches.
const DEFAULT_SEASON = 2026;
const DEFAULT_OUTFILE = 'js/nfl-scores.js';
const TEAM_BY_ABBR = new Map([
  ['ARI', 'Arizona Cardinals'],
  ['ATL', 'Atlanta Falcons'],
  ['BAL', 'Baltimore Ravens'],
  ['BUF', 'Buffalo Bills'],
  ['CAR', 'Carolina Panthers'],
  ['CHI', 'Chicago Bears'],
  ['CIN', 'Cincinnati Bengals'],
  ['CLE', 'Cleveland Browns'],
  ['DAL', 'Dallas Cowboys'],
  ['DEN', 'Denver Broncos'],
  ['DET', 'Detroit Lions'],
  ['GB', 'Green Bay Packers'],
  ['HOU', 'Houston Texans'],
  ['IND', 'Indianapolis Colts'],
  ['JAX', 'Jacksonville Jaguars'],
  ['KC', 'Kansas City Chiefs'],
  ['LV', 'Las Vegas Raiders'],
  ['LAC', 'Los Angeles Chargers'],
  ['LAR', 'Los Angeles Rams'],
  ['MIA', 'Miami Dolphins'],
  ['MIN', 'Minnesota Vikings'],
  ['NE', 'New England Patriots'],
  ['NO', 'New Orleans Saints'],
  ['NYG', 'New York Giants'],
  ['NYJ', 'New York Jets'],
  ['PHI', 'Philadelphia Eagles'],
  ['PIT', 'Pittsburgh Steelers'],
  ['SF', 'San Francisco 49ers'],
  ['SEA', 'Seattle Seahawks'],
  ['TB', 'Tampa Bay Buccaneers'],
  ['TEN', 'Tennessee Titans'],
  ['WAS', 'Washington Commanders']
]);

// Every team's last word is unique across the 32, so the short names the
// schedule page prints map back without a second table to maintain.
const TEAM_BY_SHORT = new Map(
  [...TEAM_BY_ABBR.values()].map((full) => [full.split(' ').pop().toLowerCase(), full])
);

const args = parseArgs(process.argv.slice(2));
const season = Number(args.season || DEFAULT_SEASON);
const outfile = args.out || DEFAULT_OUTFILE;
const weeks = weekRange(args.week);

if (isMain()) {
  const scores = await fetchSeasonScores(season, weeks);
  await writeScoreFile(resolve(outfile), season, scores);
  console.log(`Wrote ${scores.length} final NFL scores to ${outfile}.`);
}

export async function fetchSeasonScores(scoreSeason = DEFAULT_SEASON, scoreWeeks = weekRange()) {
  const sourceUrl = scheduleUrl(scoreSeason);
  const response = await fetch(sourceUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Plain Text Sports returned HTTP ${response.status} for ${sourceUrl}`);
  }

  const wanted = new Set(scoreWeeks.map(Number));
  const games = parseScheduleHtml(await response.text(), { season: scoreSeason, sourceUrl })
    .filter((game) => wanted.has(game.week));

  return sortScores(dedupeScores(games));
}

export function parseScheduleHtml(html, { season = DEFAULT_SEASON, sourceUrl = '' } = {}) {
  const text = htmlToText(String(html || ''));
  const games = [];
  let week = 0;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // The same page carries the preseason under its own headings, and those
    // games are not the season. Without this they kept whatever week number was
    // last seen - which is week 18 - and 36 August friendlies arrived as Week 18
    // finals.
    if (/^Preseason\b/i.test(line)) {
      week = 0;
      continue;
    }

    const weekHeading = line.match(/^Week\s+(\d+)\s*:/i);
    if (weekHeading) {
      week = Number(weekHeading[1]);
      continue;
    }
    if (!week) continue;

    const game = parseScheduleLine(line, { season, week, sourceUrl });
    if (game) games.push(game);
  }

  return games;
}

// away  W-L @ home  W-L  AWAYSCORE-HOMESCORE
//
// Two things the obvious pattern gets wrong. A record can carry ties, so it is
// W-L-T and not always W-L - the Colts and Patriots opened 0-0-1 apiece in the
// preseason. And the next day's heading is appended to the end of the last line
// of the previous day, so the score pair is not at the end of the line:
//
//   Patriots  0-1 @ Seahawks  1-0  10-13     Thursday, September 10, 2026:
//
// Anything with no score pair has not been played, so it is skipped: this file
// is a record of finals, and a fixture is already in the schedule.
export function parseScheduleLine(line, { season = DEFAULT_SEASON, week = 1, sourceUrl = '' } = {}) {
  const match = line.match(
    /^(.+?)\s+\d+-\d+(?:-\d+)?\s+@\s+(.+?)\s+\d+-\d+(?:-\d+)?\s+(\d+)-(\d+)(?:\s|$)/
  );
  if (!match) return null;

  const away = TEAM_BY_SHORT.get(match[1].trim().toLowerCase());
  const home = TEAM_BY_SHORT.get(match[2].trim().toLowerCase());
  if (!away || !home) return null;

  const awayScore = Number(match[3]);
  const homeScore = Number(match[4]);
  if (!Number.isInteger(awayScore) || !Number.isInteger(homeScore)) return null;

  return {
    season,
    week,
    away,
    awayAbbr: abbrFor(away),
    awayScore,
    home,
    homeAbbr: abbrFor(home),
    homeScore,
    status: 'Final',
    final: true,
    sourceUrl
  };
}

function abbrFor(fullName) {
  for (const [abbr, name] of TEAM_BY_ABBR) {
    if (name === fullName) return abbr;
  }
  return '';
}

export function renderScoreFile({ season = DEFAULT_SEASON, scores = [], fetchedAt = new Date().toISOString() } = {}) {
  return `// Generated from Plain Text Sports NFL week scoreboards
// Fetched: ${fetchedAt}
const NFL_SCORE_SEASON = ${JSON.stringify(season)};
const NFL_SCORE_GAMES = ${JSON.stringify(sortScores(scores), null, 2)};

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
`;
}

async function writeScoreFile(path, scoreSeason, scores) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, renderScoreFile({ season: scoreSeason, scores }), 'utf8');
}

function parseTeamScores(text) {
  const scores = new Map();
  const linePattern = /\b([A-Z]{2,3})\s+(\d{1,3})\b/g;
  let match;

  while ((match = linePattern.exec(text))) {
    const abbr = match[1];
    if (TEAM_BY_ABBR.has(abbr)) {
      scores.set(abbr, Number(match[2]));
    }
  }

  return scores;
}

function finalStatus(text) {
  const status = String(text || '').match(/\bFinal(?:\/OT)?\b/i)?.[0] || 'Final';
  return status.toUpperCase() === 'FINAL' ? 'Final' : status;
}

function attrValue(attrs, name) {
  const match = String(attrs || '').match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeHtml(match?.[1] || match?.[2] || match?.[3] || '');
}

function htmlToText(html) {
  return decodeHtml(String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/\r/g, ''));
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function absoluteUrl(pageUrl, href) {
  try {
    return new URL(href, pageUrl || 'https://plaintextsports.com').toString();
  } catch {
    return href;
  }
}

function scheduleUrl(scoreSeason) {
  return `https://plaintextsports.com/nfl/${scoreSeason}/schedule`;
}

function dedupeScores(scores) {
  const byGame = new Map();
  for (const score of scores) {
    byGame.set(`${score.week}|${score.awayAbbr}|${score.homeAbbr}`, score);
  }
  return [...byGame.values()];
}

function sortScores(scores) {
  return [...scores].sort((a, b) =>
    Number(a.week) - Number(b.week) ||
    String(a.awayAbbr).localeCompare(String(b.awayAbbr)) ||
    String(a.homeAbbr).localeCompare(String(b.homeAbbr))
  );
}

function weekRange(weekArg = '') {
  if (!weekArg) return Array.from({ length: 18 }, (_, index) => index + 1);
  const week = Number(weekArg);
  if (!Number.isInteger(week) || week < 1 || week > 18) {
    throw new Error(`Invalid NFL week: ${weekArg}`);
  }
  return [week];
}

function parseArgs(rawArgs) {
  return rawArgs.reduce((parsed, arg) => {
    const match = String(arg).match(/^--([^=]+)=(.*)$/);
    if (match) parsed[match[1]] = match[2];
    return parsed;
  }, {});
}

function isMain() {
  return import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href &&
    process.argv[1] &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}
