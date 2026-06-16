import pg from 'pg';

const { Client } = pg;

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30',
      ...(init.headers || {}),
    },
  });
}

function parseBbox(value) {
  if (!value) return null;
  const [west, south, east, north] = value.split(',').map(Number);
  if (![west, south, east, north].every(Number.isFinite) || west >= east || south >= north) return null;
  return { west, south, east, north };
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function toDateText(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function toProject(row) {
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
    startDate: toDateText(row.start_date),
    completionDate: toDateText(row.completion_date),
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

function buildProjectSearchSql(query, bbox, limit) {
  const values = [];
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

function parseYear(value) {
  if (!value) return null;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}

function buildFundingHeatmapSql(bbox, year, limit) {
  const values = [];
  const clauses = ['geom IS NOT NULL'];
  if (bbox) {
    values.push(bbox.west, bbox.south, bbox.east, bbox.north);
    clauses.push(`geom && ST_MakeEnvelope($${values.length - 3}, $${values.length - 2}, $${values.length - 1}, $${values.length}, 4326)`);
  }
  const yearClauses = [...clauses];
  let yearParam = null;
  if (year) {
    values.push(year);
    yearParam = values.length;
    yearClauses.push(`funding_year = $${yearParam}`);
  }
  const whereSql = clauses.join('\n      AND ');
  const yearWhereSql = yearClauses.join('\n      AND ');
  values.push(limit);
  const limitParam = values.length;
  return {
    values,
    sql: `
      WITH available_years AS (
        SELECT
          funding_year,
          count(*)::int AS cell_count,
          sum(project_count)::int AS project_count,
          sum(total_budget)::float8 AS total_budget,
          sum(total_cost)::float8 AS total_cost
        FROM flood_control_yearly_funding_grid
        WHERE ${whereSql}
        GROUP BY funding_year
      ), selected_year AS (
        SELECT coalesce(
          (SELECT funding_year FROM available_years WHERE funding_year = ${yearParam ? `$${yearParam}` : 'null'}::integer),
          max(funding_year)
        ) AS funding_year
        FROM available_years
      ), heat_cells AS (
        SELECT
          funding_year,
          ST_X(geom)::float8 AS longitude,
          ST_Y(geom)::float8 AS latitude,
          project_count,
          total_budget::float8 AS total_budget,
          total_cost::float8 AS total_cost,
          max_project_budget::float8 AS max_project_budget,
          contract_ids[1:5] AS top_contract_ids
        FROM flood_control_yearly_funding_grid
        WHERE ${yearWhereSql}
          AND funding_year = (SELECT funding_year FROM selected_year)
        ORDER BY total_budget DESC NULLS LAST
        LIMIT $${limitParam}
      )
      SELECT
        coalesce((SELECT json_agg(available_years ORDER BY funding_year) FROM available_years), '[]'::json) AS years,
        (SELECT funding_year FROM selected_year) AS selected_year,
        coalesce((SELECT json_agg(heat_cells ORDER BY total_budget DESC NULLS LAST) FROM heat_cells), '[]'::json) AS cells
    `,
  };
}

function fundingCellToFeature(row) {
  return {
    type: 'Feature',
    properties: {
      year: row.funding_year,
      projectCount: row.project_count ?? 0,
      totalBudget: toNumber(row.total_budget) ?? 0,
      totalCost: toNumber(row.total_cost) ?? 0,
      maxProjectBudget: toNumber(row.max_project_budget) ?? 0,
      topContractIds: row.top_contract_ids ?? [],
    },
    geometry: { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)] },
  };
}

async function queryFundingHeatmap(request, env) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const bbox = parseBbox(url.searchParams.get('bbox'));
  const year = parseYear(url.searchParams.get('year'));
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 1800, 250), 5000);
  const cacheKey = new Request(url.toString(), request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!connectionString) {
    return jsonResponse({ error: 'DATABASE_URL or HYPERDRIVE binding is not configured' }, { status: 500 });
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const { sql, values } = buildFundingHeatmapSql(bbox, year, limit);
    const dbResult = await client.query(sql, values);
    const result = dbResult.rows[0] ?? { years: [], cells: [] };
    const years = result.years ?? [];
    const cells = result.cells ?? [];
    const selectedYear = result.selected_year ?? year ?? years[years.length - 1]?.funding_year ?? null;
    const response = jsonResponse({
      type: 'FeatureCollection',
      selectedYear,
      years,
      limit,
      processingTimeMs: Date.now() - startedAt,
      features: cells.map(fundingCellToFeature),
    }, { headers: { 'cache-control': 'public, max-age=300' } });
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown PostGIS funding heatmap error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

async function queryProjects(request, env) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const query = url.searchParams.get('q') || '';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 250, 1200);
  const bbox = parseBbox(url.searchParams.get('bbox'));
  const zoom = Number(url.searchParams.get('zoom')) || 0;
  const cacheKey = new Request(url.toString(), request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!connectionString) {
    return jsonResponse({ error: 'DATABASE_URL or HYPERDRIVE binding is not configured' }, { status: 500 });
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    const { sql, values } = buildProjectSearchSql(query, bbox, limit);
    const dbResult = await client.query(sql, values);
    const hits = dbResult.rows.map(toProject);
    const total = dbResult.rows[0]?.estimated_total_hits ?? hits.length;
    const response = jsonResponse({
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
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unknown PostGIS project search error' }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}

async function serveDataset(request, env) {
  if (!env.NOAH_DATASETS) {
    return new Response('NOAH hazard dataset is not configured for this deployment.', {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  const key = 'noah_hazard_maps.pmtiles';
  const rangeHeader = request.headers.get('range');
  let range;
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (!match) return new Response(null, { status: 416 });
    const offset = Number(match[1]);
    const end = match[2] ? Number(match[2]) : undefined;
    range = end === undefined ? { offset } : { offset, length: end - offset + 1 };
  }

  const object = await env.NOAH_DATASETS.get(key, range ? { range } : undefined);
  if (!object) return new Response('Dataset not found.', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'public, max-age=86400');
  headers.set('content-type', 'application/octet-stream');
  if (range && object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
  }
  headers.set('content-length', String(object.size));
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/flood-control-projects') {
      return queryProjects(request, env);
    }
    if (url.pathname === '/api/flood-funding-heatmap') {
      return queryFundingHeatmap(request, env);
    }
    if (url.pathname === '/datasets/noah_hazard_maps.pmtiles') {
      return serveDataset(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
