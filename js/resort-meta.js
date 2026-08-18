// Shared rendering for resort identity (country flag) and après character.
// Both the season planner and the trip planner import from here so the two
// pages can never drift apart on how a resort is described.

// Turn an ISO 3166-1 alpha-2 code into its flag emoji. Regional indicator
// symbols sit at U+1F1E6 ('A'), so each letter maps by its offset from 'A'.
export function flagEmoji(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export function flagHtml(resort) {
  const emoji = flagEmoji(resort.country_code);
  if (!emoji) return '';
  const label = resort.location || resort.country || '';
  return `<span class="resort-flag" title="${label}" role="img" aria-label="${label}">${emoji}</span>`;
}

// Party and upscale are independent 0-3 axes, so a resort can score on both
// (Verbier), neither (Wolf Creek) or just one (Bansko, Deer Valley).
const PARTY_LABEL = ['Quiet nights', 'Low-key nights', 'Lively nights', 'Party town'];
const UPSCALE_LABEL = ['Basic', 'Comfortable', 'Upmarket', 'Luxury'];

export function apresLabel(apres) {
  if (!apres) return '';
  const parts = [];
  if (apres.party >= 2) parts.push(PARTY_LABEL[apres.party]);
  if (apres.upscale >= 2) parts.push(UPSCALE_LABEL[apres.upscale]);
  if (!parts.length) parts.push(PARTY_LABEL[apres.party || 0]);
  return parts.join(' · ');
}

export function apresHtml(resort) {
  const a = resort.apres;
  if (!a) return '';
  const tip = `${a.note}\n\nParty ${a.party}/3 · Upscale ${a.upscale}/3. Reputation-based, not a measured index.`;
  // Resorts with nothing notable on either axis get a muted chip, so the eye
  // lands on the ones where the scene is actually a reason to go.
  const quiet = a.party < 2 && a.upscale < 2 ? ' ac-quiet' : '';
  return `<span class="apres-chip${quiet}" title="${escapeAttr(tip)}">${apresLabel(a)}</span>`;
}

function apresAxis(resort, pref) {
  const a = resort.apres;
  if (!a) return null;
  return pref === 'party' ? a.party : a.upscale;
}

// A stated preference means the evenings are part of why you're going, so a
// resort only qualifies if the scene is a real one (2 or 3), not a single bar.
export function apresQualifies(resort, pref) {
  if (!pref || pref === 'any') return true;
  const axis = apresAxis(resort, pref);
  return axis === null ? false : axis >= 2;
}

// How well a qualifying resort matches the preference, 0-1. This nudges the
// trip planner's ranking; it does not outweigh the snow outlook.
export function apresFit(resort, pref) {
  if (!pref || pref === 'any') return 1;
  const axis = apresAxis(resort, pref);
  if (axis === null) return 0.5;
  return Math.min(1, Math.max(0, axis / 3));
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
