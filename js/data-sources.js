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

/**
 * Latest SWE reading and % of long-term median for a SNOTEL/snow-course
 * station. Returns null if the station has no recent data (e.g. an
 * unstaffed manual course between visits) or it's off-season (median 0).
 */
export async function fetchSnowpack(triplet) {
  const url = `${AWDB_BASE}?stationTriplets=${encodeURIComponent(triplet)}` +
    `&elements=WTEQ&duration=DAILY&periodRef=END` +
    `&beginDate=${isoDaysAgo(45)}&endDate=${isoDaysAgo(0)}` +
    `&centralTendencyType=median&returnFlags=false`;
  try {
    const data = await fetchJson(url);
    const series = data?.[0]?.data?.[0]?.values ?? [];
    // Walk backward for the most recent non-null reading (manual courses
    // aren't read daily).
    for (let i = series.length - 1; i >= 0; i--) {
      const v = series[i];
      if (v.value !== null && v.value !== undefined) {
        const pct = v.median > 0 ? Math.round((v.value / v.median) * 100) : null;
        return { date: v.date, sweIn: v.value, medianIn: v.median, pctOfMedian: pct };
      }
    }
    return null;
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
