// Turns the Supabase CSV exports into the static JSON the 2025 archive reads.
//
//   node 2025/data/build-archive-json.mjs [path-to-archived_db]
//
// Defaults to ../../../archived_db (the gitignored export folder). Writes
// picks.json and profiles.json next to this script.
//
// user_id, email and real names are all dropped on purpose. These files are
// static assets on a public site: anyone who knows the URL can fetch them, and
// the case-file gate on the archive page does not cover them.
//
// The admin page's 2025 roster, which does show names and addresses, reads them
// from supabase/sql/ff_archive_2025_roster.sql instead — a table with RLS and
// no policies, reachable only through an admin-checked function. Put nothing in
// here that you would not publish.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, process.argv[2] || '../../../archived_db');

// RFC 4180: quoted fields may contain commas, newlines and "" escapes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }

    if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  return rows
    .filter(r => r.some(v => v !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const clean = v => (v ?? '').trim();

// Postgres CSV stamps look like "2025-09-04 19:47:27.851906+00", which several
// browsers refuse to parse. Normalize to ISO 8601 so new Date() is reliable.
const toIso = v => clean(v).replace(' ', 'T').replace(/\+00$/, 'Z');

const picks = parseCsv(readFileSync(join(srcDir, 'picks_rows.csv'), 'utf8'))
  .map(r => ({
    week: Number(r.week),
    team: clean(r.team),
    username: clean(r.username),
    result: clean(r.result),
    perpetrator: clean(r.perpetrator),
    created_at: toIso(r.created_at),
  }))
  .filter(p => Number.isFinite(p.week) && p.team)
  .sort((a, b) => a.week - b.week || a.created_at.localeCompare(b.created_at));

const profiles = parseCsv(readFileSync(join(srcDir, 'profiles_rows.csv'), 'utf8'))
  .map(r => ({ username: clean(r.username), created_at: toIso(r.created_at) }))
  .filter(p => p.username)
  .sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));

writeFileSync(join(here, 'picks.json'), JSON.stringify(picks, null, 2) + '\n');
writeFileSync(join(here, 'profiles.json'), JSON.stringify(profiles, null, 2) + '\n');

const weeks = [...new Set(picks.map(p => p.week))].sort((a, b) => a - b);
console.log(`picks.json    ${picks.length} picks, weeks ${weeks[0]}-${weeks.at(-1)}`);
console.log(`profiles.json ${profiles.length} players`);
