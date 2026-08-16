// Live data fetchers. Everything here runs in the browser — no backend,
// no API keys. Two sources are used:
//   - NRCS AWDB (SNOTEL / manual snow courses) for % of median snowpack
//   - Open-Meteo for 7-day snowfall forecast
// NOAA's ONI/ENSO index is NOT fetched here — NOAA doesn't send CORS
// headers on that endpoint, so it's pulled server-side by
// scripts/update_oni.py into data/oni.json instead, and just read as a
// static file below.

const AWDB_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data";
const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** US water year starts Oct 1 — used as the start of the season-to-date chart. */
function waterYearStart() {
  const d = new Date();
  const year = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1; // month 9 = Oct
  return `${year}-10-01`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function loadOni() {
  // no-store: this file changes monthly and is the whole basis for which
  // phase's content the page shows, so a stale cached copy would mean
  // showing the wrong season's guidance.
  try {
    const res = await fetch("./data/oni.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn("ONI data unavailable", e);
    return null;
  }
}

export async function loadResorts() {
  return fetchJson("./data/resorts.json");
}

export async function loadAffiliates() {
  return fetchJson("./data/affiliates.json");
}

export async function loadPhaseCopy() {
  return fetchJson("./data/phase-copy.json");
}

export async function loadBacktest() {
  try {
    return await fetchJson("./data/backtest-2025-26.json");
  } catch (e) {
    console.warn("Backtest data unavailable", e);
    return null;
  }
}

export async function loadSignalMetadata() {
  return fetchJson("./data/signal-metadata.json");
}

export async function loadClimateSignals() {
  try {
    const res = await fetch("./data/climate-signals.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    console.warn("Climate signals (NAO/AO/PDO) unavailable", e);
    return null;
  }
}

/**
 * Season-to-date SWE for a SNOTEL/snow-course station: the latest reading
 * (walking backward for the most recent non-null value, since manual
 * courses aren't read daily) plus the full water-year series for a
 * historical-context sparkline. One API call covers both, rather than a
 * separate short-window call for "latest" and a long-window call for the
 * chart — with ~40 stations queried on every page load, halving the
 * request count matters.
 */
export async function fetchSnowpack(triplet) {
  const url = `${AWDB_BASE}?stationTriplets=${encodeURIComponent(triplet)}` +
    `&elements=WTEQ&duration=DAILY&periodRef=END` +
    `&beginDate=${waterYearStart()}&endDate=${isoDaysAgo(0)}` +
    `&centralTendencyType=median&returnFlags=false`;
  try {
    const data = await fetchJson(url);
    const series = (data?.[0]?.data?.[0]?.values ?? [])
      .filter(v => v.value !== null && v.value !== undefined);
    if (!series.length) return null;
    const latest = series[series.length - 1];
    const pct = latest.median > 0 ? Math.round((latest.value / latest.median) * 100) : null;
    return {
      date: latest.date, sweIn: latest.value, medianIn: latest.median, pctOfMedian: pct,
      series: series.map(v => ({ date: v.date, value: v.value, median: v.median })),
    };
  } catch (e) {
    console.warn(`SNOTEL fetch failed for ${triplet}`, e);
    return null;
  }
}

/**
 * 7-day forward snowfall total (inches) plus today's high temp, from
 * Open-Meteo. Works for any lat/lon worldwide, no key required.
 */
export async function fetchForecast(lat, lon) {
  const url = `${OPEN_METEO_BASE}?latitude=${lat}&longitude=${lon}` +
    `&daily=snowfall_sum,temperature_2m_max,temperature_2m_min` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch` +
    `&timezone=auto&forecast_days=7`;
  try {
    const data = await fetchJson(url);
    const days = data?.daily;
    if (!days) return null;
    const totalSnowIn = days.snowfall_sum.reduce((a, b) => a + (b || 0), 0);
    return {
      totalSnowIn: Math.round(totalSnowIn * 10) / 10,
      todayHighF: days.temperature_2m_max[0],
      todayLowF: days.temperature_2m_min[0],
      days: days.time.map((date, i) => ({
        date,
        snowIn: days.snowfall_sum[i],
        highF: days.temperature_2m_max[i],
        lowF: days.temperature_2m_min[i],
      })),
    };
  } catch (e) {
    console.warn(`Forecast fetch failed for ${lat},${lon}`, e);
    return null;
  }
}
