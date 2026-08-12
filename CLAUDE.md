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
| The players in the pool | **SUSPECTS** — they are booked, mugshotted, and put in a lineup |
| Submitting a pick | "Name Your Victim" |
| The team grid | **Victims** page |
| The player grid | **Suspects** page |
| Signing out | **ESCAPE** |
| The rules | 🏛️ **The Law** |
| Standings and pick history | **Case File** |
| Joining | **JOIN**, on the **Person of Interest** form |
| Your pick's team losing (you advance) | **SURVIVED** |
| Your pick's team winning (you're out) | **DUN DUN** — the *chung-chung* scene-transition sting |
| Pick submitted, result pending | **PICK IS IN** |
| Elimination / end of your run | ⚖️ **CASE CLOSED** |
| Winning the whole season | Judge: "NOT GUILTY of poor judgment. Case dismissed with honors!" |
| Losing | Judge: "The defendant *[team]* has been found NOT GUILTY of losing. Your prosecution has failed." |

Note the inversion that makes the jokes work: a **guilty** verdict means the team lost
(you were right), **not guilty** means they won (you were wrong). Keep that direction
straight in any new copy.

The frame that keeps SUSPECT and VICTIM from competing: **you are a suspect, and each
week you must name a victim to stay free.** Name right and you walk; name wrong and the
case closes on you. The last suspect still walking wins. Player-facing copy should not
call players *prosecutors* — a prosecutor cannot be booked, mugshotted, or eliminated,
and elimination is the whole game. (Three strings on the Case File page still say
"Prosecutors"; they predate this and should be changed when that page comes back.)

### Where the theme gives way to plain English

The victim cards state facts about a team's availability, and a player reading them is
mid-decision — so these are deliberately literal, not themed. Defined in `cardStatus()`
in [js/victims.js](js/victims.js), checked in this order, first match wins:

| Label | Meaning |
| --- | --- |
| **Your Current Selection** | your pick for the week being viewed |
| **Future Selection** | your pick for a *later* week — still selectable |
| **Previous Selection** | used in an earlier week, so unselectable |
| **Not Playing** | on a bye |
| **Past Kickoff** | their game has started |
| **Available** | free to pick |

`Future Selection` is the only label with a coloured badge that is still
clickable, so it is yellow (the site's interaction colour) rather than the red
of a genuinely spent team. Taking the team releases the later week — see
**Releasing a week** below. If that later week has already kicked off (which
only happens when looking back at an earlier week mid-season) the label stays
but the card goes dead; the tooltip says which week and why.

`Available` is also the count in the Case File status bar. The earlier themed set
(CURRENT VICTIM / NOT AVAILABLE / BYE / LOCKED / STILL BREATHING) is retired — do not
reintroduce "still breathing" for an unpicked team.

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

**Pages**

- [index.html](index.html) — **the Precinct**, the home page. Now little more than
  the QR code and the share strip; the game itself lives on the other pages.
- [victims.html](victims.html) — the Victims page: all 32 teams, and where a
  pick is made. Takes `?week=N`.
- [suspects/index.html](suspects/index.html) — the players, as mugshot cards.
- [law.html](law.html) — the rules.
- [report.html](report.html) — the **Case File**: status bar, League Timeline, Pick
  Ticker, Evidence Locker. Its nav button is currently disabled ("Coming Soon"), so
  the page is reachable only by URL.
- [join/index.html](join/index.html) — the **Person of Interest** form.
- [admin/index.html](admin/index.html) — schedule reconciliation and league removal.
  Gated on the username `theclarinetofjustice`.
- [2025/](2025/) — **frozen archive of the 2025 season.** Self-contained: its own
  `fonts/`, `src/`, and `data/`. No backend, no auth, no writes — see below.

**Shared code**

- [css/site.css](css/site.css) — every style for every 2026 page. Paths inside it
  are relative to `css/`, so the font is `../fonts/…`. **Keep new styling here** —
  the 2026 pages carry no inline `style=` attributes and shouldn't grow any.
- [js/season.js](js/season.js) — `SEASON` and `CURRENT_WEEK`, and the top-left badge
  (week / season / signed-in username). Loaded first on every page.
- [js/nfl-schedule.js](js/nfl-schedule.js) — the generated schedule, plus the
  helpers that derive the open week, kickoff locks and matchups from it.
- [js/teams.js](js/teams.js) — `NFL_TEAMS`: name, NFL `abbr`, and colours.
- [js/nav.js](js/nav.js) — the header menu. **The only place nav items are
  defined** — edit here, not in the HTML. It also renders the phone hamburger
  (`.nav-toggle`) and wires it up: CSS hides the toggle above 767px and hides
  the list below it until `.nav-open` is on the `<nav>`. The list is never
  removed from the DOM, so the menu still reads with the script blocked.
- [js/auth-corner.js](js/auth-corner.js) — the header auth controls and the sign-in
  popup, for every page except `index.html`, which carries its own copy in markup
  and drives it from `app.js`. (Two auth modules is a known wart.)
- [js/app.js](js/app.js) — the game: auth, picks, stats, timeline, tickers.
- [js/victims.js](js/victims.js) — the registry grid and the pick flow.
- [js/suspects.js](js/suspects.js) — the mugshot cards, including the placard
  stripes sampled from each photo.
- [js/join.js](js/join.js) — the join form and mugshot processing.
- [js/join-prefill.js](js/join-prefill.js) — carries what was typed in the sign-in
  popup over to the join form.
- [js/welcome.js](js/welcome.js) — the `#welcome` popup that shared links land on.
- [js/share.js](js/share.js) — the share sheet, with a per-platform lineup.
- [js/password-reset.js](js/password-reset.js) — the recovery lightbox. Replaces the
  old `reset.html`, which no longer exists; recovery links land on the site root.
- [js/mugshot-lightbox.js](js/mugshot-lightbox.js) — the full-size mugshot viewer.
- [js/admin.js](js/admin.js) — the admin page.
- [supabase/sql/](supabase/sql/) — one-off migrations and repair scripts, each
  documenting the problem it solves. Run by hand in the Supabase SQL editor.

**Other**

- `fonts/FrizQuadrataRegular.woff` — the Law & Order header font, loaded locally.
- `src/qr-welcome.svg` — the committed QR code. Encodes
  `https://thegamebureau.com/ff/#welcome`; regenerate it if that target changes.
- `src/` — images plus old working copies of index.html; the `index_*.html` files
  are dead snapshots.
- `index copy.html` — stale backup, not served.
- [BRAINSTORMING.MD](BRAINSTORMING.MD) — running idea list for future features.

Excluded via [.gitignore](.gitignore): `archived_db/`, `.tmp/`. Note the rule
`admin.html` does **not** match `admin/index.html`, so the admin page is in fact
tracked — change the rule to `admin/` if that was the intent.

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
- `SEASON` and `CURRENT_WEEK` live in [js/season.js](js/season.js), not `app.js`, and
  the week is **derived, not set**: `getCurrentNflWeek()` returns the first week whose
  last kickoff is still in the future, so it advances on its own once Monday night
  starts. Nothing else should hardcode a year or a week.

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

- **The week advances itself.** Nothing to edit weekly. `getCurrentNflWeek()` in
  [js/nfl-schedule.js](js/nfl-schedule.js) walks the schedule and returns the first
  week whose last kickoff is still ahead, so Week N+1 appears once Week N's Monday
  night game starts. 24 games in weeks 16–17 have no kickoff time yet, so the roll
  can land slightly early there until the schedule file is regenerated.
- **Season year** lives in `NFL_SCHEDULE_SEASON` (from the generated schedule) and is
  read by `js/season.js`. The schedule source URL carries it too.
- `NFL_TEAMS` in [js/teams.js](js/teams.js) holds all 32 teams with `abbr` and colours.
- Match the existing style: no framework, no bundler, plain DOM APIs, `document
  .getElementById`, brace-on-same-line CSS (`.foo{`). Shared behaviour goes in a file
  under `js/` that every page loads, not inline in one page.

## Supabase

Client is created inline with the project URL and the **anon** key (public by design;
row-level security is what protects data — never put a service-role key in this file).
Session persists in `localStorage` under `law-order-svu-auth`.

Tables in use:

- `profiles` — username per auth user. New users hit a username gate before playing.
- `picks` — `user_id`, `week`, `team`, `result`. `result` is free text matched
  case-insensitively for `survived` / `dun dun` / `pick is in`, which drives the status
  badge colors. Results are entered out-of-band (admin page, not in this repo).

### Picks are append-only

Nothing is ever updated or deleted in `ff_picks`. **The newest row for a
(user, week) is the pick** — changing a pick inserts another row, and every
reader funnels the table through `activePicksFromHistory()` (one copy in
[js/victims.js](js/victims.js), one in [js/app.js](js/app.js)) to collapse it.
The unique constraint that used to prevent this was dropped in
[supabase/sql/ff_allow_pick_changes.sql](supabase/sql/ff_allow_pick_changes.sql).

Server-side, `ff_apply_pick_schedule()` re-checks every insert: the game exists
in `ff_nfl_schedule`, kickoff has not passed, and the team is not already named
in another week. So the client's rules are enforced twice, and a client change
alone cannot loosen them.

### Releasing a week

`result = 'SKIP'` is a tombstone. To un-pick a week, a row is inserted for that
week carrying `SKIP`; being newest, it replaces the pick, and
`activePicksFromHistory()` drops a skipped latest row so the week reads as empty
and its team is free again. The skip row keeps the team it releases, because the
trigger only accepts a team with a real game that week.

This is what makes **Future Selection** work: picking a team parked in a later
week writes the `SKIP` row for that week **first**, then the new pick. The other
order fails — the trigger refuses a team that is still the latest pick elsewhere.
[supabase/sql/ff_release_future_pick.sql](supabase/sql/ff_release_future_pick.sql)
teaches the trigger and the `ff_current_suspects` view to ignore skipped weeks,
and must be run for the swap to work at all.

Two things to know before touching this:

- Anything new that reads picks must drop skipped rows, or a released week comes
  back as a real pick. The raw `ff_active_picks` view does **not** filter them.
- Releasing a week can leave a gap in the middle of a season, which the
  fill-in-order rule (`firstMissingWeekBefore()`) then reports on the weeks after
  it. That is the honest state of things: the week really does need a victim
  again.

## Conventions

- Commit messages in this repo are terse and lowercase (`wk13`, `winner banner`).
- Don't run a formatter over `index.html` — it's a large hand-maintained file and a
  reflow makes every diff unreadable.
