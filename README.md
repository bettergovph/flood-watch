# FloodLens PH

Interactive Flood Simulation & Infrastructure Planning Platform bootstrapped with **Vite + React + TypeScript + Tailwind CSS**.

## Implemented in this scaffold

- PRD-driven landing/dashboard shell for FloodLens PH
- MapLibre map preview centered on Naga / Bicol with flood-depth visual overlays
- Scenario controls for Current, 5-year, 25-year, 50-year, and 100-year floods
- Infrastructure simulation cards for flood walls, retention basins, diversion channels, and pump stations
- Analytics cards for population, homes, roads, and economic exposure
- CesiumJS dependency and Vite integration ready for 3D terrain viewer work
- Dataset documentation for the BetterGov / Project NOAH PMTiles resource

## Dataset

Portal page: <https://data.bettergov.ph/datasets/22/resources/416>

Resource discovered from the portal:

- **Name:** Project NOAH Hazard Maps PMTiles
- **Format:** `VND.PMTILES`
- **Size:** `5.17 GB`
- **Download:** <https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps/resolve/main/PMTiles/noah_hazard_maps.pmtiles>
- **Source folder:** <https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps/tree/main/PMTiles>

The PMTiles file is intentionally not downloaded into git. When ready, store it under a local ignored data directory:

```bash
mkdir -p data/noah
curl -L -o data/noah/noah_hazard_maps.pmtiles \
  https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps/resolve/main/PMTiles/noah_hazard_maps.pmtiles
```

## DPWH project mirror

FloodLens mirrors the BetterGov DPWH project API into local PostGIS for reliable latitude/longitude and bounding-box lookups:

```bash
sudo systemctl enable --now postgresql redis-server
createdb floodlens
psql postgres:///floodlens -f scripts/dpwh_postgis_schema.sql
scripts/sync_dpwh_projects.py
```

The sync downloads `https://api.dpwh.bettergov.ph/projects` into ignored local artifacts under `data/dpwh/`, then bulk-loads `dpwh_projects` with a generated `geom geometry(Point, 4326)` column and GiST/trigram indexes. The Vite dev API at `/api/flood-control-projects` reads from PostGIS and uses Redis for short-lived response caching.

Default local services:

- `DATABASE_URL`: unset uses the local Unix-socket database `floodlens`; set a Postgres URL to override.
- `REDIS_URL`: defaults to `redis://127.0.0.1:6379`.
- `FLOODLENS_CACHE_SECONDS`: defaults to `60`.

## Development

```bash
pnpm install
pnpm dev
```

Use a fixed port if needed:

```bash
PORT=5173 pnpm dev
```

## Build

```bash
pnpm build
```

## Next implementation milestones

1. Add `pmtiles` protocol support to MapLibre and render Project NOAH vector layers.
2. Define style layers for flood, landslide, and storm surge hazard classes.
3. Add Cesium terrain provider and 3D fly-through view.
4. Add property lookup using geocoding + elevation + hazard intersection API.
5. Add backend services for PostGIS/GeoServer and Python/GDAL processing.
6. Implement simplified water-routing simulation mode using DEM + rainfall inputs.
