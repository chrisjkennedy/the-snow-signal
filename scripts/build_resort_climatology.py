#!/usr/bin/env python3
"""Build data/resort-climatology.json — the historical basis for resort ranking.

Two independent real-data sources, combined per resort:

1. ERA5 reanalysis (via Open-Meteo archive), 10 seasons, applied with ONE
   identical method to every resort worldwide. This is what makes
   cross-resort comparison fair. ERA5 runs on a ~25km grid, so it smooths
   sharp peaks and understates absolute totals at altitude (Vail reads
   ~132in/season vs. ~354in published) — which is exactly why the site
   uses it for RELATIVE reliability, consistency, and temperature risk,
   and never prints it as a resort's real snowfall figure.

     mean_season_snow_cm  mean core-season snowfall
     cv                   std/mean across seasons — boom-or-bust vs. metronome
     cold_day_frac        share of core-season days staying at/below 0C,
                          i.e. a direct read on rain-line vulnerability
     worst/best_season_cm the actual historical range

2. NRCS AWDB station climatology, for the ~40 resorts with a real
   SNOTEL/snow-course station nearby. These are NRCS's own long-period
   central tendencies (median peak SWE, median onset/meltout dates) —
   genuinely decades of ground truth, but only available in the western
   US and parts of Canada, which is why it supplements rather than
   replaces ERA5.

Re-runnable and incremental: existing entries are kept, only missing ones
are fetched, so an interrupted run (Open-Meteo enforces an hourly request
cap) can simply be run again later to fill the gaps.

Usage: python3 scripts/build_resort_climatology.py
"""
import json
import statistics
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESORTS = ROOT / 'data' / 'resorts.json'
OUT = ROOT / 'data' / 'resort-climatology.json'

ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data"
START, END = "2015-07-01", "2025-06-30"
SOUTHERN = {'andes', 'australia'}


def curl(url, timeout=60):
    return subprocess.run(["curl", "-fsSL", "--max-time", str(timeout), url],
                          check=True, capture_output=True, text=True).stdout


def season_bounds(region_id):
    """Core-season months + hemisphere. Southern resorts ski Jun-Sep."""
    return ((6, 9), 'south') if region_id in SOUTHERN else ((12, 3), 'north')


def fetch_era5(region_id, lat, lon, elevation_m=None):
    """Sampled at MID-MOUNTAIN elevation, not ERA5's native grid elevation.

    This matters enormously. ERA5's ~25km grid takes the average height of
    the cell, which for a mountain resort is close to the valley floor.
    Sampling Chamonix at its grid elevation (1,041m) returns 2% of winter
    days below freezing and 153cm of snow; sampling the same point
    downscaled to 2,500m returns 71% and 366cm. The first number describes
    the car park, the second describes the skiing.

    Left uncorrected this systematically punishes exactly the resorts with
    the most vertical — Chamonix, Zell am See, Mayrhofen, Bansko all looked
    like warm, unreliable places purely because their valleys are low. So
    every resort is sampled at the midpoint between its base and summit,
    which is roughly where the bulk of the skiable terrain sits.
    """
    (m_start, m_end), hemi = season_bounds(region_id)
    url = (f"{ARCHIVE}?latitude={lat}&longitude={lon}&start_date={START}&end_date={END}"
           f"&daily=snowfall_sum,temperature_2m_max&timezone=UTC")
    if elevation_m is not None:
        url += f"&elevation={int(elevation_m)}"
    data = json.loads(curl(url))
    times, snow, tmax = data['daily']['time'], data['daily']['snowfall_sum'], data['daily']['temperature_2m_max']

    seasons, cold_days, core_days = {}, 0, 0
    for t, s, tx in zip(times, snow, tmax):
        y, m = int(t[:4]), int(t[5:7])
        if hemi == 'north':
            if not (m >= m_start or m <= m_end):
                continue
            label = y if m >= m_start else y - 1
        else:
            if not (m_start <= m <= m_end):
                continue
            label = y
        seasons.setdefault(label, []).append(s or 0.0)
        core_days += 1
        if tx is not None and tx <= 0.0:
            cold_days += 1

    totals = [sum(v) for _, v in sorted(seasons.items()) if len(v) > 60]
    if len(totals) < 5:
        raise ValueError(f"only {len(totals)} usable seasons")
    mean = statistics.mean(totals)
    return {
        'sampled_elevation_m': data.get('elevation'),
        'seasons_used': len(totals),
        'mean_season_snow_cm': round(mean, 1),
        'cv': round(statistics.pstdev(totals) / mean, 3) if mean > 0 else None,
        'worst_season_cm': round(min(totals), 1),
        'best_season_cm': round(max(totals), 1),
        'cold_day_frac': round(cold_days / core_days, 3) if core_days else None,
    }


def fetch_station_climatology(triplet):
    """NRCS's own long-period central tendencies for a station."""
    url = (f"{AWDB}?stationTriplets={triplet}&elements=WTEQ&duration=DAILY&periodRef=END"
           f"&beginDate=2025-01-01&endDate=2025-01-05&centralTendencyType=median&returnFlags=false")
    se = json.loads(curl(url, 25))[0]['data'][0]
    ct = se.get('timingCentralTendencies') or {}
    peak, onset, melt = ct.get('medianPeak') or {}, ct.get('medianOnset') or {}, ct.get('medianMeltout') or {}
    if not peak.get('value'):
        raise ValueError("no median peak (record likely too short)")
    return {
        'median_peak_swe_in': peak.get('value'),
        'median_peak_date': f"{peak.get('month')}/{peak.get('day')}",
        'median_onset_date': f"{onset.get('month')}/{onset.get('day')}" if onset.get('month') else None,
        'median_meltout_date': f"{melt.get('month')}/{melt.get('day')}" if melt.get('month') else None,
        'record_begins': (se['stationElement'].get('beginDate') or '')[:4],
        'triplet': triplet,
    }


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0,
                    help="Max ERA5 fetches this run (0 = no limit). Open-Meteo enforces "
                         "an hourly cap, so use this with --sleep-after to spread a large "
                         "backfill over several hours.")
    ap.add_argument('--sleep-after', type=int, default=0,
                    help="Seconds to sleep after finishing a batch, then loop again. "
                         "Use ~3900 (65 min) to land safely on the far side of the cap.")
    ap.add_argument('--max-batches', type=int, default=1,
                    help="How many batches to run before exiting.")
    args = ap.parse_args()

    for batch in range(1, args.max_batches + 1):
        remaining = run_batch(args.limit)
        print(f"--- batch {batch}/{args.max_batches} done; {remaining} resorts still missing ERA5 ---",
              flush=True)
        if remaining == 0:
            print("All resorts have ERA5. Stopping early.")
            break
        if batch < args.max_batches and args.sleep_after:
            print(f"Sleeping {args.sleep_after}s to clear the hourly cap...", flush=True)
            time.sleep(args.sleep_after)


def run_batch(limit):
    resorts = json.loads(RESORTS.read_text())
    out = json.loads(OUT.read_text()) if OUT.exists() else {'_readme': '', 'resorts': {}}
    store = out.setdefault('resorts', {})

    targets = [(reg['id'], r) for reg in resorts['regions'] for r in reg['resorts']]
    todo_era5 = [(rid, r) for rid, r in targets if 'era5' not in store.get(r['id'], {})]
    total_missing = len(todo_era5)
    if limit:
        todo_era5 = todo_era5[:limit]
    print(f"{len(targets)} resorts; {total_missing} need ERA5; fetching {len(todo_era5)} this batch",
          flush=True)

    # Once Open-Meteo's hourly cap trips, every further call in this batch
    # fails instantly. Burning through the rest wastes the batch and floods
    # the log, so bail out after a few consecutive failures and let the
    # caller sleep off the cap instead.
    consecutive_failures = 0
    for region_id, r in todo_era5:
        entry = store.setdefault(r['id'], {'name': r['name'], 'region_id': region_id})
        try:
            mid_ft = (r['base_elev_ft'] + r['summit_elev_ft']) / 2
            mid_m = mid_ft * 0.3048
            entry['era5'] = fetch_era5(region_id, r['lat'], r['lon'], mid_m)
            e = entry['era5']
            consecutive_failures = 0
            print(f"  ERA5 {r['name'][:26]:26s} @{int(mid_m):>4}m mean={e['mean_season_snow_cm']:7.1f}cm cv={e['cv']} cold={e['cold_day_frac']}", flush=True)
        except Exception as exc:
            consecutive_failures += 1
            print(f"  ERA5 {r['name'][:26]:26s} failed ({type(exc).__name__})", flush=True)
            if consecutive_failures >= 3:
                print("  Hit the rate limit — ending this batch early.", flush=True)
                break
        time.sleep(1.5)
        OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    for region_id, r in targets:
        triplet = r.get('snotel_triplet') or r.get('snow_course_triplet')
        entry = store.setdefault(r['id'], {'name': r['name'], 'region_id': region_id})
        if not triplet or 'station' in entry:
            continue
        try:
            entry['station'] = fetch_station_climatology(triplet)
            print(f"  NRCS {r['name'][:28]:28s} peak={entry['station']['median_peak_swe_in']}in since {entry['station']['record_begins']}")
        except Exception as exc:
            print(f"  NRCS {r['name'][:28]:28s} skipped ({exc})")
        time.sleep(0.2)

    out['_readme'] = (
        "Historical climatology per resort, the basis for intra-region resort ranking. "
        "'era5' is 10 seasons of ERA5 reanalysis via Open-Meteo, computed identically for every "
        "resort worldwide so cross-resort comparison is fair; ERA5's ~25km grid smooths peaks and "
        "understates absolute snowfall at altitude, so it is used for relative reliability, "
        "year-to-year consistency (cv), and temperature/rain-line risk (cold_day_frac) — never as a "
        "resort's headline snowfall number. 'station' is NRCS AWDB's own long-period central "
        "tendency for a nearby SNOTEL/snow-course station (western US and parts of Canada only). "
        "Regenerate/extend with scripts/build_resort_climatology.py — it is incremental, so re-running "
        "only fills what is missing (Open-Meteo enforces an hourly request cap)."
    )
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")

    have_era5 = sum(1 for v in store.values() if 'era5' in v)
    have_stn = sum(1 for v in store.values() if 'station' in v)
    print(f"Wrote {OUT}  ERA5: {have_era5}/{len(targets)}   NRCS station: {have_stn}/{len(targets)}",
          flush=True)
    return len(targets) - have_era5


if __name__ == '__main__':
    main()
