#!/usr/bin/env python3
"""Refresh data/climate-signals.json with NAO, AO, and PDO.

Companion to update_oni.py — same reasoning applies (NOAA/NCEI don't send
CORS headers, so these are fetched server-side, not from the browser).
These three are secondary signals layered on top of ENSO: NAO drives the
Northeast US and Europe more than ENSO does, AO/polar-vortex state explains
cold-air outbreaks in any region, and PDO modulates how strongly a given
ENSO phase actually shows up on the West Coast. Run monthly alongside
update_oni.py.

Usage: python3 scripts/update_signals.py
"""
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

NAO_URL = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/norm.nao.monthly.b5001.current.ascii"
AO_URL = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/monthly.ao.index.b50.current.ascii"
PDO_URL = "https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat"
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "climate-signals.json"

MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def curl(url):
    return subprocess.run(
        ["curl", "-fsSL", url], check=True, capture_output=True, text=True, timeout=20,
    ).stdout


def parse_cpc_monthly(text):
    """Parses the 'YYYY MM value' format used by both NAO and AO CPC files."""
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 3:
            continue
        try:
            year, month, value = int(parts[0]), int(parts[1]), float(parts[2])
        except ValueError:
            continue
        rows.append({"year": year, "month": month, "value": value})
    return rows


def parse_pdo(text):
    """NCEI PDO format: one row per year, 12 monthly values, 99.99 = missing."""
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 13 or not parts[0].isdigit():
            continue
        year = int(parts[0])
        for i, raw in enumerate(parts[1:], start=1):
            val = float(raw)
            if val > 90:  # sentinel for not-yet-computed months
                continue
            rows.append({"year": year, "month": i, "value": val})
    return rows


def latest_with_trend(rows, negative_label, positive_label, neutral_band=0.3):
    rows = sorted(rows, key=lambda r: (r["year"], r["month"]))
    latest = rows[-1]
    previous = rows[-2] if len(rows) > 1 else None
    if latest["value"] >= neutral_band:
        phase = positive_label
    elif latest["value"] <= -neutral_band:
        phase = negative_label
    else:
        phase = "Neutral"
    trend = "steady"
    if previous is not None:
        delta = latest["value"] - previous["value"]
        trend = "rising" if delta >= 0.2 else "falling" if delta <= -0.2 else "steady"
    return {
        "latest_year": latest["year"],
        "latest_month": latest["month"],
        "latest_label": f"{MONTH_NAMES[latest['month']]} {latest['year']}",
        "latest_value": round(latest["value"], 2),
        "phase": phase,
        "trend": trend,
        "recent": rows[-8:],
    }


def main():
    nao_rows = parse_cpc_monthly(curl(NAO_URL))
    ao_rows = parse_cpc_monthly(curl(AO_URL))
    pdo_rows = parse_pdo(curl(PDO_URL))

    if not nao_rows or not ao_rows or not pdo_rows:
        raise SystemExit("One or more signal feeds returned no parseable rows — source format may have changed")

    out = {
        "updated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "nao": {**latest_with_trend(nao_rows, "Negative", "Positive"),
                "source": NAO_URL,
                "relevance": "Negative NAO favors cold, stormy patterns in the Northeast US and northern Europe; positive NAO favors mild, blocked-ridge patterns in the same regions."},
        "ao": {**latest_with_trend(ao_rows, "Negative", "Positive"),
               "source": AO_URL,
               "relevance": "Negative AO indicates a weaker polar vortex prone to Arctic outbreaks reaching mid-latitudes; positive AO keeps cold air bottled up near the pole."},
        "pdo": {**latest_with_trend(pdo_rows, "Cool", "Warm", neutral_band=0.5),
                "source": PDO_URL,
                "relevance": "Warm PDO amplifies El Niño's effects on the West Coast (wetter CA/SW, drier PNW); cool PDO amplifies La Niña's effects (wetter PNW, drier CA/SW)."},
    }
    OUT_PATH.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {OUT_PATH}")
    print(f"  NAO: {out['nao']['latest_label']} = {out['nao']['latest_value']:+.2f} ({out['nao']['phase']}, {out['nao']['trend']})")
    print(f"  AO:  {out['ao']['latest_label']} = {out['ao']['latest_value']:+.2f} ({out['ao']['phase']}, {out['ao']['trend']})")
    print(f"  PDO: {out['pdo']['latest_label']} = {out['pdo']['latest_value']:+.2f} ({out['pdo']['phase']}, {out['pdo']['trend']})")


if __name__ == "__main__":
    main()
