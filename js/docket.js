// ===== THE DOCKET =====
// How many suspects are still walking, and the way through to their faces.
// Deliberately one number: the Case File goes deep further down, and the top of
// the page should answer "how many are left" before anything else.
//
// Still walking, not booked. Everyone who ever joined is in ff_profiles for
// good — being eliminated does not remove you from the league — so a row count
// would climb all season and never fall, which is the opposite of what a
// survivor pool's headline number should do.
(function () {
  const DOCKET_CONFIG = window.FF_SUPABASE_CONFIG || {};
  const DOCKET_SUPABASE_URL = DOCKET_CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const DOCKET_SUPABASE_ANON_KEY = DOCKET_CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const SUSPECTS_VIEW = DOCKET_CONFIG.views?.currentSuspects || 'ff_current_suspects';
  const PROFILES_TABLE = DOCKET_CONFIG.tables?.profiles || 'ff_profiles';
  // The one status that means the case closed on you. Matched loosely because
  // results are free text entered out of band, the same way the badge colours
  // on the lineup are matched.
  const ELIMINATED = 'dun dun';
  const DOT_SVG_NS = 'http://www.w3.org/2000/svg';
  const DOT_ROWS = 7;
  const DOT_PITCH = 4;
  const DOT_RADIUS = 1.18;
  const DOT_PAD = 1;
  const DOT_CHAR_GAP = 1;
  const DOT_SPACE_WIDTH = 3;
  const DOT_TWO_DIGIT_WIDTH = 11;
  const DOT_FONT = {
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
    '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100']
  };
  const DOT_SCOREBOARD_LABEL_WIDTH = getDotTextWidth('Still Under Suspicion');

  const docketDb = window.supabase
    ? window.supabase.createClient(DOCKET_SUPABASE_URL, DOCKET_SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          storageKey: DOCKET_CONFIG.storageKey || 'law-order-svu-auth-vkoczgzizzppdrpvpemh',
          storage: window.localStorage
        }
      })
    : null;

  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('docketCount')) return;
    renderDocketText();
    loadDocket();
    // Someone joining or leaving changes the number under everyone's feet.
    window.addEventListener('ff-auth-changed', loadDocket);
  });

  async function loadDocket() {
    const countEl = document.getElementById('docketCount');
    const labelEl = document.getElementById('docketLabel');
    const outEl = document.getElementById('docketOutCount');
    const outLabelEl = document.getElementById('docketOutLabel');
    if (!countEl) return;

    const setScore = (standing, out) => {
      renderDotText(countEl, standing);
      if (outEl) renderDotText(outEl, out);
    };

    const setLabel = (el, value) => {
      if (el) renderDotText(el, value);
    };

    if (!docketDb) {
      setScore('—', '—');
      setLabel(labelEl, 'Records Unavailable');
      return;
    }

    // Two columns, no mugshots: the view carries avatar_data_url and pulling it
    // would be a megabyte fetched to produce one integer.
    let { data, error } = await docketDb
      .from(SUSPECTS_VIEW)
      .select('username, game_status');

    // The view is a convenience and can refuse the query for reasons that have
    // nothing to do with the data — a grant this role lacks, a column that
    // moved. Falling back to a plain roster count is wrong by exactly the
    // players who have been eliminated, so it says so rather than quietly
    // reporting a bigger number.
    if (error) {
      console.warn('Docket: suspects view failed, falling back to the roster:', error);
      const fallback = await docketDb
        .from(PROFILES_TABLE)
        .select('id', { count: 'exact', head: true });

      if (fallback.error) {
        console.error('Docket count failed:', fallback.error);
        setScore('—', '—');
        setLabel(labelEl, 'Records Unavailable');
        return;
      }

      // Everyone on file, and no way to tell who is out — so the second half of
      // the scoreboard says it does not know rather than showing a zero that
      // would read as "nobody has been eliminated yet".
      setScore(String(Number(fallback.count || 0)), '?');
      setLabel(labelEl, 'Suspects On File');
      setLabel(outLabelEl, 'Unknown');
      return;
    }

    const rows = data || [];
    const out = rows.filter((row) => isEliminated(row.game_status)).length;
    setScore(String(rows.length - out), String(out));
    setLabel(labelEl, 'Still Under Suspicion');
    setLabel(outLabelEl, 'Dun Dun');
  }

  function renderDocketText() {
    ['docketCount', 'docketLabel', 'docketOutCount', 'docketOutLabel']
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .forEach((el) => renderDotText(el, el.textContent));
  }

  function renderDotText(el, value) {
    const text = normalizeDotText(value);
    const minColumns = el.classList.contains('scoreboard-count')
      ? DOT_TWO_DIGIT_WIDTH
      : el.classList.contains('scoreboard-label')
        ? DOT_SCOREBOARD_LABEL_WIDTH
        : 0;
    const layout = getDotLayout(text, minColumns);
    const viewWidth = (layout.width - 1) * DOT_PITCH + DOT_RADIUS * 2 + DOT_PAD * 2;
    const viewHeight = (DOT_ROWS - 1) * DOT_PITCH + DOT_RADIUS * 2 + DOT_PAD * 2;

    el.textContent = '';
    el.dataset.dotText = text;

    const screenReaderText = document.createElement('span');
    screenReaderText.className = 'sr-only';
    screenReaderText.textContent = text;

    const svg = document.createElementNS(DOT_SVG_NS, 'svg');
    svg.setAttribute('class', 'scoreboard-dot-svg');
    svg.setAttribute('viewBox', `0 0 ${viewWidth} ${viewHeight}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const offDots = document.createElementNS(DOT_SVG_NS, 'g');
    offDots.setAttribute('class', 'scoreboard-dot-off');
    const onDots = document.createElementNS(DOT_SVG_NS, 'g');
    onDots.setAttribute('class', 'scoreboard-dot-on');

    layout.dots.forEach((dot) => {
      const circle = document.createElementNS(DOT_SVG_NS, 'circle');
      circle.setAttribute('cx', String(DOT_PAD + DOT_RADIUS + dot.x * DOT_PITCH));
      circle.setAttribute('cy', String(DOT_PAD + DOT_RADIUS + dot.y * DOT_PITCH));
      circle.setAttribute('r', String(DOT_RADIUS));
      (dot.on ? onDots : offDots).appendChild(circle);
    });

    svg.append(offDots, onDots);
    el.append(screenReaderText, svg);
  }

  function normalizeDotText(value) {
    const text = String(value || '')
      .replace(/\u2013|\u2014|\u00e2\u20ac\u201d/g, '-')
      .trim();
    return (text || '-').toUpperCase();
  }

  function getDotLayout(text, minWidth = 0) {
    const dots = [];
    let cursor = 0;

    Array.from(text).forEach((char) => {
      if (char === ' ') {
        cursor += DOT_SPACE_WIDTH + DOT_CHAR_GAP;
        return;
      }

      const rows = DOT_FONT[char] || DOT_FONT['?'];
      rows.forEach((row, y) => {
        Array.from(row).forEach((slot, x) => {
          dots.push({ x: cursor + x, y, on: slot === '1' });
        });
      });
      cursor += rows[0].length + DOT_CHAR_GAP;
    });

    const contentWidth = Math.max(cursor - DOT_CHAR_GAP, 1);
    const width = Math.max(contentWidth, minWidth);
    const offset = Math.floor((width - contentWidth) / 2);

    return {
      dots: offset ? dots.map((dot) => ({ ...dot, x: dot.x + offset })) : dots,
      width
    };
  }

  function getDotTextWidth(text) {
    let cursor = 0;

    Array.from(normalizeDotText(text)).forEach((char) => {
      if (char === ' ') {
        cursor += DOT_SPACE_WIDTH + DOT_CHAR_GAP;
        return;
      }

      const rows = DOT_FONT[char] || DOT_FONT['?'];
      cursor += rows[0].length + DOT_CHAR_GAP;
    });

    return Math.max(cursor - DOT_CHAR_GAP, 1);
  }

  function isEliminated(status) {
    return String(status || '').trim().toLowerCase() === ELIMINATED;
  }
})();
