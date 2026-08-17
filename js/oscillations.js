import { loadSignalMetadata, loadClimateSignals, loadOni } from './data-sources.js';

const ORDER = ['oni', 'mjo', 'nao', 'ao', 'pna', 'pdo', 'sam', 'iod'];

function primerHtml(p) {
  if (!p) return '';
  return `
    <div class="primer">
      <h2 class="primer-title">${p.title}</h2>
      ${p.paragraphs.map(t => `<p class="primer-p">${t}</p>`).join('')}
      <div class="primer-families">
        ${p.families.map(f => `
          <div class="primer-family ${f.label.startsWith('Ocean') ? 'fam-ocean-box' : 'fam-atmos-box'}">
            <div class="primer-family-label">${f.label}</div>
            <div class="primer-family-members">${f.members}</div>
            <p class="primer-family-text">${f.text}</p>
          </div>
        `).join('')}
      </div>
      <p class="primer-p">${p.closing}</p>
      <div class="ladder">
        <div class="ladder-title">Timescale ladder — fastest to slowest</div>
        ${p.timescale_ladder.map(t => `
          <div class="ladder-row">
            <span class="ladder-sig">${t.signal}</span>
            <span class="ladder-span">${t.span}</span>
            <span class="ladder-note">${t.note}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function panelHtml(key, s, live) {
  const liveLine = live
    ? `<div class="osc-live">
         <span class="osc-live-label">Live now</span>
         <span class="osc-live-val">${live.phase}${
           live.latest_value !== undefined && key !== 'mjo'
             ? ` (${live.latest_value > 0 ? '+' : ''}${live.latest_value.toFixed(2)})` : ''
         }${key === 'mjo' && live.amplitude !== undefined ? ` (amplitude ${live.amplitude.toFixed(2)})` : ''}</span>
         <span class="osc-live-when">${live.latest_label || ''}</span>
       </div>`
    : '';

  return `
    <div class="osc-panel" data-panel="${key}">
      <div class="osc-head">
        <h3 class="osc-name">${s.name}</h3>
        <span class="sig-family ${s.family?.startsWith('Ocean') ? 'fam-ocean' : 'fam-atmos'}">${s.family}</span>
      </div>
      ${liveLine}

      <div class="osc-grid">
        <div class="osc-block">
          <span class="sig-field-label">What it is</span>
          <p>${s.what_it_is}</p>
        </div>
        <div class="osc-block">
          <span class="sig-field-label">Who it affects</span>
          <p>${s.regions_affected}</p>
        </div>
      </div>

      <div class="sig-phases">
        <div class="sig-phase sig-phase-pos">
          <div class="sig-phase-label">${s.positive_label}</div>
          <div class="sig-phase-text">${s.positive_effect}</div>
        </div>
        <div class="sig-phase sig-phase-neg">
          <div class="sig-phase-label">${s.negative_label}</div>
          <div class="sig-phase-text">${s.negative_effect}</div>
        </div>
      </div>

      <div class="osc-grid">
        <div class="osc-block">
          <span class="sig-field-label">Timescale</span>
          <p>${s.timescale}</p>
        </div>
        <div class="osc-block">
          <span class="sig-field-label">Updates</span>
          <p>${s.update_frequency}<span class="osc-sub">${s.latency}</span></p>
        </div>
      </div>

      <div class="osc-block osc-horizon">
        <span class="sig-field-label">How far ahead it's worth anything — ${s.horizon_short}</span>
        <p>${s.horizon_detail}</p>
      </div>
    </div>
  `;
}

function selectTab(key) {
  document.querySelectorAll('#osc-tabs button').forEach(b => {
    const on = b.dataset.tab === key;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.osc-panel').forEach(p => {
    p.hidden = p.dataset.panel !== key;
  });
  if (location.hash.slice(1) !== key) history.replaceState(null, '', `#${key}`);
}

async function main() {
  const [meta, signals, oni] = await Promise.all([loadSignalMetadata(), loadClimateSignals(), loadOni()]);
  // ONI lives in its own file (different update script), so fold it into
  // the same shape the other signals use before rendering.
  const live = { ...(signals || {}) };
  if (oni) {
    live.oni = {
      phase: oni.phase_label,
      latest_value: oni.latest_oni,
      latest_label: `${oni.latest_season} ${oni.latest_year}`,
    };
  }
  if (!meta) {
    document.getElementById('osc-panel').innerHTML = '<p class="bt-note">Signal reference unavailable.</p>';
    return;
  }

  document.getElementById('primer-mount').innerHTML = primerHtml(meta._primer);

  const keys = ORDER.filter(k => meta[k]);
  document.getElementById('osc-tabs').innerHTML = keys.map(k => `
    <button type="button" role="tab" data-tab="${k}" aria-selected="false">
      ${meta[k].short_name || k.toUpperCase()}
    </button>
  `).join('');
  document.getElementById('osc-panel').innerHTML =
    keys.map(k => panelHtml(k, meta[k], live[k])).join('');

  document.querySelectorAll('#osc-tabs button').forEach(b => {
    b.addEventListener('click', () => selectTab(b.dataset.tab));
  });

  // Deep-linkable: /oscillations.html#sam opens SAM directly, which is what
  // the season planner links to when a signal chip is clicked.
  const fromHash = location.hash.slice(1);
  selectTab(keys.includes(fromHash) ? fromHash : keys[0]);
}

main().catch(err => {
  console.error('Oscillations page failed to load', err);
  document.getElementById('osc-panel').innerHTML =
    '<p style="color:#8C1A1A;padding:20px;">Failed to load signal reference. Check the console.</p>';
});
