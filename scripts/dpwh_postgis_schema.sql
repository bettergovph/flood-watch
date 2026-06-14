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

CREATE OR REPLACE VIEW flood_control_projects AS
SELECT * FROM dpwh_projects
WHERE category = 'Flood Control and Drainage'
  AND geom IS NOT NULL;
