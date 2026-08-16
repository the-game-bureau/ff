// ===== SUSPECT COLOURS =====
// The two-tone theme each suspect's cards are painted in is normally sampled
// from their own mugshot at render time — dominantPair(), one copy in
// js/suspect-lineup-chart.js for the Suspect Tracker and one in js/suspects.js
// for the lineup placards. This file is the exception list.
//
// WHY AN EXCEPTION LIST EXISTS
// dominantPair() takes whatever covers the most pixels. In a photo shot against
// a dark room or a grey wall that is the background, not the person, and the
// suspect's actual colour sits at four or five percent and never gets picked.
// The result is a card in grey-on-grey or brown-on-brown. Rather than tune the
// sampler and re-colour all 32 to fix a handful, the handful is listed here.
//
// Keyed lower-case: usernames are stored with their own capitalisation and
// matched case-insensitively everywhere else in the site. Values are
// [primary, secondary].
//
// Colours were lifted pixel by pixel off each mugshot with the throwaway
// picker in .tmp/color-lab.html, so they are still that suspect's own colours,
// just not the ones area alone would have chosen.
(function () {
  const SUSPECT_COLORS = {
    allegedlylost: ['#5672A4', '#83ABE9'],
    couchcoachconnie: ['#A16540', '#CCA884'],
    det_scott_briscoe: ['#BE756F', '#D76100'],
    diarrhealettuce: ['#FDCB03', '#E0A85A'],
    katnola: ['#110E10', '#D2A81E'],
    secretagent222: ['#003F48', '#F7F0E6'],
    theclarinetofjustice: ['#B2B5A3', '#090A02'],
    wabadie: ['#C36522', '#8C7F6E'],
    weezle: ['#957453', '#BCC0B1'],
    wholelottalosing: ['#88B0BA', '#E5E3D4'],
    why: ['#625242', '#584735']
  };

  // null for anyone not listed, which is nearly everyone — the caller then
  // samples as before. Deliberately not a fallback pair: a suspect with no
  // entry and no readable mugshot should keep falling through to the house
  // colours the CSS already provides.
  window.suspectColorOverride = function (username) {
    const key = String(username || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(SUSPECT_COLORS, key)
      ? SUSPECT_COLORS[key].slice()
      : null;
  };
})();
