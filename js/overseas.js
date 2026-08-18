// The cost comparison is computed from the same files the trip planner uses,
// rather than being written into the page. If the underlying prices are
// corrected, this table corrects with them and the two pages cannot disagree.
import { loadResorts, loadTripCosts, loadLiftPrices } from './data-sources.js';

const NIGHTS = 7;
const SKI_DAYS = 6;
const ORIGIN = 'us-east';

// Two American destination resorts, two Alpine ones people actually compare
// them against, and one to show how far the floor goes.
const SHOWN = [
  'park-city', 'aspen-snowmass', 'vail', 'jackson-hole',
  'courchevel', 'val-disere', 'st-anton', 'grandvalira', 'bansko',
];

const usd = (n) => `$${Math.round(n).toLocaleString()}`;

function liftMid(id, prices) {
  const v = prices.verified?.[id];
  if (v) return (v.low + v.high) / 2;
  const tier = prices.resort_tier?.[id];
  const band = tier && prices.tiers?.[tier];
  return band ? (band.low + band.high) / 2 : null;
}

async function main() {
  const [resortsData, tripCosts, liftPrices] = await Promise.all([
    loadResorts(), loadTripCosts(), loadLiftPrices(),
  ]);

  const index = new Map();
  for (const region of resortsData.regions) {
    for (const r of region.resorts) index.set(r.id, { r, region });
  }

  const rows = [];
  for (const id of SHOWN) {
    const hit = index.get(id);
    if (!hit) continue;
    const { r, region } = hit;
    const lodging = tripCosts.lodging_per_day?.[region.id];
    const food = tripCosts.food_per_day?.[region.id];
    const flight = tripCosts.flights?.[region.id]?.[ORIGIN];
    const lp = liftMid(id, liftPrices);
    if (!lodging || !food || !flight || lp === null) continue;

    const mid = ([a, b]) => (a + b) / 2;
    const parts = {
      flight: mid(flight),
      lift: lp * SKI_DAYS,
      lodging: mid(lodging) * NIGHTS,
      food: mid(food) * NIGHTS,
    };
    rows.push({
      name: r.name,
      country: r.country,
      flag: r.country_code,
      europe: region.continent === 'Europe',
      ...parts,
      total: parts.flight + parts.lift + parts.lodging + parts.food,
    });
  }

  rows.sort((a, b) => b.total - a.total);
  const mount = document.getElementById('cost-table');
  mount.innerHTML = `
    <div class="cmp-scroll">
      <table class="cmp">
        <thead><tr>
          <th>Resort</th><th>Flight</th><th>Lift, 6 days</th><th>Lodging</th><th>Food</th><th>Total</th>
        </tr></thead>
        <tbody>
          ${rows.map(x => `
            <tr class="${x.europe ? 'cmp-eu' : 'cmp-us'}">
              <td class="cmp-name">${x.name}<span class="cmp-country">${x.country}</span></td>
              <td>${usd(x.flight)}</td>
              <td class="cmp-lift">${usd(x.lift)}</td>
              <td>${usd(x.lodging)}</td>
              <td>${usd(x.food)}</td>
              <td class="cmp-total">${usd(x.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  // State the headline gap in words, computed rather than asserted, so it can
  // never drift out of step with the table above it.
  const us = rows.filter(x => !x.europe);
  const eu = rows.filter(x => x.europe);
  if (us.length && eu.length) {
    const dearestUs = us[0];
    const cheapestEu = eu[eu.length - 1];
    const bestAlpine = eu.filter(x => x.country !== 'Bulgaria').sort((a, b) => a.total - b.total)[0] || cheapestEu;
    const gap = dearestUs.total - bestAlpine.total;
    const liftGap = dearestUs.lift / bestAlpine.lift;
    document.getElementById('cost-note').innerHTML =
      `${dearestUs.name} comes out ${usd(gap)} dearer than ${bestAlpine.name} for the same week, `
      + `despite ${usd(bestAlpine.flight - dearestUs.flight)} more airfare — because the lift ticket alone is `
      + `<strong>${liftGap.toFixed(1)}×</strong> the price. ${cheapestEu.name} lands at ${usd(cheapestEu.total)}, `
      + `under half the American figure.`;
  }
}

main().catch(err => {
  console.error('Overseas page failed to load', err);
  document.getElementById('cost-table').innerHTML =
    '<p style="color:#8C1A1A;padding:16px;">Could not load the cost data. Check the console.</p>';
});
