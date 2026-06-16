#!/usr/bin/env python3
"""Download DPWH/BetterGov projects and bulk-load them into PostGIS.

Defaults mirror https://api.dpwh.bettergov.ph/projects into the local `floodlens`
Postgres database. The downloader writes durable JSONL + CSV artifacts under
`data/dpwh/` and uses psql COPY for a fast, dependency-free import.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

API_URL = "https://api.dpwh.bettergov.ph/projects"
DEFAULT_LIMIT = 5000
FIELDS = [
    "contract_id",
    "description",
    "category",
    "component_categories",
    "status",
    "budget",
    "amount_paid",
    "progress",
    "location",
    "contractor",
    "start_date",
    "completion_date",
    "infra_year",
    "program_name",
    "source_of_funds",
    "is_live",
    "livestream_url",
    "latitude",
    "longitude",
    "report_count",
    "has_satellite_image",
    "raw",
]


def fetch_json(url: str, attempts: int = 5) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Flood-Watch-PostGIS-sync/1.0"})
            with urllib.request.urlopen(req, timeout=90) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            sleep = min(20, 2 ** attempt)
            print(f"Fetch failed attempt {attempt}/{attempts}: {exc}; retrying in {sleep}s", file=sys.stderr)
            time.sleep(sleep)
    raise RuntimeError(f"failed to fetch {url}: {last_error}")


def parse_date(value: Any) -> str:
    if not value:
        return ""
    text = str(value)[:10]
    return text if len(text) == 10 else ""


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def normalize(project: dict[str, Any]) -> dict[str, Any]:
    component_categories = project.get("componentCategories")
    if isinstance(component_categories, str):
        component_value: Any = [part.strip() for part in component_categories.split(",") if part.strip()]
    else:
        component_value = component_categories or []

    return {
        "contract_id": project.get("contractId") or project.get("contract_id") or "",
        "description": project.get("description") or "",
        "category": project.get("category") or "",
        "component_categories": json_dumps(component_value),
        "status": project.get("status") or "",
        "budget": project.get("budget") if project.get("budget") is not None else "",
        "amount_paid": project.get("amountPaid") if project.get("amountPaid") is not None else "",
        "progress": project.get("progress") if project.get("progress") is not None else "",
        "location": json_dumps(project.get("location") or {}),
        "contractor": project.get("contractor") or "",
        "start_date": parse_date(project.get("startDate")),
        "completion_date": parse_date(project.get("completionDate")),
        "infra_year": str(project.get("infraYear") or ""),
        "program_name": project.get("programName") or "",
        "source_of_funds": project.get("sourceOfFunds") or "",
        "is_live": "true" if project.get("isLive") else "false",
        "livestream_url": project.get("livestreamUrl") or "",
        "latitude": project.get("latitude") if project.get("latitude") is not None else "",
        "longitude": project.get("longitude") if project.get("longitude") is not None else "",
        "report_count": project.get("reportCount") if project.get("reportCount") is not None else 0,
        "has_satellite_image": "true" if project.get("hasSatelliteImage") else "false",
        "raw": json_dumps(project),
    }


def run_psql(database_url: str, sql: str) -> None:
    subprocess.run(["psql", database_url, "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)


def import_csv(database_url: str, schema_path: Path, csv_path: Path) -> None:
    subprocess.run(["psql", database_url, "-v", "ON_ERROR_STOP=1", "-f", str(schema_path)], check=True)
    columns = ", ".join(FIELDS)
    sql = f"""
BEGIN;
CREATE TEMP TABLE dpwh_projects_import (LIKE dpwh_projects INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING INDEXES);
\\copy dpwh_projects_import ({columns}) FROM '{csv_path}' WITH (FORMAT csv, HEADER true, NULL '')
INSERT INTO dpwh_projects ({columns}, updated_at)
SELECT {columns}, now()
FROM dpwh_projects_import
WHERE contract_id <> ''
ON CONFLICT (contract_id) DO UPDATE SET
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  component_categories = EXCLUDED.component_categories,
  status = EXCLUDED.status,
  budget = EXCLUDED.budget,
  amount_paid = EXCLUDED.amount_paid,
  progress = EXCLUDED.progress,
  location = EXCLUDED.location,
  contractor = EXCLUDED.contractor,
  start_date = EXCLUDED.start_date,
  completion_date = EXCLUDED.completion_date,
  infra_year = EXCLUDED.infra_year,
  program_name = EXCLUDED.program_name,
  source_of_funds = EXCLUDED.source_of_funds,
  is_live = EXCLUDED.is_live,
  livestream_url = EXCLUDED.livestream_url,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  report_count = EXCLUDED.report_count,
  has_satellite_image = EXCLUDED.has_satellite_image,
  raw = EXCLUDED.raw,
  updated_at = now();
COMMIT;
ANALYZE dpwh_projects;
REFRESH MATERIALIZED VIEW flood_control_yearly_funding_grid;
"""
    subprocess.run(["psql", database_url, "-v", "ON_ERROR_STOP=1"], input=sql, text=True, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL", "postgres:///floodlens"))
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    parser.add_argument("--out-dir", default="data/dpwh")
    parser.add_argument("--skip-download", action="store_true")
    parser.add_argument("--skip-import", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / "dpwh_projects.jsonl"
    csv_path = out_dir / "dpwh_projects.csv"
    meta_path = out_dir / "dpwh_projects.meta.json"
    schema_path = Path(__file__).with_name("dpwh_postgis_schema.sql").resolve()

    if not args.skip_download:
        first = fetch_json(f"{API_URL}?page=1&limit={args.limit}")
        payload = first["data"]
        pagination = payload["pagination"]
        total_pages = int(pagination["totalPages"])
        total_count = int(pagination["totalCount"])
        actual_limit = int(pagination["limit"])
        print(f"Downloading {total_count} projects over {total_pages} pages (limit={actual_limit})")

        count = 0
        with jsonl_path.open("w", encoding="utf-8") as jsonl, csv_path.open("w", encoding="utf-8", newline="") as csv_file:
            writer = csv.DictWriter(csv_file, fieldnames=FIELDS)
            writer.writeheader()
            for page in range(1, total_pages + 1):
                if page == 1:
                    data = payload
                else:
                    data = fetch_json(f"{API_URL}?page={page}&limit={actual_limit}")["data"]
                projects = data["data"]
                for project in projects:
                    jsonl.write(json_dumps(project) + "\n")
                    writer.writerow(normalize(project))
                count += len(projects)
                if page == 1 or page == total_pages or page % 5 == 0:
                    print(f"Page {page}/{total_pages}: {count}/{total_count} projects")

        meta = {
            "source": API_URL,
            "downloadedAt": datetime.now(timezone.utc).isoformat(),
            "count": count,
            "expectedCount": total_count,
            "limit": actual_limit,
            "jsonl": str(jsonl_path),
            "csv": str(csv_path),
        }
        meta_path.write_text(json_dumps(meta) + "\n", encoding="utf-8")
        if count != total_count:
            raise RuntimeError(f"downloaded {count}, expected {total_count}")

    if not args.skip_import:
        print(f"Importing {csv_path} into {args.database_url}")
        import_csv(args.database_url, schema_path, csv_path)
        run_psql(args.database_url, "SELECT count(*) AS total_projects, count(*) FILTER (WHERE category = 'Flood Control and Drainage') AS flood_control, count(*) FILTER (WHERE geom IS NOT NULL) AS geocoded FROM dpwh_projects;")


if __name__ == "__main__":
    main()
