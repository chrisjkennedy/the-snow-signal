# CDS setup — 5 minutes, do this when you have a moment

Everything else is already running. This is the only thing I can't do myself:
I don't create accounts, accept licence terms, or handle credentials.

## 1. Put your API key on disk (don't send it to me)

Open <https://cds.climate.copernicus.eu/profile> while logged in. It shows a
`url` and a `key`.

Create the file `~/.cdsapirc` with exactly two lines:

```
url: https://cds.climate.copernicus.eu/api
key: PASTE_YOUR_KEY_HERE
```

Then lock it down:

```bash
chmod 600 ~/.cdsapirc
```

The `cdsapi` client reads this file directly, so the key never passes through
our conversation and never lands in shell history. I've already installed the
client — once the file exists, I can pull.

## 2. Accept the licences

**Log in first** — top right of the page. The licence boxes are invisible when
logged out; they show "Login/register to accept licences" instead.

Each page below opens on a big **Download** form: Variable, Year, Month,
Geographical area and so on. **Ignore all of it.** You are not requesting data,
I do that from the script. You only need the box at the very bottom.

On each page: scroll to the bottom of the Download tab. Just above the section
headed *"Corresponding API request"* there is one headed **"Terms of use"**.
Tick every licence listed there and accept. That is the entire job.

| # | Page | Licences on it |
|---|---|---|
| 1 | [ERA5-Land monthly](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land-monthly-means?tab=download) | **1** — CC-BY licence |
| 2 | [ERA5 single levels monthly](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels-monthly-means?tab=download) | **1** — CC-BY licence |
| 3 | [ERA5 pressure levels monthly](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels-monthly-means?tab=download) | **1** — CC-BY licence |
| 4 | [Seasonal forecast monthly](https://cds.climate.copernicus.eu/datasets/seasonal-monthly-single-levels?tab=download) | **2** — CC-BY licence, *and* "Additional licence to use non European contributions" |

**Five tick-boxes across four pages.** Page 4 is the only one with two: the
second covers the non-European models (NCEP, JMA, Environment Canada, Australian
BoM) as a single licence rather than one per centre. Miss it and the ensemble
quietly loses half its models.

Verified against the live pages on 18 August 2026.

## 3. Tell me it's done

Then I'll verify with a small test request and start Phase 1 and Phase 4.

---

## What's already running without you

- **Phase 0** — full ERA5 record, 1940–2024, all 127 resorts, with the
  precipitation and temperature layers that were missing. Paced at one resort
  per 65 s to stay under the rate limit; roughly 2¼ hours, resumable, cached.
- **Phase 2** — the index database (ONI, RONI, NAO, AO, PNA, AAO, PDO, IOD, MJO)
  needs no credentials and is mostly collected already.

Neither is blocked on you.
