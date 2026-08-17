// ===== POLICE TICKER =====
// The wire at the top of the Case File: one entry per player, their most recent
// accusation, scrolling forever. Not a feed of every pick — a roll call of who
// has named whom lately, which is the thing worth glancing at.
//
// Reads ff_active_picks, the view that already collapses the append-only picks
// table to the newest row per (user, week). Two things still have to happen
// here: skip rows are tombstones and must not read as picks, and the newest row
// per WEEK still has to be narrowed to the newest row per PLAYER.
(function () {
  const TICKER_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const TICKER_SUPABASE_URL = TICKER_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const TICKER_SUPABASE_ANON_KEY = TICKER_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const ACTIVE_PICKS_VIEW = TICKER_CONFIG.views?.activePicks || 'ff_active_picks';
  const PICKS_TABLE = TICKER_CONFIG.tables?.picks || 'ff_picks';
  const SKIP_RESULT = 'SKIP';

  // Seconds per item. The animation is the same length whatever the roster
  // size, so without this a 4-player ticker would fly and a 30-player ticker
  // would crawl. Long enough to read a line as it goes by.
  const SECONDS_PER_ITEM = 4.5;

  const tickerDb = window.supabase
    ? window.supabase.createClient(TICKER_SUPABASE_URL, TICKER_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storageKey: TICKER_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
          storage: window.localStorage
        }
      })
    : null;

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('policeTickerTrack')) return;
    loadPoliceTicker();
    // A pick made elsewhere on the site should show up here without a reload.
    window.addEventListener('ff-auth-changed', loadPoliceTicker);
  });

  async function loadPoliceTicker() {
    if (!tickerDb) {
      setStatus('Wire is down.');
      return;
    }

    setStatus('Listening...');

    const picks = await fetchPicks();
    if (picks === null) {
      setStatus('Wire is down.');
      return;
    }

    const latest = latestPickPerPlayer(picks);
    if (!latest.length) {
      setStatus('No accusations on the wire yet.');
      render([]);
      return;
    }

    setStatus(`${latest.length} on the wire`);
    render(latest);
  }

  async function fetchPicks() {
    // The view is the right source, but it is a convenience rather than the
    // record: any failure falls through to the table it is built from, the
    // same way the lineup page handles ff_current_suspects.
    let { data, error } = await tickerDb
      .from(ACTIVE_PICKS_VIEW)
      .select('username, team, week, result, opponent, home_away, created_at, submitted_at_utc');

    if (error) {
      console.warn('Police ticker: active picks view failed, using the table:', error);
      ({ data, error } = await tickerDb
        .from(PICKS_TABLE)
        .select('username, team, week, result, created_at, submitted_at_utc'));
    }

    if (error) {
      console.error('Police ticker fetch failed:', error);
      return null;
    }

    return data || [];
  }

  // Who the accused has to lose to. The trigger stamps it onto the pick row at
  // insert, but rows filed before that column existed have nothing in it, so
  // fall back to the schedule the rest of the site already has loaded.
  function opponentFor(pick) {
    const stored = String(pick.opponent || '').trim();
    if (stored) return stored;

    const info = window.NFL_SCHEDULE_HELPERS?.getTeamScheduleInfo?.(pick.team, Number(pick.week));
    return String(info?.opponent || '').trim();
  }

  function pickTime(pick) {
    return new Date(pick?.submitted_at_utc || pick?.created_at || 0).getTime();
  }

  function isSkip(pick) {
    return String(pick?.result || '').trim().toUpperCase() === SKIP_RESULT;
  }

  // Newest first, one per player. Skips are dropped after the comparison, not
  // before: a released week is only released because its tombstone is the newer
  // row, so it has to be able to win before being thrown away.
  function latestPickPerPlayer(picks) {
    const newest = new Map();

    for (const pick of picks) {
      const username = String(pick.username || '').trim();
      if (!username || !pick.team) continue;

      const previous = newest.get(username);
      if (!previous || pickTime(pick) > pickTime(previous)) newest.set(username, pick);
    }

    return [...newest.values()]
      .filter((pick) => !isSkip(pick))
      .sort((a, b) => pickTime(b) - pickTime(a));
  }

  // "Sun, Sep 7, 2:14 PM" — day and time both matter on a ticker where the
  // interesting thing is often how close to kickoff somebody filed.
  function stamp(pick) {
    const when = pick.submitted_at_utc || pick.created_at;
    if (!when) return '';

    const date = new Date(when);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function render(entries) {
    const track = document.getElementById('policeTickerTrack');
    const list = document.getElementById('policeTickerList');
    if (!track) return;

    const items = entries.map(itemHtml).join('');

    // Printed twice. The animation runs the track from 0 to -50%, so the second
    // copy is what is on screen as the first one leaves, and the loop point has
    // nothing to give it away.
    track.innerHTML = items + items;
    track.style.animationDuration = `${Math.max(12, entries.length * SECONDS_PER_ITEM)}s`;

    // The strip itself is aria-hidden — a marquee is a terrible thing to read
    // with a screen reader — so the same entries go out once, statically, here.
    if (list) {
      list.innerHTML = entries.map((pick) => {
        const opponent = opponentFor(pick);
        const against = opponent ? ` to lose to ${escapeHtml(opponent)}` : '';
        return `
        <li>${escapeHtml(pick.username)} named ${escapeHtml(pick.team)}${against} for Week
          ${Number(pick.week)}, filed ${escapeHtml(stamp(pick))}.</li>`;
      }).join('');
    }
  }

  function itemHtml(pick) {
    // A bye or a missing fixture leaves nobody to lose to, and "to lose to"
    // trailing off into nothing reads as a bug. The clause is dropped instead.
    const opponent = opponentFor(pick);
    const against = opponent
      ? `<span class="police-ticker-verb">to lose to</span>
         <span class="police-ticker-team">${escapeHtml(opponent)}</span>`
      : '';

    return `
      <span class="police-ticker-item">
        <span class="police-ticker-user">${escapeHtml(pick.username)}</span>
        <span class="police-ticker-verb">names</span>
        <span class="police-ticker-team">${escapeHtml(pick.team)}</span>
        ${against}
        <span class="police-ticker-week">Week ${Number(pick.week)}</span>
        <span class="police-ticker-time">${escapeHtml(stamp(pick))}</span>
      </span>`;
  }

  function setStatus(message) {
    const el = document.getElementById('policeTickerStatus');
    if (el) el.textContent = message;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
