// ===== SUSPECT COLOURS =====
// The two-tone theme each suspect's cards are painted in is normally sampled
// from their own mugshot at render time - dominantPair(), one copy in
// js/suspect-lineup-chart.js for the Suspect Tracker and one in js/suspects.js
// for the lineup placards. This file supplies the exceptions.
//
// WHY EXCEPTIONS EXIST
// dominantPair() takes whatever covers the most pixels. In a photo shot against
// a dark room or a grey wall that is the background, not the person, and the
// suspect's actual colour sits at four or five percent and never gets picked.
// The result is a card in grey-on-grey or brown-on-brown. Rather than tune the
// sampler and re-colour all 32 to fix a handful, the handful is overridden.
//
// WHERE THEY LIVE NOW
// They used to be a hand-maintained object literal in this file, which the
// Colour Lab could only produce text for - so changing one colour meant a copy,
// a paste, a commit and a deploy. Worse, the paste had to be merged by hand
// every time, and one bad merge left this file with five duplicate keys and a
// missing comma: a syntax error that silently took every override on the site
// down with it.
//
// They are now two columns on the profile row, beside the mugshot they were
// sampled from - see supabase/sql/ff_suspect_colors.sql. The Lab writes them
// directly and this reads them back, so there is nothing to paste.
//
// WHY A SEPARATE REQUEST
// The obvious alternative is to add the two columns to the profile selects the
// two pages already make. Both of those run a fallback ladder that drops
// columns and retries when one is missing, and threading two more through it
// risks the whole lineup failing over a colour. This asks for exactly the three
// columns it needs, on its own, and if it fails nothing but the overrides is
// lost - every suspect simply falls back to sampling, which is what happened
// before the columns existed.
(function () {
  const CONFIG = window.FF_SUPABASE_CONFIG || {};
  const COLORS_URL = CONFIG.url || 'https://vkoczgzizzppdrpvpemh.supabase.co';
  const COLORS_KEY = CONFIG.publishableKey || 'sb_publishable_XfvD3zCvnCHT1v_EGE-LJA_3Z9bGjKw';
  const COLORS_PROFILES = CONFIG.tables?.profiles || 'ff_profiles';

  // Keyed lower-case: usernames are stored with their own capitalisation and
  // matched case-insensitively everywhere else in the site.
  const COLORS = new Map();

  // null for anyone without a pair on file, which is nearly everyone - the
  // caller then samples as before. Deliberately not a fallback pair: a suspect
  // with no entry and no readable mugshot should keep falling through to the
  // house colours the CSS already provides.
  window.suspectColorOverride = function (username) {
    const key = String(username || '').trim().toLowerCase();
    const pair = COLORS.get(key);
    return pair ? pair.slice() : null;
  };

  // Its own client, and a deliberately session-less one: this reads two public
  // columns and has no business joining the auth clients already on the page
  // under the same storage key.
  const colorsDb = window.supabase?.createClient(COLORS_URL, COLORS_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  async function loadSuspectColors() {
    if (!colorsDb) return;

    const { data, error } = await colorsDb
      .from(COLORS_PROFILES)
      .select('username, color_primary, color_secondary');

    if (error) {
      // Not fatal, and not worth a visible message: the pages look the way they
      // did before anyone picked a colour by hand.
      console.warn('Suspect colours unavailable, sampling instead:', error.message);
      return;
    }

    for (const row of data || []) {
      // The database will not store one half without the other, but a row read
      // through an older view might still arrive that way.
      if (!row?.username || !row.color_primary || !row.color_secondary) continue;
      COLORS.set(String(row.username).trim().toLowerCase(), [row.color_primary, row.color_secondary]);
    }

    if (!COLORS.size) return;

    // The two pages paint synchronously, before this request can land, so they
    // listen for this and paint the overridden suspects again. Painting is
    // setting a custom property, so doing it twice costs nothing.
    window.dispatchEvent(new CustomEvent('ff-suspect-colors-loaded'));
  }

  document.addEventListener('DOMContentLoaded', loadSuspectColors);
})();
