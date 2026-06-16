CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS dpwh_projects (
  contract_id text PRIMARY KEY,
  description text NOT NULL DEFAULT '',
  category text,
  component_categories jsonb,
  status text,
  budget numeric,
  amount_paid numeric,
  progress numeric,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  contractor text,
  start_date date,
  completion_date date,
  infra_year text,
  program_name text,
  source_of_funds text,
  is_live boolean NOT NULL DEFAULT false,
  livestream_url text,
  latitude double precision,
  longitude double precision,
  report_count integer NOT NULL DEFAULT 0,
  has_satellite_image boolean NOT NULL DEFAULT false,
  raw jsonb NOT NULL,
  geom geometry(Point, 4326) GENERATED ALWAYS AS (
    CASE
      WHEN latitude IS NOT NULL AND longitude IS NOT NULL
        AND latitude BETWEEN -90 AND 90
        AND longitude BETWEEN -180 AND 180
      THEN ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)
      ELSE NULL
    END
  ) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dpwh_projects_geom_gix ON dpwh_projects USING gist (geom);
CREATE INDEX IF NOT EXISTS dpwh_projects_category_idx ON dpwh_projects (category);
CREATE INDEX IF NOT EXISTS dpwh_projects_status_idx ON dpwh_projects (status);
CREATE INDEX IF NOT EXISTS dpwh_projects_region_idx ON dpwh_projects ((location->>'region'));
CREATE INDEX IF NOT EXISTS dpwh_projects_province_idx ON dpwh_projects ((location->>'province'));
CREATE INDEX IF NOT EXISTS dpwh_projects_description_trgm_idx ON dpwh_projects USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS dpwh_projects_contractor_trgm_idx ON dpwh_projects USING gin (contractor gin_trgm_ops);
CREATE INDEX IF NOT EXISTS dpwh_projects_location_gin_idx ON dpwh_projects USING gin (location);
CREATE INDEX IF NOT EXISTS dpwh_projects_infra_year_idx ON dpwh_projects (infra_year);

CREATE OR REPLACE VIEW flood_control_projects AS
SELECT * FROM dpwh_projects
WHERE category = 'Flood Control and Drainage'
  AND geom IS NOT NULL;

CREATE MATERIALIZED VIEW IF NOT EXISTS flood_control_yearly_funding_grid AS
SELECT
  regexp_replace(infra_year, '\D', '', 'g')::integer AS funding_year,
  ST_SnapToGrid(geom, 0.05) AS geom,
  count(*)::integer AS project_count,
  sum(coalesce(budget, 0))::numeric AS total_budget,
  sum(coalesce(amount_paid, 0))::numeric AS total_cost,
  max(coalesce(budget, 0))::numeric AS max_project_budget,
  array_agg(contract_id ORDER BY coalesce(budget, 0) DESC) FILTER (WHERE contract_id IS NOT NULL) AS contract_ids
FROM dpwh_projects
WHERE category = 'Flood Control and Drainage'
  AND geom IS NOT NULL
  AND regexp_replace(infra_year, '\D', '', 'g') ~ '^\d{4}$'
GROUP BY funding_year, ST_SnapToGrid(geom, 0.05);

CREATE INDEX IF NOT EXISTS flood_control_yearly_funding_grid_geom_gix
  ON flood_control_yearly_funding_grid USING gist (geom);
CREATE INDEX IF NOT EXISTS flood_control_yearly_funding_grid_year_idx
  ON flood_control_yearly_funding_grid (funding_year);
