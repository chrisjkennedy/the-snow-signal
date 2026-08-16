import { loadOni, loadResorts, loadAffiliates, loadPhaseCopy, fetchSnowpack, fetchForecast } from './data-sources.js';

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
  const liveEl = document.getElementById('hero-live');
  liveEl.innerHTML = `<span class="live-dot"></span>${phaseCopy[phaseKey].live_status}`;

  const metaEl = document.getElementById('hero-meta');
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

function renderContextStrip(oni, phaseCopy, phaseKey) {
  document.getElementById('ctx-enso-status').innerHTML = oni
    ? `<strong>${PHASE_NAME[phaseKey]}</strong> — latest ONI ${oni.latest_oni > 0 ? '+' : ''}${oni.latest_oni.toFixed(2)} (${oni.latest_season} ${oni.latest_year}), ${oni.declared_status}.`
    : 'Live data unavailable.';
  document.getElementById('ctx-mechanism').textContent = phaseCopy[phaseKey].mechanism;
  document.getElementById('ctx-freshness').textContent = oni
    ? `Snowpack and forecasts refresh on every page load. ENSO status last refreshed ${new Date(oni.updated_utc).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}.`
    : 'Live data unavailable — check back later.';
}

function resortRowSkeleton(resort, affiliates) {
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

  return `
    <div class="resort-row" id="resort-${resort.id}" data-resort="${resort.id}">
      <div class="resort-top">
        <div class="resort-name-wrap">
          <span class="resort-name">${resort.name}</span>
          <span class="resort-elev">${resort.base_elev_ft.toLocaleString()}–${resort.summit_elev_ft.toLocaleString()} ft</span>
        </div>
        <div>${passesHtml}</div>
      </div>
      <div class="live-data-row" data-live="${resort.id}">
        <span class="live-stat loading"><span class="live-dot"></span><span class="stat-label">snowpack</span><span class="stat-val">loading…</span></span>
        <span class="live-stat loading"><span class="stat-label">7-day forecast</span><span class="stat-val">loading…</span></span>
      </div>
      ${affiliateLinks}
    </div>
  `;
}

function renderRegionCard(region, rank, phaseKey, affiliates) {
  const s = region.enso_signals[phaseKey];
  const now = new Date();
  const inSeason = isInSeason(region.season.start_month, region.season.end_month, now.getMonth() + 1);
  const resortRows = region.resorts.map(r => resortRowSkeleton(r, affiliates)).join('');
  return `
    <div class="r-card" data-region-id="${region.id}">
      <div class="r-card-head">
        <div>
          <div class="r-region"><span class="rank-badge">#${rank}</span>${region.name}</div>
          <div class="r-examples">${region.resorts.map(r => r.name).join(', ')}</div>
        </div>
        <span class="signal-badge ${SIGNAL_CLASS[s.signal]}">${s.signal_label}</span>
      </div>
      <div class="r-card-body">
        <div class="season-row">
          <span class="season-tag">Season: ${region.season.display}</span>
          <span class="in-season-tag ${inSeason ? 'active' : 'inactive'}">${inSeason ? 'In season now' : 'Off-season'}</span>
        </div>
        <div class="r-meter-row">
          <span class="r-meter-label">Snow vs avg</span>
          <div class="r-meter"><div class="r-meter-fill ${METER_CLASS[s.signal]}" style="width:${s.meter_pct}%"></div></div>
          <span class="r-meter-pct">${s.meter_display}</span>
        </div>
        <p class="r-detail">${s.narrative}</p>
        <div class="r-caveat"><span class="r-caveat-icon">⚠</span>${s.caveat}</div>
        <div class="resort-list">${resortRows}</div>
      </div>
    </div>
  `;
}

function statSpan(label, value, cls) {
  return `<span class="live-stat"><span class="stat-label">${label}</span><span class="stat-val ${cls || ''}">${value}</span></span>`;
}

async function hydrateResortLiveData(resort) {
  const el = document.querySelector(`[data-live="${resort.id}"]`);
  if (!el) return;

  const triplet = resort.snotel_triplet || resort.snow_course_triplet || null;
  const [snowpack, forecast] = await Promise.all([
    triplet ? fetchSnowpack(triplet) : Promise.resolve(null),
    fetchForecast(resort.lat, resort.lon),
  ]);

  let snowpackHtml;
  if (!triplet) {
    snowpackHtml = `<span class="live-stat"><span class="stat-label">snowpack</span><span class="no-data">no nearby station</span></span>`;
  } else if (!snowpack || snowpack.pctOfMedian === null) {
    snowpackHtml = `<span class="live-stat"><span class="stat-label">snowpack</span><span class="no-data">preseason / no data</span></span>`;
  } else {
    const cls = snowpack.pctOfMedian >= 100 ? 'pos' : snowpack.pctOfMedian >= 80 ? 'neutral' : 'neg';
    snowpackHtml = statSpan('snowpack', `${snowpack.pctOfMedian}% of median (${snowpack.sweIn}" SWE, ${snowpack.date})`, cls);
  }

  let forecastHtml;
  if (!forecast) {
    forecastHtml = `<span class="live-stat"><span class="stat-label">7-day forecast</span><span class="no-data">unavailable</span></span>`;
  } else {
    const cls = forecast.totalSnowIn >= 12 ? 'pos' : forecast.totalSnowIn >= 3 ? 'neutral' : 'neg';
    forecastHtml = statSpan('7-day forecast', `${forecast.totalSnowIn}" snow · high ${Math.round(forecast.todayHighF)}°F`, cls);
  }

  el.innerHTML = snowpackHtml + forecastHtml;
}

function initMap(sortedRegions, phaseKey) {
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

  for (const region of sortedRegions) {
    const color = SIGNAL_HEX[region.enso_signals[phaseKey].signal];
    const markers = [];
    for (const resort of region.resorts) {
      const marker = L.circleMarker([resort.lat, resort.lon], {
        radius: 7, color: '#0C2340', weight: 1.5, fillColor: color, fillOpacity: 0.9,
      }).addTo(map);
      marker.bindPopup(`
        <div class="map-popup">
          <div class="mp-name">${resort.name}</div>
          <div class="mp-region">${region.name} · ${region.enso_signals[phaseKey].signal_label}</div>
          <a class="mp-link" href="#resort-${resort.id}">Jump to resort details ↓</a>
        </div>
      `);
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

function applyFilter(selectedId, mapState) {
  document.querySelectorAll('.r-card').forEach(card => {
    card.style.display = (selectedId === 'all' || card.dataset.regionId === selectedId) ? '' : 'none';
  });

  const heading = document.getElementById('regions-section-head');
  if (selectedId === 'all') {
    heading.textContent = 'Ski Regions — Ranked Most to Least Bullish';
  } else {
    const card = document.querySelector(`.r-card[data-region-id="${selectedId}"] .r-region`);
    heading.textContent = card ? `Showing: ${card.textContent.replace(/^#\d+/, '').trim()}` : 'Ski Regions';
  }

  if (!mapState.map) return;
  const bounds = [];
  for (const [regionId, markers] of Object.entries(mapState.regionMarkers)) {
    const show = selectedId === 'all' || regionId === selectedId;
    for (const marker of markers) {
      if (show) {
        if (!mapState.map.hasLayer(marker)) marker.addTo(mapState.map);
        bounds.push(marker.getLatLng());
      } else {
        mapState.map.removeLayer(marker);
      }
    }
  }
  if (bounds.length) mapState.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 7 });
}

async function main() {
  const [oni, resortsData, affiliates, phaseCopy] = await Promise.all([
    loadOni(), loadResorts(), loadAffiliates(), loadPhaseCopy(),
  ]);

  const phaseKey = oni?.phase && phaseCopy[oni.phase] ? oni.phase : 'neutral';

  renderHero(oni, phaseCopy, phaseKey);
  renderOniBanner(oni);
  renderSignalBar(oni, phaseKey);
  renderContextStrip(oni, phaseCopy, phaseKey);

  const sortedRegions = [...resortsData.regions].sort(
    (a, b) => b.enso_signals[phaseKey].meter_pct - a.enso_signals[phaseKey].meter_pct
  );

  const grid = document.getElementById('regions-grid');
  grid.innerHTML = sortedRegions.map((region, i) => renderRegionCard(region, i + 1, phaseKey, affiliates)).join('');

  const select = document.getElementById('region-select');
  select.innerHTML = `<option value="all">All regions — ranked most to least bullish</option>` +
    sortedRegions.map((r, i) => `<option value="${r.id}">#${i + 1} ${r.name} — ${r.enso_signals[phaseKey].signal_label}</option>`).join('');

  const mapState = initMap(sortedRegions, phaseKey);
  select.addEventListener('change', () => applyFilter(select.value, mapState));

  const allResorts = resortsData.regions.flatMap(r => r.resorts);
  // Fire off live-data hydration for every resort row without blocking
  // the initial render — each row resolves independently.
  for (const resort of allResorts) {
    hydrateResortLiveData(resort);
  }
}

main().catch(err => {
  console.error('Dashboard failed to load', err);
  document.getElementById('regions-grid').innerHTML =
    `<p style="color:#8C1A1A;padding:20px;">Failed to load dashboard data. Check the console for details.</p>`;
});
