# Hosting, costs and data licensing

Written 18 August 2026. Two licensing problems here would bite the moment the
site earns referral money, so read section 3 before buying anything.

---

## 1. How this actually works

Plain version, because the vocabulary is doing a lot of hiding.

**A website is just files on a computer that answers the internet.** Your site is
`index.html`, some CSS, some JavaScript, and a folder of `.json` data files.
GitHub Pages is a free computer that hands those files to anyone who asks. That's
all hosting is.

**"Front end" vs "back end":**

- **Front end** = the files above. They run in the *visitor's* browser.
- **Back end** = a computer that runs code when someone visits — looks things up
  in a database, calls an API, and builds a fresh answer per visitor.

**GitHub Pages cannot run a back end.** It only hands over files. It will not run
Python. This sounds like a problem and isn't, because of the trick below.

### The trick: your back end runs *before* anyone visits

You don't need a live server, because your data changes monthly, not per visitor.
So instead:

1. A Python script runs on a schedule and fetches from NOAA and Copernicus.
2. It writes plain `.json` files into the repository.
3. GitHub Pages serves those files as static data.
4. The visitor's browser reads them and draws the page.

This is exactly what the site already does. `update_enso_outlook.py` and the
others *are* the back end — they just run ahead of time rather than on demand.

**GitHub Actions** runs those scripts on a schedule for you, on GitHub's
computers, free for public repositories. You don't need to leave your Mac on.
That's the missing piece and it costs nothing.

**What you'd need a real back end for** — none of which you want yet: user
accounts, saved trips, anything with a password, anything personalised per
visitor, or hiding an API key. If you ever do, the usual next step is Cloudflare
Workers or Netlify Functions, both with usable free tiers.

---

## 2. Costs

| Item | Cost | Notes |
|---|---|---|
| **Domain** (snowsignal.com) | **~$11–15/yr** at cost-price registrars | ⚠️ Verify the actual quote — short, clean `.com` names are sometimes flagged "premium" and priced at hundreds or thousands. The registrar shows this before you pay. |
| GitHub Pages hosting | **$0** | Public repo. 100 GB/month bandwidth, 1 GB repo — far beyond what this needs. |
| HTTPS certificate | **$0** | GitHub issues and renews it automatically once the domain is connected. |
| GitHub Actions (scheduled updates) | **$0** | Unlimited minutes on public repositories. |
| Copernicus / CDS data | **$0** | Including commercial use. See below. |
| NOAA / CPC / NRCS data | **$0** | US Government work, public domain. |
| **Open-Meteo API** | **$29/mo** if you monetise | ⚠️ See section 3. |
| **Map tiles** | **$0 with a change** | ⚠️ See section 3. |
| Email for the domain | $0–6/mo | Optional. Cloudflare does free forwarding. |

**Realistic total: about $15/year**, if the two issues below are handled by
swapping providers rather than paying. Up to roughly **$365/year** if you pay
Open-Meteo instead of switching.

For registrars, Cloudflare sells domains at wholesale with no markup and no
first-year-cheap-then-expensive trick. Namecheap and Porkbun are comparable.
Avoid GoDaddy's upsells.

---

## 3. The two licensing problems ⚠️

Both are triggered specifically by **making money**, including referral
commission. Neither is about paywalling — you can give the analysis away free and
still be commercial in the licence sense the moment an affiliate link pays out.

### Open-Meteo — free tier is non-commercial only

The site currently calls Open-Meteo live from the visitor's browser for snowpack
and the 7-day forecast. Their terms are explicit: **the free API is for
non-commercial use.** Commercial use needs a subscription, from **$29/month**.

Note the distinction, because it matters:

- Their **API service** — non-commercial only on the free tier.
- The **data itself** — CC BY 4.0, free for commercial use with attribution.

So the historical climatology already derived from them is fine to keep and
redistribute with credit. It's the *live per-visitor calls* that need a licence.
And Phase 0 is moving the historical side to Copernicus anyway.

**Options:**
1. Pay $29/mo. Simplest, and removes the rate limits that have been slowing the
   data pulls.
2. Replace the live forecast with the **US National Weather Service API** — free,
   public domain, commercial use fine — but US only, so the other 74 resorts lose
   their forecast.
3. Drop the live 7-day forecast and link out to each resort's own forecast page.
   Costs nothing, loses a nice feature.

**Recommendation:** option 1, once there's any revenue. Until then the site is
non-commercial and compliant as it stands.

### CARTO basemaps — not free for commercial use

The map uses CARTO's tiles. Their terms restrict the basemap service to
enterprise customers and non-profit grantees; **commercial use needs an
enterprise licence.**

**This is not a one-line swap**, which I assumed at first and checked before
recommending. OpenFreeMap serves *vector* tiles; Leaflet draws *raster* ones, so
it needs a plugin. And plain OpenStreetMap raster tiles label places in each
country's own language — Wien, Moskva, 日本 — which is the exact thing you asked
me to fix earlier. So the choice is a genuine tradeoff:

| Option | Cost | English labels | Commercial | Effort |
|---|---|---|---|---|
| **Stadia Maps** | Free tier | ✅ Yes | ✅ Yes | Small. Needs an account and the live domain allowlisted, so it has to wait for the domain anyway. |
| **MapTiler** | Free tier, 100k tiles/mo | ✅ Yes | ✅ On free tier | Small. API key. |
| **OpenFreeMap** | Free, no limits, no key | ✅ Yes | ✅ Yes | Larger — vector tiles, so Leaflet needs a plugin or a switch to MapLibre. |
| **OSM standard raster** | Free | ❌ Local language | Discouraged for production | None, but regresses the map. |

**Recommendation:** Stadia Maps, set up at the same time as the domain, since it
wants the domain allowlisted regardless. OpenFreeMap is the better long-term
answer if we ever move the map to MapLibre.

Until then the site is non-commercial and compliant as it stands.

---

## 4. What is unambiguously fine

| Source | Licence | Commercial? |
|---|---|---|
| ERA5, ERA5-Land, C3S seasonal forecasts | Copernicus / CC-BY | ✅ Yes, with attribution |
| NOAA CPC — ONI, RONI, NAO, AO, PNA, AAO, GEFS | US Gov, public domain | ✅ Yes |
| NRCS SNOTEL snowpack | US Gov, public domain | ✅ Yes |
| OpenStreetMap map *data* | ODbL | ✅ Yes, with attribution |
| Leaflet (mapping library) | BSD-2 | ✅ Yes |

**Attribution required** for Copernicus and OSM. The site already has a sources
footer; it needs a line naming Copernicus and the tile provider. That's the whole
obligation.

---

## 5. What I'd do, in order

1. **Check the actual price** of snowsignal.com at Cloudflare Registrar before
   anything else. If it's premium-priced, `snowsignal.ski` or `thesnowsignal.com`
   are worth comparing.
2. **Buy it yourself** — I don't handle payment details.
3. Tell me it's bought, and I'll wire it to GitHub Pages (a `CNAME` file and two
   DNS records) and turn on HTTPS.
4. I'll switch the map to OpenFreeMap so the tile issue is gone before any money
   is involved.
5. I'll set up GitHub Actions so the NOAA and Copernicus pulls run on a schedule
   without your Mac being on.
6. Revisit Open-Meteo only when referral revenue actually exists.

Affiliate programmes worth applying to, once the domain is live and it looks like
a real site (most reject bare GitHub URLs): Booking.com and Expedia for lodging,
Skiset and Intersport Rent for ski hire, Ski.com and Alpine Answers for packages,
and Amazon Associates for gear. Chalet operators — Skiworld, Inghams, Ski Beat —
often run direct affiliate schemes with better rates than the aggregators, which
fits the overseas page well.
