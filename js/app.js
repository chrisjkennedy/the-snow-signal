import { loadOni, loadResorts, loadAffiliates, loadPhaseCopy, loadClimateSignals, loadSignalMetadata, loadBacktest, loadClimatology, fetchSnowpack, fetchForecast } from './data-sources.js';

// Module-level state: loaded once, then reused across live render and any
// number of scenario re-renders (so switching scenarios never re-fetches
// resort-level live data or rebuilds the map from scratch).
const state = {
  oni: null, resortsData: null, affiliates: null, phaseCopy: null,
  signals: null, signalMetadata: null, backtest: null, climatology: null,
  mapState: null, liveCache: new Map(), scenarioActive: false,
  expandedRegion: null,
};

const INTENSITY_LABEL = { weak: 'Weak', moderate: 'Moderate', strong: 'Strong', very_strong: 'Very Strong' };
// Illustrative representative ONI values per intensity tier, matching the
// thresholds scripts/update_oni.py uses to classify real readings. These
// are for the scenario explorer only — never shown as if they were a live
// reading.
const SCENARIO_ONI_VALUE = {
  el_nino: { weak: 0.7, moderate: 1.2, strong: 1.7, very_strong: 2.3 },
  la_nina: { weak: -0.7, moderate: -1.2, strong: -1.7, very_strong: -2.3 },
};
// How much a region's meter_pct (distance from the 50 = "average" midpoint)
// gets amplified or muted by scenario intensity. Moderate = 1.0, matching
// how the base narratives in resorts.json were written.
const INTENSITY_MULTIPLIER = { weak: 0.55, moderate: 1.0, strong: 1.3, very_strong: 1.6 };

function buildScenarioOni(phase, intensity) {
  if (phase === 'neutral') {
    return {
      is_scenario: true, phase: 'neutral', phase_label: 'ENSO-Neutral',
      latest_oni: 0, declared_status: 'Hypothetical scenario — not a forecast',
      trend: null, streak_months: null, latest_season: 'Scenario', latest_year: '',
    };
  }
  const val = SCENARIO_ONI_VALUE[phase][intensity];
  return {
    is_scenario: true, phase, intensity,
    phase_label: `${INTENSITY_LABEL[intensity]} ${PHASE_NAME[phase]}`,
    latest_oni: val, declared_status: 'Hypothetical scenario — not a forecast',
    trend: null, streak_months: null, latest_season: 'Scenario', latest_year: '',
  };
}

// Every signed oscillation the scenario explorer can override. PDO uses
// Cool/Warm rather than Negative/Positive, matching how NOAA labels it and
// how pdoBucket() reads it.
const SCENARIO_SIGNAL_LABEL = {
  nao: { strong_negative: 'Strong Negative', negative: 'Negative', neutral: 'Neutral', positive: 'Positive', strong_positive: 'Strong Positive' },
  pna: { strong_negative: 'Strong Negative', negative: 'Negative', neutral: 'Neutral', positive: 'Positive', strong_positive: 'Strong Positive' },
  sam: { strong_negative: 'Strong Negative', negative: 'Negative', neutral: 'Neutral', positive: 'Positive', strong_positive: 'Strong Positive' },
  pdo: { strong_negative: 'Strong Cool', negative: 'Cool', neutral: 'Neutral', positive: 'Warm', strong_positive: 'Strong Warm' },
};
const SCENARIO_SIGNAL_VALUE = { strong_negative: -1.8, negative: -0.8, neutral: 0, positive: 0.8, strong_positive: 1.8 };

/** Applies any set of {signalKey: choice} overrides onto the live signals object. */
function buildScenarioSignals(overrides, liveSignals) {
  const out = { ...liveSignals };
  for (const [key, choice] of Object.entries(overrides)) {
    if (!choice || choice === 'live') continue;
    out[key] = {
      ...liveSignals?.[key],
      is_scenario: true,
      latest_value: SCENARIO_SIGNAL_VALUE[choice],
      phase: SCENARIO_SIGNAL_LABEL[key][choice],
      latest_label: 'scenario',
    };
  }
  return out;
}

/** Scales a region's meter_pct around the 50 = "average" midpoint by scenario intensity. */
function scaleMeterPct(basePct, intensity) {
  const mult = INTENSITY_MULTIPLIER[intensity] ?? 1.0;
  return Math.round(Math.min(95, Math.max(5, 50 + (basePct - 50) * mult)));
}

/** Normalizes any signed phase label ("Negative", "Strong Positive", scenario or live) to a 3-way bucket. */
function naoBucket(phaseLabel) {
  const p = (phaseLabel || '').toLowerCase();
  if (p.includes('negative')) return 'negative';
  if (p.includes('positive')) return 'positive';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Resort scoring
//
// Ranks resorts WITHIN a region using real historical data
// (data/resort-climatology.json) rather than elevation alone. Four
// components, each normalized against the other resorts in the same region
// so the comparison is like-for-like:
//
//   snow    mean seasonal snowfall (ERA5, 10 seasons, identical method
//           worldwide). ERA5 understates absolute totals at altitude, but
//           within a region that bias is broadly shared, so the RANKING
//           holds even though the raw number would be wrong to print.
//   cold    share of core-season days at/below freezing — the direct
//           read on rain-line risk, and the thing that actually killed
//           Utah's 2025-26 season.
//   consistency  1 - coefficient of variation across seasons. Rewards
//           metronomes over boom-or-bust. Australia sits near 0.5, Japan
//           near 0.2, and that difference is real trip-planning
//           information.
//   elevation   base elevation, the classic temperature buffer.
//
// The weighted blend is the "base" score — how good this resort is in a
// typical year. The current climate driver then adjusts it: in a bearish
// signal, low/warm resorts are punished harder (they have less margin);
// in a bullish signal, they gain the most (they were the constraint).
// High, cold, reliable resorts stay steady in both directions, which is
// exactly the real-world behavior this is meant to capture.
// ---------------------------------------------------------------------------
const SCORE_WEIGHTS = { snow: 0.30, cold: 0.30, consistency: 0.15, elevation: 0.25 };

/** Min-max normalize to 0..1 within a peer group; returns 0.5 if the group is degenerate. */
function normalize(value, min, max) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) return 0.5;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

function climatologyFor(resortId) {
  return state.climatology?.resorts?.[resortId] || null;
}

/**
 * Computes 0-100 outlook scores for every resort in a region.
 * Returns a Map of resortId -> {score, base, adj, parts, hasData}.
 */
function scoreRegionResorts(region, displaySignal) {
  const rows = region.resorts.map(r => {
    const c = climatologyFor(r.id);
    return {
      resort: r,
      snow: c?.era5?.mean_season_snow_cm ?? null,
      cold: c?.era5?.cold_day_frac ?? null,
      cv: c?.era5?.cv ?? null,
      elev: r.base_elev_ft ?? null,
    };
  });

  const range = (key) => {
    const vals = rows.map(x => x[key]).filter(v => Number.isFinite(v));
    return vals.length ? [Math.min(...vals), Math.max(...vals)] : [NaN, NaN];
  };
  const [snowMin, snowMax] = range('snow');
  const [coldMin, coldMax] = range('cold');
  const [cvMin, cvMax] = range('cv');
  const [elevMin, elevMax] = range('elev');

  // How far the region's current call sits from "average" (-1..+1), used
  // to size the signal adjustment.
  const meterPct = displaySignal?.meter_pct ?? 50;
  const signalTilt = (meterPct - 50) / 50;

  const out = new Map();
  for (const row of rows) {
    const parts = {
      snow: normalize(row.snow, snowMin, snowMax),
      cold: normalize(row.cold, coldMin, coldMax),
      // Invert CV: lower variability scores higher.
      consistency: row.cv === null ? null : 1 - (normalize(row.cv, cvMin, cvMax) ?? 0.5),
      elevation: normalize(row.elev, elevMin, elevMax),
    };
    const hasData = parts.snow !== null || parts.cold !== null;

    let weighted = 0, weightUsed = 0;
    for (const [key, w] of Object.entries(SCORE_WEIGHTS)) {
      if (parts[key] === null) continue;
      weighted += parts[key] * w;
      weightUsed += w;
    }
    const base = weightUsed > 0 ? (weighted / weightUsed) * 100 : 50;

    // Resilience = how much buffer this resort has (cold + elevation).
    // Resorts with little buffer swing hardest with the signal.
    const resilience = [parts.cold, parts.elevation].filter(v => v !== null);
    const resilienceAvg = resilience.length
      ? resilience.reduce((a, b) => a + b, 0) / resilience.length
      : 0.5;
    const exposure = 1 - resilienceAvg;          // 0 = bulletproof, 1 = marginal
    const adj = signalTilt * (8 + 14 * exposure); // up to roughly +/-22 points

    out.set(row.resort.id, {
      score: Math.round(Math.min(100, Math.max(0, base + adj))),
      base: Math.round(base),
      adj: Math.round(adj),
      parts,
      hasData,
    });
  }
  return out;
}

function scoreBadgeClass(score) {
  if (score >= 70) return 'rs-high';
  if (score >= 45) return 'rs-mid';
  return 'rs-low';
}

/** Normalizes a PDO phase label ("Warm", "Cool", ...) to a 3-way bucket. */
function pdoBucket(phaseLabel) {
  const p = (phaseLabel || '').toLowerCase();
  if (p.includes('warm')) return 'warm';
  if (p.includes('cool')) return 'cool';
  return 'neutral';
}

/**
 * Per data/climate-signals.json's pdo.relevance: Warm PDO amplifies El
 * Niño's West Coast effects, Cool PDO amplifies La Niña's — and the
 * opposite pairing works against the current ENSO phase instead of with
 * it. ENSO-neutral or PDO-neutral readings have no defined relationship.
 */
function pdoAgreement(phaseKey, pdoPhaseBucket) {
  if (phaseKey === 'el_nino' && pdoPhaseBucket === 'warm') return 'agree';
  if (phaseKey === 'la_nina' && pdoPhaseBucket === 'cool') return 'agree';
  if (phaseKey === 'el_nino' && pdoPhaseBucket === 'cool') return 'oppose';
  if (phaseKey === 'la_nina' && pdoPhaseBucket === 'warm') return 'oppose';
  return 'neutral';
}

/** How strongly PDO's magnitude pushes on the meter — 0 means "too weak to matter." */
function pdoMagnitudeFactor(absValue) {
  if (absValue < 0.5) return 0;
  if (absValue < 1.0) return 0.15;
  if (absValue < 1.75) return 0.3;
  return 0.45;
}

/**
 * PDO amplifies or dampens (never replaces) an ENSO-driven region's
 * meter_pct, for the regions listed in REGION_SECONDARY_SIGNAL — mirrors
 * how scenario ENSO intensity scales meter_pct via scaleMeterPct(), but
 * keyed off live PDO/ENSO phase agreement rather than a chosen intensity
 * tier. Live-only by design: PDO has no scenario picker (see applyScenario
 * / renderPhaseView's isLiveEnso), so callers must gate this to real,
 * non-scenario ONI renders.
 */
function pdoModulatedMeterPct(region, phaseKey, basePct, pdoSignal) {
  if (REGION_SECONDARY_SIGNAL[region.id] !== 'pdo' || !pdoSignal) return basePct;
  const agreement = pdoAgreement(phaseKey, pdoBucket(pdoSignal.phase));
  if (agreement === 'neutral') return basePct;
  const factor = pdoMagnitudeFactor(Math.abs(pdoSignal.latest_value));
  if (!factor) return basePct;
  const mult = agreement === 'agree' ? 1 + factor : 1 - factor;
  return Math.round(Math.min(95, Math.max(5, 50 + (basePct - 50) * mult)));
}

/**
 * Single source of truth for "what signal is actually driving this
 * region's headline call right now." Most regions are ENSO-driven, but
 * some are not, and the site defers to whatever the research says
 * actually dominates:
 *   - Northeast US / Eastern Canada and the European Alps are NAO-primary
 *   - Australia is SAM-primary (Australia's Bureau of Meteorology
 *     identifies SAM as the strongest driver of Australian snowfall,
 *     ahead of ENSO)
 * For those regions the primary signal fully REPLACES the ENSO call
 * rather than riding along as an easy-to-miss footnote, and ENSO becomes
 * the secondary note instead. Used consistently by the card renderer, the
 * sort, the resort scoring, and the map so all four always agree.
 */
const DRIVER_SIGNAL_KEY = { nao: 'nao_signals', sam: 'sam_signals' };

function getDisplaySignal(region, phaseKey, signals) {
  const ensoSignal = region.enso_signals[phaseKey];
  const driver = region.primary_driver;
  const signalsKey = DRIVER_SIGNAL_KEY[driver];

  if (driver && signalsKey && region[signalsKey] && signals?.[driver]) {
    const live = signals[driver];
    const bucket = naoBucket(live.phase);
    const driverSignal = region[signalsKey][bucket];
    if (driverSignal) {
      const valLabel = `${live.latest_value > 0 ? '+' : ''}${live.latest_value.toFixed(2)}`;
      const when = live.is_scenario ? 'hypothetical' : live.latest_label;
      return {
        ...driverSignal,
        driver,
        secondaryNote: `ENSO check: currently ${ensoSignal.signal_label} (${PHASE_NAME[phaseKey]}) — a secondary influence here. ${driver.toUpperCase()} (${live.phase}, ${valLabel}, ${when}) is what actually drives this region's outcomes, and is what the call above reflects.`,
      };
    }
  }
  return { ...ensoSignal, driver: 'enso', secondaryNote: null };
}

const BACKTEST_VERDICT = {
  'hit': { cls: 'bv-hit', label: 'Hit' },
  'miss': { cls: 'bv-miss', label: 'Miss' },
  'partial': { cls: 'bv-partial', label: 'Partial' },
  'correct-for-the-right-reason': { cls: 'bv-hit', label: 'Hit (right reason)' },
  'likely-hit': { cls: 'bv-other', label: 'Likely hit (unconfirmed)' },
  'inconclusive': { cls: 'bv-other', label: 'Inconclusive' },
  'not-a-clean-test': { cls: 'bv-other', label: 'N/A — not an ENSO test' },
};

// Regions where PDO modulates (not replaces) the ENSO-driven call: it
// scales the region's live meter_pct up or down via pdoModulatedMeterPct()
// depending on whether the live PDO phase agrees with or opposes the
// current ENSO phase's usual West Coast effect, and the footnote from
// liveSignalNote() explains which of those it's doing. NAO-primary regions
// (Northeast US, European Alps) are NOT listed here: for those, NAO fully
// replaces ENSO as the headline signal (see getDisplaySignal /
// region.nao_signals in resorts.json) because that's what the site's own
// research says actually drives outcomes there.
const REGION_SECONDARY_SIGNAL = {
  'sierra-california': 'pdo',
  'pnw-northern-rockies': 'pdo',
};

const SIGNAL_CLASS = { bull: 'sb-bull', bear: 'sb-bear', mixed: 'sb-mixed' };
const METER_CLASS = { bull: 'mf-bull', bear: 'mf-bear', mixed: 'mf-mixed' };
const SIGNAL_HEX = { bull: '#22C55E', bear: '#EF4444', mixed: '#F59E0B' };
const PHASE_DOT = { el_nino: 'dot-amber', la_nina: 'dot-blue', neutral: 'dot-green' };
const PHASE_NAME = { el_nino: 'El Niño', la_nina: 'La Niña', neutral: 'ENSO-Neutral' };

function passBadgeClass(pass) {
  const p = pass.toLowerCase();
  if (p.includes('epic')) return 'pb-epic';
  if (p.includes('ikon')) return 'pb-ikon';
  if (p.includes('indy')) return 'pb-indy';
  return 'pb-independent';
}

function affiliateUrl(cfg, resortName) {
  const q = encodeURIComponent(resortName);
  return cfg.search_url.replace('{resort}', q) + (cfg.affiliate_param || '');
}

function isInSeason(startMonth, endMonth, month) {
  return startMonth <= endMonth
    ? month >= startMonth && month <= endMonth
    : month >= startMonth || month <= endMonth;
}

function renderHero(oni, phaseCopy, phaseKey) {
  const kickerEl = document.getElementById('hero-kicker');
  const liveEl = document.getElementById('hero-live');
  const metaEl = document.getElementById('hero-meta');

  if (oni?.is_scenario) {
    kickerEl.textContent = 'Scenario Preview — Not Live';
    kickerEl.classList.add('scenario-active');
    liveEl.innerHTML = `<span class="live-dot"></span>${phaseCopy[phaseKey].live_status} (shown for the scenario you selected below.)`;
    metaEl.innerHTML = `
      <div class="meta-chip"><span class="dot dot-amber"></span>Scenario phase: <span class="meta-val">&nbsp;${oni.phase_label}</span></div>
      <div class="meta-chip"><span class="dot dot-amber"></span>Representative ONI: <span class="meta-val">&nbsp;${oni.latest_oni > 0 ? '+' : ''}${oni.latest_oni.toFixed(2)} (illustrative)</span></div>
      <div class="meta-chip"><span class="dot dot-red"></span>${oni.declared_status}</div>
    `;
    return;
  }

  kickerEl.textContent = 'Live ENSO Ski Planner';
  kickerEl.classList.remove('scenario-active');
  liveEl.innerHTML = `<span class="live-dot"></span>${phaseCopy[phaseKey].live_status}`;

  if (!oni) {
    metaEl.innerHTML = `<div class="meta-chip">Live climate data unavailable right now — showing regional analysis only.</div>`;
    return;
  }
  const trendWord = oni.trend === 'rising' ? 'strengthening' : oni.trend === 'falling' ? 'weakening' : 'holding steady';
  metaEl.innerHTML = `
    <div class="meta-chip"><span class="dot ${PHASE_DOT[phaseKey]}"></span>Current phase: <span class="meta-val">&nbsp;${oni.phase_label}</span></div>
    <div class="meta-chip"><span class="dot dot-green"></span>Latest ONI: <span class="meta-val">&nbsp;${oni.latest_oni > 0 ? '+' : ''}${oni.latest_oni.toFixed(2)} (${oni.latest_season} ${oni.latest_year}), ${trendWord}</span></div>
    <div class="meta-chip"><span class="dot dot-amber"></span>Official declaration: <span class="meta-val">&nbsp;${oni.declared_status}</span></div>
  `;
}

function renderOniBanner(oni) {
  const el = document.getElementById('oni-banner-inner');
  if (!oni) {
    el.innerHTML = `<span class="oni-label">ENSO status →</span><span class="oni-value">Live ONI data unavailable — run <code>scripts/update_oni.py</code></span>`;
    return;
  }
  el.innerHTML = `
    <span class="oni-label">Live ENSO status →</span>
    <span class="oni-value">${oni.phase_label}</span>
    <span class="oni-value">Latest ONI (${oni.latest_season} ${oni.latest_year}): <span class="num">${oni.latest_oni > 0 ? '+' : ''}${oni.latest_oni.toFixed(2)}</span></span>
    <span class="oni-value">Trend: <span class="num">${oni.trend}</span>, ${oni.streak_months}mo streak</span>
    <span class="oni-updated">NOAA CPC · refreshed ${new Date(oni.updated_utc).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
  `;
}

function renderSignalBar(oni, phaseKey) {
  const el = document.getElementById('signal-bar-inner');
  if (!oni) {
    el.innerHTML = `<span class="signal-label">Current signals →</span><span class="signal-pill sp-red">Live data unavailable</span>`;
    return;
  }
  if (oni.is_scenario) {
    const chips = [
      { cls: 'sp-amber', text: `Scenario: ${oni.phase_label} (ONI ${oni.latest_oni > 0 ? '+' : ''}${oni.latest_oni.toFixed(2)}, illustrative)` },
      { cls: 'sp-amber', text: 'Hypothetical — not a live reading' },
    ];
    el.innerHTML = `<span class="signal-label">Viewing scenario →</span>` +
      chips.map(c => `<span class="signal-pill ${c.cls}">${c.text}</span>`).join('');
    return;
  }
  const phaseCls = phaseKey === 'el_nino' ? 'sp-amber' : phaseKey === 'la_nina' ? 'sp-blue' : 'sp-amber';
  const trendCls = oni.trend === 'rising' ? 'sp-red' : oni.trend === 'falling' ? 'sp-blue' : 'sp-amber';
  const chips = [
    { cls: phaseCls, text: `${oni.phase_label} (ONI ${oni.latest_oni > 0 ? '+' : ''}${oni.latest_oni.toFixed(2)})` },
    { cls: trendCls, text: `Trend: ${oni.trend}, ${oni.streak_months}mo streak` },
    { cls: 'sp-blue', text: oni.declared_status },
    { cls: 'sp-amber', text: 'Check NOAA CPC monthly for the official advisory ↗' },
  ];
  el.innerHTML = `<span class="signal-label">Current signals →</span>` +
    chips.map(c => `<span class="signal-pill ${c.cls}">${c.text}</span>`).join('');
}

function renderOtherSignalsLine(signals) {
  const el = document.getElementById('other-signals-line');
  if (!signals) {
    el.textContent = 'Other climate signals (NAO/AO/PDO) unavailable right now.';
    return;
  }
  const fmt = (s) => `${s.latest_value > 0 ? '+' : ''}${s.latest_value.toFixed(2)}`;
  const chip = (key, label) => signals[key]
    ? `${label}: <strong>${signals[key].phase}</strong> (${fmt(signals[key])})`
    : `${label}: unavailable`;
  el.innerHTML = `Other signals → ` +
    `NAO: <strong>${signals.nao.phase}</strong> (${fmt(signals.nao)}, ${signals.nao.latest_label})` +
    `<span class="sig-sep">·</span>${chip('ao', 'AO')}` +
    `<span class="sig-sep">·</span>${chip('pdo', 'PDO')}` +
    `<span class="sig-sep">·</span>${chip('pna', 'PNA')}` +
    `<span class="sig-sep">·</span>${chip('sam', 'SAM')}` +
    `<span class="sig-sep">·</span>${chip('iod', 'IOD')}`;
}

/** Describes what pdoModulatedMeterPct() actually did to the meter above, so the footnote never contradicts the bar. */
function pdoEffectText(phaseKey, pdoSignal, isLiveEnso) {
  if (!isLiveEnso) {
    return ' PDO modulation only applies to the live ENSO reading, so it has no effect on the hypothetical scenario meter shown above.';
  }
  const agreement = pdoAgreement(phaseKey, pdoBucket(pdoSignal.phase));
  const factor = pdoMagnitudeFactor(Math.abs(pdoSignal.latest_value));
  if (agreement === 'neutral' || !factor) {
    return ' Currently a minor influence here — too weak or too near-neutral to move the meter above off its base ENSO level.';
  }
  return agreement === 'agree'
    ? ' Currently reinforcing the live ENSO signal here, so the meter above is scaled up accordingly.'
    : ' Currently working against the live ENSO signal here, so the meter above is dampened toward neutral accordingly.';
}

function liveSignalNote(region, signals, phaseKey, isLiveEnso) {
  const key = REGION_SECONDARY_SIGNAL[region.id];
  if (!key || !signals?.[key]) return '';
  const s = signals[key];
  const label = key.toUpperCase();
  const val = `${s.latest_value > 0 ? '+' : ''}${s.latest_value.toFixed(2)}`;
  const lead = s.is_scenario ? 'Scenario check' : 'Live check';
  const when = s.is_scenario ? 'hypothetical' : s.latest_label;
  const effect = key === 'pdo' ? pdoEffectText(phaseKey, s, isLiveEnso) : '';
  return `<div class="live-signal-note">${lead}: ${label} set to <strong>${s.phase}</strong> (${val}, ${when}) — ${s.relevance}${effect}</div>`;
}

function renderSignalInfo(metadata) {
  const el = document.getElementById('signal-info-body');
  if (!metadata) {
    el.innerHTML = `<p class="bt-note">Signal reference info unavailable.</p>`;
    return;
  }
  const rows = ['oni', 'nao', 'ao', 'pna', 'pdo', 'sam', 'iod'].filter(k => metadata[k]).map(key => {
    const s = metadata[key];
    return `
      <tr>
        <td class="sig-name">${s.name}</td>
        <td>${s.update_frequency}<div class="bt-note">${s.latency}</div></td>
        <td class="sig-horizon-tag">${s.horizon_short}</td>
        <td>${s.horizon_detail}</td>
      </tr>
    `;
  }).join('');
  el.innerHTML = `
    <table class="sig-table">
      <thead><tr><th>Signal</th><th>Updates</th><th>Relevant horizon</th><th>What that actually means</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderContextStrip(oni, phaseCopy, phaseKey) {
  if (oni?.is_scenario) {
    document.getElementById('ctx-enso-status').innerHTML =
      `<strong>Hypothetical: ${oni.phase_label}</strong> — representative ONI ${oni.latest_oni > 0 ? '+' : ''}${oni.latest_oni.toFixed(2)}. Not a live reading.`;
    document.getElementById('ctx-mechanism').textContent = phaseCopy[phaseKey].mechanism;
    document.getElementById('ctx-freshness').textContent =
      'Everything below is showing a scenario you selected — reset to live data to see real current conditions again.';
    return;
  }
  document.getElementById('ctx-enso-status').innerHTML = oni
    ? `<strong>${PHASE_NAME[phaseKey]}</strong> — latest ONI ${oni.latest_oni > 0 ? '+' : ''}${oni.latest_oni.toFixed(2)} (${oni.latest_season} ${oni.latest_year}), ${oni.declared_status}.`
    : 'Live data unavailable.';
  document.getElementById('ctx-mechanism').textContent = phaseCopy[phaseKey].mechanism;
  document.getElementById('ctx-freshness').textContent = oni
    ? `Snowpack and forecasts refresh on every page load. ENSO status last refreshed ${new Date(oni.updated_utc).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.`
    : 'Live data unavailable — check back later.';
}

/** Compact strip of the real historical numbers behind this resort's score. */
function historyStripHtml(resort) {
  const c = climatologyFor(resort.id);
  if (!c) return '';
  const bits = [];
  if (c.era5) {
    const e = c.era5;
    if (e.cold_day_frac !== null && e.cold_day_frac !== undefined) {
      bits.push(`<span class="hist-item"><span class="hist-label">below freezing</span>${Math.round(e.cold_day_frac * 100)}% of season days</span>`);
    }
    if (e.cv !== null && e.cv !== undefined) {
      const consistency = e.cv < 0.25 ? 'very consistent' : e.cv < 0.4 ? 'moderate swing' : 'boom-or-bust';
      bits.push(`<span class="hist-item"><span class="hist-label">year-to-year</span>${consistency} (cv ${e.cv.toFixed(2)})</span>`);
    }
  }
  if (c.station?.median_peak_swe_in) {
    const st = c.station;
    bits.push(`<span class="hist-item"><span class="hist-label">typical peak snowpack</span>${st.median_peak_swe_in}" SWE around ${st.median_peak_date}${st.record_begins ? `, since ${st.record_begins}` : ''}</span>`);
  }
  if (!bits.length) return '';
  return `<div class="history-strip">${bits.join('')}</div>`;
}

function resortRowSkeleton(resort, affiliates, score, rank) {
  const passesHtml = resort.passes.map(p => {
    const confBadge = resort.pass_confidence === 'verify'
      ? `<a class="pass-confidence" href="https://www.epicpass.com" target="_blank" rel="noopener" title="Pass rosters change season to season — verify before booking">verify</a>`
      : '';
    return `<span class="pass-badge ${passBadgeClass(p)}">${p}</span>${confBadge}`;
  }).join(' ');

  const affiliateLinks = affiliates ? `
    <div class="affiliate-row">
      <a class="affiliate-btn" target="_blank" rel="noopener sponsored" href="${affiliateUrl(affiliates.lift_tickets, resort.name)}">Lift tickets ↗</a>
      <a class="affiliate-btn" target="_blank" rel="noopener sponsored" href="${affiliateUrl(affiliates.gear_rental, resort.name)}">Rent gear ↗</a>
      <a class="affiliate-btn" target="_blank" rel="noopener sponsored" href="${affiliateUrl(affiliates.lodging, resort.name)}">Lodging ↗</a>
    </div>` : '';

  const snowReportLink = resort.snow_report_url
    ? `<a class="snow-report-link" target="_blank" rel="noopener" href="${resort.snow_report_url}">Live snow report (${resort.snow_report_source}) ↗</a>`
    : '';
  const resortSiteLink = resort.resort_url
    ? `<a class="resort-site-link" target="_blank" rel="noopener" href="${resort.resort_url}">Resort site ↗</a>`
    : '';
  const microclimateHtml = resort.microclimate_note
    ? `<p class="microclimate-note">${resort.microclimate_note}</p>`
    : '';

  return `
    <div class="resort-row" id="resort-${resort.id}" data-resort="${resort.id}">
      <div class="resort-top">
        <div class="resort-name-wrap">
          <span class="resort-rank">${rank ? `${rank}.` : ''}</span>
          ${scoreChipHtml(score)}
          <span class="resort-name">${resort.name}</span>
          <span class="resort-elev">${resort.base_elev_ft.toLocaleString()}–${resort.summit_elev_ft.toLocaleString()} ft</span>
        </div>
        <div>${passesHtml}</div>
      </div>
      ${microclimateHtml}
      ${historyStripHtml(resort)}
      <div class="live-data-row" data-live="${resort.id}">
        <span class="live-stat loading"><span class="live-dot"></span><span class="stat-label">snowpack</span><span class="stat-val">loading…</span></span>
        <span class="live-stat loading"><span class="stat-label">7-day forecast</span><span class="stat-val">loading…</span></span>
      </div>
      <div class="accum-row" data-chart="${resort.id}"></div>
      <div class="resort-links-row">
        ${resortSiteLink}
        ${snowReportLink}
      </div>
      ${affiliateLinks}
    </div>
  `;
}

const DRIVER_LABEL = { enso: 'ENSO', nao: 'NAO', sam: 'SAM' };

/** The score chip + its plain-language explanation, shown on each resort row. */
function scoreChipHtml(sc) {
  if (!sc || !sc.hasData) {
    return `<span class="resort-score rs-none" title="Historical climatology not yet available for this resort">—</span>`;
  }
  const pct = (v) => v === null ? '—' : `${Math.round(v * 100)}`;
  const tip = [
    `Outlook ${sc.score}/100`,
    `base (typical year) ${sc.base}`,
    `current-signal adjustment ${sc.adj >= 0 ? '+' : ''}${sc.adj}`,
    `— components (0-100, vs. others in this region): snowfall ${pct(sc.parts.snow)}, cold-day reliability ${pct(sc.parts.cold)}, year-to-year consistency ${pct(sc.parts.consistency)}, elevation buffer ${pct(sc.parts.elevation)}`,
  ].join(' · ');
  return `<span class="resort-score ${scoreBadgeClass(sc.score)}" title="${tip}">${sc.score}</span>`;
}

/**
 * Collapsed by default: the landing page shows only the region-level call
 * for all 10 regions, which is the level most people actually decide at.
 * Resorts render only for the expanded region, ranked by outlook score.
 */
function renderRegionCard(region, rank, phaseKey, affiliates, signals, scenarioIntensity, isLiveEnso, expanded) {
  const s = getDisplaySignal(region, phaseKey, signals);
  let meterPct = (scenarioIntensity && s.driver === 'enso') ? scaleMeterPct(s.meter_pct, scenarioIntensity) : s.meter_pct;
  if (isLiveEnso && s.driver === 'enso') meterPct = pdoModulatedMeterPct(region, phaseKey, meterPct, signals?.pdo);
  const intensityNote = (scenarioIntensity && scenarioIntensity !== 'moderate' && s.driver === 'enso')
    ? `<div class="live-signal-note">Scenario check: shown at <strong>${INTENSITY_LABEL[scenarioIntensity]}</strong> intensity — the bar above is scaled accordingly, but the written call below still describes the typical/moderate case.</div>`
    : '';
  const driverNote = s.secondaryNote ? `<div class="live-signal-note">${s.secondaryNote}</div>` : '';
  const now = new Date();
  const inSeason = isInSeason(region.season.start_month, region.season.end_month, now.getMonth() + 1);

  let expandedBody = '';
  if (expanded) {
    const scores = scoreRegionResorts(region, { ...s, meter_pct: meterPct });
    // Resorts with no historical climatology yet are held out of the
    // ranking entirely rather than sorted to the bottom — an unscored
    // Niseko sitting last would read as "worst," which is the opposite
    // of what a missing data point means.
    const scored = region.resorts.filter(r => scores.get(r.id)?.hasData)
      .sort((a, b) => scores.get(b.id).score - scores.get(a.id).score);
    const unscored = region.resorts.filter(r => !scores.get(r.id)?.hasData);

    const rankedRows = scored
      .map((r, i) => resortRowSkeleton(r, affiliates, scores.get(r.id), i + 1))
      .join('');
    const unscoredRows = unscored.length ? `
      <div class="unranked-head">Historical climatology not yet retrieved — not ranked</div>
      ${unscored.map(r => resortRowSkeleton(r, affiliates, scores.get(r.id), null)).join('')}
    ` : '';

    expandedBody = `
      <p class="r-detail">${s.narrative}</p>
      <div class="r-caveat"><span class="r-caveat-icon">⚠</span>${s.caveat}</div>
      ${intensityNote}
      ${driverNote}
      ${liveSignalNote(region, signals, phaseKey, isLiveEnso)}
      <div class="resort-list-head">
        <span>Resorts, ranked by outlook</span>
        <span class="resort-list-hint">Score blends this resort's own history — mean seasonal snowfall, share of season days below freezing, and year-to-year consistency, all from 10 seasons of ERA5 reanalysis — with its elevation buffer, then adjusts for the current ${DRIVER_LABEL[s.driver] || 'climate'} signal. Compared within this region only. Hover a score for the full breakdown. It measures snow <em>reliability</em>, not terrain quality or powder character.</span>
      </div>
      <div class="resort-list">${rankedRows}${unscoredRows}</div>
    `;
  }

  return `
    <div class="r-card ${expanded ? 'is-expanded' : 'is-collapsed'}" data-region-id="${region.id}">
      <button type="button" class="r-card-head" data-toggle-region="${region.id}" aria-expanded="${expanded}">
        <div class="r-head-main">
          <div class="r-region"><span class="rank-badge">#${rank}</span>${region.name}</div>
          <div class="r-head-meta">
            <span class="season-tag">${region.season.display}</span>
            <span class="in-season-tag ${inSeason ? 'active' : 'inactive'}">${inSeason ? 'In season' : 'Off-season'}</span>
            <span class="r-resort-count">${region.resorts.length} resorts</span>
            <span class="r-driver-tag">${DRIVER_LABEL[s.driver] || 'ENSO'}-driven</span>
          </div>
        </div>
        <div class="r-head-right">
          <span class="signal-badge ${SIGNAL_CLASS[s.signal]}">${s.signal_label}</span>
          <div class="r-meter-row">
            <div class="r-meter"><div class="r-meter-fill ${METER_CLASS[s.signal]}" style="width:${meterPct}%"></div></div>
            <span class="r-meter-pct">${s.meter_display}</span>
          </div>
        </div>
        <span class="r-chevron" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
      </button>
      <div class="r-card-body" ${expanded ? '' : 'hidden'}>
        ${expandedBody}
      </div>
    </div>
  `;
}

function statSpan(label, value, cls) {
  return `<span class="live-stat"><span class="stat-label">${label}</span><span class="stat-val ${cls || ''}">${value}</span></span>`;
}

/** Season-to-date SWE vs. the historical median, as a small inline sparkline. */
function sparklineSvg(series, color) {
  if (!series || series.length < 2) return '';
  const w = 160, h = 34, pad = 2;
  // The AWDB API sometimes omits `median` for individual days (e.g. right
  // at the start of a station's period of record) — normalize both fields
  // to finite numbers so one missing value can't poison the whole chart
  // with NaN (which SVG silently refuses to render at all).
  const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
  const maxVal = Math.max(...series.map(d => Math.max(num(d.value), num(d.median))), 0.1);
  const x = i => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = v => h - pad - (Math.min(num(v), maxVal) / maxVal) * (h - pad * 2);
  const actual = series.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const median = series.map((d, i) => `${x(i)},${y(d.median)}`).join(' ');
  return `<svg class="accum-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Season-to-date snowpack vs. historical median">
    <polyline points="${median}" fill="none" stroke="#B7C4D1" stroke-width="1.5" stroke-dasharray="2,2"/>
    <polyline points="${actual}" fill="none" stroke="${color}" stroke-width="1.75"/>
  </svg>`;
}

/** Paints already-fetched (cached) live data for a resort into its row. */
function paintResortLiveData(resort, data) {
  const el = document.querySelector(`[data-live="${resort.id}"]`);
  const chartEl = document.querySelector(`[data-chart="${resort.id}"]`);
  if (el) el.innerHTML = data.snowpackHtml + data.forecastHtml;
  if (chartEl) {
    chartEl.innerHTML = data.chartColor
      ? `${sparklineSvg(data.series, data.chartColor)}
         <span class="accum-legend"><span class="leg-actual" style="background:${data.chartColor}"></span>this season <span class="leg-median"></span>median</span>`
      : '';
  }
}

/**
 * Fetches live snowpack + forecast for a resort once, caches the rendered
 * pieces in state.liveCache, and paints them. Re-rendering the region grid
 * (e.g. on a scenario change) calls paintResortLiveData from the cache
 * instead of calling this again — the underlying snowpack/forecast is real
 * data that doesn't change just because the user is exploring a
 * hypothetical ENSO scenario.
 */
async function hydrateResortLiveData(resort) {
  const triplet = resort.snotel_triplet || resort.snow_course_triplet || null;
  const [snowpack, forecast] = await Promise.all([
    triplet ? fetchSnowpack(triplet) : Promise.resolve(null),
    fetchForecast(resort.lat, resort.lon),
  ]);

  let snowpackHtml;
  let chartCls = 'neutral';
  if (!triplet) {
    snowpackHtml = `<span class="live-stat"><span class="stat-label">snowpack</span><span class="no-data">no nearby station</span></span>`;
  } else if (!snowpack || snowpack.pctOfMedian === null) {
    snowpackHtml = `<span class="live-stat"><span class="stat-label">snowpack</span><span class="no-data">preseason / no data</span></span>`;
  } else {
    chartCls = snowpack.pctOfMedian >= 100 ? 'pos' : snowpack.pctOfMedian >= 80 ? 'neutral' : 'neg';
    snowpackHtml = statSpan('snowpack', `${snowpack.pctOfMedian}% of median (${snowpack.sweIn}" SWE, ${snowpack.date})`, chartCls);
  }

  let forecastHtml;
  if (!forecast) {
    forecastHtml = `<span class="live-stat"><span class="stat-label">7-day forecast</span><span class="no-data">unavailable</span></span>`;
  } else {
    const cls = forecast.totalSnowIn >= 12 ? 'pos' : forecast.totalSnowIn >= 3 ? 'neutral' : 'neg';
    forecastHtml = statSpan('7-day forecast', `${forecast.totalSnowIn}" snow · high ${Math.round(forecast.todayHighF)}°F`, cls);
  }

  const data = {
    snowpackHtml, forecastHtml,
    series: snowpack?.series?.length > 1 ? snowpack.series : null,
    chartColor: snowpack?.series?.length > 1 ? (chartCls === 'pos' ? '#22C55E' : chartCls === 'neg' ? '#EF4444' : '#F59E0B') : null,
  };
  state.liveCache.set(resort.id, data);
  paintResortLiveData(resort, data);
}

/** Paints from cache if we already have it; otherwise fetches (throttled by the caller). */
async function ensureResortLiveData(resort) {
  const cached = state.liveCache.get(resort.id);
  if (cached) {
    paintResortLiveData(resort, cached);
    return;
  }
  await hydrateResortLiveData(resort);
}

/**
 * Builds the map once, with markers grouped by region id. Colors start
 * from whatever phaseKey is passed in, but afterward stay in sync with the
 * live/scenario phase via updateMapSignals() — the map itself is never
 * torn down and rebuilt (that would lose the user's pan/zoom position).
 */
function initMap(resortsData, phaseKey, signals) {
  if (typeof L === 'undefined') {
    document.getElementById('resort-map').innerHTML =
      '<p style="padding:16px;color:var(--muted);">Map library failed to load (offline?).</p>';
    return { regionMarkers: {}, map: null };
  }
  const map = L.map('resort-map', { scrollWheelZoom: false }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 12,
  }).addTo(map);

  const regionMarkers = {};
  const allBounds = [];

  for (const region of resortsData.regions) {
    const s = getDisplaySignal(region, phaseKey, signals);
    const color = SIGNAL_HEX[s.signal];
    const markers = [];
    for (const resort of region.resorts) {
      const marker = L.circleMarker([resort.lat, resort.lon], {
        radius: 7, color: '#0C2340', weight: 1.5, fillColor: color, fillOpacity: 0.9,
      }).addTo(map);
      marker.bindPopup(`
        <div class="map-popup">
          <div class="mp-name">${resort.name}</div>
          <div class="mp-region">${region.name} · ${s.signal_label}</div>
          <button type="button" class="mp-link" data-open-region="${region.id}">Open this region ↓</button>
        </div>
      `);
      // Clicking through from a marker opens its region — same path the
      // dropdown and card headers use, so the three can't disagree.
      marker.on('popupopen', (e) => {
        e.popup.getElement()?.querySelector('[data-open-region]')
          ?.addEventListener('click', () => selectRegion(region.id));
      });
      markers.push(marker);
      allBounds.push([resort.lat, resort.lon]);
    }
    regionMarkers[region.id] = markers;
  }
  // The container can report a stale/zero size at the instant the map is
  // created (webfonts and the Leaflet stylesheet can still be reflowing
  // layout), which throws fitBounds' zoom calculation way off — force a
  // resize check immediately before fitting.
  requestAnimationFrame(() => {
    map.invalidateSize();
    if (allBounds.length) map.fitBounds(allBounds, { padding: [20, 20] });
  });

  return { regionMarkers, map, allBounds };
}

/** Recolors existing markers/popups in place when the phase (live or scenario) changes. */
function updateMapSignals(mapState, resortsData, phaseKey, signals) {
  for (const region of resortsData.regions) {
    const s = getDisplaySignal(region, phaseKey, signals);
    const markers = mapState.regionMarkers[region.id] || [];
    // markers[] was built in the same order as region.resorts[], so index
    // lines them up directly.
    region.resorts.forEach((resort, i) => {
      const marker = markers[i];
      if (!marker) return;
      marker.setStyle({ fillColor: SIGNAL_HEX[s.signal] });
      marker.setPopupContent(`
        <div class="map-popup">
          <div class="mp-name">${resort.name}</div>
          <div class="mp-region">${region.name} · ${s.signal_label}</div>
          <button type="button" class="mp-link" data-open-region="${region.id}">Open this region ↓</button>
        </div>
      `);
    });
  }
}

/**
 * The one entry point for "user picked a region" — whether that came from
 * the dropdown, a map marker, or clicking a region card header. Everything
 * (which card is expanded, the dropdown value, the map framing) is driven
 * off state.expandedRegion so the three controls can never disagree.
 * Passing null (or the already-open region) collapses back to the overview.
 */
function selectRegion(regionId, opts = {}) {
  const next = (!regionId || regionId === 'all' || regionId === state.expandedRegion) ? null : regionId;
  state.expandedRegion = next;

  const select = document.getElementById('region-select');
  if (select) select.value = next || 'all';

  rerenderRegionGrid();

  const heading = document.getElementById('regions-section-head');
  if (heading) {
    const region = state.resortsData.regions.find(r => r.id === next);
    heading.textContent = region
      ? `${region.name} — resorts ranked by outlook`
      : 'Ski Regions — Ranked Most to Least Bullish';
  }

  frameMap(next);

  if (next && opts.scroll !== false) {
    document.querySelector(`.r-card[data-region-id="${next}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/** Shows only the selected region's markers (all of them when collapsed) and fits the view. */
function frameMap(regionId) {
  const mapState = state.mapState;
  if (!mapState?.map) return;
  const bounds = [];
  for (const [id, markers] of Object.entries(mapState.regionMarkers)) {
    const show = !regionId || id === regionId;
    for (const marker of markers) {
      if (show) {
        if (!mapState.map.hasLayer(marker)) marker.addTo(mapState.map);
        bounds.push(marker.getLatLng());
      } else {
        mapState.map.removeLayer(marker);
      }
    }
  }
  if (bounds.length) mapState.map.fitBounds(bounds, { padding: [30, 30], maxZoom: regionId ? 8 : 6 });
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. With ~65
 * resorts each firing a SNOTEL + Open-Meteo request on page load, doing
 * this unthrottled reliably gets the AWDB API to start returning 429s.
 */
async function runWithConcurrency(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function sourceLinksHtml(sources) {
  if (!sources?.length) return '';
  return `<div class="bt-sources">${sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${s.label} ↗</a>`).join('')}</div>`;
}

function renderBacktest(backtest, resortsData) {
  const el = document.getElementById('backtest-body');
  if (!backtest) {
    el.innerHTML = `<p class="bt-note">Backtest data unavailable.</p>`;
    return;
  }
  const regionName = (id) => resortsData.regions.find(r => r.id === id)?.name ?? id;

  const rows = backtest.regions.map(r => {
    const v = BACKTEST_VERDICT[r.verdict] ?? BACKTEST_VERDICT['inconclusive'];
    return `
      <tr>
        <td class="bt-region-name">${regionName(r.region_id)}</td>
        <td>${r.predicted}</td>
        <td>${r.actual}<div class="bt-note">${r.note}</div></td>
        <td><span class="bt-verdict ${v.cls}">${v.label}</span></td>
      </tr>
    `;
  }).join('');

  el.innerHTML = `
    <p class="bt-summary-line"><strong>${backtest.season_label}.</strong> ${backtest.enso_summary}</p>

    <div class="bt-callout">
      <div class="bt-callout-title">${backtest.headline_wildcard.title}</div>
      <p class="bt-callout-text">${backtest.headline_wildcard.text}</p>
      ${sourceLinksHtml(backtest.headline_wildcard.sources)}
    </div>

    <div class="bt-table-wrap">
      <table class="bt-table">
        <thead><tr><th>Region</th><th>This site predicted</th><th>What actually happened</th><th>Verdict</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="bt-callout bt-live">
      <div class="bt-callout-title">${backtest.live_validation.title}</div>
      <p class="bt-callout-text">${backtest.live_validation.text}</p>
      ${sourceLinksHtml(backtest.live_validation.sources)}
    </div>

    <p class="bt-methodology">${backtest.methodology_note}</p>
  `;
}

/**
 * Renders everything that depends on the current phase — hero, signal bar,
 * context strip, the region grid + dropdown, and the map colors. Called
 * once on load with live data, and again on every scenario apply/reset
 * with either the real live data or a synthetic scenario oni/signals pair.
 * Resort-level live data (snowpack/forecast) is intentionally NOT
 * re-fetched here — see ensureResortLiveData / state.liveCache.
 */
function renderPhaseView(oni, signals, phaseKey, scenarioIntensity) {
  // Remember the render context so expanding/collapsing a region can
  // rebuild the grid without re-deriving (or re-fetching) anything.
  state.view = { oni, signals, phaseKey, scenarioIntensity };

  const { phaseCopy } = state;
  renderHero(oni, phaseCopy, phaseKey);
  renderSignalBar(oni, phaseKey);
  renderContextStrip(oni, phaseCopy, phaseKey);

  rerenderRegionGrid();

  if (state.mapState?.map) {
    updateMapSignals(state.mapState, state.resortsData, phaseKey, signals);
    frameMap(state.expandedRegion);
  }
}

/** Rebuilds the region grid + dropdown from state.view and state.expandedRegion. */
function rerenderRegionGrid() {
  const { resortsData, affiliates } = state;
  const { oni, signals, phaseKey, scenarioIntensity } = state.view || {};
  if (!phaseKey) return;
  // PDO modulation (pdoModulatedMeterPct) is live-only — it never runs
  // against a scenario oni, since PDO's scenario override is applied to
  // signals directly rather than through the ENSO meter path.
  const isLiveEnso = !oni?.is_scenario;

  const sortPct = (region) => {
    const s = getDisplaySignal(region, phaseKey, signals);
    let pct = (scenarioIntensity && s.driver === 'enso') ? scaleMeterPct(s.meter_pct, scenarioIntensity) : s.meter_pct;
    if (isLiveEnso && s.driver === 'enso') pct = pdoModulatedMeterPct(region, phaseKey, pct, signals?.pdo);
    return pct;
  };
  const sortedRegions = [...resortsData.regions].sort((a, b) => sortPct(b) - sortPct(a));

  const grid = document.getElementById('regions-grid');
  grid.innerHTML = sortedRegions.map((region, i) =>
    renderRegionCard(region, i + 1, phaseKey, affiliates, signals, scenarioIntensity, isLiveEnso,
      region.id === state.expandedRegion)
  ).join('');

  grid.querySelectorAll('[data-toggle-region]').forEach(btn => {
    btn.addEventListener('click', () => selectRegion(btn.dataset.toggleRegion, { scroll: false }));
  });

  const select = document.getElementById('region-select');
  select.innerHTML = `<option value="all">All regions — overview</option>` +
    sortedRegions.map((r, i) => `<option value="${r.id}">#${i + 1} ${r.name} — ${getDisplaySignal(r, phaseKey, signals).signal_label}</option>`).join('');
  select.value = state.expandedRegion || 'all';

  // Only the expanded region's rows exist in the DOM, so only those need
  // live data painted — ensureResortLiveData serves from cache after the
  // first fetch, so re-expanding a region later is instant.
  const visible = sortedRegions.filter(r => r.id === state.expandedRegion).flatMap(r => r.resorts);
  if (visible.length) runWithConcurrency(visible, 6, ensureResortLiveData);
}

function currentPhaseKeyFor(oni) {
  return oni?.phase && state.phaseCopy[oni.phase] ? oni.phase : 'neutral';
}

// Every oscillation the scenario explorer exposes, in display order.
const SCENARIO_SIGNAL_KEYS = ['nao', 'pdo', 'pna', 'sam'];

function readScenarioControls() {
  const overrides = {};
  for (const key of SCENARIO_SIGNAL_KEYS) {
    overrides[key] = document.getElementById(`scenario-${key}`).value;
  }
  return {
    phaseChoice: document.getElementById('scenario-phase').value,
    intensity: document.getElementById('scenario-intensity').value,
    overrides,
  };
}

/**
 * Always renders EVERY axis explicitly (never just "the overridden ones") —
 * the confusing case was a user resetting one dropdown back to "live,"
 * clicking Apply, and the page correctly staying in scenario mode because a
 * different signal was still overridden, with nothing on screen making that
 * obvious. Every axis' status is spelled out, plus a small "overriding" tag
 * sits directly on whichever dropdowns are engaged.
 */
function setScenarioUiState(phaseChoice, overrides, oniForRender) {
  const active = phaseChoice !== 'live' || SCENARIO_SIGNAL_KEYS.some(k => overrides[k] !== 'live');
  state.scenarioActive = active;

  const status = document.getElementById('scenario-status');
  const banner = document.getElementById('scenario-banner');
  const bannerText = document.getElementById('scenario-banner-text');
  const resetBtn = document.getElementById('scenario-reset');
  const readout = document.getElementById('scenario-live-readout');
  document.getElementById('phase-override-tag').hidden = phaseChoice === 'live';
  for (const key of SCENARIO_SIGNAL_KEYS) {
    document.getElementById(`${key}-override-tag`).hidden = overrides[key] === 'live';
  }

  const parts = [`ENSO: ${phaseChoice === 'live'
    ? `live (${state.oni ? state.oni.phase_label : 'unavailable'})`
    : `<strong>scenario</strong> — ${oniForRender.phase_label}`}`];
  for (const key of SCENARIO_SIGNAL_KEYS) {
    parts.push(`${key.toUpperCase()}: ${overrides[key] === 'live'
      ? `live (${state.signals?.[key] ? state.signals[key].phase : 'unavailable'})`
      : `<strong>scenario</strong> — ${SCENARIO_SIGNAL_LABEL[key][overrides[key]]}`}`);
  }
  readout.innerHTML = parts.join(' &nbsp;·&nbsp; ');

  const labelParts = [];
  if (phaseChoice !== 'live') labelParts.push(oniForRender.phase_label);
  for (const key of SCENARIO_SIGNAL_KEYS) {
    if (overrides[key] !== 'live') labelParts.push(`${key.toUpperCase()} ${SCENARIO_SIGNAL_LABEL[key][overrides[key]]}`);
  }
  const label = labelParts.join(' + ');

  status.textContent = active ? `Viewing scenario: ${label}` : 'Currently showing live data';
  status.classList.toggle('active', active);
  banner.hidden = !active;
  resetBtn.hidden = !active;
  if (active) bannerText.textContent = `Scenario mode: viewing a hypothetical ${label} — not live conditions.`;
}

function applyScenario() {
  const { phaseChoice, intensity, overrides } = readScenarioControls();

  if (phaseChoice === 'live' && SCENARIO_SIGNAL_KEYS.every(k => overrides[k] === 'live')) {
    resetScenario();
    return;
  }

  const phaseKey = phaseChoice === 'live' ? currentPhaseKeyFor(state.oni) : phaseChoice;
  const oniForRender = phaseChoice === 'live' ? state.oni : buildScenarioOni(phaseChoice, intensity);
  const signalsForRender = buildScenarioSignals(overrides, state.signals);
  const scenarioIntensity = phaseChoice !== 'live' && phaseChoice !== 'neutral' ? intensity : null;

  setScenarioUiState(phaseChoice, overrides, oniForRender);
  renderPhaseView(oniForRender, signalsForRender, phaseKey, scenarioIntensity);
}

function resetScenario() {
  document.getElementById('scenario-phase').value = 'live';
  document.getElementById('scenario-intensity').value = 'moderate';
  document.getElementById('scenario-intensity').disabled = true;
  const overrides = {};
  for (const key of SCENARIO_SIGNAL_KEYS) {
    document.getElementById(`scenario-${key}`).value = 'live';
    overrides[key] = 'live';
  }
  setScenarioUiState('live', overrides, state.oni);
  renderPhaseView(state.oni, state.signals, currentPhaseKeyFor(state.oni), null);
}

function wireScenarioControls() {
  const phaseSelect = document.getElementById('scenario-phase');
  const intensitySelect = document.getElementById('scenario-intensity');

  phaseSelect.addEventListener('change', () => {
    intensitySelect.disabled = phaseSelect.value === 'live' || phaseSelect.value === 'neutral';
  });
  document.getElementById('scenario-apply').addEventListener('click', applyScenario);
  document.getElementById('scenario-reset').addEventListener('click', resetScenario);
  document.getElementById('scenario-banner-reset').addEventListener('click', resetScenario);

  // Initialize the readout on first load, before any Apply click.
  const live = {};
  for (const key of SCENARIO_SIGNAL_KEYS) live[key] = 'live';
  setScenarioUiState('live', live, state.oni);
}

async function main() {
  const [oni, resortsData, affiliates, phaseCopy, signals, signalMetadata, backtest, climatology] = await Promise.all([
    loadOni(), loadResorts(), loadAffiliates(), loadPhaseCopy(), loadClimateSignals(),
    loadSignalMetadata(), loadBacktest(), loadClimatology(),
  ]);
  Object.assign(state, { oni, resortsData, affiliates, phaseCopy, signals, signalMetadata, backtest, climatology });

  // Rendered once and never touched again by scenario mode — these are
  // the permanent "ground truth" readouts.
  renderOniBanner(oni);
  renderOtherSignalsLine(signals);
  renderSignalInfo(signalMetadata);
  renderBacktest(backtest, resortsData);

  state.mapState = initMap(resortsData, currentPhaseKeyFor(oni), signals);
  document.getElementById('region-select').addEventListener('change', (e) => selectRegion(e.target.value));

  wireScenarioControls();
  renderPhaseView(oni, signals, currentPhaseKeyFor(oni), null);
}

main().catch(err => {
  console.error('Dashboard failed to load', err);
  document.getElementById('regions-grid').innerHTML =
    `<p style="color:#8C1A1A;padding:20px;">Failed to load dashboard data. Check the console for details.</p>`;
});
