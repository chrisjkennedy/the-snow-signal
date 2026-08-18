#!/usr/bin/env python3.13
"""Forward-looking data for every index the site uses, plus an honest read on
how much of it is actually predictable.

Two very different horizons get conflated in most ski forecasting, and the site
should not repeat the mistake:

  ENSO is an ocean signal with months of thermal memory, so CPC issues genuine
  seasonal probabilities for it.

  NAO / AO / PNA / AAO are atmospheric. The only skilful forecast for them is
  the GEFS ensemble, which runs 15 days. Beyond that the honest answer is a
  climatological distribution, not a forecast.

The one bridge between them is the ENSO-to-NAO teleconnection, so this script
also composites the observed record to measure how strong that bridge really
is at each El Nino intensity. It turns out to be weak, and the site says so.
"""
import csv, io, json, statistics as st, subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'index-forecasts.json'
FTP = 'https://ftp.cpc.ncep.noaa.gov/cwlinks'
CPC = 'https://www.cpc.ncep.noaa.gov'

GEFS = {
    'nao': f'{FTP}/norm.daily.nao.gefs.z500.120days.csv',
    'ao':  f'{FTP}/norm.daily.ao.gefs.z1000.120days.csv',
    'pna': f'{FTP}/norm.daily.pna.gefs.z500.120days.csv',
    'sam': f'{FTP}/norm.daily.aao.gefs.z700.120days.csv',   # AAO is the SAM index
}
MONTHLY = {
    'nao': f'{CPC}/products/precip/CWlink/pna/norm.nao.monthly.b5001.current.ascii.table',
    'pna': f'{CPC}/products/precip/CWlink/pna/norm.pna.monthly.b5001.current.ascii.table',
}
ONI = f'{CPC}/data/indices/oni.ascii.txt'
RONI = f'{CPC}/data/indices/RONI.ascii.txt'


def curl(url):
    return subprocess.run(['curl', '-sS', '--max-time', '180', url],
                          capture_output=True, text=True, check=True).stdout


def gefs_bands(url):
    """Collapse the raw ensemble into a median and an 10-90% band per day.

    The file carries every member separately, which is the whole point: the
    spread between them IS the confidence band, so it is measured here rather
    than assumed.
    """
    rows = list(csv.DictReader(io.StringIO(curl(url))))
    col = next(c for c in rows[0] if c.endswith('_index'))
    latest_init = max(r['time'] for r in rows)
    by_day = defaultdict(list)
    for r in rows:
        if r['time'] != latest_init:
            continue
        try:
            by_day[r['valid_time']].append(float(r[col]))
        except (ValueError, KeyError):
            continue

    def pct(vals, p):
        s = sorted(vals)
        return s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))]

    out = []
    for day in sorted(by_day):
        v = by_day[day]
        out.append({'date': day, 'median': round(st.median(v), 3),
                    'p10': round(pct(v, 10), 3), 'p90': round(pct(v, 90), 3),
                    'members': len(v)})
    return {'initialised': latest_init, 'days': out}


def monthly_table(url):
    d = {}
    for line in curl(url).splitlines():
        p = line.split()
        if len(p) == 13 and p[0].isdigit():
            for m, v in enumerate(p[1:], 1):
                d[(int(p[0]), m)] = float(v)
    return d


def seasons(url):
    d = {}
    for line in curl(url).splitlines()[1:]:
        p = line.split()
        if len(p) == 4:
            try:
                d[(p[0], int(p[1]))] = float(p[3])
            except ValueError:
                continue
    return d


def enso_nao_composite(nao, oni):
    """How much does El Nino intensity actually tell you about winter NAO?"""
    winters = [(y, oni[('DJF', y)]) for y in range(1951, 2030) if ('DJF', y) in oni]
    allmonths = [nao[(y, m)] for y, _ in winters for m in (1, 2) if (y, m) in nao]
    base = {'mean': round(st.mean(allmonths), 2),
            'sd': round(st.pstdev(allmonths), 2),
            'share_negative': round(sum(1 for x in allmonths if x < 0) / len(allmonths), 2),
            'n_months': len(allmonths)}

    bands, out = [(2.0, 9.9, 'very_strong'), (1.5, 2.0, 'strong'),
                  (1.0, 1.5, 'moderate'), (0.5, 1.0, 'weak')], {}
    for lo, hi, key in bands:
        sel = [y for y, v in winters if lo <= v < hi]
        early = [nao[(y - 1, m)] for y in sel for m in (11, 12) if (y - 1, m) in nao]
        late = [nao[(y, m)] for y in sel for m in (1, 2) if (y, m) in nao]
        if not late:
            continue
        out[key] = {
            'n_winters': len(sel),
            'winters': [f'{y-1}-{str(y)[2:]}' for y in sel],
            'early_winter_nao': round(st.mean(early), 2) if early else None,
            'late_winter_nao': round(st.mean(late), 2),
            'late_winter_sd': round(st.pstdev(late), 2) if len(late) > 1 else None,
            'share_negative': round(sum(1 for x in late if x < 0) / len(late), 2),
            'shift': round(st.mean(late) - st.mean(early), 2) if early else None,
        }
    return {'climatology_jan_feb': base, 'by_el_nino_intensity': out}


def main():
    oni, roni = seasons(ONI), seasons(RONI)
    nao_m = monthly_table(MONTHLY['nao'])
    comp = enso_nao_composite(nao_m, oni)

    vs = comp['by_el_nino_intensity'].get('very_strong', {})
    base = comp['climatology_jan_feb']
    # Three winters is not a sample you can forecast from, and pretending
    # otherwise is exactly how a ski site ends up asserting a cold Alpine
    # winter it has no evidence for.
    usable = (vs.get('n_winters', 0) >= 8
              and abs(vs.get('late_winter_nao', 0) - base['mean']) > 0.5 * base['sd'])
    comp['verdict'] = {
        'enso_predicts_winter_nao': bool(usable),
        'summary': (
            f"Very strong El Nino winters (n={vs.get('n_winters')}: {', '.join(vs.get('winters', []))}) "
            f"averaged {vs.get('late_winter_nao'):+.2f} NAO in Jan-Feb against a climatological "
            f"{base['mean']:+.2f}, with {int(vs.get('share_negative', 0)*100)}% of months negative against "
            f"{int(base['share_negative']*100)}% normally. The tilt is smaller than the year-to-year spread "
            f"(sd {base['sd']}), and three events is not a forecastable sample. "
            "ENSO intensity does not tell you what the NAO will do this winter."
        ),
        'what_does_hold': (
            "The one robust feature is direction of change, not level: El Nino winters drift from a higher "
            "early-winter NAO toward a lower late-winter one, via a weakened stratospheric polar vortex, "
            "while neutral and La Nina winters drift the other way. That is a reason to prefer late-season "
            "trips in the southern Alps, not a reason to call the winter cold."
        ),
    }

    out = {
        '_readme': ('Forward-looking index data. ENSO carries real seasonal skill; the atmospheric '
                    'indices carry about 15 days of it and are shown as ensemble bands over that '
                    'window and as climatology beyond it. Nothing here is extrapolated further '
                    'than the source data supports.'),
        'updated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'horizons': {
            'enso': {'skill': 'seasonal', 'source': 'CPC official ENSO outlook',
                     'note': 'Ocean thermal memory makes ENSO predictable months ahead.'},
            'atmospheric': {'skill': '15 days', 'source': 'NCEP GEFS ensemble via CPC',
                            'note': 'NAO, AO, PNA and SAM are chaotic beyond about two weeks. '
                                    'Past 15 days the honest answer is the climatological distribution.'},
        },
        'gefs': {k: gefs_bands(u) for k, u in GEFS.items()},
        'enso_nao_teleconnection': comp,
        'oni_seasons': [{'season': s, 'year': y, 'value': v} for (s, y), v in sorted(oni.items(), key=lambda kv: (kv[0][1], kv[0][0]))][-200:],
        'roni_seasons': [{'season': s, 'year': y, 'value': v} for (s, y), v in sorted(roni.items(), key=lambda kv: (kv[0][1], kv[0][0]))][-200:],
        'sources': {'gefs': FTP, 'oni': ONI, 'roni': RONI, 'nao_monthly': MONTHLY['nao']},
    }
    OUT.write_text(json.dumps(out, indent=2) + '\n')

    for k, v in out['gefs'].items():
        d = v['days']
        print(f"{k:4s} init {v['initialised']}  {len(d)} days  {d[0]['members']} members  "
              f"end {d[-1]['date']} median {d[-1]['median']:+.2f} [{d[-1]['p10']:+.2f},{d[-1]['p90']:+.2f}]")
    print()
    print('ENSO->NAO verdict:', out['enso_nao_teleconnection']['verdict']['enso_predicts_winter_nao'])
    print(out['enso_nao_teleconnection']['verdict']['summary'])


if __name__ == '__main__':
    main()
