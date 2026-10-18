# agmeo web

Farm management web app: TanStack Start (client-rendered routes), React Aria Components,
Tailwind CSS v4, TanStack Query, MapLibre GL with terra-draw for field boundaries.

```bash
pnpm --filter @agmeo/web dev        # http://localhost:3000, proxies /api to :3001
pnpm --filter @agmeo/web typecheck
pnpm --filter @agmeo/web build
```

## Structure

- `src/routes/` — file-based routes. `o.$orgId.*` are organization pages inside the app shell.
- `src/ui/` — React Aria based component kit (buttons, fields, dialogs, tables, tabs, toasts).
  Styling uses the design tokens in `src/styles.css`; dark mode swaps the token values.
- `src/lib/` — API client (`api.ts`), development auth, organization/season context, query helpers.
- `src/components/` — app components: shell, maps (`map/`), charts, operation form, field import.

Request schemas and response types come from `@agmeo/contracts` (resolved from TypeScript
source in development via the `@agmeo/source` export condition).

## Maps

Basemaps: aerial imagery (Esri World Imagery by default; set `VITE_SATELLITE_TILES` for a
licensed provider in production) and OpenFreeMap vector tiles. MapLibre's worker is copied
to `public/` at startup by a small Vite plugin, because Vite's dev server would otherwise
inject its client into the worker module.

GeoJSON, KML and zipped Shapefiles are parsed in the browser; the API validates geometry
with PostGIS and computes areas geodesically.
