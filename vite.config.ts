import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';


type EnvMap = Record<string, string>;

type BoundingBox = { west: number; south: number; east: number; north: number };
type RegionSearchArea = BoundingBox & { region: string };
type ProjectHit = { contractId?: string; latitude?: number; longitude?: number; [key: string]: unknown };

const regionSearchAreas: RegionSearchArea[] = [
  { region: 'Region I', west: 119.7, south: 15.6, east: 121.2, north: 18.8 },
  { region: 'Region II', west: 120.6, south: 15.5, east: 122.6, north: 19.0 },
  { region: 'Region III', west: 119.7, south: 14.3, east: 121.4, north: 16.0 },
  { region: 'Region IV-A', west: 120.2, south: 13.5, east: 122.4, north: 15.0 },
  { region: 'Region IV-B', west: 116.8, south: 9.0, east: 122.5, north: 13.8 },
  { region: 'Region V', west: 122.3, south: 11.5, east: 124.6, north: 14.2 },
  { region: 'Region VI', west: 121.4, south: 9.7, east: 123.7, north: 12.4 },
  { region: 'Region VII', west: 123.0, south: 9.0, east: 125.0, north: 11.4 },
  { region: 'Region VIII', west: 124.1, south: 10.0, east: 126.8, north: 12.9 },
  { region: 'Region IX', west: 121.8, south: 6.6, east: 123.7, north: 8.6 },
  { region: 'Region X', west: 123.5, south: 7.4, east: 125.7, north: 9.7 },
  { region: 'Region XI', west: 125.0, south: 5.9, east: 126.8, north: 8.4 },
  { region: 'Region XII', west: 124.0, south: 5.5, east: 125.6, north: 7.9 },
  { region: 'Region XIII', west: 124.6, south: 7.7, east: 126.6, north: 10.1 },
  { region: 'National Capital Region', west: 120.85, south: 14.35, east: 121.2, north: 14.85 },
  { region: 'BARMM', west: 119.8, south: 4.6, east: 125.4, north: 8.4 },
  { region: 'Cordillera Administrative Region', west: 120.4, south: 16.1, east: 121.5, north: 17.8 },
];

function parseBbox(value: string | null): BoundingBox | null {
  if (!value) return null;
  const [west, south, east, north] = value.split(',').map(Number);
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) return null;
  return { west, south, east, north };
}

function boxesIntersect(a: BoundingBox, b: BoundingBox) {
  return a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
}

function hitWithinBbox(hit: ProjectHit, bbox: BoundingBox, paddingRatio = 0.08) {
  const lng = Number(hit.longitude);
  const lat = Number(hit.latitude);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  const lngPad = Math.max(0.05, (bbox.east - bbox.west) * paddingRatio);
  const latPad = Math.max(0.05, (bbox.north - bbox.south) * paddingRatio);
  return lng >= bbox.west - lngPad && lng <= bbox.east + lngPad && lat >= bbox.south - latPad && lat <= bbox.north + latPad;
}


function readProjectWatchEnv(): EnvMap {
  const envPath = resolve(__dirname, '../project-watch/.env');
  const values: EnvMap = {};
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...rest] = trimmed.split('=');
      values[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // The API route will return a helpful error if credentials are missing.
  }
  return values;
}

function floodControlProjectsApi(): Plugin {
  return {
    name: 'flood-control-projects-api',
    configureServer(server) {
      server.middlewares.use('/api/flood-control-projects', async (req, res) => {
        try {
          const env = readProjectWatchEnv();
          const host = env.VITE_MEILISEARCH_HOST || 'https://search2.bettergov.ph';
          const apiKey = env.VITE_MEILISEARCH_SEARCH_API_KEY;
          const indexUid = env.VITE_MEILISEARCH_INDEX || 'dpwh';
          if (!apiKey) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing Project Watch Meilisearch search key' }));
            return;
          }

          const url = new URL(req.url || '', 'http://localhost');
          const query = url.searchParams.get('q') || '';
          const limit = Math.min(Number(url.searchParams.get('limit')) || 250, 1200);
          const zoom = Number(url.searchParams.get('zoom')) || 0;
          const bbox = parseBbox(url.searchParams.get('bbox'));
          const attributesToRetrieve = [
            'contractId',
            'description',
            'category',
            'componentCategories',
            'status',
            'budget',
            'amountPaid',
            'progress',
            'location',
            'contractor',
            'startDate',
            'completionDate',
            'infraYear',
            'programName',
            'sourceOfFunds',
            'isLive',
            'livestreamUrl',
            'latitude',
            'longitude',
            'reportCount',
            'hasSatelliteImage',
          ];
          const visibleRegions = bbox ? regionSearchAreas.filter((area) => boxesIntersect(area, bbox)) : [];
          const shouldFanOutByRegion = Boolean(bbox && zoom > 0 && zoom < 10 && visibleRegions.length > 1);
          const regionalLimit = shouldFanOutByRegion ? Math.max(80, Math.ceil(limit / Math.max(1, visibleRegions.length))) : 0;
          const queries = [
            {
              indexUid,
              q: query,
              filter: ['category = "Flood Control and Drainage"'],
              limit,
              attributesToRetrieve,
            },
            ...(shouldFanOutByRegion
              ? visibleRegions.map((area) => ({
                  indexUid,
                  q: '',
                  filter: ['category = "Flood Control and Drainage"', `location.region = "${area.region}"`],
                  limit: regionalLimit,
                  attributesToRetrieve,
                }))
              : []),
          ];
          const body = { queries };

          const response = await fetch(`${host}/multi-search`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          });

          const payload = await response.text();
          res.statusCode = response.status;
          res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          if (!response.ok || !bbox) {
            res.end(payload);
            return;
          }

          const parsed = JSON.parse(payload) as { results?: Array<{ hits?: ProjectHit[]; estimatedTotalHits?: number; processingTimeMs?: number }> };
          const sourceResults = parsed.results ?? [];
          const seen = new Set<string>();
          const mergedHits = (shouldFanOutByRegion ? sourceResults.flatMap((result) => result.hits ?? []) : (sourceResults[0]?.hits ?? []))
            .filter((hit) => hitWithinBbox(hit, bbox))
            .filter((hit) => {
              const key = String(hit.contractId ?? `${hit.latitude},${hit.longitude}`);
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, limit);

          res.end(JSON.stringify({
            results: [{
              indexUid,
              hits: mergedHits,
              query,
              processingTimeMs: Math.max(...sourceResults.map((result) => result.processingTimeMs ?? 0), 0),
              limit,
              offset: 0,
              estimatedTotalHits: shouldFanOutByRegion ? Math.max(mergedHits.length, ...sourceResults.map((result) => result.estimatedTotalHits ?? 0)) : mergedHits.length,
              searchStrategy: shouldFanOutByRegion ? 'viewport-region-fanout' : 'viewport-bbox-filter',
              visibleRegions: visibleRegions.map((area) => area.region),
            }],
          }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown Meilisearch proxy error' }));
        }
      });
    },
  };
}

function localDatasetServer(): Plugin {
  const datasetPath = resolve(__dirname, 'data/noah/noah_hazard_maps.pmtiles');
  const route = '/datasets/noah_hazard_maps.pmtiles';

  return {
    name: 'local-dataset-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url !== route) return next();

        const stat = statSync(datasetPath);
        const range = req.headers.range;
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=3600');

        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range);
          if (!match) {
            res.statusCode = 416;
            res.end();
            return;
          }
          const start = match[1] ? Number(match[1]) : 0;
          const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
          if (start >= stat.size || end >= stat.size || start > end) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${stat.size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader('Content-Length', end - start + 1);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          if (req.method === 'HEAD') {
            res.end();
            return;
          }
          createReadStream(datasetPath, { start, end }).pipe(res);
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Length', stat.size);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        createReadStream(datasetPath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [floodControlProjectsApi(), localDatasetServer(), react(), cesium()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    allowedHosts: ['95.217.112.160'],
  },
});
