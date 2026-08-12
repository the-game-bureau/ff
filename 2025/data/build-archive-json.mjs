// Turns the Supabase CSV exports into the static JSON the 2025 archive reads.
//
//   node 2025/data/build-archive-json.mjs [path-to-archived_db]
//
// Defaults to ../../../archived_db (the gitignored export folder). Writes
// picks.json and profiles.json next to this script.
//
// user_id is dropped on purpose. Name and email are NOT: the admin page lists
// the 2025 roster with both, and this file is where they come from.
//
// Know what that means. profiles.json is served as a static file, so anyone who
// knows the URL can fetch it — the case-file gate on the archive page does not
// cover it. These addresses are published, in effect. That was a deliberate
// call; if it is ever reconsidered, the fix is to move the roster behind an
// admin-only RPC on the live project rather than to trim the file and hope
// nobody kept a copy.

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

// The export's name columns have changed shape over the years, so take the
// first spelling that is actually present rather than assuming one.
const pickFirst = (row, ...keys) => {
  for (const key of keys) {
    const value = clean(row[key]);
    if (value) return value;
  }
  return '';
};

// Names are NOT in the export — the 2025 profiles table was id, username,
// created_at, email and nothing else — so every name in profiles.json was typed
// in by hand. Rebuilding from the CSV would therefore wipe all 32 of them,
// which is why the existing file is read first and its names carried over. The
// CSV still wins when it has a name to give, in case a later export gains the
// column.
let existingNames = new Map();
try {
  existingNames = new Map(
    JSON.parse(readFileSync(join(here, 'profiles.json'), 'utf8'))
      .filter(p => p.name)
      .map(p => [p.username, p.name])
  );
} catch {
  // No previous file, or an unreadable one. Nothing to preserve.
}

const profiles = parseCsv(readFileSync(join(srcDir, 'profiles_rows.csv'), 'utf8'))
  .map(r => {
    const first = pickFirst(r, 'first_name', 'firstname', 'given_name');
    const last = pickFirst(r, 'last_name', 'lastname', 'family_name', 'surname');
    const whole = pickFirst(r, 'full_name', 'name', 'display_name');

    return {
      username: clean(r.username),
      // One field, not two: this is a record of who played, and the admin page
      // prints it as written. Falls back to a whole-name column when the export
      // has one instead of a split pair.
      name: [first, last].filter(Boolean).join(' ') || whole ||
            existingNames.get(clean(r.username)) || '',
      email: clean(r.email).toLowerCase(),
      created_at: toIso(r.created_at),
    };
  })
  .filter(p => p.username)
  .sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));

writeFileSync(join(here, 'picks.json'), JSON.stringify(picks, null, 2) + '\n');
writeFileSync(join(here, 'profiles.json'), JSON.stringify(profiles, null, 2) + '\n');

const weeks = [...new Set(picks.map(p => p.week))].sort((a, b) => a - b);
console.log(`picks.json    ${picks.length} picks, weeks ${weeks[0]}-${weeks.at(-1)}`);
console.log(`profiles.json ${profiles.length} players`);
