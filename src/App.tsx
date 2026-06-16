import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import {
  BarChart3,
  CalendarClock,
  ChevronRight,
  Clock3,
  Database,
  Home,
  Layers3,
  LocateFixed,
  MapPinned,
  Mountain,
  Shield,
  SlidersHorizontal,
  Waves,
  X,
} from 'lucide-react';

type Scenario = 'Clear' | '5-Year Flood' | '25-Year Flood' | '50-Year Flood' | '100-Year Flood';
type Tool = 'Flood Wall' | 'Retention Basin' | 'Diversion Channel' | 'Pump Station';
type LayerKey = 'flood' | 'landslide' | 'stormSurge' | 'debrisFlow' | 'projects' | 'funding' | 'buildings' | 'houses';
type GeometryKind = 'Point' | 'LineString' | 'Polygon';
type MobilePanel = 'map' | 'browse' | 'terrain';
type ProjectFilter = 'all' | 'ongoing' | 'completed' | 'withReports' | 'withSatellite' | 'largeBudget';
type MapViewport = { center: [number, number]; zoom: number; bounds: [[number, number], [number, number]] };
type FundingYearSummary = { funding_year: number; cell_count: number; project_count: number; total_budget: number; total_cost: number };
type FundingHeatmapFeature = {
  type: 'Feature';
  properties: { year: number; projectCount: number; totalBudget: number; totalCost: number; maxProjectBudget: number; topContractIds: string[] };
  geometry: { type: 'Point'; coordinates: [number, number] };
};
type FundingHeatmapData = { type: 'FeatureCollection'; selectedYear: number | null; years: FundingYearSummary[]; features: FundingHeatmapFeature[] };

type LocationPreset = { name: string; subtitle: string; center: [number, number]; zoom: number; national?: boolean; projectQuery: string };
type FloodControlProject = {
  contractId: string;
  description: string;
  category: string;
  componentCategories?: string | string[];
  status?: string;
  budget?: number;
  amountPaid?: number;
  progress?: number;
  location?: { region?: string; province?: string; municipality?: string; barangay?: string };
  contractor?: string;
  startDate?: string;
  completionDate?: string;
  infraYear?: string | number;
  programName?: string;
  sourceOfFunds?: string;
  isLive?: boolean;
  livestreamUrl?: string | null;
  latitude: number;
  longitude: number;
  reportCount?: number;
  hasSatelliteImage?: boolean;
};

type InfrastructureProject = {
  id: number;
  tool: Tool;
  label: string;
  lngLat: [number, number];
  geometry: { type: GeometryKind; coordinates: unknown };
  benefitScore: number;
  params: string;
};

type MitigationFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: { id: number; tool: Tool; label: string; benefitScore: number };
    geometry: InfrastructureProject['geometry'];
  }>;
};

const datasetUrl = '/datasets/noah_hazard_maps.pmtiles';
const sourceLayers = ['flood_5yr', 'flood_25yr', 'flood_100yr', 'landslide', 'debris_flow', 'storm_surge_ssa1', 'storm_surge_ssa2', 'storm_surge_ssa3', 'storm_surge_ssa4'];

const scenarios: Array<{ name: Scenario; sourceLayer?: string; depth: string; affected: number; homes: number; roads: number; assets: number; color: string }> = [
  { name: 'Clear', depth: 'Vanilla map', affected: 0, homes: 0, roads: 0, assets: 0, color: '#94a3b8' },
  { name: '5-Year Flood', sourceLayer: 'flood_5yr', depth: '0.7 m', affected: 23100, homes: 7180, roads: 52, assets: 4.8, color: '#06b6d4' },
  { name: '25-Year Flood', sourceLayer: 'flood_25yr', depth: '1.4 m', affected: 58600, homes: 18150, roads: 104, assets: 9.7, color: '#0ea5e9' },
  { name: '50-Year Flood', sourceLayer: 'flood_25yr', depth: '2.1 m', affected: 91200, homes: 28740, roads: 143, assets: 13.9, color: '#2563eb' },
  { name: '100-Year Flood', sourceLayer: 'flood_100yr', depth: '3.4 m', affected: 138900, homes: 42180, roads: 184, assets: 18.6, color: '#7c3aed' },
];

const locations: LocationPreset[] = [
  { name: 'Philippines', subtitle: 'National flood concentration view', center: [122.4, 12.65], zoom: 4.9, national: true, projectQuery: '' },
  { name: 'Naga City', subtitle: 'Bicol River Basin', center: [123.8854, 13.6218], zoom: 13.4, projectQuery: 'Bicol' },
  { name: 'Metro Manila', subtitle: 'Marikina / Pasig floodplain', center: [121.0437, 14.6507], zoom: 13.1, projectQuery: 'Marikina Pasig Metro Manila' },
  { name: 'Cagayan de Oro', subtitle: 'Cagayan River', center: [124.6319, 8.4542], zoom: 13.4, projectQuery: 'Cagayan de Oro' },
  { name: 'Tacloban', subtitle: 'Leyte storm-surge zone', center: [125.0, 11.244], zoom: 13.4, projectQuery: 'Tacloban' },
  { name: 'Iloilo City', subtitle: 'Panay urban coast', center: [122.5621, 10.7202], zoom: 13.4, projectQuery: 'Iloilo City' },
];

const floodConcentration = {
  type: 'FeatureCollection' as const,
  features: [
    { type: 'Feature' as const, properties: { name: 'Metro Manila / Marikina-Pasig', intensity: 0.95, affected: 'Dense urban floodplain' }, geometry: { type: 'Point' as const, coordinates: [121.0437, 14.6507] } },
    { type: 'Feature' as const, properties: { name: 'Central Luzon / Pampanga', intensity: 0.86, affected: 'Low-lying basin concentration' }, geometry: { type: 'Point' as const, coordinates: [120.72, 15.08] } },
    { type: 'Feature' as const, properties: { name: 'Cagayan Valley', intensity: 0.75, affected: 'Riverine flood corridor' }, geometry: { type: 'Point' as const, coordinates: [121.72, 17.62] } },
    { type: 'Feature' as const, properties: { name: 'Bicol River Basin', intensity: 0.82, affected: 'Naga / Camarines Sur basin' }, geometry: { type: 'Point' as const, coordinates: [123.62, 13.62] } },
    { type: 'Feature' as const, properties: { name: 'Panay / Iloilo', intensity: 0.68, affected: 'Urban coast and river systems' }, geometry: { type: 'Point' as const, coordinates: [122.56, 10.72] } },
    { type: 'Feature' as const, properties: { name: 'Leyte / Tacloban', intensity: 0.7, affected: 'Coastal flood and surge exposure' }, geometry: { type: 'Point' as const, coordinates: [125.0, 11.24] } },
    { type: 'Feature' as const, properties: { name: 'Northern Mindanao / CDO', intensity: 0.72, affected: 'Cagayan de Oro river system' }, geometry: { type: 'Point' as const, coordinates: [124.63, 8.45] } },
    { type: 'Feature' as const, properties: { name: 'Cotabato Basin', intensity: 0.64, affected: 'Mindanao river basin' }, geometry: { type: 'Point' as const, coordinates: [124.25, 7.22] } },
  ],
};

const infrastructureTools: Array<{ name: Tool; description: string; params: string; benefit: number }> = [
  { name: 'Flood Wall', description: 'Places a linear barrier and estimates protected frontage.', params: 'height 2.5m · length 600m', benefit: 0.11 },
  { name: 'Retention Basin', description: 'Places temporary storage in a low-lying area.', params: 'capacity 180k m³ · depth 4m', benefit: 0.16 },
  { name: 'Diversion Channel', description: 'Routes excess flow to a nearby waterway.', params: 'width 18m · depth 3m', benefit: 0.14 },
  { name: 'Pump Station', description: 'Adds discharge capacity at a priority outfall.', params: '12 m³/s · 3 pumps', benefit: 0.08 },
];

let protocolRegistered = false;
function ensurePmtilesProtocol() {
  if (protocolRegistered) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  protocolRegistered = true;
}

function hazardColor(layer: string) {
  if (layer.startsWith('flood')) return ['interpolate', ['linear'], ['coalesce', ['get', 'Var'], 1], 1, '#67e8f9', 2, '#22d3ee', 3, '#2563eb', 4, '#6d28d9'];
  if (layer.startsWith('storm')) return ['interpolate', ['linear'], ['coalesce', ['get', 'HAZ'], 1], 1, '#fde68a', 2, '#fb923c', 3, '#ef4444', 4, '#991b1b'];
  if (layer === 'landslide') return ['interpolate', ['linear'], ['coalesce', ['get', 'HAZ'], 1], 1, '#bef264', 2, '#84cc16', 3, '#4d7c0f'];
  return ['interpolate', ['linear'], ['coalesce', ['get', 'HAZ'], 1], 1, '#f9a8d4', 2, '#ec4899', 3, '#9d174d'];
}

function fmtNumber(value: number) {
  return new Intl.NumberFormat('en-PH').format(Math.round(value));
}

function fmtPeso(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'n/a';
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 }).format(value);
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char));
}

function projectLocation(project: FloodControlProject) {
  return [project.location?.municipality, project.location?.province, project.location?.region].filter(Boolean).join(', ') || 'Unknown location';
}

function fmtDate(value?: string) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

function projectPopoverHtml(project: FloodControlProject) {
  const progress = typeof project.progress === 'number' && Number.isFinite(project.progress) ? Math.round(project.progress) : 0;
  const location = [project.location?.barangay, project.location?.municipality, project.location?.province, project.location?.region].filter(Boolean).join(', ') || 'Unknown location';
  const reportUrl = `https://bisto.ph/project/${encodeURIComponent(project.contractId)}`;

  return `
    <div class="floodlens-project-popup">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:#0d56ad">DPWH flood-control project</div>
      <div style="margin-top:4px;font-size:16px;font-weight:900;color:#111827">${escapeHtml(project.contractId)}</div>
      <div style="margin-top:8px;max-height:96px;overflow-y:auto;font-size:13px;line-height:1.45;color:#374151">${escapeHtml(project.description || 'No description available')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;font-size:12px">
        <div style="border-radius:10px;background:#f8fafc;padding:8px"><div style="color:#6b7280">Budget</div><div style="font-weight:800;color:#0d56ad">${escapeHtml(fmtPeso(project.budget))}</div></div>
        <div style="border-radius:10px;background:#f8fafc;padding:8px"><div style="color:#6b7280">Paid</div><div style="font-weight:800;color:#0d56ad">${escapeHtml(fmtPeso(project.amountPaid))}</div></div>
        <div style="border-radius:10px;background:#f8fafc;padding:8px"><div style="color:#6b7280">Status</div><div style="font-weight:800;color:#111827">${escapeHtml(project.status || 'Unknown')}</div></div>
        <div style="border-radius:10px;background:#f8fafc;padding:8px"><div style="color:#6b7280">Progress</div><div style="font-weight:800;color:#111827">${progress}%</div></div>
      </div>
      <div style="margin-top:12px;font-size:12px;line-height:1.55;color:#374151">
        <div><strong style="color:#6b7280">Location:</strong> ${escapeHtml(location)}</div>
        <div><strong style="color:#6b7280">Contractor:</strong> ${escapeHtml(project.contractor || 'n/a')}</div>
        <div><strong style="color:#6b7280">Program:</strong> ${escapeHtml(project.programName || 'n/a')}</div>
        <div><strong style="color:#6b7280">Source:</strong> ${escapeHtml(project.sourceOfFunds || 'n/a')} · <strong style="color:#6b7280">Year:</strong> ${escapeHtml(project.infraYear || 'n/a')}</div>
        <div><strong style="color:#6b7280">Timeline:</strong> ${escapeHtml(fmtDate(project.startDate))} → ${escapeHtml(fmtDate(project.completionDate))}</div>
        <div><strong style="color:#6b7280">Reports:</strong> ${fmtNumber(project.reportCount ?? 0)} · <strong style="color:#6b7280">Satellite:</strong> ${project.hasSatelliteImage ? 'yes' : 'no'}</div>
      </div>
      <a href="${escapeHtml(reportUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;width:100%;margin-top:14px;border-radius:10px;background:#0d56ad;color:#ffffff;font-size:13px;font-weight:800;line-height:1;text-align:center;padding:12px 14px;text-decoration:none">Report a problem</a>
    </div>
  `;
}

const projectFilters: Array<{ key: ProjectFilter; label: string; description: string }> = [
  { key: 'all', label: 'All', description: 'Every returned DPWH flood-control project' },
  { key: 'ongoing', label: 'Ongoing', description: 'Projects not marked completed' },
  { key: 'completed', label: 'Completed', description: 'Finished projects' },
  { key: 'withReports', label: 'With reports', description: 'Has citizen/monitoring reports' },
  { key: 'withSatellite', label: 'Satellite', description: 'Has satellite imagery' },
  { key: 'largeBudget', label: '₱100M+', description: 'Large-budget projects' },
];

function filterFloodControlProjects(projects: FloodControlProject[], filter: ProjectFilter) {
  if (filter === 'all') return projects;
  if (filter === 'ongoing') return projects.filter((project) => !String(project.status ?? '').toLowerCase().includes('completed'));
  if (filter === 'completed') return projects.filter((project) => String(project.status ?? '').toLowerCase().includes('completed'));
  if (filter === 'withReports') return projects.filter((project) => (project.reportCount ?? 0) > 0);
  if (filter === 'withSatellite') return projects.filter((project) => Boolean(project.hasSatelliteImage));
  return projects.filter((project) => (project.budget ?? 0) >= 100_000_000);
}

function projectFundingYear(project: FloodControlProject) {
  const match = String(project.infraYear ?? '').match(/\d{4}/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function projectWithinBounds(project: FloodControlProject, bounds: MapViewport['bounds'], paddingRatio = 0.12) {
  const [[west, south], [east, north]] = bounds;
  const lngPad = Math.max(0.08, (east - west) * paddingRatio);
  const latPad = Math.max(0.08, (north - south) * paddingRatio);
  return project.longitude >= west - lngPad && project.longitude <= east + lngPad && project.latitude >= south - latPad && project.latitude <= north + latPad;
}

function closestProjectQuery(center: [number, number], zoom: number) {
  if (zoom < 6) return '';
  const [lng, lat] = center;
  const closest = locations
    .filter((location) => !location.national)
    .map((location) => {
      const [locLng, locLat] = location.center;
      const distance = Math.hypot((locLng - lng) * Math.cos((lat * Math.PI) / 180), locLat - lat);
      return { location, distance };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  return closest && closest.distance < (zoom >= 10 ? 1.2 : 2.5) ? closest.location.projectQuery : '';
}

function viewportBboxParam(bounds: MapViewport['bounds']) {
  const [[west, south], [east, north]] = bounds;
  return [west, south, east, north].map((value) => value.toFixed(4)).join(',');
}

function asProjectGeojson(projects: FloodControlProject[]) {
  return {
    type: 'FeatureCollection' as const,
    features: projects
      .filter((project) => Number.isFinite(project.latitude) && Number.isFinite(project.longitude))
      .map((project) => ({
        type: 'Feature' as const,
        properties: {
          contractId: project.contractId,
          description: project.description,
          status: project.status ?? 'Unknown',
          budget: project.budget ?? 0,
          progress: project.progress ?? 0,
          contractor: project.contractor ?? '',
          programName: project.programName ?? '',
          infraYear: project.infraYear ?? '',
          location: projectLocation(project),
          reportCount: project.reportCount ?? 0,
          hasSatelliteImage: Boolean(project.hasSatelliteImage),
        },
        geometry: { type: 'Point' as const, coordinates: [project.longitude, project.latitude] },
      })),
  };
}

function emptyFeatureCollection() {
  return { type: 'FeatureCollection' as const, features: [] };
}

function fundingSummaryForYear(data: FundingHeatmapData | null, year: number | null) {
  if (!data || year === null) return null;
  return data.years.find((item) => item.funding_year === year) ?? null;
}

function circlePolygon(center: [number, number], radiusKm: number, points = 48) {
  const [lng, lat] = center;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    const dx = (Math.cos(angle) * radiusKm) / (111.32 * Math.cos((lat * Math.PI) / 180));
    const dy = (Math.sin(angle) * radiusKm) / 110.57;
    coords.push([lng + dx, lat + dy]);
  }
  return [coords];
}

function makeProject(tool: Tool, lngLat: [number, number], id: number): InfrastructureProject {
  const meta = infrastructureTools.find((item) => item.name === tool) ?? infrastructureTools[0];
  const [lng, lat] = lngLat;
  const geometry = tool === 'Retention Basin'
    ? { type: 'Polygon' as const, coordinates: circlePolygon(lngLat, 0.45) }
    : tool === 'Pump Station'
      ? { type: 'Point' as const, coordinates: lngLat }
      : { type: 'LineString' as const, coordinates: [[lng - 0.006, lat - 0.002], [lng + 0.006, lat + 0.002]] };
  return { id, tool, label: `${tool} ${id}`, lngLat, geometry, benefitScore: meta.benefit, params: meta.params };
}

function asMitigationGeojson(projects: InfrastructureProject[]): MitigationFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: projects.map((project) => ({
      type: 'Feature',
      properties: { id: project.id, tool: project.tool, label: project.label, benefitScore: project.benefitScore },
      geometry: project.geometry,
    })),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function MapPreview({
  scenario,
  opacity,
  visibleLayers,
  selectedLocation,
  terrainEnabled,
  terrainExaggeration,
  drawingTool,
  projects,
  floodControlProjects,
  fundingHeatmapData,
  selectedFundingYear,
  onFundingYearChange,
  fundingHeatmapLoading,
  onPlaceProject,
  onSelectFloodControlProject,
  onViewportChange,
  mobileApp = false,
  fullScreen = false,
  navigationSeq = 0,
}: {
  scenario: (typeof scenarios)[number];
  opacity: number;
  visibleLayers: Record<LayerKey, boolean>;
  selectedLocation: LocationPreset;
  terrainEnabled: boolean;
  terrainExaggeration: number;
  drawingTool: Tool | null;
  projects: InfrastructureProject[];
  floodControlProjects: FloodControlProject[];
  fundingHeatmapData: FundingHeatmapData | null;
  selectedFundingYear: number | null;
  onFundingYearChange: (year: number) => void;
  fundingHeatmapLoading: boolean;
  onPlaceProject: (lngLat: [number, number]) => void;
  onSelectFloodControlProject: (project: FloodControlProject) => void;
  onViewportChange: (viewport: MapViewport) => void;
  mobileApp?: boolean;
  fullScreen?: boolean;
  navigationSeq?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const initialLocationRef = useRef(selectedLocation);
  const drawingToolRef = useRef(drawingTool);
  const onPlaceProjectRef = useRef(onPlaceProject);
  const onSelectFloodControlProjectRef = useRef(onSelectFloodControlProject);
  const onViewportChangeRef = useRef(onViewportChange);
  const floodControlProjectsRef = useRef(floodControlProjects);
  const fundingBufferRef = useRef<'a' | 'b'>('a');

  useEffect(() => {
    drawingToolRef.current = drawingTool;
    onPlaceProjectRef.current = onPlaceProject;
    onSelectFloodControlProjectRef.current = onSelectFloodControlProject;
    onViewportChangeRef.current = onViewportChange;
    floodControlProjectsRef.current = floodControlProjects;
  }, [drawingTool, onPlaceProject, onSelectFloodControlProject, onViewportChange, floodControlProjects]);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    ensurePmtilesProtocol();

    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        transition: { duration: 650, delay: 0 },
        sources: {
          osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
          noah: { type: 'vector', url: `pmtiles://${window.location.origin}${datasetUrl}`, attribution: 'Project NOAH / BetterGov.ph' },
          floodConcentration: { type: 'geojson', data: floodConcentration },
          'terrain-dem': { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', attribution: 'Terrain: AWS Open Data Terrarium DEM' },
          // OSMBuildings' standalone package is Leaflet/OpenLayers-era and does not
          // integrate cleanly with MapLibre. OpenFreeMap exposes the same OSM-derived
          // building footprints as vector tiles, so render them natively with
          // MapLibre fill-extrusion layers instead.
          buildings: { type: 'vector', url: 'https://tiles.openfreemap.org/planet', attribution: 'OpenFreeMap / OpenMapTiles / OpenStreetMap' },
          floodControlProjects: { type: 'geojson', data: asProjectGeojson([]) },
          fundingHeatmapA: { type: 'geojson', data: emptyFeatureCollection() },
          fundingHeatmapB: { type: 'geojson', data: emptyFeatureCollection() },
          mitigation: { type: 'geojson', data: asMitigationGeojson([]) },
        },
        layers: [
          { id: 'osm', type: 'raster', source: 'osm' },
          { id: 'hillshade', type: 'hillshade', source: 'terrain-dem', paint: { 'hillshade-shadow-color': '#0f172a', 'hillshade-highlight-color': '#e0f2fe', 'hillshade-accent-color': '#0891b2' }, layout: { visibility: 'none' } },
        ],
      },
      center: initialLocationRef.current.center,
      zoom: initialLocationRef.current.zoom,
      pitch: initialLocationRef.current.national ? 0 : 55,
      bearing: initialLocationRef.current.national ? 0 : -18,
      maxPitch: 85,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.dragRotate.enable();
    map.touchZoomRotate.enable();
    map.touchZoomRotate.enableRotation();
    map.keyboard.enable();

    const canvas = map.getCanvas();
    let modifierDrag: { pointerId: number; x: number; y: number; bearing: number; pitch: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || (!event.altKey && !event.metaKey)) return;
      event.preventDefault();
      modifierDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, bearing: map.getBearing(), pitch: map.getPitch() };
      canvas.setPointerCapture(event.pointerId);
      map.dragPan.disable();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!modifierDrag || event.pointerId !== modifierDrag.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - modifierDrag.x;
      const dy = event.clientY - modifierDrag.y;
      map.jumpTo({
        bearing: modifierDrag.bearing - dx * 0.35,
        pitch: clamp(modifierDrag.pitch + dy * 0.25, 0, 85),
      });
    };
    const endModifierDrag = (event: PointerEvent) => {
      if (!modifierDrag || event.pointerId !== modifierDrag.pointerId) return;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
      modifierDrag = null;
      map.dragPan.enable();
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endModifierDrag);
    canvas.addEventListener('pointercancel', endModifierDrag);

    map.on('load', () => {
      map.addLayer({
        id: 'flood-concentration-heat',
        type: 'heatmap',
        source: 'floodConcentration',
        maxzoom: 8,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'intensity'], 0, 0, 1, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3.5, 0.75, 7, 1.8],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(6,182,212,0)', 0.25, 'rgba(34,211,238,0.38)', 0.55, 'rgba(37,99,235,0.58)', 0.82, 'rgba(124,58,237,0.74)', 1, 'rgba(248,113,113,0.9)'],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3.5, 34, 7, 72],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.82, 8, 0],
        },
      });
      map.addLayer({
        id: 'flood-concentration-points',
        type: 'circle',
        source: 'floodConcentration',
        maxzoom: 8.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'intensity'], 0.6, 9, 1, 18],
          'circle-color': ['interpolate', ['linear'], ['get', 'intensity'], 0.6, '#22d3ee', 0.82, '#2563eb', 1, '#f97316'],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.88, 8.5, 0],
          'circle-stroke-color': 'rgba(255,255,255,0.85)',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'flood-concentration-labels',
        type: 'symbol',
        source: 'floodConcentration',
        minzoom: 4.3,
        maxzoom: 7.2,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.7],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#e0f2fe',
          'text-halo-color': '#020617',
          'text-halo-width': 1.5,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.72, 7.2, 0],
        },
      });
      (['a', 'b'] as const).forEach((buffer) => {
        map.addLayer({
          id: `funding-heatmap-${buffer}`,
          type: 'heatmap',
          source: `fundingHeatmap${buffer.toUpperCase()}`,
          maxzoom: 12,
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'totalBudget'], 0], 0, 0, 50000000, 0.35, 200000000, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.75, 9, 1.85, 12, 2.35],
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(16,185,129,0)', 0.25, 'rgba(45,212,191,0.38)', 0.5, 'rgba(14,165,233,0.55)', 0.75, 'rgba(245,158,11,0.72)', 1, 'rgba(220,38,38,0.9)'],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 20, 8, 44, 12, 82],
            'heatmap-opacity': 0,
          },
        });
        map.addLayer({
          id: `funding-heatmap-points-${buffer}`,
          type: 'circle',
          source: `fundingHeatmap${buffer.toUpperCase()}`,
          minzoom: 8.5,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'totalBudget'], 0], 0, 4, 50000000, 8, 250000000, 15],
            'circle-color': '#0ea5e9',
            'circle-opacity': 0,
            'circle-stroke-color': '#ecfeff',
            'circle-stroke-width': 1.4,
          },
        });
      });
      sourceLayers.forEach((layer) => {
        map.addLayer({
          id: `hazard-${layer}`,
          type: 'fill',
          source: 'noah',
          'source-layer': layer,
          paint: { 'fill-color': hazardColor(layer) as maplibregl.ExpressionSpecification, 'fill-opacity': 0.58, 'fill-outline-color': 'rgba(255,255,255,0.35)' },
        });
      });
      map.addLayer({
        id: 'building-extrusions',
        type: 'fill-extrusion',
        source: 'buildings',
        'source-layer': 'building',
        minzoom: 13,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['coalesce', ['get', 'colour'], '#dbeafe'],
          'fill-extrusion-opacity': 0.58,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['coalesce', ['get', 'render_height'], 10]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-vertical-gradient': true,
        },
      });
      map.addLayer({
        id: 'house-extrusions',
        type: 'fill-extrusion',
        source: 'buildings',
        'source-layer': 'building',
        minzoom: 14,
        // OpenFreeMap's public building layer exposes height/color fields but not
        // a reliable residential class. Treat low-rise buildings as a useful
        // proxy for houses/footprints until a richer local OSM extract is added.
        filter: ['<=', ['coalesce', ['get', 'render_height'], 8], 12],
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#fef3c7',
          'fill-extrusion-opacity': 0.72,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, ['coalesce', ['get', 'render_height'], 7]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-vertical-gradient': true,
        },
      });
      map.addLayer({ id: 'flood-control-project-heat', type: 'heatmap', source: 'floodControlProjects', maxzoom: 8.5, paint: { 'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'budget'], 0], 0, 0.35, 100000000, 1], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 8, 1.9], 'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(249,115,22,0)', 0.35, 'rgba(251,146,60,0.45)', 0.7, 'rgba(249,115,22,0.7)', 1, 'rgba(220,38,38,0.9)'], 'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 18, 8, 48], 'heatmap-opacity': 0.8 } });
      map.addLayer({ id: 'flood-control-project-pins', type: 'circle', source: 'floodControlProjects', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 12, 8, 15, 11], 'circle-color': '#f97316', 'circle-opacity': 0.92, 'circle-stroke-color': '#fff7ed', 'circle-stroke-width': 1.8 } });
      map.addLayer({ id: 'flood-control-project-labels', type: 'symbol', source: 'floodControlProjects', minzoom: 10, layout: { 'text-field': ['get', 'contractId'], 'text-size': 10, 'text-offset': [0, 1.25], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': '#fed7aa', 'text-halo-color': '#431407', 'text-halo-width': 1.2 } });
      map.addLayer({ id: 'mitigation-fill', type: 'fill', source: 'mitigation', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.28, 'fill-outline-color': '#bbf7d0' } });
      map.addLayer({ id: 'mitigation-line', type: 'line', source: 'mitigation', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#facc15', 'line-width': 5, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'mitigation-point', type: 'circle', source: 'mitigation', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 10, 'circle-color': '#fb7185', 'circle-stroke-color': '#fff1f2', 'circle-stroke-width': 2 } });
    });

    const emitViewport = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      onViewportChangeRef.current({
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bounds: [[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]],
      });
    };
    map.once('idle', emitViewport);
    map.on('moveend', emitViewport);
    map.on('zoomend', emitViewport);

    map.on('click', (event) => {
      if (drawingToolRef.current) {
        onPlaceProjectRef.current([event.lngLat.lng, event.lngLat.lat]);
        return;
      }

      const projectFeature = map.queryRenderedFeatures(event.point, { layers: ['flood-control-project-pins'].filter((id) => map.getLayer(id)) })[0];
      if (!projectFeature?.properties) {
        popupRef.current?.remove();
        return;
      }

      const props = projectFeature.properties as Record<string, unknown>;
      const contractId = String(props.contractId ?? '');
      const project = floodControlProjectsRef.current.find((item) => item.contractId === contractId);
      if (!project) {
        popupRef.current?.remove();
        return;
      }

      onSelectFloodControlProjectRef.current(project);
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({
        maxWidth: '420px',
        className: 'floodlens-project-popup-shell',
      }).setLngLat(event.lngLat).setHTML(projectPopoverHtml(project)).addTo(map);
    });

    return () => {
      popupRef.current?.remove();
      map.off('moveend', emitViewport);
      map.off('zoomend', emitViewport);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endModifierDrag);
      canvas.removeEventListener('pointercancel', endModifierDrag);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const camera = { center: selectedLocation.center, zoom: selectedLocation.zoom, pitch: selectedLocation.national ? 0 : terrainEnabled ? 72 : 44, bearing: selectedLocation.national ? 0 : -18, duration: 1000 };
    map.resize();
    map.stop();
    map.flyTo(camera);
    const retry = window.setTimeout(() => {
      map.resize();
      map.flyTo({ ...camera, duration: 450 });
    }, 80);
    return () => window.clearTimeout(retry);
  }, [selectedLocation, terrainEnabled, navigationSeq]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyVisibility = () => {
      ['flood-control-project-heat', 'flood-control-project-pins', 'flood-control-project-labels'].forEach((id) => {
        if (!map.getLayer(id)) return;
        map.setLayoutProperty(id, 'visibility', visibleLayers.projects ? 'visible' : 'none');
      });
      ['funding-heatmap-a', 'funding-heatmap-b', 'funding-heatmap-points-a', 'funding-heatmap-points-b'].forEach((id) => {
        if (!map.getLayer(id)) return;
        map.setLayoutProperty(id, 'visibility', visibleLayers.funding ? 'visible' : 'none');
      });
      ['building-extrusions', 'house-extrusions'].forEach((id) => {
        if (!map.getLayer(id)) return;
        const visible = id === 'building-extrusions' ? visibleLayers.buildings : visibleLayers.houses;
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      });
      ['flood-concentration-heat', 'flood-concentration-points', 'flood-concentration-labels'].forEach((id) => {
        if (!map.getLayer(id)) return;
        map.setLayoutProperty(id, 'visibility', visibleLayers.flood && Boolean(scenario.sourceLayer) ? 'visible' : 'none');
      });
      sourceLayers.forEach((layer) => {
        const id = `hazard-${layer}`;
        if (!map.getLayer(id)) return;
        const isFlood = layer.startsWith('flood');
        const visible = (isFlood && visibleLayers.flood && scenario.sourceLayer === layer) || (layer === 'landslide' && visibleLayers.landslide) || (layer === 'debris_flow' && visibleLayers.debrisFlow) || (layer.startsWith('storm_surge') && visibleLayers.stormSurge);
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        map.setPaintProperty(id, 'fill-opacity', visible ? opacity : 0);
      });
    };
    if (map.isStyleLoaded()) applyVisibility();
    map.once('idle', applyVisibility);
  }, [scenario, opacity, visibleLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyTerrain = () => {
      if (!map.getSource('terrain-dem')) return;
      map.setLayoutProperty('hillshade', 'visibility', terrainEnabled ? 'visible' : 'none');
      map.setTerrain(terrainEnabled ? { source: 'terrain-dem', exaggeration: terrainExaggeration } : null);
      if (terrainEnabled && !selectedLocation.national) map.easeTo({ pitch: 72, duration: 700 });
    };
    if (map.isStyleLoaded()) applyTerrain();
    map.once('idle', applyTerrain);
  }, [terrainEnabled, terrainExaggeration, selectedLocation.national]);

  useEffect(() => {
    const source = mapRef.current?.getSource('mitigation') as maplibregl.GeoJSONSource | undefined;
    source?.setData(asMitigationGeojson(projects));
  }, [projects]);

  useEffect(() => {
    const source = mapRef.current?.getSource('floodControlProjects') as maplibregl.GeoJSONSource | undefined;
    source?.setData(asProjectGeojson(floodControlProjects));
  }, [floodControlProjects]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fundingHeatmapData) return;
    const applyFundingData = () => {
      const nextBuffer = fundingBufferRef.current === 'a' ? 'b' : 'a';
      const previousBuffer = fundingBufferRef.current;
      const nextSource = map.getSource(`fundingHeatmap${nextBuffer.toUpperCase()}`) as maplibregl.GeoJSONSource | undefined;
      if (!nextSource) return;
      nextSource.setData(fundingHeatmapData);
      const nextLayer = `funding-heatmap-${nextBuffer}`;
      const previousLayer = `funding-heatmap-${previousBuffer}`;
      const nextPointLayer = `funding-heatmap-points-${nextBuffer}`;
      const previousPointLayer = `funding-heatmap-points-${previousBuffer}`;
      if (map.getLayer(nextLayer)) map.setPaintProperty(nextLayer, 'heatmap-opacity', visibleLayers.funding ? 0.82 : 0);
      if (map.getLayer(previousLayer)) map.setPaintProperty(previousLayer, 'heatmap-opacity', 0);
      if (map.getLayer(nextPointLayer)) map.setPaintProperty(nextPointLayer, 'circle-opacity', visibleLayers.funding ? ['interpolate', ['linear'], ['zoom'], 8.5, 0, 11, 0.74] : 0);
      if (map.getLayer(previousPointLayer)) map.setPaintProperty(previousPointLayer, 'circle-opacity', 0);
      fundingBufferRef.current = nextBuffer;
    };
    if (map.isStyleLoaded()) applyFundingData();
    else map.once('idle', applyFundingData);
  }, [fundingHeatmapData, visibleLayers.funding]);

  const fundingYears = fundingHeatmapData?.years.map((item) => item.funding_year).filter(Number.isFinite) ?? [];
  const activeFundingYear = selectedFundingYear ?? fundingHeatmapData?.selectedYear ?? fundingYears[fundingYears.length - 1] ?? null;
  const activeFundingSummary = fundingSummaryForYear(fundingHeatmapData, activeFundingYear);
  const activeFundingIndex = activeFundingYear === null ? -1 : fundingYears.indexOf(activeFundingYear);
  const fundingTickYears = fundingYears.filter((_, index) => mobileApp || fundingYears.length <= 8 || index === 0 || index === fundingYears.length - 1 || index % 2 === 0);
  const [timelineIndex, setTimelineIndex] = useState(0);
  const [timelineDragging, setTimelineDragging] = useState(false);

  useEffect(() => {
    if (timelineDragging || activeFundingIndex < 0) return;
    setTimelineIndex(activeFundingIndex);
  }, [activeFundingIndex, timelineDragging]);

  const updateTimelinePosition = (value: number, snap = false) => {
    const maxIndex = Math.max(0, fundingYears.length - 1);
    const nextIndex = clamp(value, 0, maxIndex);
    const snappedIndex = clamp(Math.round(nextIndex), 0, maxIndex);
    setTimelineIndex(snap ? snappedIndex : nextIndex);
    const nextYear = fundingYears[snappedIndex];
    if (nextYear !== undefined && nextYear !== activeFundingYear) onFundingYearChange(nextYear);
  };

  return (
    <div className={`relative overflow-hidden bg-white shadow-glow ${mobileApp ? 'h-full rounded-none border-0' : fullScreen ? 'h-full min-h-0 rounded-none border-0' : 'h-[68svh] min-h-[440px] rounded-[1.35rem] border border-blue-100 sm:h-[72svh] md:h-[660px] md:rounded-[2rem]'}`}>
      <div ref={ref} className={`absolute inset-0 ${drawingTool ? 'cursor-crosshair' : ''}`} />
      <div className={`pointer-events-none absolute rounded-2xl border border-gray-200 bg-white/85 text-gray-900 backdrop-blur-xl ${mobileApp ? 'left-4 right-4 top-[max(1rem,env(safe-area-inset-top))] p-3' : 'left-3 right-3 top-3 p-3 sm:left-5 sm:right-auto sm:top-5 sm:max-w-sm sm:p-4'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-primary sm:text-sm sm:tracking-[0.24em]"><Waves className="h-4 w-4" /> Flood Watch by BetterGov.ph</div>
            <div className="mt-1 text-lg font-semibold sm:text-2xl">{scenario.name}</div>
            <div className="mt-0.5 text-xs text-gray-600 sm:text-sm">{selectedLocation.name} · {terrainEnabled ? `${terrainExaggeration.toFixed(1)}× 3D` : '2D view'}</div>
          </div>
          <div className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">LIVE</div>
        </div>
        {!mobileApp && <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-700 sm:mt-3 sm:text-xs"><Database className="h-3.5 w-3.5" /> PMTiles range loading</div>}
      </div>
      {drawingTool && <div className={`absolute z-10 rounded-2xl border border-amber-200 bg-amber-300 p-3 text-center text-sm font-semibold text-gray-900 shadow-xl ${mobileApp ? 'left-4 right-4 top-32' : 'bottom-3 left-3 right-3 sm:bottom-auto sm:left-auto sm:right-5 sm:top-24 sm:p-4 sm:text-left sm:text-base'}`}>Tap map to place: {drawingTool}</div>}
      {visibleLayers.funding && fundingYears.length > 0 && (
        <div className={`absolute z-20 rounded-xl border border-gray-200 bg-white/90 text-gray-900 shadow-2xl backdrop-blur-xl ${mobileApp ? 'bottom-[5.4rem] left-3 right-3 p-2.5' : fullScreen ? 'bottom-6 left-6 w-[min(540px,calc(100vw-36rem))] p-3' : 'bottom-5 left-1/2 w-[min(560px,calc(100%-2.5rem))] -translate-x-1/2 p-3'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-primary"><CalendarClock className="h-3.5 w-3.5" /> Funding timeline</div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <div className="text-xl font-black">{activeFundingYear ?? 'n/a'}</div>
                <div className="text-xs text-gray-600">{fundingHeatmapLoading ? 'Updating...' : `${fmtPeso(activeFundingSummary?.total_budget)} funded`}</div>
                <div className="text-[11px] text-gray-500">{fmtNumber(activeFundingSummary?.project_count ?? fundingHeatmapData?.features.length ?? 0)} projects</div>
              </div>
            </div>
            <div className="hidden items-center gap-2 text-[11px] text-gray-500 sm:flex">
              <span>{fundingYears[0]}</span>
              <span>{fundingYears[fundingYears.length - 1]}</span>
            </div>
          </div>
          <div className="mt-1.5">
            <input
              className="m-0 w-full cursor-pointer accent-primary"
              type="range"
              min={0}
              max={Math.max(0, fundingYears.length - 1)}
              step={0.01}
              value={timelineIndex}
              onPointerDown={() => setTimelineDragging(true)}
              onPointerUp={(event) => {
                setTimelineDragging(false);
                updateTimelinePosition(Number(event.currentTarget.value), true);
              }}
              onPointerCancel={(event) => {
                setTimelineDragging(false);
                updateTimelinePosition(Number(event.currentTarget.value), true);
              }}
              onBlur={(event) => {
                setTimelineDragging(false);
                updateTimelinePosition(Number(event.currentTarget.value), true);
              }}
              onChange={(event) => updateTimelinePosition(Number(event.target.value))}
            />
            <div className="relative -mt-1 h-5 border-t border-gray-300">
              {fundingYears.map((year, index) => {
                const left = fundingYears.length === 1 ? 0 : (index / (fundingYears.length - 1)) * 100;
                const showLabel = fundingTickYears.includes(year);
                return (
                  <div key={year} className="absolute top-0 -translate-x-1/2" style={{ left: `${left}%` }}>
                    <div className={`mx-auto w-px bg-gray-400 ${showLabel ? 'h-2' : 'h-1.5 opacity-60'}`} />
                    {showLabel && <div className="mt-0.5 text-[9px] font-semibold leading-none text-gray-500">{year}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {!mobileApp && !visibleLayers.funding && <div className="absolute bottom-5 left-5 right-5 hidden gap-3 rounded-2xl border border-gray-200 bg-white/85 p-4 text-gray-900 backdrop-blur-xl sm:grid md:grid-cols-4">{['Click pins for project details', 'Pan / zoom / rotate enabled', 'NOAH flood layers', 'DPWH flood-control overlay'].map((layer) => <div key={layer} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm"><Layers3 className="h-4 w-4 text-primary" /> {layer}</div>)}</div>}
    </div>
  );
}

function ScenarioControls({ scenarioName, setScenarioName }: { scenarioName: Scenario; setScenarioName: (value: Scenario) => void }) {
  return <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2">{scenarios.map((item) => <button key={item.name} onClick={() => setScenarioName(item.name)} className={`min-w-0 rounded-2xl border p-3 text-left transition ${scenarioName === item.name ? 'border-primary bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-100'}`}><div className="truncate text-sm font-semibold">{item.name}</div><div className="mt-1 text-base font-black leading-tight" style={{ color: item.color }}>{item.depth}</div></button>)}</div>;
}

function AppButton({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${active ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100'}`}>{children}</button>;
}

export default function App() {
  const [scenarioName, setScenarioName] = useState<Scenario>('100-Year Flood');
  const [opacity, setOpacity] = useState(0.58);
  const [selectedLocation, setSelectedLocation] = useState(locations[0]);
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerKey, boolean>>({ flood: true, landslide: false, stormSurge: false, debrisFlow: false, projects: true, funding: true, buildings: false, houses: false });
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const [terrainExaggeration, setTerrainExaggeration] = useState(2.2);
  const [drawingTool, setDrawingTool] = useState<Tool | null>(null);
  const [projects, setProjects] = useState<InfrastructureProject[]>([]);
  const [floodControlProjects, setFloodControlProjects] = useState<FloodControlProject[]>([]);
  const [fundingHeatmapData, setFundingHeatmapData] = useState<FundingHeatmapData | null>(null);
  const [selectedFundingYear, setSelectedFundingYear] = useState<number | null>(null);
  const [fundingHeatmapState, setFundingHeatmapState] = useState<{ loading: boolean; error: string | null }>({ loading: true, error: null });
  const [selectedFloodControlProject, setSelectedFloodControlProject] = useState<FloodControlProject | null>(null);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>('all');
  const [projectSearchState, setProjectSearchState] = useState<{ loading: boolean; error: string | null; total: number; query: string }>({ loading: true, error: null, total: 0, query: '' });
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('map');
  const [desktopView, setDesktopView] = useState<'landing' | 'terrain'>(() => (new URLSearchParams(window.location.search).get('v') === 'project' ? 'terrain' : 'landing'));
  const [navigationSeq, setNavigationSeq] = useState(0);
  const [mapViewport, setMapViewport] = useState<MapViewport>({ center: locations[0].center, zoom: locations[0].zoom, bounds: [[116, 4], [127, 21]] });

  const scenario = useMemo(() => scenarios.find((item) => item.name === scenarioName) ?? scenarios[4], [scenarioName]);
  // PostGIS is now the source of truth for project lookup, so viewport movement
  // should be driven by bbox only. Applying a location text query here can hide
  // valid pins inside the current bounds (for example Naga projects that do not
  // contain the word “Bicol” in searchable fields).
  const projectQuery = '';
  const projectLimit = mapViewport.zoom < 7 ? 1200 : mapViewport.zoom < 10 ? 900 : 450;
  const fundingHeatmapLimit = mapViewport.zoom < 6 ? 5000 : mapViewport.zoom < 8 ? 3200 : mapViewport.zoom < 11 ? 1800 : 900;
  const projectBbox = useMemo(() => viewportBboxParam(mapViewport.bounds), [mapViewport.bounds]);
  const handleViewportChange = useCallback((viewport: MapViewport) => {
    setMapViewport((current) => {
      const centerDelta = Math.hypot(current.center[0] - viewport.center[0], current.center[1] - viewport.center[1]);
      const zoomDelta = Math.abs(current.zoom - viewport.zoom);
      if (centerDelta < 0.01 && zoomDelta < 0.05) return current;
      return viewport;
    });
  }, []);
  const filteredFloodControlProjects = useMemo(() => {
    const filtered = filterFloodControlProjects(floodControlProjects, projectFilter);
    if (mapViewport.zoom < 7) return filtered;
    return filtered.filter((project) => projectWithinBounds(project, mapViewport.bounds));
  }, [floodControlProjects, projectFilter, mapViewport]);
  const yearFilteredFloodControlProjects = useMemo(() => {
    if (selectedFundingYear === null) return filteredFloodControlProjects;
    return filteredFloodControlProjects.filter((project) => projectFundingYear(project) === selectedFundingYear);
  }, [filteredFloodControlProjects, selectedFundingYear]);
  useEffect(() => {
    if (!selectedFloodControlProject) return;
    if (yearFilteredFloodControlProjects.some((project) => project.contractId === selectedFloodControlProject.contractId)) return;
    setSelectedFloodControlProject(null);
  }, [selectedFloodControlProject, yearFilteredFloodControlProjects]);
  const toggleLayer = (layer: LayerKey) => setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }));
  const jumpToLocation = (location: LocationPreset) => {
    setProjectSearchState((current) => ({ ...current, loading: true, error: null, total: 0 }));
    setSelectedFloodControlProject(null);
    setProjectFilter('all');
    setSelectedLocation({ ...location });
    setNavigationSeq((value) => value + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const q = projectQuery;
      const limit = projectLimit;
      const params = new URLSearchParams({ q, limit: String(limit), zoom: mapViewport.zoom.toFixed(2), bbox: projectBbox });
      setProjectSearchState((current) => ({ ...current, loading: true, error: null, query: q }));
      fetch(`/api/flood-control-projects?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Project search failed (${response.status})`);
          return response.json();
        })
        .then((payload) => {
          const result = payload.results?.[0];
          const hits = (result?.hits ?? []) as FloodControlProject[];
          const validHits = hits.filter((project) => Number.isFinite(project.latitude) && Number.isFinite(project.longitude));
          setFloodControlProjects(validHits);
          setProjectSearchState({ loading: false, error: null, total: result?.estimatedTotalHits ?? validHits.length, query: q });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setFloodControlProjects([]);
          setProjectSearchState({ loading: false, error: error instanceof Error ? error.message : 'Project search failed', total: 0, query: q });
        });
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [projectQuery, projectLimit, projectBbox, mapViewport.zoom]);

  useEffect(() => {
    if (!visibleLayers.funding) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ bbox: projectBbox, limit: String(fundingHeatmapLimit) });
      if (selectedFundingYear !== null) params.set('year', String(selectedFundingYear));
      setFundingHeatmapState({ loading: true, error: null });
      fetch(`/api/flood-funding-heatmap?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Funding heatmap failed (${response.status})`);
          return response.json();
        })
        .then((payload: FundingHeatmapData) => {
          setFundingHeatmapData(payload);
          setSelectedFundingYear((current) => {
            const availableYears = payload.years.map((item) => item.funding_year);
            if (current !== null && availableYears.includes(current)) return current;
            return payload.selectedYear ?? availableYears[availableYears.length - 1] ?? null;
          });
          setFundingHeatmapState({ loading: false, error: null });
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setFundingHeatmapState({ loading: false, error: error instanceof Error ? error.message : 'Funding heatmap failed' });
        });
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [visibleLayers.funding, projectBbox, selectedFundingYear, fundingHeatmapLimit]);

  const placeProject = (lngLat: [number, number]) => {
    if (!drawingTool) return;
    setProjects((current) => [...current, makeProject(drawingTool, lngLat, current.length + 1)]);
    setDrawingTool(null);
    setMobilePanel('map');
  };

  const featureCards = [
    { title: 'National overview first', body: 'Start with a country-wide flood concentration view, then drill into city-level Project NOAH hazard polygons.', icon: LocateFixed },
    { title: '3D terrain workspace', body: 'Use DEM terrain, hillshade, pitch, and exaggeration controls in a dedicated full-screen map page.', icon: Mountain },
    { title: 'DPWH project overlay', body: 'Load geocoded flood-control projects from PostGIS and inspect project details directly on the map.', icon: MapPinned },
    { title: 'Fast viewport search', body: 'Use bounding-box lookups to keep project pins responsive as planners pan and zoom.', icon: BarChart3 },
  ];

  const mobileNav = [
    { key: 'map' as const, label: 'Map', icon: Home },
    { key: 'browse' as const, label: 'Browse', icon: SlidersHorizontal },
    { key: 'terrain' as const, label: '3D', icon: Mountain },
  ];

  const mapProps = { scenario, opacity, visibleLayers, selectedLocation, terrainEnabled, terrainExaggeration, drawingTool, projects, floodControlProjects: yearFilteredFloodControlProjects, fundingHeatmapData, selectedFundingYear, onFundingYearChange: setSelectedFundingYear, fundingHeatmapLoading: fundingHeatmapState.loading, onPlaceProject: placeProject, onSelectFloodControlProject: setSelectedFloodControlProject, onViewportChange: handleViewportChange, navigationSeq };

  const controlsPanel = (
    <div className="h-full space-y-5 overflow-y-auto pr-1">
      <div className="rounded-3xl border border-blue-100 bg-white/90 p-5 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-primary">Terrain workspace</div>
            <h2 className="mt-2 text-2xl font-black">3D flood map</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">Full-screen map with a single control panel. Pan, zoom, rotate, inspect tiles, and place projects without scrolling through a page.</p>
          </div>
          <button onClick={() => setDesktopView('landing')} className="rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100">Landing</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-gray-50 p-3"><div className="text-gray-500">Scenario</div><div className="font-bold text-primary">{scenario.name}</div></div>
          <div className="rounded-2xl bg-gray-50 p-3"><div className="text-gray-500">Location</div><div className="font-bold text-primary">{selectedLocation.name}</div></div>
          <div className="col-span-2 rounded-2xl bg-amber-50 p-3"><div className="text-gray-500">Flood-control projects</div><div className="font-bold text-amber-800">{projectSearchState.loading ? 'Loading…' : `${fmtNumber(yearFilteredFloodControlProjects.length)} pins${selectedFundingYear ? ` in ${selectedFundingYear}` : ''}${filteredFloodControlProjects.length > yearFilteredFloodControlProjects.length ? ` / ${fmtNumber(filteredFloodControlProjects.length)} in view` : floodControlProjects.length > filteredFloodControlProjects.length ? ` / ${fmtNumber(floodControlProjects.length)} loaded` : projectSearchState.total > floodControlProjects.length ? ` / ${fmtNumber(projectSearchState.total)} matches` : ''}`}</div><div className="mt-1 text-xs text-amber-700/70">Auto-updates as you pan/zoom{projectSearchState.query ? ` · query: ${projectSearchState.query}` : ''}</div>{projectSearchState.error && <div className="mt-1 text-xs text-red-300">{projectSearchState.error}</div>}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-amber-200 bg-white/90 p-5 backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><div className="text-xs uppercase tracking-[0.2em] text-amber-800">Project overlay</div><h3 className="mt-1 font-bold text-gray-900">DPWH flood-control filters</h3></div>
          <div className="grid gap-2 text-sm text-amber-800">
            <label className="flex items-center justify-end gap-2"><span>Funding heatmap</span><input type="checkbox" checked={visibleLayers.funding} onChange={() => toggleLayer('funding')} /></label>
            <label className="flex items-center justify-end gap-2"><span>Map pins</span><input type="checkbox" checked={visibleLayers.projects} onChange={() => toggleLayer('projects')} /></label>
          </div>
        </div>
        {fundingHeatmapState.error && <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{fundingHeatmapState.error}</div>}
        <div className="mt-3 grid grid-cols-2 gap-2">{projectFilters.map((filter) => <button key={filter.key} onClick={() => { setProjectFilter(filter.key); setSelectedFloodControlProject(null); }} className={`rounded-2xl border p-3 text-left text-sm transition ${projectFilter === filter.key ? 'border-amber-300 bg-amber-300 text-gray-900' : 'border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100'}`}><span className="block font-semibold">{filter.label}</span><span className="mt-1 block text-xs opacity-75">{filter.description}</span></button>)}</div>
      </div>

      {selectedFloodControlProject && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 backdrop-blur-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-amber-800">Selected DPWH project</div>
          <h3 className="mt-2 text-lg font-black text-gray-900">{selectedFloodControlProject.contractId}</h3>
          <p className="mt-2 line-clamp-4 text-sm leading-6 text-gray-700">{selectedFloodControlProject.description}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-gray-50 p-3"><div className="text-gray-500">Budget</div><div className="font-bold text-amber-800">{fmtPeso(selectedFloodControlProject.budget)}</div></div>
            <div className="rounded-xl bg-gray-50 p-3"><div className="text-gray-500">Progress</div><div className="font-bold text-amber-800">{Math.round(selectedFloodControlProject.progress ?? 0)}%</div></div>
            <div className="col-span-2 rounded-xl bg-gray-50 p-3"><div className="text-gray-500">Location</div><div className="font-bold text-amber-800">{projectLocation(selectedFloodControlProject)}</div></div>
            <div className="col-span-2 rounded-xl bg-gray-50 p-3"><div className="text-gray-500">Contractor</div><div className="font-bold text-amber-800">{selectedFloodControlProject.contractor || 'n/a'}</div></div>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-gray-200 bg-white/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><Clock3 className="h-4 w-4 text-primary" /> Flood scenario</div>
        <div className="mt-3"><ScenarioControls scenarioName={scenarioName} setScenarioName={setScenarioName} /></div>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><MapPinned className="h-4 w-4 text-primary" /> Jump to area</div>
        <div className="grid gap-2">{locations.map((location) => <AppButton key={location.name} active={selectedLocation.name === location.name} onClick={() => jumpToLocation(location)}><span className="font-semibold">{location.name}</span><span className="block text-xs opacity-75">{location.subtitle}</span></AppButton>)}</div>
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><Mountain className="h-4 w-4 text-primary" /> 3D terrain</div>
        <label className="flex items-center justify-between gap-4 rounded-2xl bg-gray-50 px-4 py-3"><span><span className="block font-semibold">Enable 3D terrain</span><span className="text-sm text-gray-500">DEM terrain + hillshade</span></span><input type="checkbox" checked={terrainEnabled} onChange={() => setTerrainEnabled((value) => !value)} /></label>
        <label className="mt-3 block rounded-2xl bg-gray-50 p-4"><span className="font-semibold">Exaggeration: {terrainExaggeration.toFixed(1)}×</span><input className="mt-2 w-full accent-primary" type="range" min="0.5" max="5" step="0.1" value={terrainExaggeration} onChange={(event) => setTerrainExaggeration(Number(event.target.value))} /></label>
      </div>

    </div>
  );

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="fixed inset-0 md:hidden">
        <MapPreview {...mapProps} mobileApp />

        {mobilePanel !== 'map' && (
          <section className="absolute bottom-[5.8rem] left-3 right-3 z-20 max-h-[58svh] overflow-hidden rounded-[1.75rem] border border-gray-200 bg-white/95 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-primary">Controls</div>
                <h2 className="text-lg font-bold">{mobilePanel === 'browse' ? 'Hazard browser' : '3D terrain'}</h2>
              </div>
              <button onClick={() => setMobilePanel('map')} className="grid h-10 w-10 place-items-center rounded-full bg-gray-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[calc(58svh-4.5rem)] overflow-y-auto p-4">
              {mobilePanel === 'browse' && (
                <div className="space-y-5">
                  <div><h3 className="mb-2 font-semibold">Flood scenario</h3><ScenarioControls scenarioName={scenarioName} setScenarioName={setScenarioName} /></div>
                  <div><h3 className="mb-2 font-semibold">Jump to area</h3><div className="grid gap-2">{locations.map((location) => <AppButton key={location.name} active={selectedLocation.name === location.name} onClick={() => { jumpToLocation(location); setMobilePanel('map'); }}><span className="font-semibold">{location.name}</span><span className="block text-xs opacity-75">{location.subtitle}</span></AppButton>)}</div></div>
                  <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
                    <div><span className="font-bold">DPWH flood-control pins:</span> {projectSearchState.loading ? 'Loading…' : `${fmtNumber(yearFilteredFloodControlProjects.length)}${selectedFundingYear ? ` in ${selectedFundingYear}` : ''}`}</div>
                    <div className="mt-3 grid gap-2">
                      <label className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2"><span>Funding heatmap</span><input type="checkbox" checked={visibleLayers.funding} onChange={() => toggleLayer('funding')} /></label>
                      <label className="flex items-center justify-between rounded-xl bg-white/70 px-3 py-2"><span>Map pins</span><input type="checkbox" checked={visibleLayers.projects} onChange={() => toggleLayer('projects')} /></label>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">{projectFilters.map((filter) => <button key={filter.key} onClick={() => setProjectFilter(filter.key)} className={`rounded-xl px-3 py-2 text-left text-xs ${projectFilter === filter.key ? 'bg-amber-300 text-gray-900' : 'bg-gray-100 text-amber-800'}`}>{filter.label}</button>)}</div>
                  </div>
                </div>
              )}

              {mobilePanel === 'terrain' && (
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-gray-600">Tilt and rotate the map like a 3D mobile GIS viewer. DEM terrain and hillshade stay behind the NOAH hazard layer.</p>
                  <label className="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-4"><span><span className="block font-semibold">Enable 3D terrain</span><span className="text-sm text-gray-500">DEM + hillshade</span></span><input type="checkbox" checked={terrainEnabled} onChange={() => setTerrainEnabled((value) => !value)} /></label>
                  <label className="block rounded-2xl bg-gray-50 p-4"><span className="font-semibold">Exaggeration: {terrainExaggeration.toFixed(1)}×</span><input className="mt-2 w-full accent-primary" type="range" min="0.5" max="5" step="0.1" value={terrainExaggeration} onChange={(event) => setTerrainExaggeration(Number(event.target.value))} /></label>
                </div>
              )}

            </div>
          </section>
        )}

        <nav className="absolute bottom-0 left-0 right-0 z-30 border-t border-gray-200 bg-white/95 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-2xl">
          <div className="grid grid-cols-3 gap-1">
            {mobileNav.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setMobilePanel(key)} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold ${mobilePanel === key ? 'bg-primary text-white' : 'text-gray-600'}`}><Icon className="h-5 w-5" />{label}</button>)}
          </div>
        </nav>
      </div>

      <div className="hidden md:block">
        {desktopView === 'landing' ? (
          <div className="relative isolate min-h-screen overflow-hidden px-6 py-8 lg:px-10">
            <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_48%,#eef4ff_100%)]" />
            <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-gray-200 bg-gray-50 px-5 py-3 backdrop-blur-xl">
              <div className="flex items-center gap-3"><img src="/bettergov-logo-icon.png" alt="BetterGov" className="h-10 w-10 rounded-full" /><div><div className="font-semibold">Flood Watch</div><div className="text-xs text-blue-700/70">by BetterGov.ph</div></div></div>
              <div className="flex items-center gap-3 text-sm"><button onClick={() => setDesktopView('landing')} className="rounded-full px-4 py-2 text-gray-600 hover:bg-gray-100">Landing</button><button onClick={() => setDesktopView('terrain')} className="rounded-full bg-primary px-4 py-2 font-semibold text-white">Open 3D terrain</button></div>
            </nav>

            <section className="mx-auto grid max-w-7xl gap-10 py-16 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
              <div>
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-blue-50 px-4 py-2 text-sm text-blue-700"><Shield className="h-4 w-4" /> 3D terrain + DPWH projects</div>
                <h1 className="text-5xl font-black tracking-tight text-gray-900 md:text-7xl">Flood Watch</h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-gray-600">By BetterGov.ph. Browse Philippines-wide flood hazards, tilt 3D terrain, and inspect DPWH flood-control projects with PostGIS-backed project pins.</p>
                <div className="mt-6 max-w-xl rounded-2xl border border-gray-200 bg-white/80 p-4 text-sm text-gray-700 shadow-sm">
                  <div className="font-semibold text-gray-900">Map controls</div>
                  <div className="mt-3 grid gap-2">
                    <div className="flex items-start gap-3"><span className="mt-0.5 font-semibold text-primary">Mouse</span><span>Drag to pan. Scroll to zoom. Right-click and drag to rotate and pitch.</span></div>
                    <div className="flex items-start gap-3"><span className="mt-0.5 font-semibold text-primary">Mac</span><span>Use two-finger trackpad scroll to zoom. Hold Option and drag to rotate and pitch.</span></div>
                    <div className="flex items-start gap-3"><span className="mt-0.5 font-semibold text-primary">Touch</span><span>Drag with one finger to pan. Pinch with two fingers to zoom. Twist or two-finger drag to rotate and pitch.</span></div>
                    <div className="flex items-start gap-3"><span className="mt-0.5 font-semibold text-primary">Keys</span><span>Use + and - to zoom. Use the map's +/- and compass buttons for precise zoom and reset north.</span></div>
                  </div>
                </div>
                <div className="mt-8 flex gap-3"><button onClick={() => setDesktopView('terrain')} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 font-semibold text-white transition hover:bg-blue-600">Open 3D terrain <ChevronRight className="h-4 w-4" /></button></div>
              </div>
              <MapPreview {...mapProps} />
            </section>

            <section className="mx-auto max-w-7xl pb-20">
              <div className="mb-6 flex items-end justify-between gap-6"><div><div className="text-sm uppercase tracking-[0.24em] text-primary">Features</div><h2 className="mt-2 text-3xl font-black">Built for map-first flood planning</h2></div><div className="rounded-full border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700"><Database className="mr-2 inline h-4 w-4" /> PMTiles range loading</div></div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{featureCards.map(({ title, body, icon: Icon }) => <article key={title} className="rounded-[1.75rem] border border-gray-200 bg-white p-6 shadow-sm"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-primary"><Icon className="h-6 w-6" /></div><h3 className="mt-5 text-xl font-bold">{title}</h3><p className="mt-3 text-sm leading-6 text-gray-500">{body}</p></article>)}</div>
              <footer className="mt-10 border-t border-gray-200 pt-6 text-sm leading-6 text-gray-500">
                <div className="font-semibold text-gray-800">Flood Watch by BetterGov.ph</div>
                <div className="mt-1">Thanks to our partners from DPWH and Project NOAH for the public infrastructure and flood hazard data that make this map possible.</div>
              </footer>
            </section>
          </div>
        ) : (
          <section className="fixed inset-0 bg-white">
            <MapPreview {...mapProps} fullScreen />
            <aside className="absolute bottom-6 right-6 top-6 z-20 w-[430px] max-w-[calc(100vw-3rem)] rounded-[2rem] border border-gray-200 bg-white/88 p-4 shadow-2xl backdrop-blur-2xl">{controlsPanel}</aside>
            {!visibleLayers.funding && <div className="pointer-events-none absolute bottom-6 left-6 z-10 rounded-2xl border border-gray-200 bg-white/80 px-4 py-3 text-sm text-gray-600 backdrop-blur-xl"><span className="font-semibold text-primary">Tip:</span> use the panel to jump locations; rotate and pitch directly on the map.</div>}
          </section>
        )}
      </div>
    </main>
  );
}
