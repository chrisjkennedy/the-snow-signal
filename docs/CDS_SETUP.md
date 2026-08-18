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

CDS blocks downloads until the licence is accepted **per dataset**, and it's a
click-through I'm not permitted to do on your behalf. Open each link, scroll to
"Terms of use", tick accept:

| Dataset | Why we need it |
|---|---|
| [ERA5-Land monthly means](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land-monthly-means) | 9 km reanalysis — 3× finer than what we have, the mountain fix |
| [ERA5 single levels (monthly)](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels-monthly-means) | Circulation fields, snow variables |
| [ERA5 pressure levels (monthly)](https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels-monthly-means) | 10 hPa zonal wind at 60°N — the stratospheric polar vortex |
| [Seasonal forecast monthly, single levels](https://cds.climate.copernicus.eu/datasets/seasonal-monthly-single-levels) | **The dynamical forecasts + hindcasts** |

⚠️ **The seasonal dataset needs a licence accepted for each originating centre
separately** — ECMWF, UK Met Office, Météo-France, DWD, CMCC, NCEP, JMA, ECCC,
BOM. They appear as separate tick-boxes on that one page. Missing one means that
model silently drops out of the multi-model ensemble, so tick all of them.

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
