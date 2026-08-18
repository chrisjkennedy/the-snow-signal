#!/usr/bin/env python3.13
"""Phase 0 via Copernicus: the full ERA5-Land record for every resort.

The Open-Meteo route worked but its free daily quota allowed roughly eight
resorts a day, so 127 would have taken a fortnight. CDS is the better source
anyway: ERA5-Land is 9km rather than 31km, which matters enormously for
mountains -- ERA5's smoothed orography is what put Coronet Peak at 392m when
the mid-mountain is 1,412m.

It is also a far better fit for bulk. Rather than 127 point requests, this asks
for one gridded box per region and extracts every resort in it locally, so the
whole job is 16 requests instead of 127.

Resumable: each box is cached as NetCDF under data/cache/cds, and re-running
skips whatever already downloaded.

    python3.13 scripts/phase0_cds.py            # all boxes
    python3.13 scripts/phase0_cds.py --only european-alps
"""
import argparse, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESORTS = ROOT / 'data' / 'resorts.json'
CACHE = ROOT / 'data' / 'cache' / 'cds'
OUT = ROOT / 'data' / 'resort-seasons-era5land.json'

DATASET = 'reanalysis-era5-land-monthly-means'
VARIABLES = ['2m_temperature', 'total_precipitation', 'snowfall', 'snow_depth_water_equivalent']
YEARS = [str(y) for y in range(1950, 2026)]
MONTHS = [f'{m:02d}' for m in range(1, 13)]

SOUTHERN = {'andes', 'australia', 'new-zealand'}


def boxes_from_resorts(resorts):
    """One bounding box per region, padded so every resort has grid cells around it."""
    out = {}
    for region in resorts['regions']:
        lats = [r['lat'] for r in region['resorts']]
        lons = [r['lon'] for r in region['resorts']]
        out[region['id']] = [round(max(lats) + 0.5, 2), round(min(lons) - 0.5, 2),
                             round(min(lats) - 0.5, 2), round(max(lons) + 0.5, 2)]
    return out


def download(client, region_id, area):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / f'{region_id}.nc'
    if target.exists() and target.stat().st_size > 10_000:
        return target, True
    client.retrieve(DATASET, {
        'product_type': ['monthly_averaged_reanalysis'],
        'variable': VARIABLES,
        'year': YEARS,
        'month': MONTHS,
        'time': ['00:00'],
        'area': area,
        'data_format': 'netcdf',
        'download_format': 'unarchived',
    }, str(target))
    return target, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='single region id')
    args = ap.parse_args()

    import cdsapi
    resorts = json.loads(RESORTS.read_text())
    areas = boxes_from_resorts(resorts)
    if args.only:
        areas = {args.only: areas[args.only]}

    client = cdsapi.Client(quiet=True, progress=False)
    for region_id, area in areas.items():
        try:
            path, cached = download(client, region_id, area)
            mb = path.stat().st_size / 1e6
            print(f'  {region_id:24s} {mb:8.1f} MB{"  (cached)" if cached else ""}', flush=True)
        except Exception as exc:
            print(f'  {region_id:24s} FAILED {type(exc).__name__}: {str(exc)[:160]}', flush=True)

    have = sorted(p.stem for p in CACHE.glob('*.nc'))
    print(f'\n{len(have)}/{len(boxes_from_resorts(resorts))} region boxes downloaded', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
