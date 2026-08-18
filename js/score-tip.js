// One explanation of the outlook score, shared by the season planner and the
// trip planner so the two pages can never describe the number differently.
import { SCORE_WEIGHTS } from './scoring.js';

const PART_LABEL = {
  snow: 'Snowfall',
  cold: 'Cold-day reliability',
  consistency: 'Year-to-year consistency',
  elevation: 'Elevation buffer',
};

export function scoreTipText(sc) {
  if (!sc || !sc.hasData) {
    return 'No historical climatology for this resort yet, so it is not scored.';
  }
  const pct = (v) => (v === null || v === undefined ? '—' : String(Math.round(v * 100)));
  const adj = sc.adj >= 0 ? `+${sc.adj}` : `${sc.adj}`;

  const components = Object.keys(PART_LABEL)
    .map(k => `  ${PART_LABEL[k]}: ${pct(sc.parts[k])}  (${Math.round(SCORE_WEIGHTS[k] * 100)}% of the score)`)
    .join('\n');

  return [
    `Outlook ${sc.score} out of 100.`,
    '',
    `${sc.base} is what this resort's own record earns it in a typical year. `
      + `The current climate signal then moves it ${adj}.`,
    '',
    'Components, each scored 0-100 against the other resorts in this region:',
    components,
    '',
    'From ERA5 reanalysis sampled at mid-mountain elevation. It rates snow '
      + 'reliability, not terrain quality or how good the powder feels.',
  ].join('\n');
}
