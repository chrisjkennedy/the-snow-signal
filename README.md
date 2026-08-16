# The Snow Signal

A static, no-backend website, built to be evergreen rather than tied to one
ski season: the brand ("The Snow Signal") and layout never change, but the
climate framing and every region's bull/bear call are keyed off whatever
ENSO is actually doing right now, and each resort row pulls live snowpack
and forecast data straight from public APIs in the visitor's browser. It
also tracks NAO/AO/PDO as secondary signals, keeps a backtest of how the
model's calls actually performed last season, is explicit about how far
ahead each signal is genuinely predictive vs. just describing current
state, and has a scenario explorer for imposing a hypothetical ENSO/NAO
reading to see how the rankings would change.

Currently covers **101 resorts across 10 regions**, live in production at
https://chrisjkennedy.github.io/the-snow-signal/.

## Why it's structured this way

Earlier drafts hardcoded "2026-27" and an El Niño-only narrative into the
page. That breaks the moment ENSO flips — La Niña reverses most of the
regional calls (PNW/Canada go from bearish to the most bullish region in
North America, California/Southwest flip the other way), so a page that
only knows how to talk about El Niño would keep confidently pointing people
at the wrong resorts once conditions changed. Design choices that fix that:

1. **Every region has three narratives, not one.** `data/resorts.json`
   gives each region an `enso_signals` object with `el_nino`, `la_nina`,
   and `neutral` variants (different signal/meter/narrative/caveat for
   each). `js/app.js` picks the one matching the current phase, and sorts
   every region by that phase's `meter_pct` — most bullish first.
2. **Brand identity is separate from live status.** The name, tagline, and
   layout are fixed in `index.html` and never change. Only a small labelled
   "live signal" line and the ONI banner update — so the site reads as a
   stable tool with a live reading, not three different seasonal articles
   reusing the same CSS.
3. **ENSO isn't the only signal.** NAO dominates outcomes in the Northeast
   US and the Alps more than ENSO does; PDO modulates how strongly a given
   ENSO phase actually shows up on the West Coast. Those two regions (plus
   Sierra/CA and the PNW) get a live "secondary signal" note pulled from
   `data/climate-signals.json`, and a compact NAO/AO/PDO line sits under the
   context strip for everyone else — without turning every region card into
   a multi-signal matrix.
4. **The model grades itself.** `data/backtest-2025-26.json` is a real,
   sourced comparison of what the La Niña content predicted for the
   2025-26 season against what actually happened, region by region —
   including the March 2026 ridge/heatwave that overrode the ENSO signal
   entirely across the Interior West. It's collapsed behind a `<details>`
   element near the bottom of the page so it doesn't compete with the live
   content, but it's real, not decorative.
5. **Live truth never gets overwritten.** The ONI banner and the
   NAO/AO/PDO line under the context strip always show the real, current
   reading — full stop, no exceptions. The scenario explorer (see below)
   only ever changes the hero, region rankings, and map; those two strips
   are the permanent ground truth a user can check against.
6. **Predictive horizon is stated, not implied.** `data/signal-metadata.json`
   is honest that these four signals aren't equally forward-looking: ENSO
   has real skill 3-9 months out once a phase locks in (with a big caveat
   for forecasts made in the spring predictability barrier); NAO and AO are
   mostly nowcasts with 1-6 weeks of real skill; PDO is a multi-year
   backdrop, not a forecast of any specific period. This shows as an
   expandable table under the "How often is this updated…" toggle.

## How it's built

```
index.html                     page shell + fixed brand/hero + wildcard/footer copy
css/style.css                  all styling
js/app.js                      picks the current ENSO phase, sorts/renders regions,
                                resort rows, map, backtest table, and the scenario explorer
js/data-sources.js             the live data fetchers (see below)
data/resorts.json              101 resorts: coords, elevations, passes, station IDs,
                                verified snow-report links, phase-aware region narratives
data/phase-copy.json           the live-status line + mechanism text per ENSO phase
data/oni.json                  ENSO/ONI snapshot — regenerate with scripts/update_oni.py
data/climate-signals.json      NAO/AO/PDO snapshot — regenerate with scripts/update_signals.py
data/signal-metadata.json      static: update cadence + real predictive horizon per signal
data/backtest-2025-26.json     hand-researched season backtest (see below)
data/affiliates.json           your affiliate link config (empty placeholders for now)
scripts/update_oni.py          pulls NOAA's ONI table server-side, classifies the phase
scripts/update_signals.py      pulls NOAA/NCEI NAO, AO, and PDO tables server-side
```

No build step, no server, no npm install. Open `index.html` through any static
file server (not `file://` — the JSON fetches need real HTTP) and it works.

## Live data sources

| Data | Source | Fetched | Why |
|---|---|---|---|
| Snowpack (% of median + season-to-date chart) | NRCS AWDB (SNOTEL / manual snow courses) | client-side, live | CORS-enabled, free, no key |
| 7-day snow forecast | Open-Meteo | client-side, live | CORS-enabled, free, no key, works worldwide |
| ENSO / ONI index | NOAA CPC | server-side, via `scripts/update_oni.py` | NOAA doesn't send CORS headers |
| NAO, AO, PDO | NOAA CPC / NCEI | server-side, via `scripts/update_signals.py` | Same CORS issue as ONI |
| Live snow report link | OnTheSnow / Snow-Forecast / OpenSnow | static link per resort, verified by search | Not all of these sites expose a public API, so this is a direct link out rather than embedded data |

Snowpack only shows for resorts with a real nearby station — mostly the
western US and parts of BC/Alberta. NRCS has essentially no coverage in the
Northeast US, Europe, Japan, Andes, Australia, or most of coastal BC, so
those resorts show "no nearby station" and rely on the Open-Meteo forecast
panel and the live snow-report link instead. That's a real data-coverage
gap, not a bug — with ~101 resorts hitting the SNOTEL API on every load,
`js/app.js` also throttles requests to 6 concurrent (`runWithConcurrency`)
to avoid tripping the API's rate limit.

### Refreshing the live indices

```bash
python3 scripts/update_oni.py
python3 scripts/update_signals.py
```

`update_oni.py` is the one that matters most — it decides which of the
three region narratives the whole site shows. NOAA updates these monthly.
Two ways to keep them current without thinking about it:

- Ask me to set up a scheduled Claude task that runs both monthly and lets
  you know if the ENSO phase changed (i.e. the site's content is about to
  flip).
- Or add them to any cron-like scheduler you already use.

### Updating the backtest

`data/backtest-2025-26.json` is a one-time research pass, not something
that auto-refreshes — the underlying facts (season recaps, snowpack
surveys) only exist once a season is basically over. Ask me to redo this
research each summer once a season wraps, or do it yourself and follow the
same file structure (predicted / actual / verdict / sources per region).

## Monetization — what's wired up vs. what you still need to do

Every resort row has three affiliate-style buttons (lift tickets, gear
rental, lodging), plus a separate "Live snow report" link that's purely
informational (not an affiliate link). The affiliate buttons link to plain
search pages with **no tracking IDs** — I can't sign you up for affiliate
programs, only wire the site to use your IDs once you have them. To
activate real revenue:

1. Apply to the affiliate programs — e.g. Liftopia (lift tickets), evo /
   Christy Sports / Ski Butlers (gear rental), Booking.com or Expedia
   (lodging). Most run through networks like Impact, CJ, ShareASale, or
   Awin.
2. Once approved, drop your tracking parameter into the matching
   `affiliate_param` field in `data/affiliates.json` — no code changes
   needed, the site picks it up automatically.

Pass badges (Epic / Ikon / Indy) are informational, not affiliate links —
badges marked `verify` in the data reflect passes I'm less certain are
still current for that resort this season. Check the official pass site
before anyone relies on it to buy a pass.

## Deploying changes

The site is already live at https://chrisjkennedy.github.io/the-snow-signal/
via GitHub Pages, deploying from the `master` branch of
https://github.com/chrisjkennedy/the-snow-signal. To push an update:

```bash
git add -A && git commit -m "your message" && git push
```

Pages rebuilds automatically within a minute or two of each push.

## Data accuracy notes

- Elevations are approximate published figures — worth spot-checking before
  relying on them for anything precise.
- Pass affiliations reflect a best understanding of the 2025-26 rosters for
  the well-known North American anchors; global resorts and anything marked
  `pass_confidence: "verify"` in `data/resorts.json` should be confirmed
  before publishing anything that depends on it.
- Snow-report links were verified via live search where possible (mostly
  OnTheSnow, with Snow-Forecast/OpenSnow as fallback for the handful of
  resorts OnTheSnow doesn't index) — not hand-guessed URL patterns.
