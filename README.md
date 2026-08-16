# The Snow Signal

A static, no-backend website, built to be evergreen rather than tied to one
ski season: the brand ("The Snow Signal") and layout never change, but the
climate framing and every region's bull/bear call are keyed off whatever
ENSO is actually doing right now, and each resort row pulls live snowpack
and forecast data straight from public APIs in the visitor's browser.

## Why it's structured this way

Earlier drafts hardcoded "2026-27" and an El Niño-only narrative into the
page. That breaks the moment ENSO flips — La Niña reverses most of the
regional calls (PNW/Canada go from bearish to the most bullish region in
North America, California/Southwest flip the other way), so a page that
only knows how to talk about El Niño would keep confidently pointing people
at the wrong resorts once conditions changed. Two design choices fix that:

1. **Every region has three narratives, not one.** `data/resorts.json`
   gives each region an `enso_signals` object with `el_nino`, `la_nina`,
   and `neutral` variants (different signal/meter/narrative/caveat for
   each). `js/app.js` picks the one matching the current phase.
2. **Brand identity is separate from live status.** The name, tagline, and
   layout are fixed in `index.html` and never change. Only a small labelled
   "live signal" line and the ONI banner update — so the site reads as a
   stable tool with a live reading, not three different seasonal articles
   reusing the same CSS.

## How it's built

```
index.html              page shell + fixed brand/hero + wildcard/footer copy
css/style.css           all styling
js/app.js               picks the current ENSO phase, renders hero/region cards/resort rows
js/data-sources.js      the four live data fetchers (see below)
data/resorts.json       curated resort list: coords, elevations, passes, station IDs,
                         and phase-aware (el_nino/la_nina/neutral) region narratives
data/phase-copy.json    the live-status line + mechanism text per ENSO phase
data/oni.json           ENSO/ONI snapshot — regenerate with scripts/update_oni.py
data/affiliates.json    your affiliate link config (empty placeholders for now)
scripts/update_oni.py   pulls NOAA's ONI table server-side, classifies the phase,
                         writes data/oni.json
```

No build step, no server, no npm install. Open `index.html` through any static
file server (not `file://` — the JSON fetches need real HTTP) and it works.

## The three live data sources

| Data | Source | Fetched | Why |
|---|---|---|---|
| Snowpack (% of median) | NRCS AWDB (SNOTEL / manual snow courses) | client-side, live | CORS-enabled, free, no key |
| 7-day snow forecast | Open-Meteo | client-side, live | CORS-enabled, free, no key, works worldwide |
| ENSO / ONI index | NOAA CPC | server-side, via `scripts/update_oni.py` | NOAA doesn't send CORS headers, so the browser can't fetch it directly |

Snowpack only shows for resorts with a real nearby station — mostly the
western US and parts of BC/Alberta. NRCS has essentially no coverage in the
Northeast US or coastal BC, so those resorts show "no nearby station" and
rely on the Open-Meteo forecast panel only. That's a real data-coverage gap,
not a bug.

### Refreshing the ONI number

```bash
python3 scripts/update_oni.py
```

This is the one piece of live data that isn't fetched in-browser, and it's
also the piece that decides which of the three region narratives the whole
site shows — so keeping it current matters more than the other feeds. NOAA
updates ONI once a month. Two ways to keep it current without thinking
about it:

- Ask me to set up a scheduled Claude task that runs it monthly and lets you
  know if the ENSO phase changed (i.e. the site's content is about to flip).
- Or add it to any cron-like scheduler you already use.

## Monetization — what's wired up vs. what you still need to do

Every resort row has three affiliate-style buttons (lift tickets, gear
rental, lodging). Right now they link to plain search pages with **no
tracking IDs** — I can't sign you up for affiliate programs, only wire the
site to use your IDs once you have them. To activate real revenue:

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

## Deploying it for real

This is a plain static site, so any of these work and are free:

- **GitHub Pages** — push this folder to a repo, enable Pages in repo
  settings, done.
- **Netlify / Vercel** — drag-and-drop the folder in their dashboard, or
  connect a GitHub repo for auto-deploys on push.

I haven't set up git or pushed anywhere — just say the word and which of
these you want, and I'll walk through it (creating a repo/pushing/connecting
a host are all things I'll confirm with you before doing, since they touch
your GitHub account and go live publicly).

## Data accuracy notes

- Elevations are approximate published figures — worth spot-checking before
  this goes fully public.
- Pass affiliations reflect a best understanding of the 2025-26 rosters for
  the well-known North American anchors; global resorts and anything marked
  `pass_confidence: "verify"` in `data/resorts.json` should be confirmed
  before publishing.
