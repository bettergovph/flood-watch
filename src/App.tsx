import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import {
  Activity,
  BarChart3,
  Building2,
  ChevronRight,
  Clock3,
  Database,
  Droplets,
  Eye,
  Factory,
  Home,
  Layers3,
  LocateFixed,
  MapPinned,
  Mountain,
  Route,
  Shield,
  SlidersHorizontal,
  Waves,
  X,
} from 'lucide-react';

type Scenario = 'Clear' | '5-Year Flood' | '25-Year Flood' | '50-Year Flood' | '100-Year Flood';
type Tool = 'Flood Wall' | 'Retention Basin' | 'Diversion Channel' | 'Pump Station';
type LayerKey = 'flood' | 'landslide' | 'stormSurge' | 'debrisFlow' | 'projects' | 'buildings' | 'houses';
type GeometryKind = 'Point' | 'LineString' | 'Polygon';
type MobilePanel = 'map' | 'browse' | 'terrain' | 'simulate' | 'impact';
type ProjectFilter = 'all' | 'ongoing' | 'completed' | 'withReports' | 'withSatellite' | 'largeBudget';
type MapViewport = { center: [number, number]; zoom: number; bounds: [[number, number], [number, number]] };

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

  return `
    <div class="floodlens-project-popup">
      <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.16em;color:#fdba74">DPWH flood-control project</div>
      <div style="margin-top:4px;font-size:16px;font-weight:900;color:#fff7ed">${escapeHtml(project.contractId)}</div>
      <div style="margin-top:8px;max-height:96px;overflow-y:auto;font-size:13px;line-height:1.45;color:#e2e8f0">${escapeHtml(project.description || 'No description available')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;font-size:12px">
        <div style="border-radius:10px;background:rgba(255,255,255,.08);padding:8px"><div style="color:#94a3b8">Budget</div><div style="font-weight:800;color:#fed7aa">${escapeHtml(fmtPeso(project.budget))}</div></div>
        <div style="border-radius:10px;background:rgba(255,255,255,.08);padding:8px"><div style="color:#94a3b8">Paid</div><div style="font-weight:800;color:#fed7aa">${escapeHtml(fmtPeso(project.amountPaid))}</div></div>
        <div style="border-radius:10px;background:rgba(255,255,255,.08);padding:8px"><div style="color:#94a3b8">Status</div><div style="font-weight:800;color:#ffedd5">${escapeHtml(project.status || 'Unknown')}</div></div>
        <div style="border-radius:10px;background:rgba(255,255,255,.08);padding:8px"><div style="color:#94a3b8">Progress</div><div style="font-weight:800;color:#ffedd5">${progress}%</div></div>
      </div>
      <div style="margin-top:12px;font-size:12px;line-height:1.55;color:#e2e8f0">
        <div><strong style="color:#94a3b8">Location:</strong> ${escapeHtml(location)}</div>
        <div><strong style="color:#94a3b8">Contractor:</strong> ${escapeHtml(project.contractor || 'n/a')}</div>
        <div><strong style="color:#94a3b8">Program:</strong> ${escapeHtml(project.programName || 'n/a')}</div>
        <div><strong style="color:#94a3b8">Source:</strong> ${escapeHtml(project.sourceOfFunds || 'n/a')} · <strong style="color:#94a3b8">Year:</strong> ${escapeHtml(project.infraYear || 'n/a')}</div>
        <div><strong style="color:#94a3b8">Timeline:</strong> ${escapeHtml(fmtDate(project.startDate))} → ${escapeHtml(fmtDate(project.completionDate))}</div>
        <div><strong style="color:#94a3b8">Reports:</strong> ${fmtNumber(project.reportCount ?? 0)} · <strong style="color:#94a3b8">Satellite:</strong> ${project.hasSatelliteImage ? 'yes' : 'no'}</div>
      </div>
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
        sources: {
          osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' },
          noah: { type: 'vector', url: `pmtiles://${window.location.origin}${datasetUrl}`, attribution: 'Project NOAH / BetterGov.ph' },
          floodConcentration: { type: 'geojson', data: floodConcentration },
          'terrain-dem': { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], tileSize: 256, encoding: 'terrarium', attribution: 'Terrain: AWS Open Data Terrarium DEM' },
          buildings: { type: 'vector', tiles: ['https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, attribution: 'OpenFreeMap / OpenMapTiles / OpenStreetMap' },
          floodControlProjects: { type: 'geojson', data: asProjectGeojson([]) },
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
      map.addLayer({
        id: 'building-extrusions',
        type: 'fill-extrusion',
        source: 'buildings',
        'source-layer': 'building',
        minzoom: 12,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#dbeafe',
          'fill-extrusion-opacity': 0.52,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 15, ['coalesce', ['get', 'render_height'], ['get', 'height'], 10]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        },
      });
      map.addLayer({
        id: 'house-extrusions',
        type: 'fill-extrusion',
        source: 'buildings',
        'source-layer': 'building',
        minzoom: 14,
        filter: ['any', ['==', ['get', 'class'], 'house'], ['==', ['get', 'class'], 'residential'], ['==', ['get', 'type'], 'house'], ['==', ['get', 'type'], 'residential'], ['==', ['get', 'building'], 'house'], ['==', ['get', 'building'], 'residential']],
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': '#fef3c7',
          'fill-extrusion-opacity': 0.68,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 16, ['coalesce', ['get', 'render_height'], ['get', 'height'], 7]],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0],
        },
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

  return (
    <div className={`relative overflow-hidden bg-slate-950 shadow-glow ${mobileApp ? 'h-full rounded-none border-0' : fullScreen ? 'h-full min-h-0 rounded-none border-0' : 'h-[68svh] min-h-[440px] rounded-[1.35rem] border border-cyan-200/20 sm:h-[72svh] md:h-[660px] md:rounded-[2rem]'}`}>
      <div ref={ref} className={`absolute inset-0 ${drawingTool ? 'cursor-crosshair' : ''}`} />
      <div className={`pointer-events-none absolute rounded-2xl border border-white/15 bg-slate-950/85 text-white backdrop-blur-xl ${mobileApp ? 'left-4 right-4 top-[max(1rem,env(safe-area-inset-top))] p-3' : 'left-3 right-3 top-3 p-3 sm:left-5 sm:right-auto sm:top-5 sm:max-w-sm sm:p-4'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-cyan-200 sm:text-sm sm:tracking-[0.24em]"><Waves className="h-4 w-4" /> FloodLens PH</div>
            <div className="mt-1 text-lg font-semibold sm:text-2xl">{scenario.name}</div>
            <div className="mt-0.5 text-xs text-slate-300 sm:text-sm">{selectedLocation.name} · {terrainEnabled ? `${terrainExaggeration.toFixed(1)}× 3D` : '2D view'}</div>
          </div>
          <div className="rounded-full bg-emerald-300/15 px-2 py-1 text-[10px] font-bold text-emerald-200">LIVE</div>
        </div>
        {!mobileApp && <div className="mt-2 flex items-center gap-2 text-[11px] text-emerald-300 sm:mt-3 sm:text-xs"><Database className="h-3.5 w-3.5" /> PMTiles range loading</div>}
      </div>
      {drawingTool && <div className={`absolute z-10 rounded-2xl border border-yellow-200/40 bg-yellow-300 p-3 text-center text-sm font-semibold text-slate-950 shadow-xl ${mobileApp ? 'left-4 right-4 top-32' : 'bottom-3 left-3 right-3 sm:bottom-auto sm:left-auto sm:right-5 sm:top-24 sm:p-4 sm:text-left sm:text-base'}`}>Tap map to place: {drawingTool}</div>}
      {!mobileApp && <div className="absolute bottom-5 left-5 right-5 hidden gap-3 rounded-2xl border border-white/15 bg-slate-950/85 p-4 text-white backdrop-blur-xl sm:grid md:grid-cols-4">{['Click pins for project details', 'Pan / zoom / rotate enabled', 'NOAH flood layers', 'DPWH flood-control overlay'].map((layer) => <div key={layer} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm"><Layers3 className="h-4 w-4 text-cyan-300" /> {layer}</div>)}</div>}
    </div>
  );
}

function ScenarioControls({ scenarioName, setScenarioName }: { scenarioName: Scenario; setScenarioName: (value: Scenario) => void }) {
  return <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 xl:grid-cols-2">{scenarios.map((item) => <button key={item.name} onClick={() => setScenarioName(item.name)} className={`min-w-0 rounded-2xl border p-3 text-left transition ${scenarioName === item.name ? 'border-cyan-300 bg-cyan-300/15' : 'border-white/10 bg-slate-900/60 hover:bg-white/10'}`}><div className="truncate text-sm font-semibold">{item.name}</div><div className="mt-1 text-base font-black leading-tight" style={{ color: item.color }}>{item.depth}</div></button>)}</div>;
}

function AppButton({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${active ? 'border-cyan-300 bg-cyan-300 text-slate-950' : 'border-white/10 bg-white/5 text-white hover:bg-white/10'}`}>{children}</button>;
}

export default function App() {
  const [scenarioName, setScenarioName] = useState<Scenario>('100-Year Flood');
  const [opacity, setOpacity] = useState(0.58);
  const [selectedLocation, setSelectedLocation] = useState(locations[0]);
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerKey, boolean>>({ flood: true, landslide: false, stormSurge: false, debrisFlow: false, projects: true, buildings: false, houses: false });
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const [terrainExaggeration, setTerrainExaggeration] = useState(2.2);
  const [drawingTool, setDrawingTool] = useState<Tool | null>(null);
  const [projects, setProjects] = useState<InfrastructureProject[]>([]);
  const [floodControlProjects, setFloodControlProjects] = useState<FloodControlProject[]>([]);
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
  const projectBbox = useMemo(() => viewportBboxParam(mapViewport.bounds), [mapViewport.bounds]);
  const handleViewportChange = useCallback((viewport: MapViewport) => {
    setMapViewport((current) => {
      const centerDelta = Math.hypot(current.center[0] - viewport.center[0], current.center[1] - viewport.center[1]);
      const zoomDelta = Math.abs(current.zoom - viewport.zoom);
      if (centerDelta < 0.01 && zoomDelta < 0.05) return current;
      return viewport;
    });
  }, []);
  const totalBenefit = Math.min(0.72, projects.reduce((sum, project) => sum + project.benefitScore, 0));
  const after = { affected: scenario.affected * (1 - totalBenefit), homes: scenario.homes * (1 - totalBenefit), roads: scenario.roads * (1 - totalBenefit * 0.8), assets: scenario.assets * (1 - totalBenefit * 0.9) };
  const filteredFloodControlProjects = useMemo(() => {
    const filtered = filterFloodControlProjects(floodControlProjects, projectFilter);
    if (mapViewport.zoom < 7) return filtered;
    return filtered.filter((project) => projectWithinBounds(project, mapViewport.bounds));
  }, [floodControlProjects, projectFilter, mapViewport]);
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

  const placeProject = (lngLat: [number, number]) => {
    if (!drawingTool) return;
    setProjects((current) => [...current, makeProject(drawingTool, lngLat, current.length + 1)]);
    setDrawingTool(null);
    setMobilePanel('impact');
  };

  const impactCards = [
    { label: 'Residents affected', before: fmtNumber(scenario.affected), after: fmtNumber(after.affected), icon: Activity },
    { label: 'Homes exposed', before: fmtNumber(scenario.homes), after: fmtNumber(after.homes), icon: Building2 },
    { label: 'Road length flooded', before: `${Math.round(scenario.roads)} km`, after: `${Math.round(after.roads)} km`, icon: Route },
    { label: 'Asset exposure', before: `₱${scenario.assets.toFixed(1)}B`, after: `₱${after.assets.toFixed(1)}B`, icon: BarChart3 },
  ];

  const featureCards = [
    { title: 'National overview first', body: 'Start with a country-wide flood concentration view, then drill into city-level Project NOAH hazard polygons.', icon: LocateFixed },
    { title: '3D terrain workspace', body: 'Use DEM terrain, hillshade, pitch, and exaggeration controls in a dedicated full-screen map page.', icon: Mountain },
    { title: 'Mitigation simulation', body: 'Place flood walls, retention basins, diversion channels, and pump stations directly on the map.', icon: Factory },
    { title: 'Before / after impact', body: 'Compare simplified exposure estimates for residents, homes, roads, and asset exposure.', icon: BarChart3 },
  ];

  const mobileNav = [
    { key: 'map' as const, label: 'Map', icon: Home },
    { key: 'browse' as const, label: 'Browse', icon: SlidersHorizontal },
    { key: 'terrain' as const, label: '3D', icon: Mountain },
    { key: 'simulate' as const, label: 'Sim', icon: Factory },
    { key: 'impact' as const, label: 'Impact', icon: BarChart3 },
  ];

  const mapProps = { scenario, opacity, visibleLayers, selectedLocation, terrainEnabled, terrainExaggeration, drawingTool, projects, floodControlProjects: filteredFloodControlProjects, onPlaceProject: placeProject, onSelectFloodControlProject: setSelectedFloodControlProject, onViewportChange: handleViewportChange, navigationSeq };

  const controlsPanel = (
    <div className="h-full space-y-5 overflow-y-auto pr-1">
      <div className="rounded-3xl border border-cyan-200/20 bg-slate-950/90 p-5 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-200">Terrain workspace</div>
            <h2 className="mt-2 text-2xl font-black">3D flood map</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">Full-screen map with a single control panel. Pan, zoom, rotate, inspect tiles, and place projects without scrolling through a page.</p>
          </div>
          <button onClick={() => setDesktopView('landing')} className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Landing</button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-2xl bg-white/5 p-3"><div className="text-slate-400">Scenario</div><div className="font-bold text-cyan-200">{scenario.name}</div></div>
          <div className="rounded-2xl bg-white/5 p-3"><div className="text-slate-400">Location</div><div className="font-bold text-cyan-200">{selectedLocation.name}</div></div>
          <div className="col-span-2 rounded-2xl bg-orange-300/10 p-3"><div className="text-slate-400">Flood-control projects</div><div className="font-bold text-orange-200">{projectSearchState.loading ? 'Loading…' : `${fmtNumber(filteredFloodControlProjects.length)} in view${floodControlProjects.length > filteredFloodControlProjects.length ? ` / ${fmtNumber(floodControlProjects.length)} loaded` : projectSearchState.total > floodControlProjects.length ? ` / ${fmtNumber(projectSearchState.total)} matches` : ''}`}</div><div className="mt-1 text-xs text-orange-100/70">Auto-updates as you pan/zoom{projectSearchState.query ? ` · query: ${projectSearchState.query}` : ''}</div>{projectSearchState.error && <div className="mt-1 text-xs text-red-300">{projectSearchState.error}</div>}</div>
        </div>
      </div>

      <div className="rounded-3xl border border-orange-200/20 bg-slate-950/90 p-5 backdrop-blur-2xl">
        <div className="flex items-center justify-between gap-3"><div><div className="text-xs uppercase tracking-[0.2em] text-orange-200">Project overlay</div><h3 className="mt-1 font-bold text-white">DPWH flood-control filters</h3></div><label className="flex items-center gap-2 text-sm text-orange-100"><span>Map pins</span><input type="checkbox" checked={visibleLayers.projects} onChange={() => toggleLayer('projects')} /></label></div>
        <div className="mt-3 grid grid-cols-2 gap-2">{projectFilters.map((filter) => <button key={filter.key} onClick={() => { setProjectFilter(filter.key); setSelectedFloodControlProject(null); }} className={`rounded-2xl border p-3 text-left text-sm transition ${projectFilter === filter.key ? 'border-orange-300 bg-orange-300 text-slate-950' : 'border-white/10 bg-white/5 text-white hover:bg-white/10'}`}><span className="block font-semibold">{filter.label}</span><span className="mt-1 block text-xs opacity-75">{filter.description}</span></button>)}</div>
      </div>

      {selectedFloodControlProject && (
        <div className="rounded-3xl border border-orange-200/20 bg-orange-950/30 p-5 backdrop-blur-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-orange-200">Selected DPWH project</div>
          <h3 className="mt-2 text-lg font-black text-white">{selectedFloodControlProject.contractId}</h3>
          <p className="mt-2 line-clamp-4 text-sm leading-6 text-orange-50/85">{selectedFloodControlProject.description}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-white/5 p-3"><div className="text-slate-400">Budget</div><div className="font-bold text-orange-200">{fmtPeso(selectedFloodControlProject.budget)}</div></div>
            <div className="rounded-xl bg-white/5 p-3"><div className="text-slate-400">Progress</div><div className="font-bold text-orange-200">{Math.round(selectedFloodControlProject.progress ?? 0)}%</div></div>
            <div className="col-span-2 rounded-xl bg-white/5 p-3"><div className="text-slate-400">Location</div><div className="font-bold text-orange-100">{projectLocation(selectedFloodControlProject)}</div></div>
            <div className="col-span-2 rounded-xl bg-white/5 p-3"><div className="text-slate-400">Contractor</div><div className="font-bold text-orange-100">{selectedFloodControlProject.contractor || 'n/a'}</div></div>
          </div>
        </div>
      )}

      <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><Clock3 className="h-4 w-4 text-cyan-300" /> Flood scenario</div>
        <div className="mt-3"><ScenarioControls scenarioName={scenarioName} setScenarioName={setScenarioName} /></div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><MapPinned className="h-4 w-4 text-cyan-300" /> Jump to area</div>
        <div className="grid gap-2">{locations.map((location) => <AppButton key={location.name} active={selectedLocation.name === location.name} onClick={() => jumpToLocation(location)}><span className="font-semibold">{location.name}</span><span className="block text-xs opacity-75">{location.subtitle}</span></AppButton>)}</div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><Mountain className="h-4 w-4 text-cyan-300" /> 3D terrain</div>
        <label className="flex items-center justify-between gap-4 rounded-2xl bg-white/5 px-4 py-3"><span><span className="block font-semibold">Enable 3D terrain</span><span className="text-sm text-slate-400">DEM terrain + hillshade</span></span><input type="checkbox" checked={terrainEnabled} onChange={() => setTerrainEnabled((value) => !value)} /></label>
        <label className="mt-3 block rounded-2xl bg-white/5 p-4"><span className="font-semibold">Exaggeration: {terrainExaggeration.toFixed(1)}×</span><input className="mt-2 w-full accent-cyan-300" type="range" min="0.5" max="5" step="0.1" value={terrainExaggeration} onChange={(event) => setTerrainExaggeration(Number(event.target.value))} /></label>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><Eye className="h-4 w-4 text-cyan-300" /> Layers</div>
        <div className="space-y-2">{([{ key: 'flood', label: 'Flood scenario + national concentration' }, { key: 'landslide', label: 'Landslide hazards' }, { key: 'stormSurge', label: 'Storm surge hazards' }, { key: 'debrisFlow', label: 'Debris-flow hazards' }, { key: 'projects', label: 'DPWH flood-control projects' }, { key: 'buildings', label: '3D buildings' }, { key: 'houses', label: 'Houses / residential footprints' }] as Array<{ key: LayerKey; label: string }>).map((item) => <label key={item.key} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm"><span>{item.label}</span><input type="checkbox" checked={visibleLayers[item.key]} onChange={() => toggleLayer(item.key)} /></label>)}</div>
        <label className="mt-4 block text-sm text-slate-300">Opacity: {Math.round(opacity * 100)}%<input className="mt-2 w-full accent-cyan-300" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><Factory className="h-4 w-4 text-cyan-300" /> Simulation tools</div>
        <div className="grid gap-2">{infrastructureTools.map((tool) => <AppButton key={tool.name} active={drawingTool === tool.name} onClick={() => setDrawingTool((active) => (active === tool.name ? null : tool.name))}><span className="font-semibold">{tool.name}</span><span className="block text-xs opacity-75">{tool.params}</span></AppButton>)}</div>
        <div className="mt-3 rounded-2xl bg-emerald-300/10 p-4 text-emerald-200"><div className="text-sm">Protection factor</div><div className="text-3xl font-black">{Math.round(totalBenefit * 100)}%</div><div className="mt-1 text-xs text-emerald-100/70">Placed projects: {projects.length}</div></div>
        <button onClick={() => setProjects([])} className="mt-3 w-full rounded-full border border-white/15 px-4 py-2 text-sm hover:bg-white/10">Clear simulation</button>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-950/90 p-5 backdrop-blur-2xl">
        <div className="mb-3 flex items-center gap-2 font-bold"><BarChart3 className="h-4 w-4 text-cyan-300" /> Impact estimate</div>
        <div className="grid gap-2">{impactCards.map(({ label, before, after: afterValue }) => <div key={label} className="grid grid-cols-[1fr_auto] gap-3 rounded-2xl bg-white/5 p-3 text-sm"><div><div className="text-slate-400">{label}</div><div className="font-bold">{before}</div></div><div className="text-right text-emerald-300"><div className="text-xs">after</div><div className="font-bold">{afterValue}</div></div></div>)}</div>
      </div>
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="fixed inset-0 md:hidden">
        <MapPreview {...mapProps} mobileApp />

        {mobilePanel !== 'map' && (
          <section className="absolute bottom-[5.8rem] left-3 right-3 z-20 max-h-[58svh] overflow-hidden rounded-[1.75rem] border border-white/15 bg-slate-950/95 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-cyan-200">Controls</div>
                <h2 className="text-lg font-bold">{mobilePanel === 'browse' ? 'Hazard browser' : mobilePanel === 'terrain' ? '3D terrain' : mobilePanel === 'simulate' ? 'Simulation' : 'Impact'}</h2>
              </div>
              <button onClick={() => setMobilePanel('map')} className="grid h-10 w-10 place-items-center rounded-full bg-white/10"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[calc(58svh-4.5rem)] overflow-y-auto p-4">
              {mobilePanel === 'browse' && (
                <div className="space-y-5">
                  <div><h3 className="mb-2 font-semibold">Flood scenario</h3><ScenarioControls scenarioName={scenarioName} setScenarioName={setScenarioName} /></div>
                  <div><h3 className="mb-2 font-semibold">Jump to area</h3><div className="grid gap-2">{locations.map((location) => <AppButton key={location.name} active={selectedLocation.name === location.name} onClick={() => { jumpToLocation(location); setMobilePanel('map'); }}><span className="font-semibold">{location.name}</span><span className="block text-xs opacity-75">{location.subtitle}</span></AppButton>)}</div></div>
                  <div className="rounded-2xl bg-orange-300/10 p-4 text-sm text-orange-100"><div><span className="font-bold">DPWH flood-control pins:</span> {projectSearchState.loading ? 'Loading…' : fmtNumber(filteredFloodControlProjects.length)} in current view</div><div className="mt-3 grid grid-cols-2 gap-2">{projectFilters.map((filter) => <button key={filter.key} onClick={() => setProjectFilter(filter.key)} className={`rounded-xl px-3 py-2 text-left text-xs ${projectFilter === filter.key ? 'bg-orange-300 text-slate-950' : 'bg-white/10 text-orange-50'}`}>{filter.label}</button>)}</div></div>
                  <div><h3 className="mb-2 font-semibold">Layers</h3><div className="space-y-2">{([{ key: 'flood', label: 'Flood' }, { key: 'landslide', label: 'Landslide' }, { key: 'stormSurge', label: 'Storm surge' }, { key: 'debrisFlow', label: 'Debris flow' }, { key: 'projects', label: 'DPWH projects' }, { key: 'buildings', label: 'Buildings' }, { key: 'houses', label: 'Houses' }] as Array<{ key: LayerKey; label: string }>).map((item) => <label key={item.key} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3"><span>{item.label}</span><input type="checkbox" checked={visibleLayers[item.key]} onChange={() => toggleLayer(item.key)} /></label>)}</div><label className="mt-3 block text-sm text-slate-300">Opacity: {Math.round(opacity * 100)}%<input className="mt-1 w-full accent-cyan-300" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label></div>
                </div>
              )}

              {mobilePanel === 'terrain' && (
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-slate-300">Tilt and rotate the map like a 3D mobile GIS viewer. DEM terrain and hillshade stay behind the NOAH hazard layer.</p>
                  <label className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-4"><span><span className="block font-semibold">Enable 3D terrain</span><span className="text-sm text-slate-400">DEM + hillshade</span></span><input type="checkbox" checked={terrainEnabled} onChange={() => setTerrainEnabled((value) => !value)} /></label>
                  <label className="block rounded-2xl bg-white/5 p-4"><span className="font-semibold">Exaggeration: {terrainExaggeration.toFixed(1)}×</span><input className="mt-2 w-full accent-cyan-300" type="range" min="0.5" max="5" step="0.1" value={terrainExaggeration} onChange={(event) => setTerrainExaggeration(Number(event.target.value))} /></label>
                </div>
              )}

              {mobilePanel === 'simulate' && (
                <div className="space-y-4">
                  <p className="text-sm leading-6 text-slate-300">Choose one project, then tap directly on the map. The control drawer will close so placement feels like a mobile map app.</p>
                  <div className="grid gap-2">{infrastructureTools.map((tool) => <AppButton key={tool.name} active={drawingTool === tool.name} onClick={() => { setDrawingTool((active) => (active === tool.name ? null : tool.name)); setMobilePanel('map'); }}><span className="font-semibold">{tool.name}</span><span className="block text-xs opacity-75">{tool.params}</span></AppButton>)}</div>
                  <div className="rounded-2xl bg-white/5 p-4"><div className="font-semibold">Placed projects: {projects.length}</div><div className="text-sm text-slate-400">Protection factor: {Math.round(totalBenefit * 100)}%</div><button onClick={() => setProjects([])} className="mt-3 w-full rounded-full border border-white/15 px-4 py-2 text-sm">Clear simulation</button></div>
                </div>
              )}

              {mobilePanel === 'impact' && (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-emerald-300/10 p-4 text-emerald-200"><div className="text-sm">Estimated protection</div><div className="text-3xl font-black">{Math.round(totalBenefit * 100)}%</div></div>
                  {impactCards.map(({ label, before, after: afterValue, icon: Icon }) => <div key={label} className="rounded-2xl bg-white/5 p-4"><div className="flex items-center gap-2 text-sm text-slate-400"><Icon className="h-4 w-4 text-cyan-300" /> {label}</div><div className="mt-2 grid grid-cols-2 gap-2"><div><div className="text-xl font-black">{before}</div><div className="text-xs text-slate-500">before</div></div><div className="rounded-xl bg-emerald-300/10 px-3 py-2 text-emerald-300"><div className="text-xl font-black">{afterValue}</div><div className="text-xs">after</div></div></div></div>)}
                  {projects.length > 0 && <div className="space-y-2">{projects.map((project) => <div key={project.id} className="rounded-xl bg-white/5 px-3 py-2 text-sm"><span className="font-semibold">{project.label}</span><span className="block text-xs text-slate-400">{project.params}</span></div>)}</div>}
                </div>
              )}
            </div>
          </section>
        )}

        <nav className="absolute bottom-0 left-0 right-0 z-30 border-t border-white/10 bg-slate-950/95 px-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-2xl">
          <div className="grid grid-cols-5 gap-1">
            {mobileNav.map(({ key, label, icon: Icon }) => <button key={key} onClick={() => setMobilePanel(key)} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2 text-[11px] font-semibold ${mobilePanel === key ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}><Icon className="h-5 w-5" />{label}</button>)}
          </div>
        </nav>
      </div>

      <div className="hidden md:block">
        {desktopView === 'landing' ? (
          <div className="relative isolate min-h-screen overflow-hidden px-6 py-8 lg:px-10">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(59,130,246,0.16),transparent_34%)]" />
            <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-white/5 px-5 py-3 backdrop-blur-xl">
              <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-cyan-300 text-slate-950"><Droplets className="h-5 w-5" /></div><div><div className="font-semibold">FloodLens PH</div><div className="text-xs text-cyan-100/70">NOAH-powered planning platform</div></div></div>
              <div className="flex items-center gap-3 text-sm"><button onClick={() => setDesktopView('landing')} className="rounded-full px-4 py-2 text-slate-300 hover:bg-white/10">Landing</button><button onClick={() => setDesktopView('terrain')} className="rounded-full bg-cyan-300 px-4 py-2 font-semibold text-slate-950">Open 3D terrain</button></div>
            </nav>

            <section className="mx-auto grid max-w-7xl gap-10 py-16 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
              <div>
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100"><Shield className="h-4 w-4" /> 3D terrain + simulation</div>
                <h1 className="text-5xl font-black tracking-tight text-white md:text-7xl">Browse hazards, tilt terrain, test interventions.</h1>
                <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">FloodLens starts with a Philippines-wide flood concentration view, then streams only the PMTiles byte ranges needed as planners zoom into NOAH hazard data.</p>
                <div className="mt-8 flex gap-3"><button onClick={() => setDesktopView('terrain')} className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">Open 3D terrain <ChevronRight className="h-4 w-4" /></button><button onClick={() => { setDesktopView('terrain'); setDrawingTool('Retention Basin'); }} className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 font-semibold text-white hover:bg-white/10"><Factory className="h-4 w-4" /> Simulate projects</button></div>
              </div>
              <MapPreview {...mapProps} />
            </section>

            <section className="mx-auto max-w-7xl pb-20">
              <div className="mb-6 flex items-end justify-between gap-6"><div><div className="text-sm uppercase tracking-[0.24em] text-cyan-200">Features</div><h2 className="mt-2 text-3xl font-black">Built for map-first flood planning</h2></div><div className="rounded-full border border-cyan-200/20 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100"><Database className="mr-2 inline h-4 w-4" /> PMTiles range loading</div></div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{featureCards.map(({ title, body, icon: Icon }) => <article key={title} className="rounded-[1.75rem] border border-white/10 bg-white/[0.04] p-6"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-200"><Icon className="h-6 w-6" /></div><h3 className="mt-5 text-xl font-bold">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-400">{body}</p></article>)}</div>
            </section>
          </div>
        ) : (
          <section className="fixed inset-0 bg-slate-950">
            <MapPreview {...mapProps} fullScreen />
            <aside className="absolute bottom-6 right-6 top-6 z-20 w-[430px] max-w-[calc(100vw-3rem)] rounded-[2rem] border border-white/15 bg-slate-950/88 p-4 shadow-2xl backdrop-blur-2xl">{controlsPanel}</aside>
            <div className="pointer-events-none absolute bottom-6 left-6 z-10 rounded-2xl border border-white/15 bg-slate-950/80 px-4 py-3 text-sm text-slate-300 backdrop-blur-xl"><span className="font-semibold text-cyan-200">Tip:</span> use the panel to jump locations; rotate and pitch directly on the map.</div>
          </section>
        )}
      </div>
    </main>
  );
}
