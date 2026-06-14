import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';


type EnvMap = Record<string, string>;

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
          const limit = Math.min(Number(url.searchParams.get('limit')) || 250, 800);
          const body = {
            queries: [
              {
                indexUid,
                q: query,
                filter: ['category = "Flood Control and Drainage"'],
                limit,
                attributesToRetrieve: [
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
                ],
              },
            ],
          };

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
          res.end(payload);
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
