#!/usr/bin/env python3.13
"""Phase 0: replace the 10-season climatology with the full ERA5 record.

The site's "typical season" figures rested on 10 seasons, which is dominated by
whatever happened in the last decade and is far too short to composite by
climate phase -- the thing the whole product claims to do. ERA5 runs from 1940,
so there are ~85 seasons available, free, for the asking.

This also pulls the local layers that were missing entirely: precipitation,
and daily max/min/mean temperature. Until now each resort had exactly one
derived snowfall number and nothing underneath it.

Designed to be interrupted. Raw daily responses are cached to data/cache (git
ignored), so re-running costs nothing for resorts already fetched and the job
can be spread over as many sittings as the rate limit demands.

  python3.13 scripts/phase0_full_history.py --limit 20 --sleep 8
"""
import argparse, json, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESORTS = ROOT / 'data' / 'resorts.json'
CACHE = ROOT / 'data' / 'cache'
OUT = ROOT / 'data' / 'resort-seasons.json'
ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
START, END = '1940-01-01', '2025-12-31'
DAILY = 'snowfall_sum,precipitation_sum,temperature_2m_max,temperature_2m_min,temperature_2m_mean'

SOUTHERN = {'andes', 'australia', 'new-zealand'}


def curl(url):
    r = subprocess.run(['curl', '-sS', '--max-time', '180', url],
                       capture_output=True, text=True, check=True)
    return r.stdout


def fetch_resort(resort, mid_m):
    cache = CACHE / f"{resort['id']}.json"
    if cache.exists():
        return json.loads(cache.read_text()), True
    url = (f"{ARCHIVE}?latitude={resort['lat']}&longitude={resort['lon']}"
           f"&start_date={START}&end_date={END}&daily={DAILY}"
           f"&elevation={int(mid_m)}&timezone=UTC")
    data = json.loads(curl(url))
    if 'daily' not in data:
        raise ValueError(data.get('reason', 'no daily block'))
    cache.write_text(json.dumps(data))
    return data, False


def seasonal(data, region_id):
    """Aggregate daily rows into one record per season.

    Kept as per-season aggregates rather than raw days: 127 resorts x 86
    seasons is ~11k rows, which is small enough to ship and is the unit the
    composite analysis actually needs.
    """
    south = region_id in SOUTHERN
    months = (6, 7, 8, 9, 10) if south else (11, 12, 1, 2, 3, 4)
    d = data['daily']
    acc = {}
    for i, t in enumerate(d['time']):
        y, m = int(t[:4]), int(t[5:7])
        if m not in months:
            continue
        # Northern seasons span the new year and are labelled by their start year.
        label = y if (south or m >= 11) else y - 1
        a = acc.setdefault(label, {'snow_cm': 0.0, 'precip_mm': 0.0, 'days': 0,
                                   'cold_days': 0, 'tmean_sum': 0.0, 'tmean_n': 0,
                                   'wet_days': 0, 'rain_days': 0})
        sn = d['snowfall_sum'][i]
        pr = d['precipitation_sum'][i]
        tx = d['temperature_2m_max'][i]
        tm = d['temperature_2m_mean'][i]
        a['days'] += 1
        if sn is not None:
            a['snow_cm'] += sn
        if pr is not None:
            a['precip_mm'] += pr
            if pr >= 1.0:
                a['wet_days'] += 1
                # Precipitation on a day whose max stayed above freezing is the
                # rain-on-snow risk the site has never been able to measure.
                if tx is not None and tx > 2.0:
                    a['rain_days'] += 1
        if tx is not None and tx <= 0.0:
            a['cold_days'] += 1
        if tm is not None:
            a['tmean_sum'] += tm
            a['tmean_n'] += 1

    out = []
    for label in sorted(acc):
        a = acc[label]
        # The record starts 1 Jan 1940, so the first northern "season" holds only
        # Jan-Apr and would score far too low on total snowfall. Demand nearly a
        # full season rather than a fixed day count, which differs by hemisphere.
        if a['days'] < 0.9 * len(months) * 30:
            continue
        out.append({
            'season': label,
            'snow_cm': round(a['snow_cm'], 1),
            'precip_mm': round(a['precip_mm'], 1),
            'cold_day_frac': round(a['cold_days'] / a['days'], 3),
            'tmean_c': round(a['tmean_sum'] / a['tmean_n'], 2) if a['tmean_n'] else None,
            'wet_days': a['wet_days'],
            'rain_risk_days': a['rain_days'],
            'days': a['days'],
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='resorts to fetch this run')
    ap.add_argument('--sleep', type=float, default=8.0, help='seconds between requests')
    args = ap.parse_args()

    CACHE.mkdir(parents=True, exist_ok=True)
    resorts = json.loads(RESORTS.read_text())
    store = json.loads(OUT.read_text())['resorts'] if OUT.exists() else {}

    targets = [(reg['id'], r) for reg in resorts['regions'] for r in reg['resorts']]
    todo = [(rid, r) for rid, r in targets if r['id'] not in store]
    print(f'{len(targets)} resorts, {len(todo)} still to fetch', flush=True)
    if args.limit:
        todo = todo[:args.limit]

    fails = 0
    for region_id, r in todo:
        mid_m = ((r['base_elev_ft'] + r['summit_elev_ft']) / 2) * 0.3048
        cached = False
        try:
            data, cached = fetch_resort(r, mid_m)
            rows = seasonal(data, region_id)
            store[r['id']] = {'name': r['name'], 'region_id': region_id,
                              'sampled_elevation_m': data.get('elevation'),
                              'seasons': rows}
            fails = 0
            print(f"  {r['name'][:26]:26s} {len(rows):3d} seasons "
                  f"{rows[0]['season']}-{rows[-1]['season']}{'  (cached)' if cached else ''}", flush=True)
        except Exception as exc:
            fails += 1
            print(f"  {r['name'][:26]:26s} FAILED {type(exc).__name__}: {exc}", flush=True)
            if fails >= 3:
                print('  three failures in a row -- stopping so the cap can clear', flush=True)
                break
        if not cached:
            time.sleep(args.sleep)

    OUT.write_text(json.dumps({
        '_readme': ('Full ERA5 record per resort, one row per season, sampled at mid-mountain. '
                    'Replaces the 10-season climatology and adds the precipitation and '
                    'temperature layers the site previously lacked. rain_risk_days counts '
                    'wet days whose max temperature exceeded 2C -- rain-on-snow, not snowfall.'),
        'source': f'ERA5 via Open-Meteo archive, {START} to {END}',
        'resorts': store,
    }, indent=2, ensure_ascii=False) + '\n')

    done = len(store)
    tot = sum(len(v['seasons']) for v in store.values())
    print(f'\n{done}/{len(targets)} resorts stored, {tot} season-records total', flush=True)
    return 0 if done == len(targets) else 1


if __name__ == '__main__':
    sys.exit(main())
