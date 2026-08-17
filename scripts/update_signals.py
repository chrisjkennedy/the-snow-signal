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
PNA_URL = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/pna/norm.pna.monthly.b5001.current.ascii"
# CPC calls the Southern Annular Mode the "Antarctic Oscillation" (AAO);
# same index, and the name the BoM uses (SAM) is what skiers will know.
SAM_URL = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_ao_index/aao/monthly.aao.index.b79.current.ascii"
# Dipole Mode Index = the Indian Ocean Dipole, from NOAA PSL.
IOD_URL = "https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data"
# MJO. CPC's pentad file projects convection onto 10 longitude bands, of
# which INDEX_1..INDEX_8 are exactly the standard 8 RMM phases (80E through
# 10W). Whichever of those eight is largest is where enhanced convection
# currently sits, which is what "MJO phase N" means. BoM's own RMM file
# would be the canonical source but it blocks automated requests (403).
MJO_URL = "https://www.cpc.ncep.noaa.gov/products/precip/CWlink/daily_mjo_index/proj_norm_order.ascii"
# Deliberately NOT included: the EPO (East Pacific Oscillation). It's a real
# and useful cold-outbreak signal, but CPC publishes no stable monthly ASCII
# feed for it, and its main ski-relevant effect (Arctic air into the central
# and eastern US) is already largely captured by the AO here.

# What each MJO phase means for skiing. Phases 7-8-1 extend the Pacific jet
# toward North America and open the storm door on the US West Coast; 4-6
# favour ridging over the Pacific and cold outbreaks into the eastern US.
MJO_PHASE_MEANING = {
    1: ("Western Hemisphere / Africa", "Pacific jet extending — favourable for storms reaching the US West Coast."),
    2: ("Indian Ocean", "Transitional. Little consistent North American signal."),
    3: ("Indian Ocean", "Often precedes ridging over the western US — a drier lean."),
    4: ("Maritime Continent", "Tends toward western US ridging and eastern US cold."),
    5: ("Maritime Continent", "Ridge west, trough east — cold outbreaks favoured in the central and eastern US."),
    6: ("Western Pacific", "Eastern US cold favoured; western US often dry."),
    7: ("Western Pacific", "Pacific jet begins extending — the West Coast storm door starts to open."),
    8: ("Western Pacific / Date Line", "Strongest signal for an amplified Pacific jet and West Coast storms."),
}
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
    """Year-per-row layout with 12 monthly values, shared by NCEI's PDO file
    and NOAA PSL's DMI (IOD) file. Missing months use a sentinel that is
    positive in one feed (99.99) and negative in the other (-9999), so
    filter on magnitude rather than sign."""
    rows = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 13 or not parts[0].isdigit():
            continue
        year = int(parts[0])
        for i, raw in enumerate(parts[1:], start=1):
            val = float(raw)
            if abs(val) > 90:  # sentinel for not-yet-computed months
                continue
            rows.append({"year": year, "month": i, "value": val})
    return rows


def parse_mjo(text):
    """CPC pentad projection file -> latest active MJO phase and amplitude.

    Header row names the columns INDEX_9, INDEX_10, INDEX_1..INDEX_8; the
    data rows are 'YYYYMMDD' plus those 10 values in that same order.
    Missing/not-yet-computed pentads are '*****'.
    """
    lines = [l for l in text.splitlines() if l.strip()]
    header = None
    rows = []
    for line in lines:
        parts = line.split()
        if header is None and parts and parts[0].startswith("INDEX"):
            header = parts
            continue
        if header is None or len(parts) != len(header) + 1:
            continue
        date = parts[0]
        if not (len(date) == 8 and date.isdigit()):
            continue
        vals = {}
        ok = True
        for name, raw in zip(header, parts[1:]):
            try:
                vals[name] = float(raw)
            except ValueError:
                ok = False
                break
        if ok:
            rows.append((date, vals))
    if not rows:
        return None

    date, vals = rows[-1]
    # Only INDEX_1..INDEX_8 are the standard phases.
    phases = {i: vals.get(f"INDEX_{i}") for i in range(1, 9)}
    phases = {k: v for k, v in phases.items() if v is not None}
    if not phases:
        return None
    phase = max(phases, key=phases.get)
    amplitude = phases[phase]
    region, effect = MJO_PHASE_MEANING[phase]
    return {
        "latest_label": f"{date[:4]}-{date[4:6]}-{date[6:]}",
        "latest_value": round(amplitude, 2),
        "phase": f"Phase {phase} ({region})",
        "phase_number": phase,
        "amplitude": round(amplitude, 2),
        "is_active": amplitude >= 1.0,
        "trend": "n/a",
        "effect": effect,
        "recent": [
            {"date": d, "phase": max({i: v.get(f"INDEX_{i}") for i in range(1, 9) if v.get(f"INDEX_{i}") is not None},
                                     key=lambda i: v[f"INDEX_{i}"])}
            for d, v in rows[-8:]
        ],
    }


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
    pna_rows = parse_cpc_monthly(curl(PNA_URL))
    sam_rows = parse_cpc_monthly(curl(SAM_URL))
    # DMI/IOD uses the same year-per-row layout as PDO, with -9999 for
    # months not yet computed.
    iod_rows = parse_pdo(curl(IOD_URL))

    if not all([nao_rows, ao_rows, pdo_rows, pna_rows, sam_rows, iod_rows]):
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
        "pna": {**latest_with_trend(pna_rows, "Negative", "Positive"),
                "source": PNA_URL,
                "relevance": "Negative PNA puts a trough over the western US — colder and wetter for the West, milder and drier for the East. Positive PNA does the reverse, ridging over the West and driving cold into the East."},
        "sam": {**latest_with_trend(sam_rows, "Negative", "Positive"),
                "source": SAM_URL,
                "relevance": "Negative SAM pushes the Southern Ocean westerly storm belt north onto the Australian Alps and southern Andes — the single strongest driver of Australian snowfall per the Bureau of Meteorology. Positive SAM pulls those fronts south toward Antarctica, away from the ski fields."},
        "iod": {**latest_with_trend(iod_rows, "Negative", "Positive", neutral_band=0.4),
                "source": IOD_URL,
                "relevance": "Positive IOD cuts moisture feeding into southeastern Australia, drying out late winter and spring; negative IOD is associated with deeper Australian snowpack. Its effect concentrates later in the season than ENSO's."},
    }

    mjo = parse_mjo(curl(MJO_URL))
    if mjo:
        out["mjo"] = {**mjo, "source": MJO_URL,
                      "relevance": "The MJO is a pulse of tropical convection circling the globe every 30-60 days. Phases 7, 8 and 1 extend the Pacific jet and open the storm door on the US West Coast; phases 4-6 favour western ridging and cold outbreaks in the eastern US."}
    OUT_PATH.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {OUT_PATH}")
    for key in ("nao", "ao", "pdo", "pna", "sam", "iod", "mjo"):
        if key not in out:
            continue
        s = out[key]
        print(f"  {key.upper():4s} {s['latest_label']} = {s['latest_value']:+.2f} ({s['phase']})")


if __name__ == "__main__":
    main()
