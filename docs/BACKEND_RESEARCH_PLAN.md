# Backend research plan

Written 18 August 2026, in response to a fair challenge: where do the projections
actually come from, and why should anyone believe them?

---

## 1. What the backend actually is today

Not what the site implies. Stated plainly:

| Layer | What it really is | Evidence basis |
|---|---|---|
| Regional outlooks (bullish/bearish, `meter_pct`) | **63 hand-written narratives** across 16 regions, keyed to phase | My reading of published literature. Not derived from data. Not validated. |
| `meter_pct` values (0–100) | **Hand-set integers** | Judgement. No estimation procedure, no uncertainty. |
| Resort snow climatology | ERA5 reanalysis, mid-mountain sampled | Real data — but only **10 seasons per resort** |
| Snow depth conversion | Ratio scaled by cold-day fraction | My approximation, ±20% against published figures |
| ENSO phase/intensity | CPC official outlook | Real, sourced, current |
| NAO/AO/PNA/SAM forward view | GEFS ensemble, 31 members | Real, but **15 days only** |
| ENSO→NAO composite | Post-hoc test I ran | n=3 for very strong. Correctly returned null. |

**The honest summary: there is no model.** There is a lookup table of my opinions,
wrapped in real climatology and real index data. The parts that are genuinely
data-driven (ERA5 resort climatology, CPC ENSO outlook, GEFS bands) are sound.
The part that claims predictive power — "this region will do well this season" —
is not estimated from anything.

Three specific defects that follow:

1. **10 seasons of ERA5.** ERA5 runs from 1940. Using 10 years for a "typical
   season" means the figures are dominated by whatever happened 2015–2025, and
   are far too short to composite by climate phase. This is the single most
   fixable weakness.
2. **No validation anywhere.** No hindcast, no out-of-sample test, no skill
   score. The one backtest on the site is a narrative review of a single season,
   which is anecdote, not verification.
3. **Multiple-testing exposure.** 8 indices × 16 regions × 3 phases is ~380
   comparisons. Against 40–75 seasons of record, a meaningful number of
   "significant" relationships will appear by chance alone. Nothing in the
   current setup guards against this — which is precisely how I ended up
   asserting a cold Alpine winter.

---

## 2. The core question: dynamical models or empirical analysis?

These are genuinely different things and the site should be explicit about which
it uses.

### Option A — Dynamical seasonal forecasts (physics-based)

Coupled ocean–atmosphere GCMs run months ahead, as ensembles.

- **C3S multi-system** via the [Copernicus Climate Data Store](https://cds.climate.copernicus.eu):
  ECMWF SEAS5, UK Met Office GloSea, Météo-France, DWD, CMCC, NCEP CFSv2, JMA,
  ECCC, BOM. Monthly and seasonal means of precipitation, 2m temperature,
  circulation. Free, API access, **hindcasts back to 1993** for skill assessment.
- **NMME** via the [IRI Data Library](https://iridl.ldeo.columbia.edu) — North
  American multi-model ensemble, similar structure.

**Pros:** actual physics; real probabilistic output; hindcasts let you *measure*
skill rather than assert it; already bias-corrected against reanalysis.

**Cons:** resolution ~0.5–1° (roughly 50–100 km). A grid cell that size does not
resolve the Tarentaise or the Wasatch — the same problem that put ERA5's Coronet
Peak at 392 m. Requires downscaling. Precipitation skill in midlatitudes is
modest at best.

### Option B — Empirical / statistical

Composite or regress a resort-level snow predictand on index predictors.

**Pros:** cheap; transparent; can use the full 1940–present record; directly
answers "what happened at *this resort* in past El Niños".

**Cons:** this is where data mining lives. Small samples for extreme phases
(n=3 for very strong El Niño), non-stationarity, and the multiple-testing
problem above. Correlation without a physical mechanism is not a forecast.

### Option C — Hybrid (my recommendation)

Use the dynamical models for what they are good at — predicting the **large-scale
state** (ENSO, and increasingly the winter NAO) — and use the empirical layer
only for **downscaling that state to resort-level snow**, where the long
reanalysis record is genuinely informative and the physics is local.

This separates the two claims cleanly:
- "What will the atmosphere do?" → dynamical models, with their published skill.
- "Given that, what does it mean at Alta?" → empirical, from 85 seasons of ERA5.

---

## 3. The honest skill ceiling

This has to be established *before* building, because it determines what the
product can legitimately claim.

- **Seasonal precipitation skill in midlatitude mountains is low.** This is the
  central fact. Temperature is more predictable than precipitation; the tropics
  more than midlatitudes; and snow depends on precipitation *and* the freezing
  level, compounding both.
- **ENSO has real, localised skill.** The Southwest US wet / Pacific Northwest
  dry dipole in El Niño is among the more robust seasonal signals anywhere.
  Regions where it is weak (Colorado, the Alps) should say so.
- **Winter NAO seasonal skill exists but is peculiar.** Modern systems show
  useful ensemble-mean correlation with observed DJF NAO — but with the
  [signal-to-noise paradox](https://rmets.onlinelibrary.wiley.com/doi/10.1002/asl.70008):
  the ensemble mean predicts reality better than it predicts its own members,
  meaning the models are underconfident and the signal must be scaled up. Doing
  this correctly requires large ensembles and variance rescaling. It is not
  something to hand-roll.
- **ENSO transition years may carry longer-lead NAO skill** ([Nature Comms,
  2026](https://www.nature.com/articles/s41467-026-70646-2)) — worth reading
  before assuming a null.

**Implication for the product:** output must be *probability shifts with stated
skill*, never deterministic seasonal calls. Where measured skill is
indistinguishable from climatology, the site should say "no usable signal here"
— and that will be the correct answer for several regions.

---

## 4. Data to pull

### Predictand (what we are forecasting)

| Source | Coverage | Why |
|---|---|---|
| **ERA5** (1940–present, ~31 km) | Global | Full record. Replaces the current 10 seasons with ~85. |
| **ERA5-Land** (1950–present, **9 km**) | Global land | 3× finer. Materially better over mountains. Has snow depth, SWE, snowfall, 2m temp. **Priority.** |
| **SNOTEL / NRCS** (~800 sites, 1980–) | Western US | Ground truth SWE. Validates the reanalysis. |
| **MODIS snow cover** (2000–) | Global, 500 m | Independent check on season length and cover. |
| **GHCN-Daily / ECA&D** | Global / Europe stations | Long station precipitation and temperature. |
| **HISTALP** | Alps, 1760– | Very long Alpine record for non-stationarity tests. |

Local precipitation and temperature layers are exactly what is missing today —
the site currently has *one* derived snowfall number per resort and nothing else.

### Predictors (the indices)

Already collected or trivially available: ONI, RONI (CPC), NAO/AO/PNA/AAO
(CPC monthly back to 1950, plus GEFS ensemble), PDO (NOAA PSL), IOD (DMI),
MJO/RMM (BoM). Need to add: stratospheric polar vortex strength (10 hPa zonal
wind at 60°N, from ERA5), which is the physical mediator in the ENSO→NAO story
and is more informative than either endpoint.

### Forecast systems

C3S seasonal hindcasts (1993–2016) and live forecasts, for both the skill
assessment and the operational feed.

---

## 5. Empirical design, done properly

If we build the statistical layer, these safeguards are not optional:

1. **Predictand**: resort-level seasonal snow metric from ERA5-Land at
   mid-mountain elevation — separately for snowfall, freezing-level days, and a
   season-length measure. Not one blended number.
2. **Cross-validation**: leave-one-season-out for every fitted relationship.
   In-sample correlations are meaningless here.
3. **Field significance**: permutation test across regions, not per-region
   p-values. Control the false discovery rate across the whole 380-comparison
   grid.
4. **Minimum sample rule**: no phase/intensity bucket reported with n < 10
   seasons. This alone kills the "very strong El Niño" composite (n=3) that I
   should never have leant on.
5. **Non-stationarity check**: split-sample 1940–1982 vs 1983–2025. If a
   relationship flips or vanishes, it does not go in the product.
6. **Physical mechanism required**: a correlation with no proposed mechanism is
   reported as an observation, never as a forecast.

---

## 6. Validation protocol

The site should carry a permanent, honest scorecard:

- **Anomaly correlation** and **RPSS against climatology**, per region, per lead
  time, computed on the C3S hindcast period.
- **Reliability diagrams** — when we say 70%, does it happen 70% of the time?
- **Published null results.** Regions where skill is zero get stated as such.
  This is a feature: it is the difference between a forecasting product and
  horoscopes.
- **Rolling live verification**: every season's call scored after the fact, and
  the record kept visible.

---

## 7. Phased plan

| Phase | Work | Output | Rough effort |
|---|---|---|---|
| **0** | Re-pull ERA5 to full 1940–2025 for all 127 resorts, at mid-mountain, with precipitation and temperature layers, not just derived snowfall | 85 seasons × 127 resorts | 1–2 days (rate-limited) |
| **1** | Add ERA5-Land 9 km where available; validate against 30 SNOTEL sites; quantify the reanalysis bias per resort | Bias-corrected climatology + honest error bars | 2–3 days |
| **2** | Build the index database (all oscillations, 1950–present, monthly) plus stratospheric vortex | One tidy predictor table | 1 day |
| **3** | Empirical skill audit with the §5 safeguards: for each region and index, is there *any* cross-validated skill? | **A skill matrix — including the nulls.** This decides what the product can claim | 3–5 days |
| **4** | Pull C3S seasonal hindcasts; measure dynamical model skill for the same regions; compare against the empirical baseline | Skill comparison; choose per-region approach | 3–5 days |
| **5** | Wire the winning approach into the site, replacing the 63 hand-written narratives with estimated, uncertainty-bearing output | Real backend | 3–4 days |
| **6** | Permanent verification page and rolling scorecard | Trust infrastructure | 2 days |

**Phase 3 is the decision point.** If the empirical skill audit comes back mostly
null — which is a real possibility for precipitation in several regions — then
the product's honest positioning is *"here is what each resort's own record
looks like, plus where ENSO genuinely shifts the odds"*, not a seasonal forecast
service. That would still be a good product. It would just be a different one.

---

## 8. What I recommend

1. **Do Phase 0 immediately regardless.** The 10-season climatology is
   indefensible and the fix is mechanical.
2. **Do not build more narrative layers until Phase 3 reports.** Everything I
   add on top of an unvalidated base compounds the problem you're objecting to.
3. **Adopt the hybrid architecture** — dynamical for the large-scale state,
   empirical for the local downscaling — because it is the only one where each
   claim has an auditable source.
4. **Ship the skill matrix publicly.** A ski forecasting site that publishes
   where it has no skill is more credible than one that doesn't, and no
   competitor does this.

---

## 9. Open questions for you

1. **Ambition**: a genuine seasonal forecasting product (Phases 0–6, several
   weeks, real compute), or a well-sourced climatology + trip planner that is
   honest about ENSO being the only reliably useful signal (Phases 0–2)?
2. **Compute and accounts**: C3S needs a free CDS account and API key; full
   ERA5-Land pulls are large. Happy to script it all, but you'd need to
   register.
3. **Where do you want the honesty line drawn** — publish the nulls prominently,
   or keep the scorecard on a secondary page?
