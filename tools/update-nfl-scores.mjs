#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const games = [];

  for (const week of scoreWeeks) {
    const sourceUrl = scoreUrlForWeek(scoreSeason, week);
    const response = await fetch(sourceUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Plain Text Sports returned HTTP ${response.status} for ${sourceUrl}`);
    }

    const html = await response.text();
    games.push(...parseScoreboardHtml(html, { season: scoreSeason, week, sourceUrl }));
  }

  return sortScores(dedupeScores(games));
}

export function parseScoreboardHtml(html, { season = DEFAULT_SEASON, week = 1, sourceUrl = '' } = {}) {
  const games = [];
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(String(html || '')))) {
    const attrs = match[1] || '';
    const href = attrValue(attrs, 'href');
    if (!href || !href.includes(`/nfl/${season}/week${week}/`)) continue;

    const slugMatch = href.match(new RegExp(`/nfl/${season}/week${week}/([a-z]+)-([a-z]+)`, 'i'));
    if (!slugMatch) continue;

    const awayAbbr = slugMatch[1].toUpperCase();
    const homeAbbr = slugMatch[2].toUpperCase();
    const away = TEAM_BY_ABBR.get(awayAbbr);
    const home = TEAM_BY_ABBR.get(homeAbbr);
    if (!away || !home) continue;

    const body = match[2] || '';
    if (/<time\b/i.test(body)) continue;

    const text = htmlToText(body);
    if (!/\bFinal\b/i.test(text)) continue;

    const teamScores = parseTeamScores(text);
    const awayScore = teamScores.get(awayAbbr);
    const homeScore = teamScores.get(homeAbbr);
    if (!Number.isInteger(awayScore) || !Number.isInteger(homeScore)) continue;

    games.push({
      season,
      week,
      away,
      awayAbbr,
      awayScore,
      home,
      homeAbbr,
      homeScore,
      status: finalStatus(text),
      final: true,
      sourceUrl: absoluteUrl(sourceUrl, href)
    });
  }

  return games;
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

function scoreUrlForWeek(scoreSeason, week) {
  return `https://plaintextsports.com/nfl/${scoreSeason}/week${Number(week)}/`;
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
