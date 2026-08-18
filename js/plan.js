import {
  loadOni, loadResorts, loadPhaseCopy, loadClimateSignals,
  loadClimatology, loadLiftPrices, loadTripCosts,
} from './data-sources.js';
import { flagHtml, apresHtml, apresFit, apresQualifies } from './resort-meta.js';
import { initTooltips } from './tooltip.js';
import { scoreTipText } from './score-tip.js';
import { escapeAttr } from './html.js';
import { SCORE_WEIGHTS } from './scoring.js';

const DRIVER_SIGNAL_KEY = { nao: 'nao_signals', sam: 'sam_signals' };

const state = {};

function normalize(v, min, max) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) return 0.5;
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

function phaseBucket(label) {
  const p = (label || '').toLowerCase();
  if (p.includes('negative') || p.includes('cool')) return 'negative';
  if (p.includes('positive') || p.includes('warm')) return 'positive';
  return 'neutral';
}

function displaySignal(region) {
  const phaseKey = state.oni?.phase && ['el_nino', 'la_nina', 'neutral'].includes(state.oni.phase)
    ? state.oni.phase : 'neutral';
  const enso = region.enso_signals[phaseKey];
  const driver = region.primary_driver;
  const key = DRIVER_SIGNAL_KEY[driver];
  if (driver && key && region[key] && state.signals?.[driver]) {
    const s = region[key][phaseBucket(state.signals[driver].phase)];
    if (s) return { ...s, driver, driverPhase: state.signals[driver].phase };
  }
  return { ...enso, driver: 'enso', driverPhase: state.oni?.phase_label };
}

/** Scores every resort in a region, same method as the season planner. */
function scoreRegion(region) {
  const sig = displaySignal(region);
  const rows = region.resorts.map(r => {
    const c = state.climatology?.resorts?.[r.id];
    return {
      r,
      snow: c?.era5?.mean_season_snow_cm ?? null,
      cold: c?.era5?.cold_day_frac ?? null,
      cv: c?.era5?.cv ?? null,
      elev: r.base_elev_ft ?? null,
    };
  });
  const range = k => {
    const v = rows.map(x => x[k]).filter(Number.isFinite);
    return v.length ? [Math.min(...v), Math.max(...v)] : [NaN, NaN];
  };
  const [sMin, sMax] = range('snow'), [cMin, cMax] = range('cold');
  const [vMin, vMax] = range('cv'), [eMin, eMax] = range('elev');
  const tilt = ((sig.meter_pct ?? 50) - 50) / 50;

  return rows.map(row => {
    const parts = {
      snow: normalize(row.snow, sMin, sMax),
      cold: normalize(row.cold, cMin, cMax),
      consistency: row.cv === null ? null : 1 - (normalize(row.cv, vMin, vMax) ?? 0.5),
      elevation: normalize(row.elev, eMin, eMax),
    };
    const hasData = parts.snow !== null || parts.cold !== null;
    let w = 0, used = 0;
    for (const [k, wt] of Object.entries(SCORE_WEIGHTS)) {
      if (parts[k] === null) continue;
      w += parts[k] * wt; used += wt;
    }
    const base = used ? (w / used) * 100 : 50;
    const resil = [parts.cold, parts.elevation].filter(v => v !== null);
    const exposure = 1 - (resil.length ? resil.reduce((a, b) => a + b, 0) / resil.length : 0.5);
    const score = Math.round(Math.min(100, Math.max(0, base + tilt * (8 + 14 * exposure))));
    return {
      resort: row.r, region, signal: sig, score, hasData, parts,
      base: Math.round(base), adj: score - Math.round(base),
    };
  });
}

function liftPrice(resortId) {
  const lp = state.liftPrices;
  if (!lp) return null;
  const v = lp.verified?.[resortId];
  if (v) return { low: v.low, high: v.high, verified: true, weekday: v.weekday };
  const t = lp.tiers?.[lp.resort_tier?.[resortId]];
  return t ? { low: t.low, high: t.high, verified: false } : null;
}

function passCovers(resort, pass) {
  if (pass === 'none') return false;
  return resort.passes.some(p => p.toLowerCase().includes(pass.toLowerCase()));
}

/** Months a region's season covers, handling the year wrap. */
function seasonMonths(region) {
  const { start_month: a, end_month: b } = region.season;
  const out = [];
  let m = a;
  for (let i = 0; i < 12; i++) { out.push(m); if (m === b) break; m = m === 12 ? 1 : m + 1; }
  return out;
}

function datesOverlapSeason(region, start, end) {
  if (!start || !end) return true;
  const months = new Set(seasonMonths(region));
  const d = new Date(start);
  const last = new Date(end);
  while (d <= last) {
    if (months.has(d.getMonth() + 1)) return true;
    d.setDate(d.getDate() + 1);
  }
  return false;
}

function estimateCost(entry, opts) {
  const tc = state.tripCosts;
  const regionId = entry.region.id;
  const days = opts.days;
  const nights = Math.max(days, 1);

  const f = tc.flights[regionId]?.[opts.origin] ?? [0, 0];
  const flightLow = f[0], flightHigh = f[1], drivable = f[2] === 'drive';

  const [lodLow, lodHigh] = tc.lodging_per_day[regionId] ?? [0, 0];
  const [foodLow, foodHigh] = tc.food_per_day[regionId] ?? [0, 0];

  const covered = passCovers(entry.resort, opts.pass);
  const lp = liftPrice(entry.resort.id);
  const liftLow = covered || !lp ? 0 : lp.low * days;
  const liftHigh = covered || !lp ? 0 : lp.high * days;

  const low = flightLow + lodLow * nights + foodLow * days + liftLow;
  const high = flightHigh + lodHigh * nights + foodHigh * days + liftHigh;
  return {
    low: Math.round(low), high: Math.round(high),
    breakdown: {
      flights: [flightLow, flightHigh, drivable],
      lodging: [Math.round(lodLow * nights), Math.round(lodHigh * nights)],
      food: [Math.round(foodLow * days), Math.round(foodHigh * days)],
      lift: [Math.round(liftLow), Math.round(liftHigh)],
      liftCovered: covered,
    },
  };
}

function abilityFit(resort, ability) {
  const vert = resort.summit_elev_ft - resort.base_elev_ft;
  const need = state.tripCosts.difficulty[ability]?.min_vertical_ft ?? 0;
  if (vert >= need) return { ok: true, vert };
  return { ok: false, vert };
}

function money(n) { return `$${n.toLocaleString()}`; }

function resultCard(e, opts) {
  const cost = e.cost;
  const b = cost.breakdown;
  const lp = liftPrice(e.resort.id);
  const vert = e.resort.summit_elev_ft - e.resort.base_elev_ft;
  const inSeason = datesOverlapSeason(e.region, opts.start, opts.end);
  return `
    <div class="trip-card">
      <div class="trip-head">
        <div>
          <div class="trip-name">
            <span class="resort-score ${e.score >= 70 ? 'rs-high' : e.score >= 45 ? 'rs-mid' : 'rs-low'}"
                  title="${escapeAttr(scoreTipText(e))}">${e.score}</span>
            ${flagHtml(e.resort)}
            <a href="${e.resort.resort_url}" target="_blank" rel="noopener">${e.resort.name}</a>
            ${apresHtml(e.resort)}
          </div>
          <div class="trip-sub">
            ${e.region.name} · ${e.resort.base_elev_ft.toLocaleString()}–${e.resort.summit_elev_ft.toLocaleString()} ft
            · ${vert.toLocaleString()} ft vertical · season ${e.region.season.display}
            ${!inSeason && (opts.start || opts.end) ? ' · <span class="trip-warn">outside your dates</span>' : ''}
          </div>
        </div>
        <div class="trip-cost">
          <div class="trip-cost-val">${money(cost.low)}–${money(cost.high)}</div>
          <div class="trip-cost-lab">per person, ${opts.days} day${opts.days === 1 ? '' : 's'}</div>
        </div>
      </div>

      <div class="trip-why">
        <span class="trip-why-lab">${e.signal.driver.toUpperCase()} signal</span>
        ${e.signal.signal_label}${e.signal.driverPhase ? ` (${e.signal.driverPhase})` : ''} — ${e.signal.narrative}
      </div>

      <div class="trip-breakdown">
        <span><span class="tb-k">Flights</span>${b.flights[2] ? 'drivable' : `${money(b.flights[0])}–${money(b.flights[1])}`}</span>
        <span><span class="tb-k">Lodging</span>${money(b.lodging[0])}–${money(b.lodging[1])}</span>
        <span><span class="tb-k">Food</span>${money(b.food[0])}–${money(b.food[1])}</span>
        <span><span class="tb-k">Lift</span>${b.liftCovered
          ? `<span class="tb-covered">covered by ${opts.pass}</span>`
          : lp ? `${money(b.lift[0])}–${money(b.lift[1])}` : 'n/a'}</span>
      </div>

      ${e.resort.apres ? `<div class="trip-apres"><span class="trip-why-lab">Après</span>${e.resort.apres.note}</div>` : ''}

      <div class="trip-links">
        <a href="${e.resort.resort_url}" target="_blank" rel="noopener">Resort site ↗</a>
        <a href="${e.resort.snow_report_url}" target="_blank" rel="noopener">Snow report ↗</a>
        <a href="${e.resort.snow_history_url}" target="_blank" rel="noopener">Snowfall history ↗</a>
        <span class="trip-pass">${e.resort.passes.join(', ')}</span>
      </div>
    </div>
  `;
}

function run(e) {
  if (e) e.preventDefault();
  const opts = {
    start: document.getElementById('pf-start').value,
    end: document.getElementById('pf-end').value,
    flexDates: document.getElementById('pf-flexible-dates').checked,
    days: Math.max(1, parseInt(document.getElementById('pf-days').value, 10) || 5),
    origin: document.getElementById('pf-origin').value,
    ability: document.getElementById('pf-ability').value,
    pass: document.getElementById('pf-pass').value,
    apres: document.getElementById('pf-apres').value,
    budget: document.getElementById('pf-budget').value,
    anywhere: document.getElementById('pf-flexible-where').checked,
    regions: Array.from(document.querySelectorAll('#pf-regions input:checked')).map(i => i.value),
  };

  let regions = state.resortsData.regions;
  if (!opts.anywhere && opts.regions.length) {
    regions = regions.filter(r => opts.regions.includes(r.id));
  }
  if (!opts.flexDates && opts.start && opts.end) {
    const inSeason = regions.filter(r => datesOverlapSeason(r, opts.start, opts.end));
    if (inSeason.length) regions = inSeason;
  }

  let entries = regions.flatMap(scoreRegion).filter(x => x.hasData);
  entries.forEach(x => { x.cost = estimateCost(x, opts); });

  const beforeAbility = entries.length;
  entries = entries.filter(x => abilityFit(x.resort, opts.ability).ok);
  const droppedAbility = beforeAbility - entries.length;

  let droppedBudget = 0;
  if (opts.budget !== 'any') {
    const cap = parseInt(opts.budget, 10);
    const before = entries.length;
    entries = entries.filter(x => x.cost.low <= cap);
    droppedBudget = before - entries.length;
  }

  // Asking for a particular kind of evening drops the resorts that don't
  // genuinely offer it, then re-weights what's left. The outlook score still
  // leads, because the point of the site is the snow.
  let droppedApres = 0;
  if (opts.apres !== 'any') {
    const before = entries.length;
    entries = entries.filter(x => apresQualifies(x.resort, opts.apres));
    droppedApres = before - entries.length;
  }
  entries.forEach(x => {
    x.rank_score = opts.apres === 'any'
      ? x.score
      : x.score * 0.75 + apresFit(x.resort, opts.apres) * 100 * 0.25;
  });

  entries.sort((a, b) => b.rank_score - a.rank_score || a.cost.low - b.cost.low);
  const top = entries.slice(0, 12);

  const el = document.getElementById('plan-results');
  if (!top.length) {
    el.innerHTML = `<div class="trip-empty">
      <strong>Nothing matches those constraints.</strong>
      ${droppedBudget ? ` ${droppedBudget} option${droppedBudget === 1 ? '' : 's'} were over budget.` : ''}
      ${droppedAbility ? ` ${droppedAbility} were below the vertical you'd want at this ability.` : ''}
      ${droppedApres ? ` ${droppedApres} ${opts.apres === 'party' ? "don't have much of a scene" : "aren't upmarket"}.` : ''}
      Try widening the budget, the dates, or the regions.
    </div>`;
    return;
  }

  const cheapest = [...top].sort((a, b) => a.cost.low - b.cost.low)[0];
  el.innerHTML = `
    <div class="trip-summary">
      <strong>${top.length}</strong> option${top.length === 1 ? '' : 's'}, best outlook first.
      Cheapest here is <strong>${cheapest.resort.name}</strong> from ${money(cheapest.cost.low)}.
      ${droppedBudget ? `${droppedBudget} filtered out on budget. ` : ''}
      ${droppedAbility ? `${droppedAbility} filtered out as too small for ${state.tripCosts.difficulty[opts.ability].label.toLowerCase()} skiing. ` : ''}
      ${droppedApres ? `${droppedApres} filtered out on ${opts.apres === 'party' ? 'nightlife' : 'lodging'}. ` : ''}
    </div>
    ${top.map(x => resultCard(x, opts)).join('')}
  `;
}

// Booking windows and airfare both punish last-minute planning, so the form
// opens on the next full Saturday-to-Saturday week that is still at least 30
// days away. It is computed from today's date on every load, so the default
// rolls forward on its own rather than going stale.
const MIN_LEAD_DAYS = 30;

function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function defaultTripWeek(today = new Date()) {
  // Build from local Y/M/D so the result can't slip a day across time zones.
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MIN_LEAD_DAYS);
  start.setDate(start.getDate() + ((6 - start.getDay() + 7) % 7)); // 6 = Saturday
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start: isoDate(start), end: isoDate(end) };
}

// Every control opens on a real, sensible value, so the page shows useful
// results before anyone touches it. Reset returns to exactly these.
const DEFAULTS = {
  days: 5,
  origin: 'us-west',
  ability: 'intermediate',
  pass: 'none',
  apres: 'any',
  budget: 'any',
  flexDates: false,
  anywhere: true,
};

function applyDefaults() {
  const week = defaultTripWeek();
  document.getElementById('pf-start').value = week.start;
  document.getElementById('pf-end').value = week.end;
  document.getElementById('pf-flexible-dates').checked = DEFAULTS.flexDates;
  document.getElementById('pf-days').value = DEFAULTS.days;
  document.getElementById('pf-origin').value = DEFAULTS.origin;
  document.getElementById('pf-ability').value = DEFAULTS.ability;
  document.getElementById('pf-pass').value = DEFAULTS.pass;
  document.getElementById('pf-apres').value = DEFAULTS.apres;
  document.getElementById('pf-budget').value = DEFAULTS.budget;
  document.getElementById('pf-flexible-where').checked = DEFAULTS.anywhere;
  document.querySelectorAll('#pf-regions input:checked').forEach(i => { i.checked = false; });
  document.getElementById('pf-dates-note').textContent =
    `Defaults to the next Saturday-to-Saturday week at least ${MIN_LEAD_DAYS} days out.`;
}

function resetForm() {
  document.getElementById('planner').reset();
  applyDefaults();
  document.getElementById('pf-ability').dispatchEvent(new Event('change'));
  run();
}

async function main() {
  const [oni, resortsData, phaseCopy, signals, climatology, liftPrices, tripCosts] = await Promise.all([
    loadOni(), loadResorts(), loadPhaseCopy(), loadClimateSignals(),
    loadClimatology(), loadLiftPrices(), loadTripCosts(),
  ]);
  Object.assign(state, { oni, resortsData, phaseCopy, signals, climatology, liftPrices, tripCosts });

  const originSel = document.getElementById('pf-origin');
  originSel.innerHTML = Object.entries(tripCosts.origins)
    .map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  const abilitySel = document.getElementById('pf-ability');
  abilitySel.innerHTML = Object.entries(tripCosts.difficulty)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  abilitySel.value = 'intermediate';
  // Description lives under the select rather than inside the option text,
  // which would otherwise overflow the control.
  const abilityHint = document.getElementById('pf-ability-hint');
  const setAbilityHint = () => {
    abilityHint.textContent = tripCosts.difficulty[abilitySel.value]?.desc || '';
  };
  abilitySel.addEventListener('change', setAbilityHint);
  setAbilityHint();

  document.getElementById('pf-regions').innerHTML = resortsData.regions
    .map(r => `<label class="pf-chip"><input type="checkbox" value="${r.id}"> ${r.name}</label>`).join('');

  // Ticking a specific region implies you're no longer "anywhere".
  document.getElementById('pf-regions').addEventListener('change', () => {
    const any = document.querySelectorAll('#pf-regions input:checked').length > 0;
    if (any) document.getElementById('pf-flexible-where').checked = false;
  });
  document.getElementById('pf-flexible-where').addEventListener('change', (e) => {
    if (e.target.checked) {
      document.querySelectorAll('#pf-regions input:checked').forEach(i => { i.checked = false; });
    }
  });

  const now = new Date();
  const inSeasonNow = resortsData.regions
    .filter(r => seasonMonths(r).includes(now.getMonth() + 1))
    .map(r => r.name);
  document.getElementById('pf-season-note').textContent = inSeasonNow.length
    ? `In season right now: ${inSeasonNow.join(', ')}.`
    : '';

  applyDefaults();

  document.getElementById('planner').addEventListener('submit', run);
  document.getElementById('pf-reset').addEventListener('click', resetForm);
  initTooltips();
  run();
}

main().catch(err => {
  console.error('Trip planner failed to load', err);
  document.getElementById('plan-results').innerHTML =
    '<p style="color:#8C1A1A;padding:20px;">Failed to load planner data. Check the console.</p>';
});
