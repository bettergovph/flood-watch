import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';


type EnvMap = Record<string, string>;

type BoundingBox = { west: number; south: number; east: number; north: number };
type ProjectHit = { contractId?: string; latitude?: number; longitude?: number; [key: string]: unknown };

type DbProjectRow = {
  contract_id: string;
  description: string;
  category: string | null;
  component_categories: unknown;
  status: string | null;
  budget: string | number | null;
  amount_paid: string | number | null;
  progress: string | number | null;
  location: Record<string, unknown> | null;
  contractor: string | null;
  start_date: string | null;
  completion_date: string | null;
  infra_year: string | null;
  program_name: string | null;
  source_of_funds: string | null;
  is_live: boolean | null;
  livestream_url: string | null;
  latitude: number | null;
  longitude: number | null;
  report_count: number | null;
  has_satellite_image: boolean | null;
};

let pgPoolPromise: Promise<import('pg').Pool> | null = null;
let redisClientPromise: Promise<import('redis').RedisClientType> | null = null;

function parseBbox(value: string | null): BoundingBox | null {
  if (!value) return null;
  const [west, south, east, north] = value.split(',').map(Number);
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) return null;
  return { west, south, east, north };
}

function readProjectEnv(): EnvMap {
  const envFiles = [resolve(__dirname, '.env.local'), resolve(__dirname, '.env')];
  const values: EnvMap = {};
  for (const envPath of envFiles) {
    try {
      const raw = readFileSync(envPath, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [key, ...rest] = trimmed.split('=');
        values[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
      }
    } catch {
      // Optional local configuration.
    }
  }
  return { ...values, ...process.env } as EnvMap;
}

async function getPgPool() {
  if (!pgPoolPromise) {
    pgPoolPromise = import('pg').then(({ Pool }) => {
      const env = readProjectEnv();
      return env.DATABASE_URL
        ? new Pool({ connectionString: env.DATABASE_URL, max: Number(env.PGPOOL_MAX) || 8 })
        : new Pool({ database: 'floodlens', host: '/var/run/postgresql', max: Number(env.PGPOOL_MAX) || 8 });
    });
  }
  return pgPoolPromise;
}

async function getRedisClient() {
  if (process.env.FLOODLENS_DISABLE_REDIS === '1') return null;
  if (!redisClientPromise) {
    redisClientPromise = import('redis').then(async ({ createClient }) => {
      const env = readProjectEnv();
      const client = createClient({ url: env.REDIS_URL || 'redis://127.0.0.1:6379' });
      client.on('error', (error) => console.warn('[floodlens] redis cache error:', error instanceof Error ? error.message : error));
      await client.connect();
      return client as import('redis').RedisClientType;
    });
  }
  try {
    return await redisClientPromise;
  } catch (error) {
    console.warn('[floodlens] redis unavailable; continuing without cache:', error instanceof Error ? error.message : error);
    redisClientPromise = null;
    return null;
  }
}

function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toProject(row: DbProjectRow): ProjectHit {
  return {
    contractId: row.contract_id,
    description: row.description,
    category: row.category ?? '',
    componentCategories: row.component_categories,
    status: row.status ?? '',
    budget: toNumber(row.budget),
    amountPaid: toNumber(row.amount_paid),
    progress: toNumber(row.progress),
    location: row.location ?? {},
    contractor: row.contractor ?? '',
    startDate: row.start_date,
    completionDate: row.completion_date,
    infraYear: row.infra_year ?? '',
    programName: row.program_name ?? '',
    sourceOfFunds: row.source_of_funds ?? '',
    isLive: Boolean(row.is_live),
    livestreamUrl: row.livestream_url,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    reportCount: row.report_count ?? 0,
    hasSatelliteImage: Boolean(row.has_satellite_image),
  };
}

function buildProjectSearchSql(query: string, bbox: BoundingBox | null, limit: number) {
  const values: Array<string | number> = [];
  const clauses = ["category = 'Flood Control and Drainage'", 'geom IS NOT NULL'];
  if (bbox) {
    values.push(bbox.west, bbox.south, bbox.east, bbox.north);
    clauses.push(`geom && ST_MakeEnvelope($${values.length - 3}, $${values.length - 2}, $${values.length - 1}, $${values.length}, 4326)`);
  }
  const trimmedQuery = query.trim();
  let orderBy = 'budget DESC NULLS LAST, contract_id ASC';
  if (trimmedQuery) {
    values.push(`%${trimmedQuery}%`, trimmedQuery);
    const likeParam = values.length - 1;
    const textParam = values.length;
    clauses.push(`(
      description ILIKE $${likeParam}
      OR contractor ILIKE $${likeParam}
      OR program_name ILIKE $${likeParam}
      OR source_of_funds ILIKE $${likeParam}
      OR contract_id ILIKE $${likeParam}
      OR location::text ILIKE $${likeParam}
    )`);
    orderBy = `GREATEST(similarity(description, $${textParam}), similarity(contractor, $${textParam}), similarity(location::text, $${textParam})) DESC, budget DESC NULLS LAST`;
  }
  values.push(limit);
  const limitParam = values.length;
  const whereSql = clauses.join('\n      AND ');
  return {
    values,
    sql: `
      WITH filtered AS (
        SELECT *
        FROM dpwh_projects
        WHERE ${whereSql}
      ), counted AS (
        SELECT count(*)::int AS total FROM filtered
      )
      SELECT
        contract_id, description, category, component_categories, status, budget, amount_paid, progress,
        location, contractor, start_date::text, completion_date::text, infra_year, program_name, source_of_funds,
        is_live, livestream_url, latitude, longitude, report_count, has_satellite_image,
        (SELECT total FROM counted) AS estimated_total_hits
      FROM filtered
      ORDER BY ${orderBy}
      LIMIT $${limitParam}
    `,
  };
}

function floodControlProjectsApi(): Plugin {
  return {
    name: 'flood-control-projects-api',
    configureServer(server) {
      server.middlewares.use('/api/flood-control-projects', async (req, res) => {
        const startedAt = Date.now();
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const query = url.searchParams.get('q') || '';
          const limit = Math.min(Number(url.searchParams.get('limit')) || 250, 1200);
          const bbox = parseBbox(url.searchParams.get('bbox'));
          const zoom = Number(url.searchParams.get('zoom')) || 0;
          const cacheKey = `flood-control-projects:v2:${query}:${limit}:${zoom.toFixed(2)}:${bbox ? `${bbox.west},${bbox.south},${bbox.east},${bbox.north}` : 'none'}`;
          const redis = await getRedisClient();
          const cached = redis ? await redis.get(cacheKey) : null;
          if (cached) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'public, max-age=30');
            res.setHeader('X-FloodLens-Cache', 'HIT');
            res.end(cached);
            return;
          }

          const pool = await getPgPool();
          const { sql, values } = buildProjectSearchSql(query, bbox, limit);
          const dbResult = await pool.query<DbProjectRow & { estimated_total_hits: number }>(sql, values);
          const hits = dbResult.rows.map(toProject);
          const total = dbResult.rows[0]?.estimated_total_hits ?? hits.length;
          const body = JSON.stringify({
            results: [{
              indexUid: 'postgis.dpwh_projects',
              hits,
              query,
              processingTimeMs: Date.now() - startedAt,
              limit,
              offset: 0,
              estimatedTotalHits: total,
              searchStrategy: bbox ? 'postgis-bbox-gist' : 'postgis-national',
              visibleRegions: [],
            }],
          });
          if (redis) await redis.set(cacheKey, body, { EX: Number(process.env.FLOODLENS_CACHE_SECONDS) || 60 });
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=30');
          res.setHeader('X-FloodLens-Cache', 'MISS');
          res.end(body);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown PostGIS project search error' }));
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
