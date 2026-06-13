import { useEffect, useMemo, useRef, useState } from 'react';
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

type Scenario = 'Current' | '5-Year Flood' | '25-Year Flood' | '50-Year Flood' | '100-Year Flood';
type Tool = 'Flood Wall' | 'Retention Basin' | 'Diversion Channel' | 'Pump Station';
type LayerKey = 'flood' | 'landslide' | 'stormSurge' | 'debrisFlow';
type GeometryKind = 'Point' | 'LineString' | 'Polygon';
type MobilePanel = 'map' | 'browse' | 'terrain' | 'simulate' | 'impact';

type LocationPreset = { name: string; subtitle: string; center: [number, number]; zoom: number; national?: boolean };
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
  { name: 'Current', depth: '0.2 m', affected: 8400, homes: 2200, roads: 22, assets: 1.4, color: '#38bdf8' },
  { name: '5-Year Flood', sourceLayer: 'flood_5yr', depth: '0.7 m', affected: 23100, homes: 7180, roads: 52, assets: 4.8, color: '#06b6d4' },
  { name: '25-Year Flood', sourceLayer: 'flood_25yr', depth: '1.4 m', affected: 58600, homes: 18150, roads: 104, assets: 9.7, color: '#0ea5e9' },
  { name: '50-Year Flood', sourceLayer: 'flood_25yr', depth: '2.1 m', affected: 91200, homes: 28740, roads: 143, assets: 13.9, color: '#2563eb' },
  { name: '100-Year Flood', sourceLayer: 'flood_100yr', depth: '3.4 m', affected: 138900, homes: 42180, roads: 184, assets: 18.6, color: '#7c3aed' },
];

const locations: LocationPreset[] = [
  { name: 'Philippines', subtitle: 'National flood concentration view', center: [122.4, 12.65], zoom: 4.9, national: true },
  { name: 'Naga City', subtitle: 'Bicol River Basin', center: [123.8854, 13.6218], zoom: 11.2 },
  { name: 'Metro Manila', subtitle: 'Marikina / Pasig floodplain', center: [121.0437, 14.6507], zoom: 10.5 },
  { name: 'Cagayan de Oro', subtitle: 'Cagayan River', center: [124.6319, 8.4542], zoom: 11 },
  { name: 'Tacloban', subtitle: 'Leyte storm-surge zone', center: [125.0, 11.244], zoom: 11 },
  { name: 'Iloilo City', subtitle: 'Panay urban coast', center: [122.5621, 10.7202], zoom: 11 },
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
  onPlaceProject,
  mobileApp = false,
}: {
  scenario: (typeof scenarios)[number];
  opacity: number;
  visibleLayers: Record<LayerKey, boolean>;
  selectedLocation: LocationPreset;
  terrainEnabled: boolean;
  terrainExaggeration: number;
  drawingTool: Tool | null;
  projects: InfrastructureProject[];
  onPlaceProject: (lngLat: [number, number]) => void;
  mobileApp?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const initialLocationRef = useRef(selectedLocation);
  const drawingToolRef = useRef(drawingTool);
  const onPlaceProjectRef = useRef(onPlaceProject);

  useEffect(() => {
    drawingToolRef.current = drawingTool;
    onPlaceProjectRef.current = onPlaceProject;
  }, [drawingTool, onPlaceProject]);

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
      sourceLayers.forEach((layer) => {
        map.addLayer({
          id: `hazard-${layer}`,
          type: 'fill',
          source: 'noah',
          'source-layer': layer,
          paint: { 'fill-color': hazardColor(layer) as maplibregl.ExpressionSpecification, 'fill-opacity': 0.58, 'fill-outline-color': 'rgba(255,255,255,0.35)' },
        });
      });
      map.addLayer({ id: 'mitigation-fill', type: 'fill', source: 'mitigation', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.28, 'fill-outline-color': '#bbf7d0' } });
      map.addLayer({ id: 'mitigation-line', type: 'line', source: 'mitigation', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#facc15', 'line-width': 5, 'line-dasharray': [2, 1] } });
      map.addLayer({ id: 'mitigation-point', type: 'circle', source: 'mitigation', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 10, 'circle-color': '#fb7185', 'circle-stroke-color': '#fff1f2', 'circle-stroke-width': 2 } });
    });

    map.on('click', (event) => {
      if (drawingToolRef.current) {
        onPlaceProjectRef.current([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      const concentration = map.queryRenderedFeatures(event.point, { layers: ['flood-concentration-points'].filter((id) => map.getLayer(id)) })[0];
      const features = map.queryRenderedFeatures(event.point, { layers: sourceLayers.map((layer) => `hazard-${layer}`).filter((id) => map.getLayer(id)) });
      const top = features[0];
      const html = concentration
        ? `<strong>${concentration.properties?.name}</strong><br/>National flood concentration: ${Math.round((Number(concentration.properties?.intensity) || 0) * 100)}%<br/>${concentration.properties?.affected ?? ''}`
        : top
          ? `<strong>${top.sourceLayer}</strong><br/>Hazard value: ${top.properties?.Var ?? top.properties?.HAZ ?? 'n/a'}<br/>Lng/Lat: ${event.lngLat.lng.toFixed(5)}, ${event.lngLat.lat.toFixed(5)}`
          : `<strong>No NOAH hazard feature here</strong><br/>Open Simulate to place a project.<br/>Lng/Lat: ${event.lngLat.lng.toFixed(5)}, ${event.lngLat.lat.toFixed(5)}`;
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup().setLngLat(event.lngLat).setHTML(html).addTo(map);
    });

    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    mapRef.current?.flyTo({ center: selectedLocation.center, zoom: selectedLocation.zoom, pitch: selectedLocation.national ? 0 : terrainEnabled ? 72 : 44, bearing: selectedLocation.national ? 0 : -18, duration: 1000 });
  }, [selectedLocation, terrainEnabled]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyVisibility = () => {
      ['flood-concentration-heat', 'flood-concentration-points', 'flood-concentration-labels'].forEach((id) => {
        if (!map.getLayer(id)) return;
        map.setLayoutProperty(id, 'visibility', visibleLayers.flood ? 'visible' : 'none');
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

  return (
    <div className={`relative overflow-hidden bg-slate-950 shadow-glow ${mobileApp ? 'h-full rounded-none border-0' : 'h-[68svh] min-h-[440px] rounded-[1.35rem] border border-cyan-200/20 sm:h-[72svh] md:h-[660px] md:rounded-[2rem]'}`}>
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
      {!mobileApp && <div className="absolute bottom-5 left-5 right-5 hidden gap-3 rounded-2xl border border-white/15 bg-slate-950/85 p-4 text-white backdrop-blur-xl sm:grid md:grid-cols-4">{['Click map for feature values', 'Pan / zoom / rotate enabled', 'NOAH flood layers', 'Draw mitigation projects'].map((layer) => <div key={layer} className="flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm"><Layers3 className="h-4 w-4 text-cyan-300" /> {layer}</div>)}</div>}
    </div>
  );
}

function ScenarioControls({ scenarioName, setScenarioName }: { scenarioName: Scenario; setScenarioName: (value: Scenario) => void }) {
  return <div className="grid gap-2 sm:grid-cols-5">{scenarios.map((item) => <button key={item.name} onClick={() => setScenarioName(item.name)} className={`rounded-2xl border p-3 text-left transition ${scenarioName === item.name ? 'border-cyan-300 bg-cyan-300/15' : 'border-white/10 bg-slate-900/60 hover:bg-white/10'}`}><div className="text-sm font-semibold">{item.name}</div><div className="mt-2 text-2xl font-black" style={{ color: item.color }}>{item.depth}</div><div className="mt-1 text-xs text-slate-400">{fmtNumber(item.affected)} affected</div></button>)}</div>;
}

function AppButton({ active, children, onClick }: { active?: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className={`rounded-2xl border px-3 py-3 text-left text-sm transition ${active ? 'border-cyan-300 bg-cyan-300 text-slate-950' : 'border-white/10 bg-white/5 text-white hover:bg-white/10'}`}>{children}</button>;
}

export default function App() {
  const [scenarioName, setScenarioName] = useState<Scenario>('100-Year Flood');
  const [opacity, setOpacity] = useState(0.58);
  const [selectedLocation, setSelectedLocation] = useState(locations[0]);
  const [visibleLayers, setVisibleLayers] = useState<Record<LayerKey, boolean>>({ flood: true, landslide: false, stormSurge: false, debrisFlow: false });
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const [terrainExaggeration, setTerrainExaggeration] = useState(2.2);
  const [drawingTool, setDrawingTool] = useState<Tool | null>(null);
  const [projects, setProjects] = useState<InfrastructureProject[]>([]);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('map');

  const scenario = useMemo(() => scenarios.find((item) => item.name === scenarioName) ?? scenarios[4], [scenarioName]);
  const totalBenefit = Math.min(0.72, projects.reduce((sum, project) => sum + project.benefitScore, 0));
  const after = { affected: scenario.affected * (1 - totalBenefit), homes: scenario.homes * (1 - totalBenefit), roads: scenario.roads * (1 - totalBenefit * 0.8), assets: scenario.assets * (1 - totalBenefit * 0.9) };
  const toggleLayer = (layer: LayerKey) => setVisibleLayers((current) => ({ ...current, [layer]: !current[layer] }));
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

  const mobileNav = [
    { key: 'map' as const, label: 'Map', icon: Home },
    { key: 'browse' as const, label: 'Browse', icon: SlidersHorizontal },
    { key: 'terrain' as const, label: '3D', icon: Mountain },
    { key: 'simulate' as const, label: 'Sim', icon: Factory },
    { key: 'impact' as const, label: 'Impact', icon: BarChart3 },
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="fixed inset-0 md:hidden">
        <MapPreview scenario={scenario} opacity={opacity} visibleLayers={visibleLayers} selectedLocation={selectedLocation} terrainEnabled={terrainEnabled} terrainExaggeration={terrainExaggeration} drawingTool={drawingTool} projects={projects} onPlaceProject={placeProject} mobileApp />

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
                  <div><h3 className="mb-2 font-semibold">Flood scenario</h3><div className="grid grid-cols-2 gap-2"><ScenarioControls scenarioName={scenarioName} setScenarioName={setScenarioName} /></div></div>
                  <div><h3 className="mb-2 font-semibold">Jump to area</h3><div className="grid gap-2">{locations.map((location) => <AppButton key={location.name} active={selectedLocation.name === location.name} onClick={() => { setSelectedLocation(location); setMobilePanel('map'); }}><span className="font-semibold">{location.name}</span><span className="block text-xs opacity-75">{location.subtitle}</span></AppButton>)}</div></div>
                  <div><h3 className="mb-2 font-semibold">Layers</h3><div className="space-y-2">{([{ key: 'flood', label: 'Flood' }, { key: 'landslide', label: 'Landslide' }, { key: 'stormSurge', label: 'Storm surge' }, { key: 'debrisFlow', label: 'Debris flow' }] as Array<{ key: LayerKey; label: string }>).map((item) => <label key={item.key} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3"><span>{item.label}</span><input type="checkbox" checked={visibleLayers[item.key]} onChange={() => toggleLayer(item.key)} /></label>)}</div><label className="mt-3 block text-sm text-slate-300">Opacity: {Math.round(opacity * 100)}%<input className="mt-1 w-full accent-cyan-300" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label></div>
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
        <section className="relative isolate overflow-hidden px-6 py-8 lg:px-10">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.22),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(59,130,246,0.16),transparent_34%)]" />
          <nav className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-white/5 px-5 py-3 backdrop-blur-xl">
            <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-cyan-300 text-slate-950"><Droplets className="h-5 w-5" /></div><div><div className="font-semibold">FloodLens PH</div><div className="text-xs text-cyan-100/70">NOAH-powered planning platform</div></div></div>
            <div className="flex gap-6 text-sm text-slate-300"><a href="#browser">Browser</a><a href="#terrain">3D Terrain</a><a href="#simulate">Simulate</a><a href="#analytics">Analytics</a></div>
          </nav>

          <div className="mx-auto grid max-w-7xl gap-10 py-16 lg:grid-cols-[0.72fr_1.28fr] lg:items-center">
            <div>
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm text-cyan-100"><Shield className="h-4 w-4" /> 3D terrain + simulation</div>
              <h1 className="text-5xl font-black tracking-tight text-white md:text-7xl">Browse hazards, tilt terrain, test interventions.</h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">The app streams only the PMTiles byte ranges needed for the current viewport. It does not download the entire 4.9GB dataset when the page opens.</p>
              <div className="mt-8 flex gap-3"><a href="#terrain" className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-6 py-3 font-semibold text-slate-950 transition hover:bg-cyan-200">Open 3D terrain <ChevronRight className="h-4 w-4" /></a><a href="#simulate" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 font-semibold text-white hover:bg-white/10"><Factory className="h-4 w-4" /> Simulate projects</a></div>
            </div>
            <MapPreview scenario={scenario} opacity={opacity} visibleLayers={visibleLayers} selectedLocation={selectedLocation} terrainEnabled={terrainEnabled} terrainExaggeration={terrainExaggeration} drawingTool={drawingTool} projects={projects} onPlaceProject={placeProject} />
          </div>
        </section>

        <section id="browser" className="mx-auto max-w-7xl px-6 pb-16 lg:px-10">
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.03] p-6">
              <div className="flex items-center justify-between gap-4"><div><h2 className="text-2xl font-bold">Hazard browser controls</h2><p className="mt-1 text-slate-400">Switch scenario, jump to places, toggle NOAH layers, and click the map to inspect values.</p></div><Clock3 className="h-8 w-8 text-cyan-300" /></div>
              <div className="mt-6"><ScenarioControls scenarioName={scenarioName} setScenarioName={setScenarioName} /></div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-950/70 p-5"><div className="mb-3 flex items-center gap-2 font-semibold"><MapPinned className="h-4 w-4 text-cyan-300" /> Jump to area</div><div className="grid gap-2">{locations.map((location) => <AppButton key={location.name} active={selectedLocation.name === location.name} onClick={() => setSelectedLocation(location)}><span className="font-semibold">{location.name}</span><span className="block text-xs opacity-75">{location.subtitle}</span></AppButton>)}</div></div>
                <div className="rounded-2xl bg-slate-950/70 p-5"><div className="mb-3 flex items-center gap-2 font-semibold"><Eye className="h-4 w-4 text-cyan-300" /> Layers & opacity</div><div className="space-y-2">{([{ key: 'flood', label: 'Flood scenario polygons' }, { key: 'landslide', label: 'Landslide hazards' }, { key: 'stormSurge', label: 'Storm surge hazards' }, { key: 'debrisFlow', label: 'Debris-flow hazards' }] as Array<{ key: LayerKey; label: string }>).map((item) => <label key={item.key} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2 text-sm"><span>{item.label}</span><input type="checkbox" checked={visibleLayers[item.key]} onChange={() => toggleLayer(item.key)} /></label>)}</div><label className="mt-4 block text-sm text-slate-300">Opacity: {Math.round(opacity * 100)}%<input className="mt-2 w-full accent-cyan-300" type="range" min="0.15" max="0.9" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /></label></div>
              </div>
            </div>
            <aside className="rounded-[2rem] border border-cyan-200/20 bg-cyan-950/30 p-6"><h3 className="flex items-center gap-2 text-xl font-bold"><LocateFixed className="h-5 w-5 text-cyan-300" /> Dataset loading</h3><p className="mt-3 text-sm leading-6 text-slate-300">PMTiles uses HTTP range requests. Opening the page requests small header/tile byte ranges, not the full 4.9GB file.</p><div className="mt-5 rounded-xl bg-white/5 px-4 py-3 font-mono text-xs text-cyan-100">HTTP 206 Partial Content<br />Content-Range: bytes 0-127/5171019251</div></aside>
          </div>
        </section>

        <section id="terrain" className="mx-auto max-w-7xl px-6 pb-16 lg:px-10"><div className="rounded-[2rem] border border-cyan-200/20 bg-gradient-to-br from-cyan-950/40 to-slate-900 p-6"><h2 className="flex items-center gap-3 text-3xl font-black"><Mountain className="h-8 w-8 text-cyan-300" /> 3D terrain controls</h2><p className="mt-3 text-slate-300">This uses public Terrarium DEM tiles as a raster elevation source, then MapLibre extrudes the map into terrain. Pitch/rotate the main map to inspect valleys, mountains, and hazard overlays together.</p><div className="mt-6 grid gap-4 md:grid-cols-2"><label className="flex items-center justify-between gap-4 rounded-2xl bg-slate-950/70 p-5"><span><span className="block font-semibold">Enable 3D terrain</span><span className="text-sm text-slate-400">Adds DEM terrain and hillshade</span></span><input type="checkbox" checked={terrainEnabled} onChange={() => setTerrainEnabled((value) => !value)} /></label><label className="rounded-2xl bg-slate-950/70 p-5"><span className="font-semibold">Terrain exaggeration: {terrainExaggeration.toFixed(1)}×</span><input className="mt-4 w-full accent-cyan-300" type="range" min="0.5" max="5" step="0.1" value={terrainExaggeration} onChange={(event) => setTerrainExaggeration(Number(event.target.value))} /></label></div></div></section>

        <section id="simulate" className="mx-auto max-w-7xl px-6 pb-16 lg:px-10"><div className="mb-6 flex items-end justify-between gap-4"><div><h2 className="text-3xl font-black">Infrastructure simulation workbench</h2><p className="mt-2 text-slate-400">Pick an intervention, click the map, and compare simplified before/after impacts for the active flood scenario.</p></div><Factory className="h-10 w-10 text-cyan-300" /></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{infrastructureTools.map((tool) => <article key={tool.name} className={`rounded-[1.5rem] border p-5 transition hover:-translate-y-1 ${drawingTool === tool.name ? 'border-yellow-300 bg-yellow-300/15' : 'border-white/10 bg-white/[0.04] hover:border-cyan-300/40'}`}><div className="mb-5 inline-flex rounded-full bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-widest text-cyan-200">{tool.params}</div><h3 className="text-xl font-bold">{tool.name}</h3><p className="mt-3 min-h-16 text-sm leading-6 text-slate-400">{tool.description}</p><button onClick={() => setDrawingTool((active) => (active === tool.name ? null : tool.name))} className="mt-5 w-full rounded-full bg-cyan-300 px-4 py-2 font-semibold text-slate-950">{drawingTool === tool.name ? 'Click map to place' : `Place ${tool.name}`}</button></article>)}</div><div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5"><div className="flex items-center justify-between"><div><div className="font-semibold">Placed projects: {projects.length}</div><div className="text-sm text-slate-400">Estimated protection factor: {Math.round(totalBenefit * 100)}%</div></div><button onClick={() => setProjects([])} className="rounded-full border border-white/15 px-4 py-2 text-sm hover:bg-white/10">Clear simulation</button></div><div className="mt-4 grid gap-2 md:grid-cols-2">{projects.map((project) => <div key={project.id} className="rounded-xl bg-slate-950/70 px-4 py-3 text-sm"><span className="font-semibold">{project.label}</span><span className="block text-xs text-slate-400">{project.params}</span></div>)}</div></div></section>

        <section id="analytics" className="mx-auto max-w-7xl px-6 pb-16 lg:px-10"><div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8"><div className="mb-5"><h2 className="text-3xl font-black">Before / after impact estimate</h2><p className="mt-2 text-slate-400">Simplified planning model only — suitable for exploration, not engineering certification.</p></div><div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">{impactCards.map(({ label, before, after: afterValue, icon: Icon }) => <div key={label} className="rounded-2xl bg-slate-950/70 p-5"><Icon className="h-6 w-6 text-cyan-300" /><div className="mt-5 text-sm text-slate-400">{label}</div><div className="mt-1 text-2xl font-black">{before}</div><div className="mt-2 text-xs text-slate-500">before mitigation</div><div className="mt-4 rounded-xl bg-emerald-300/10 px-3 py-2 text-lg font-bold text-emerald-300">{afterValue}</div><div className="mt-1 text-xs text-emerald-300">after simulation</div></div>)}</div></div></section>

        <section id="data" className="mx-auto max-w-7xl px-6 pb-20 lg:px-10"><div className="grid gap-6 rounded-[2rem] border border-cyan-200/20 bg-gradient-to-br from-cyan-950/60 to-slate-900 p-8 md:grid-cols-[1fr_0.8fr]"><div><h2 className="text-3xl font-black">Dataset mounted and browsable</h2><p className="mt-4 leading-7 text-slate-300">The app serves the BetterGov / Project NOAH PMTiles resource with HTTP byte-range support. The browser asks for just the tiles needed for the current viewport.</p></div><div className="overflow-x-auto rounded-2xl bg-slate-950/80 p-5 font-mono text-sm text-cyan-100"><div>Resource: Project NOAH Hazard Maps PMTiles</div><div className="mt-2">Format: VND.PMTILES</div><div className="mt-2">Local size: 4.9 GB</div><div className="mt-2">Layers: flood_5yr, flood_25yr, flood_100yr, landslide, debris_flow, storm_surge_ssa1-4</div></div></div></section>
      </div>
    </main>
  );
}
