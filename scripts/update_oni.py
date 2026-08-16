#!/usr/bin/env python3
"""Refresh data/oni.json from NOAA CPC's ONI table.

NOAA's CPC site does not send CORS headers, so the browser can't fetch this
directly — this script pulls it server-side instead. Run it monthly (CPC
updates ONI once a month), e.g. via a scheduled task.

Usage: python3 scripts/update_oni.py

This writes a "phase" key (el_nino / la_nina / neutral) that the website
uses to pick which set of region narratives to show — the site is meant to
track whatever ENSO is actually doing, not one specific season, so this
script is the one thing that has to be kept current.
"""
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SOURCE_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "oni.json"

PHASE_THRESHOLD = 0.5


def strength_label(oni, phase):
    mag = abs(oni)
    if phase == "neutral":
        return "Neutral"
    tier = "Very Strong" if mag >= 2.0 else "Strong" if mag >= 1.5 else "Moderate" if mag >= 1.0 else "Weak"
    name = "El Niño" if phase == "el_nino" else "La Niña"
    return f"{tier} {name}"


def phase_of(oni):
    if oni >= PHASE_THRESHOLD:
        return "el_nino"
    if oni <= -PHASE_THRESHOLD:
        return "la_nina"
    return "neutral"


def fetch_rows():
    # Uses curl rather than urllib: some macOS Python installs (python.org
    # builds) ship without the system's root CA bundle wired up, which makes
    # urllib's SSL verification fail. curl uses the OS trust store directly.
    text = subprocess.run(
        ["curl", "-fsSL", SOURCE_URL],
        check=True, capture_output=True, text=True, timeout=20,
    ).stdout
    rows = []
    for line in text.splitlines()[1:]:
        parts = line.split()
        if len(parts) != 4:
            continue
        season, year, _, anom = parts
        rows.append({"season": season, "year": int(year), "oni": float(anom)})
    return rows


def main():
    rows = fetch_rows()
    if not rows:
        raise SystemExit("No rows parsed from ONI table — source format may have changed")

    latest = rows[-1]
    previous = rows[-2] if len(rows) > 1 else None
    recent = rows[-8:]

    latest_phase = phase_of(latest["oni"])

    # Officially, El Niño/La Niña is only "declared" once ONI crosses +/-0.5
    # for 5 consecutive overlapping seasons. That's the rigorous NOAA rule —
    # useful for the historical record, but a forward-looking planning tool
    # cares more about where things are headed than a retroactive
    # certification, so `phase` (used to pick site content) is based on the
    # latest single reading, and `declared_status` carries the stricter
    # 5-month rule as supporting context.
    trailing5 = [r["oni"] for r in rows[-5:]]
    if len(trailing5) == 5 and all(v >= PHASE_THRESHOLD for v in trailing5):
        declared_status = strength_label(min(trailing5), "el_nino")
    elif len(trailing5) == 5 and all(v <= -PHASE_THRESHOLD for v in trailing5):
        declared_status = strength_label(max(trailing5), "la_nina")
    else:
        declared_status = f"Not yet declared — trending {strength_label(latest['oni'], latest_phase)}" if latest_phase != "neutral" else "ENSO-Neutral"

    if previous is None:
        trend = "steady"
    else:
        delta = latest["oni"] - previous["oni"]
        trend = "rising" if delta >= 0.1 else "falling" if delta <= -0.1 else "steady"

    # Consecutive months (from the end) on the same side of the threshold as
    # the latest reading — a rough read on how established the signal is.
    streak = 0
    for r in reversed(rows):
        if phase_of(r["oni"]) == latest_phase and latest_phase != "neutral":
            streak += 1
        else:
            break

    out = {
        "updated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": SOURCE_URL,
        "latest_season": latest["season"],
        "latest_year": latest["year"],
        "latest_oni": latest["oni"],
        "phase": latest_phase,
        "phase_label": strength_label(latest["oni"], latest_phase),
        "trend": trend,
        "streak_months": streak,
        "declared_status": declared_status,
        "recent": recent,
    }
    OUT_PATH.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {OUT_PATH} — latest {latest['season']} {latest['year']}: ONI {latest['oni']:+.2f} "
          f"({out['phase_label']}, {trend}, {streak}mo streak)")


if __name__ == "__main__":
    main()
