# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

**Law & Order: Special Victory Unit** — an NFL survivor pool with a Law & Order theme.
Each week a player picks one team they think will **lose**. If that team loses, the
player survives. Win or tie = eliminated ("DUN DUN"). Each team may be used only once
per season.

Static site, no build step. Open `index.html` in a browser (or serve the folder) and it
runs. Backend is Supabase (auth + two tables) loaded from a CDN.

## The Law & Order analogy

The whole site is a sustained parody of *Law & Order: SVU* — "Special Victims Unit"
becomes **Special Victory Unit**. The conceit: picking a team to lose is *prosecuting*
them. You accuse a team of being a loser; Sunday's result either convicts or acquits
them.
Any new copy, feature name, or UI label should be written inside this metaphor rather
than in plain fantasy-football language.

The mapping in use:

| Game concept | Themed as |
| --- | --- |
| The team you pick to lose | **VICTIM** — the one you expect to go down |
| A team nobody has picked yet | **STILL BREATHING** (a suspect is at large; a victim is still breathing) |
| Submitting a pick | "Name Your Victim" |
| The team grid | 🚨 **Victim Lineup** / the **Victim Registry** page |
| Signing out | **ESCAPE** |
| The rules | 🏛️ **The Law** |
| Registration / sign-ups open | "BOOKING OPEN: Enrollment Charges Now Filed" |
| Your pick's team losing (you advance) | **SURVIVED** |
| Your pick's team winning (you're out) | **DUN DUN** — the *chung-chung* scene-transition sting |
| Pick submitted, result pending | **PICK IS IN** |
| Elimination / end of your run | ⚖️ **CASE CLOSED** |
| Winning the whole season | Judge: "NOT GUILTY of poor judgment. Case dismissed with honors!" |
| Losing | Judge: "The defendant *[team]* has been found NOT GUILTY of losing. Your prosecution has failed." |

Note the inversion that makes the jokes work: a **guilty** verdict means the team lost
(you were right), **not guilty** means they won (you were wrong). Keep that direction
straight in any new copy.

Voice and set pieces:

- The tagline rewrites the show's cold open: *"In the NFL justice system, the people
  are represented by two separate yet equally important groups: those who win, and
  those who lose. These are their stories. Dun Dun."*
- `.verdict` callout boxes are quips attributed to canon characters — **Detective
  Briscoe** for wisecracks, **DA McCoy** for pick confirmations, **Judge** for
  game-over rulings. New quips should stay in-character and one line long.
- The header uses the show's stacked **LAW & / ORDER** logo in Friz Quadrata (the
  local `.woff`), with the season line under it as the SVU subtitle.
- The scrolling marquee is the "breaking case" ticker — always written as a filing,
  booking, or verdict announcement (e.g. `CASE CLOSED munch wins!!! 🏆`), never as a
  plain status message.
- Player names in the pool are Law & Order character names (e.g. `munch`), so treat
  usernames as part of the bit.

See [BRAINSTORMING.MD](BRAINSTORMING.MD) for theming ideas not yet built — notably
running live scores with L&O character/team names layered over real NFL teams, and
keeping the base game skinnable so a league can pick a different theme on top.

## Layout

The 2026 site is split into shared CSS and JS; only the archive is still one file.

- [index.html](index.html) — **the live site, current season (2026)**: the game.
- [victims.html](victims.html) — the Victim Registry, all 32 teams with helmets.
- [css/site.css](css/site.css) — every style for both pages. Paths inside it are
  relative to `css/`, so the font is `../fonts/…`. **Keep new styling here** — the
  2026 pages carry no inline `style=` attributes and shouldn't grow any.
- [js/season.js](js/season.js) — `SEASON` and `CURRENT_WEEK`, plus the header week
  badge. Loaded first on every page so the badge and the game always agree.
- [js/teams.js](js/teams.js) — `NFL_TEAMS`: name, NFL `abbr`, and colours. Shared.
- [js/nav.js](js/nav.js) — the header menu, injected into both pages. **The only
  place nav items are defined** — edit here, not in the HTML.
- [js/app.js](js/app.js) — the game: auth, picks, stats, timeline, tickers.
- [js/victims.js](js/victims.js) — the registry grid and the helmet drawing.
- [2025/](2025/) — **frozen archive of the 2025 season.** Self-contained: its own
  `fonts/`, `src/`, and `data/`. No backend, no auth, no writes — see below.
- [reset.html](reset.html) — password-reset landing page (Supabase redirect target).
- `fonts/FrizQuadrataRegular.woff` — the Law & Order header font, loaded locally.
- `src/` — images (`lawandorder.jpg` favicon/OG, `Lawandordersvu.webp`) plus old
  working copies of index.html; the `index_*.html` files are dead snapshots.
- `index copy.html` — stale backup, not served.
- [BRAINSTORMING.MD](BRAINSTORMING.MD) — running idea list for future features.

Untracked and intentionally excluded (see [.gitignore](.gitignore)): `admin.html`,
`archived_db/`.

Because the pages now load `css/` and `js/` by relative path, opening `index.html`
off disk works, but use a local server when testing so MIME types are right —
Chrome refuses a stylesheet served as `application/octet-stream`.

## The 2026 look: neo-brutalism

The house rules, all enforced in [css/site.css](css/site.css) via tokens:

- Hard black rules (`--rule`, `--rule-fat`), never a soft or coloured border.
- Offset shadows with **zero blur** (`--shadow*`). Nothing floats; it stacks.
- No `border-radius`, no gradients, no glow. The old neon header was flattened
  into hard offset text-shadows.
- Buttons press *into* the page on hover (translate + shadow collapses to 0)
  rather than lifting.
- Loud type: `--font-display` (Friz Quadrata) for headings and buttons,
  `--font-mono` for anything data-shaped, uppercase with wide tracking.
- Yellow (`--accent-yellow`) is the interaction colour — hover, focus, highlights.

Team colours are passed in as `--victim-primary` / `--team-primary` custom
properties rather than inline style strings.

### Team logos

The victims page uses the official club logos straight off the NFL's own CDN:
`https://static.www.nfl.com/league/api/clubs/logos/{ABBR}.svg`, the same assets
nfl.com/standings serves. The abbreviation lives on each team in `teams.js`. If a
logo fails to load, `victims.js` swaps in a drawn helmet so the grid never shows a
broken image — **keep that fallback**. Note these are trademarked marks used by
hotlink; nothing is copied into the repo.

## Gotchas that have already bitten

- **Pin the Supabase CDN.** `@supabase/supabase-js@2` floats. A release in the 2.11x
  line declares a global `var supabase`, which collides with a top-level
  `const supabase` and kills the entire script at parse time — the page renders
  chrome and nothing else. The client is therefore named `db`, and the script tag
  pins an exact version. Don't rename `db` back, and don't unpin.
- The season is frozen in two constants at the top of `js/app.js` (`SEASON`,
  `CURRENT_WEEK`). Nothing else should hardcode a year or a week.

## The archive rule

Each season the finished site gets frozen into a `YYYY/` folder and the root
`index.html` moves on to the next season. The current site links back with the
**COLD CASES** button in the nav.

When asked to change "the site", that means root `index.html`. The archive is a
preservation copy — leave it alone unless the request is explicitly about the archive.
It deliberately has no link back to the current season.

### How the 2025 archive works

The 2025 Supabase project is gone (its host no longer resolves), so the archive is
fully static:

- `2025/data/picks.json` — 159 picks, weeks 1–13, 32 players. Fields: `week`, `team`,
  `username`, `result`, `perpetrator`, `created_at` (ISO 8601).
- `2025/data/profiles.json` — the 32 registered players (`username`, `created_at`).
  Not read by the page; kept as part of the record.
- `2025/data/build-archive-json.mjs` — regenerates both from the CSV exports in the
  gitignored `archived_db/`. Run `node 2025/data/build-archive-json.mjs [path]`.
  **It drops `user_id` and `email` on purpose** — these files ship to a public site.

The page reads `data/picks.json` via `fetch` in `fetchAllPicksPublic()`; everything
downstream (Evidence Locker, League Timeline, Pick Ticker, team tiles) is unchanged
from the live version. All auth, `submitPick`, and Supabase code is gone. Because it
uses `fetch`, opening `2025/index.html` straight off disk fails — serve it over http,
which is how it's deployed anyway. The page says so if the fetch fails.

Entry is gated by a sealed-case-file overlay (`#caseGate`). The access code is checked
in the browser against an FNV-1a hash, so the code is not sitting in the source as
plain text, and a session unlock is remembered in `sessionStorage`. This is a soft
gate for a static site, not security: `data/picks.json` is fetchable directly by
anyone who knows the URL. Don't put anything in there you wouldn't publish.

To freeze the next season at year end: copy the root site plus `fonts/` and `src/`
into `YYYY/`, export the tables to CSV, adapt `build-archive-json.mjs`, strip the
backend the same way, and point the ARCHIVE link at the newest archive (or make it a
list once there are several).

## Editing the current site

- **Advancing the week**: change `const CURRENT_WEEK` in the script block. It is the
  single source of truth — `gameState.currentWeek` and the Pick Ticker's default week
  derive from it. Nothing else should hardcode a week number.
- **Season year** appears in the `.svu-subtitle` header line and in
  `getScheduleUrl()`'s plaintextsports URL — update both when the season rolls over.
- The scrolling banner text (`.scrolling-banner-content`) is edited by hand each week;
  it repeats the same phrase ~5x to fill the marquee loop.
- `nflTeams` holds all 32 teams with primary/secondary colors used for the pick tiles.
- Match the existing style: no framework, no bundler, plain DOM APIs, `document
  .getElementById`, brace-on-same-line CSS (`.foo{`). Keep everything in the one file.

## Supabase

Client is created inline with the project URL and the **anon** key (public by design;
row-level security is what protects data — never put a service-role key in this file).
Session persists in `localStorage` under `law-order-svu-auth`.

Tables in use:

- `profiles` — username per auth user. New users hit a username gate before playing.
- `picks` — `user_id`, `week`, `team`, `result`. `result` is free text matched
  case-insensitively for `survived` / `dun dun` / `pick is in`, which drives the status
  badge colors. Results are entered out-of-band (admin page, not in this repo).

## Conventions

- Commit messages in this repo are terse and lowercase (`wk13`, `winner banner`).
- Don't run a formatter over `index.html` — it's a large hand-maintained file and a
  reflow makes every diff unreadable.
