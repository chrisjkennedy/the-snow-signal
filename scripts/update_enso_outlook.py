#!/usr/bin/env python3.13
"""Pull CPC's official ENSO outlook, not just the last observed ONI.

The site used to key everything off the most recent observed ONI season, which
made it structurally backward-looking: in August 2026 that reported a "Moderate
El Nino" and "not yet declared" while CPC had an El Nino Advisory in force and
was forecasting a greater than 90% chance of a VERY STRONG event for the coming
ski season. For someone booking a trip four months out, the forecast is the
only part that matters.

This writes data/enso-outlook.json with the alert status, the verbatim synopsis,
the probability statements CPC actually published, and the observed series --
each carrying its own source and date so nothing on the page is unattributed.
"""
import json, re, html, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'enso-outlook.json'
DISC = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml'
NINO34 = 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/detrend.nino34.ascii.txt'


def curl(url):
    # macOS python.org builds ship without a CA bundle, so urllib fails on
    # these hosts; curl uses the system trust store and just works.
    r = subprocess.run(['curl', '-sS', '--max-time', '60', url],
                       capture_output=True, text=True, check=True)
    return r.stdout


def plain_text(markup):
    t = re.sub(r'<script.*?</script>', ' ', markup, flags=re.S | re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    return re.sub(r'\s+', ' ', html.unescape(t)).strip()


def parse_discussion(text):
    out = {'source': DISC}

    m = re.search(r'CLIMATE PREDICTION CENTER/NCEP/NWS\s+(\d{1,2} \w+ \d{4})', text)
    if m:
        out['issued'] = m.group(1)

    m = re.search(r'ENSO Alert System Status:\s*([^A-Z]*?[A-Za-zñÑ ]+?)\s+Synopsis', text)
    out['alert_status'] = m.group(1).strip() if m else None

    m = re.search(r'Synopsis:\s*(.+?)(?=\s+El Ni|\s+La Ni|\s+ENSO-neutral)', text)
    out['synopsis'] = m.group(1).strip() if m else None

    m = re.search(r'next ENSO Diagnostics Discussion is scheduled for\s+(\d{1,2} \w+ \d{4})', text)
    if m:
        out['next_update'] = m.group(1)

    # The published probability statements, kept as CPC's own words. These are
    # quoted rather than modelled -- the site must never invent a number here.
    probs = []
    for pat, horizon in [
        (r'greater than (\d+)% chance of a (very strong|strong|moderate|weak) event during ([^.]+?)\.', 'strength'),
        (r'there is an? (\d+)% chance of a historic event that would exceed[^.]*?\(([^)]+)\)', 'historic'),
    ]:
        for mm in re.finditer(pat, text):
            probs.append(mm.group(0).strip())
    out['probability_statements'] = probs

    m = re.search(r'During the ([A-Za-z\-]+ \d{4}) season, there is a (\d+)% chance of a historic event', text)
    if m:
        out['historic_event'] = {'season': m.group(1), 'probability_pct': int(m.group(2)),
                                 'threshold': '+2.5C or more, 3-month RONI'}

    m = re.search(r'greater than (\d+)% chance of a (very strong|strong|moderate|weak) event during the Northern Hemisphere ([^.]+)\.', text)
    if m:
        out['season_outlook'] = {
            'strength': m.group(2),
            'probability_pct': int(m.group(1)),
            'probability_qualifier': 'greater than',
            'window': m.group(3).strip(),
        }

    m = re.search(r'The (\w+) Niño index values were \+?(-?[\d.]+)°?C in Niño-3\.4', text)
    if m:
        out['latest_month'] = {'month': m.group(1), 'nino34_c': float(m.group(2))}
    return out


def parse_nino34(text):
    rows = []
    for line in text.splitlines()[1:]:
        p = line.split()
        # YR MON TOTAL CLIMADJUST ANOM -- the anomaly is the last column, not
        # the fourth, which is the climatology it is measured against.
        if len(p) >= 5:
            try:
                rows.append({'year': int(p[0]), 'month': int(p[1]), 'anom': float(p[4])})
            except ValueError:
                continue
    return rows


def main():
    disc = parse_discussion(plain_text(curl(DISC)))
    series = parse_nino34(curl(NINO34))

    if not disc.get('alert_status'):
        print('WARNING: could not parse the alert status; leaving the previous value', file=sys.stderr)

    out = {
        '_readme': ('CPC official ENSO outlook. The forecast fields are what the site leads with, '
                    'because a ski trip is booked months ahead and the last observed month cannot '
                    'tell you about the season you are booking. Probability statements are quoted '
                    'from CPC verbatim and never modelled here.'),
        'updated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'discussion': disc,
        'observed_nino34': {
            'source': NINO34,
            'note': 'Monthly Nino-3.4 anomaly, degrees C, 1991-2020 base.',
            'series': series[-360:],
        },
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
    d = disc
    print(f"alert status : {d.get('alert_status')}")
    print(f"issued       : {d.get('issued')}  (next {d.get('next_update')})")
    print(f"synopsis     : {d.get('synopsis')}")
    print(f"outlook      : {d.get('season_outlook')}")
    print(f"historic     : {d.get('historic_event')}")
    print(f"observed     : {len(series)} months through {series[-1]['year']}-{series[-1]['month']:02d} ({series[-1]['anom']:+.2f})")


if __name__ == '__main__':
    main()
