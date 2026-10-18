# Initial archive inventory

Live CDSE catalogue checked on 2026-10-18. Acquisition dates: 2020-01-01 through 2026-10-18.

| Year | Products | Reported volume (TB, decimal) |
|---|---:|---:|
| 2020 | 2,764 | 2.11 |
| 2021 | 2,747 | 2.05 |
| 2022 | 2,742 | 2.11 |
| 2023 | 2,727 | 2.03 |
| 2024 | 2,953 | 2.21 |
| 2025 | 3,821 | 2.91 |
| 2026 | 3,097 | 2.39 |

Total: **20,851 products**, **15.81 TB**.

These are original full-tile products, including available reprocessing versions and cloudy scenes.
Provider-reported size is an estimate, not measured ZIP transfer size; derived rasters and backups add storage.

The initial full query used the GISCO regional boundary. Every returned footprint was then checked
against the final BKG Niedersachsen land boundary; all intersect it. January 2020 was also queried
directly with the BKG boundary. The next sync will reconcile every historical month with BKG.

No authenticated imagery has been downloaded. The daily launchd job is generated but not activated.
Authentication, a real product download and scheduled execution remain to be verified.

Validation: 10 automated tests pass, including actual JPEG2000-to-COG processing; Ruff passes;
the generated launchd plist passes plutil validation.
