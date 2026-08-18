// Four independent measures of a resort, each on its own scale.
//
// The site used to collapse these into one 0-100 score, which hid the tradeoff
// that actually decides a trip: a resort can have the best snow on the list and
// still be the wrong choice because it costs double and has nothing open after
// four. So nothing is blended here. Snow leads because it is the reason the
// site exists, and it is the only one that moves with the climate signal. The
// other three are fixed facts about the place.

export const METRIC_KEYS = ['snow', 'party', 'cost', 'distance'];

export const METRIC_LABEL = {
  snow: 'Snow', party: 'Après', cost: 'Cost', distance: 'Travel',
};

export const METRIC_BLURB = {
  snow: 'Typical season snowfall at mid-mountain, tilted by the climate signal now driving the region.',
  party: 'How much of a scene there is after the lifts stop.',
  cost: 'Lift ticket, lodging and food per person per day.',
  distance: 'How far it is from where you are starting.',
};

// Open-Meteo reports ERA5 snowfall using one fixed ratio, 1mm of water to
// 0.7cm of snow. That is roughly right for heavy maritime snow and badly wrong
// for cold continental powder, where 15:1 or 20:1 is normal — which is why the
// raw figures put Colorado below Bulgaria. While every resort was only ranked
// against its own neighbours the bias cancelled out; on an absolute scale it
// does not, so it has to be corrected.
//
// Colder resorts make drier, bulkier snow, so the ratio is scaled off the share
// of days below freezing: 7:1 where nothing freezes, 20:1 where everything
// does. It is an approximation — it lands Alyeska at 582in against roughly
// 650in published and Whistler at 518in against roughly 470in — but it is far
// closer to what falls than a flat 7:1, and it is applied identically
// everywhere.
const SWE_RATIO_MIN = 7;
const SWE_RATIO_RANGE = 13;

function correctedSnowCm(rawCm, coldFrac) {
  const sweMm = rawCm / 0.7;
  const ratio = SWE_RATIO_MIN + SWE_RATIO_RANGE * (coldFrac ?? 0.5);
  return sweMm * ratio / 10;
}

// Fixed depths, never ranks, so a resort's colour means the same thing in
// Hokkaido as in Vermont. Cut points sit on the corrected spread across all
// 127 resorts, whose median season is about 180in.
const SNOW_BANDS = [
  { min: 1016, label: 'Exceptional', cls: 'mb-1' },  // 400in+
  { min: 699,  label: 'Excellent',   cls: 'mb-2' },  // 275in
  { min: 445,  label: 'Good',        cls: 'mb-3' },  // 175in
  { min: 305,  label: 'Moderate',    cls: 'mb-4' },  // 120in
  { min: 178,  label: 'Thin',        cls: 'mb-5' },  // 70in
  { min: -1,   label: 'Marginal',    cls: 'mb-6' },
];

const PARTY_BANDS = [
  { label: 'Quiet',    cls: 'mb-p0' },
  { label: 'Low-key',  cls: 'mb-p1' },
  { label: 'Lively',   cls: 'mb-p2' },
  { label: 'Big',      cls: 'mb-p3' },
];

// Per person per day: lift ticket + lodging + food. Range across the site runs
// $129 (Karakol) to $660 (Park City), median $348.
const COST_BANDS = [
  { max: 200, label: '$',    cls: 'mb-1', word: 'Cheap' },
  { max: 320, label: '$$',   cls: 'mb-3', word: 'Moderate' },
  { max: 450, label: '$$$',  cls: 'mb-5', word: 'Expensive' },
  { max: Infinity, label: '$$$$', cls: 'mb-6', word: 'Premium' },
];

const cm2in = (cm) => Math.round(cm / 2.54);

function bandFor(bands, value) {
  return bands.find(b => value >= b.min) || bands[bands.length - 1];
}

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Everything the metrics need that depends on the WHOLE list — percentiles,
// neighbours, cost spread — is computed once here rather than per resort.
export function buildMetricContext({ resortsData, climatology, liftPrices, tripCosts }) {
  const clim = climatology?.resorts || {};
  const rows = [];

  for (const region of resortsData.regions) {
    const lodging = tripCosts?.lodging_per_day?.[region.id] || [0, 0];
    const food = tripCosts?.food_per_day?.[region.id] || [0, 0];
    for (const r of region.resorts) {
      const era5 = clim[r.id]?.era5 || null;
      rows.push({
        id: r.id,
        regionId: region.id,
        regionName: region.name,
        lat: r.lat,
        lon: r.lon,
        snow: era5 ? era5.mean_season_snow_cm : null,
        cold: era5 ? era5.cold_day_frac : null,
        cv: era5 ? era5.cv : null,
        dailyCost: liftPriceMid(r.id, liftPrices) === null ? null
          : liftPriceMid(r.id, liftPrices) + mid(lodging) + mid(food),
      });
    }
  }

  const byId = new Map(rows.map(r => [r.id, r]));
  const snowSorted = rows.filter(r => r.snow !== null).map(r => r.snow).sort((a, b) => b - a);
  return { rows, byId, snowSorted, tripCosts, liftPrices };
}

function mid([lo, hi]) { return (Number(lo || 0) + Number(hi || 0)) / 2; }

export function liftPriceMid(resortId, liftPrices) {
  if (!liftPrices) return null;
  const v = liftPrices.verified?.[resortId];
  if (v) return mid([v.low, v.high]);
  const tier = liftPrices.resort_tier?.[resortId];
  const band = tier && liftPrices.tiers?.[tier];
  return band ? mid([band.low, band.high]) : null;
}

// ---- Snow -----------------------------------------------------------------

// The climate signal shifts the expectation rather than replacing it: a strong
// bullish signal is worth roughly a fifth more snow than that resort's normal,
// which is about the size of the historical composites this site is built on.
const MAX_SIGNAL_SHIFT = 0.20;

export function snowMetric(resort, region, signal, ctx) {
  const row = ctx.byId.get(resort.id);
  if (!row || row.snow === null) {
    return {
      key: 'snow', label: 'Snow', display: 'no data', cls: 'mb-none', good: 0,
      tip: 'No usable reanalysis record for this resort yet, so it is not scored on snow.',
    };
  }

  const tilt = (Number(signal?.meter_pct ?? 50) - 50) / 50;      // -1 .. +1
  const typical = correctedSnowCm(row.snow, row.cold);
  const expected = typical * (1 + tilt * MAX_SIGNAL_SHIFT);
  const band = bandFor(SNOW_BANDS, expected);

  // --- the four comparisons the tooltip makes
  const near = ctx.rows
    .filter(o => o.id !== row.id && o.snow !== null && haversineKm(row, o) <= 250)
    .sort((a, b) => b.snow - a.snow);
  const inRegion = ctx.rows.filter(o => o.regionId === row.regionId && o.snow !== null)
    .sort((a, b) => b.snow - a.snow);
  const regionRank = inRegion.findIndex(o => o.id === row.id) + 1;
  const globalRank = ctx.snowSorted.filter(v => v > row.snow).length + 1;
  const globalPct = Math.round((globalRank / ctx.snowSorted.length) * 100);

  const lines = [
    `${band.label} — about ${Math.round(expected)} cm (${cm2in(expected)} in) of snow in a season.`,
    '',
    `Its own record: ${cm2in(typical)} in (${Math.round(typical)} cm) in a typical season. `
      + (Math.abs(tilt) < 0.06
        ? 'The current signal is near neutral here, so that is also the expectation this season.'
        : `The signal now driving ${region.name} tilts it `
          + `${tilt > 0 ? 'up' : 'down'} about ${Math.abs(Math.round(tilt * MAX_SIGNAL_SHIFT * 100))}%.`),
  ];

  if (near.length) {
    const beat = near.filter(o => row.snow > o.snow).length;
    lines.push('', `Nearby: snowier than ${beat} of the ${near.length} resort${near.length === 1 ? '' : 's'} within 250 km.`);
  } else {
    lines.push('', 'Nearby: no other resort on this list within 250 km.');
  }
  lines.push(`In ${region.name}: ${ordinal(regionRank)} of ${inRegion.length}.`);
  lines.push(`Worldwide: ${ordinal(globalRank)} of ${ctx.snowSorted.length} tracked, top ${globalPct}%.`);

  if (row.cold !== null) {
    lines.push('', `${Math.round(row.cold * 100)}% of season days stay below freezing at mid-mountain, `
      + `and season-to-season it is ${row.cv < 0.25 ? 'very consistent' : row.cv < 0.4 ? 'moderately variable' : 'boom-or-bust'} (cv ${row.cv}).`);
  }
  lines.push('', 'ERA5 reanalysis, 10 seasons, sampled at mid-mountain, converted from water content to depth using a snow ratio scaled by how cold the resort runs. '
    + 'That conversion is approximate and tends to sit within about 20% of published resort figures. Bands are fixed depths, so the colour means the same thing at every resort on the site.');

  return {
    key: 'snow',
    label: 'Snow',
    display: `${cm2in(expected)}\"`,
    sub: band.label,
    cls: band.cls,
    good: Math.min(1, expected / 1200),
    tip: lines.join('\n'),
  };
}

// ---- Après ----------------------------------------------------------------

export function partyMetric(resort) {
  const a = resort.apres;
  if (!a) return null;
  const band = PARTY_BANDS[a.party] || PARTY_BANDS[0];
  return {
    key: 'party',
    label: 'Après',
    display: band.label,
    cls: band.cls,
    good: a.party / 3,
    tip: `${a.note}\n\nNightlife ${a.party}/3, upmarket ${a.upscale}/3. `
      + 'Reputation-based, from published resort and nightlife guides rather than measured. This one does not move with the weather.',
  };
}

// ---- Cost -----------------------------------------------------------------

export function costMetric(resort, region, ctx) {
  const row = ctx.byId.get(resort.id);
  if (!row || row.dailyCost === null) return null;
  const daily = Math.round(row.dailyCost);
  const band = COST_BANDS.find(b => daily < b.max);
  const lift = Math.round(liftPriceMid(resort.id, ctx.liftPrices) || 0);
  const lodging = ctx.tripCosts?.lodging_per_day?.[region.id];
  const food = ctx.tripCosts?.food_per_day?.[region.id];

  const cheaper = ctx.rows.filter(o => o.dailyCost !== null && o.dailyCost < row.dailyCost).length;
  const priced = ctx.rows.filter(o => o.dailyCost !== null).length;

  return {
    key: 'cost',
    label: 'Cost',
    display: `$${daily}`,
    sub: 'per day',
    cls: band.cls,
    good: 1 - Math.min(1, Math.max(0, (daily - 120) / 560)),
    tip: [
      `${band.word} — roughly $${daily} per person per day on the ground.`,
      '',
      lodging && food
        ? `Lift ticket about $${lift}, lodging $${lodging[0]}-${lodging[1]}, food $${food[0]}-${food[1]}, per person per day.`
        : `Lift ticket about $${lift} per day.`,
      '',
      `Cheaper than ${priced - cheaper - 1} of the ${priced} resorts priced on this site.`,
      '',
      'Excludes flights, which the trip planner adds. Planning estimates, not quotes — the resort site is the only authority on price.',
    ].join('\n'),
  };
}

// ---- Travel ---------------------------------------------------------------

const TRAVEL_BANDS = [
  { key: 'drive',  label: 'Drivable',  cls: 'mb-1', good: 1.0 },
  { key: 'short',  label: 'Short hop', cls: 'mb-3', good: 0.7 },
  { key: 'medium', label: 'Mid-haul',  cls: 'mb-4', good: 0.45 },
  { key: 'long',   label: 'Long haul', cls: 'mb-6', good: 0.15 },
];

export function distanceMetric(resort, region, origin, ctx) {
  const f = ctx.tripCosts?.flights?.[region.id]?.[origin];
  if (!f) return null;
  const [lo, hi, note] = f;
  const band = note === 'drive' ? TRAVEL_BANDS[0]
    : lo < 400 ? TRAVEL_BANDS[1]
    : lo < 800 ? TRAVEL_BANDS[2]
    : TRAVEL_BANDS[3];
  const originLabel = ctx.tripCosts?.origins?.[origin] || origin;

  return {
    key: 'distance',
    label: 'Travel',
    display: band.label,
    sub: note === 'drive' ? 'no flight' : `$${lo}-${hi}`,
    cls: band.cls,
    good: band.good,
    tip: [
      `${band.label} from ${originLabel}.`,
      '',
      note === 'drive'
        ? 'Commonly driven from this origin, so there is no airfare to add.'
        : `Round-trip economy typically $${lo}-${hi} per person, booked in advance.`,
      '',
      'Airfare varies more than everything else in a ski budget combined. Change the origin to rescore this.',
    ].join('\n'),
  };
}

export function metricsFor(resort, region, signal, ctx, opts = {}) {
  const origin = opts.origin || 'us-west';
  return {
    snow: snowMetric(resort, region, signal, ctx),
    party: partyMetric(resort),
    cost: costMetric(resort, region, ctx),
    distance: distanceMetric(resort, region, origin, ctx),
  };
}

// Ranking uses only the metrics the reader said they care about. Snow is always
// in, so the list never stops being about the snow.
export function rankValue(metrics, selected) {
  const keys = ['snow', ...selected.filter(k => k !== 'snow')];
  const vals = keys.map(k => metrics[k]?.good).filter(v => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}
