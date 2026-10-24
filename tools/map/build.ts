// Map data pipeline: Natural Earth (public domain) -> game data in data/modern/.
// Usage: npm run data:download && npm run data:build
// See tools/README.md for the outputs and the decisions behind them.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import polygonClipping from 'polygon-clipping';
import { PNG } from 'pngjs';
import { traceBorders, UNOWNED_LAND, WATER } from './lib/borders.ts';
import {
  bboxOf,
  containsPoint,
  distanceKm,
  MillerProjection,
  multiPolygonAreaKm2,
  toMultiPolygon,
  type BBox,
  type MultiPolygon,
  type Position,
} from './lib/geo.ts';
import { fillMultiPolygon } from './lib/raster.ts';
import { buildSeaRoutes, WaterGrid } from './lib/sea.ts';
import { cacheDir, DATA_DIR, loadConfig, MAP_DIR } from './paths.ts';

type Props = Record<string, unknown>;
interface Feature {
  properties: Props;
  geometry: { type: string; coordinates: unknown } | null;
}

const started = Date.now();
const log = (msg: string): void =>
  console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${msg}`);
const config = loadConfig();
const NE = cacheDir(config);
const today = new Date().toISOString().slice(0, 10);
const warnings: string[] = [];
const decisions: string[] = [];

const load = (name: string): Feature[] =>
  (JSON.parse(readFileSync(join(NE, `${name}.geojson`), 'utf8')) as { features: Feature[] })
    .features;

const admin0 = load('ne_10m_admin_0_countries');
const admin1 = load('ne_10m_admin_1_states_provinces');
const disputedAreas = load('ne_10m_admin_0_disputed_areas');
const places = load('ne_10m_populated_places');
log(
  `loaded Natural Earth ${config.naturalEarth.version}: ${admin0.length} admin-0, ${admin1.length} admin-1, ${places.length} places`,
);

// ---------------------------------------------------------------------------------------------
// Owners

const statusOf = new Map<string, 'full' | 'disputed' | 'uninhabited'>();
for (const id of [...config.statuses.unMembers, ...config.statuses.extraFull])
  statusOf.set(id, 'full');
for (const id of config.statuses.disputed) statusOf.set(id, 'disputed');
for (const id of config.statuses.uninhabited) statusOf.set(id, 'uninhabited');

const admin0ByCode = new Map<string, Props>();
for (const f of admin0) admin0ByCode.set(String(f.properties.ADM0_A3), f.properties);

const validIso = (v: unknown): string | undefined =>
  typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : undefined;

function ownerOfUnit(adm0: string): string {
  const override = config.owners.overrides[adm0];
  if (override) return override;
  const props = admin0ByCode.get(adm0);
  if (!props) throw new Error(`Unknown admin-0 unit ${adm0}`);
  const sov = String(props.SOV_A3);
  const viaCode = config.owners.sovereignCodes[sov];
  if (viaCode) return viaCode;
  const sovereign = admin0ByCode.get(sov);
  const iso = validIso(sovereign?.ISO_A3_EH) ?? validIso(props.ISO_A3_EH);
  if (!iso) throw new Error(`No owner for admin-0 unit ${adm0} (add it to owners.overrides)`);
  return iso;
}

const unitOwner = new Map<string, string>();
for (const code of admin0ByCode.keys()) {
  if (config.owners.unownedLand.includes(code)) continue;
  const owner = ownerOfUnit(code);
  if (!statusOf.has(owner))
    throw new Error(`Admin-0 unit ${code} maps to ${owner}, which has no status`);
  unitOwner.set(code, owner);
  if (owner !== validIso(admin0ByCode.get(code)!.ISO_A3_EH)) {
    decisions.push(`Unit ${code} (${String(admin0ByCode.get(code)!.NAME)}) -> ${owner}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Province sources (admin-1 regions, plus carve-outs for breakaway territories)

interface Source {
  key: string;
  name: string;
  owner: string;
  unit: string;
  geometry: MultiPolygon;
  labelPoint?: Position;
}

const sources: Source[] = [];
for (const f of admin1) {
  const p = f.properties;
  if (!f.geometry) throw new Error(`admin-1 ${String(p.adm1_code)} has no geometry`);
  const unit = String(p.adm0_a3);
  const owner = unitOwner.get(unit);
  if (!owner)
    throw new Error(`admin-1 ${String(p.adm1_code)} belongs to unit ${unit} without owner`);
  const name = [p.name, p.name_en, p.gn_name].find((v) => typeof v === 'string' && v.trim()) as
    string | undefined;
  const fallbackName = `${String(p.admin)} minor islands`;
  if (!name) decisions.push(`admin-1 ${String(p.adm1_code)} has no name; named "${fallbackName}"`);
  sources.push({
    key: String(p.adm1_code),
    name: (name ?? fallbackName).trim(),
    owner,
    unit,
    geometry: toMultiPolygon(f.geometry),
    labelPoint: [Number(p.longitude), Number(p.latitude)],
  });
}

for (const rule of config.carve) {
  const area = disputedAreas.find((f) => f.properties.BRK_NAME === rule.disputedArea);
  if (!area?.geometry)
    throw new Error(`Disputed area "${rule.disputedArea}" not found in Natural Earth`);
  const areaGeom = toMultiPolygon(area.geometry);
  const t = config.carveThresholds;
  for (const source of [...sources]) {
    if (source.unit !== rule.from || source.owner !== unitOwner.get(rule.from)) continue;
    const inter = polygonClipping.intersection(source.geometry, areaGeom) as MultiPolygon;
    if (inter.length === 0) continue;
    const total = multiPolygonAreaKm2(source.geometry);
    const inside = multiPolygonAreaKm2(inter);
    const share = inside / total;
    if (share >= t.wholeShare) {
      source.owner = rule.country;
      decisions.push(
        `${source.name} (${source.key}) -> ${rule.country}: ${(share * 100).toFixed(1)}% inside ${rule.disputedArea}`,
      );
    } else if (share < t.ignoreShare || inside < t.ignoreKm2) {
      if (inside >= 1) {
        decisions.push(
          `${source.name} (${source.key}) stays ${source.owner}: only ${inside.toFixed(1)} km² (${(share * 100).toFixed(1)}%) inside ${rule.disputedArea}`,
        );
      }
    } else {
      source.geometry = polygonClipping.difference(source.geometry, areaGeom) as MultiPolygon;
      source.labelPoint = undefined;
      sources.push({
        key: `${source.key}~${rule.country}`,
        name: source.name,
        owner: rule.country,
        unit: source.unit,
        geometry: inter,
      });
      decisions.push(
        `${source.name} (${source.key}) split: ${inside.toFixed(0)} km² (${(share * 100).toFixed(1)}%) -> ${rule.country}, rest stays ${source.owner}`,
      );
    }
  }
}

sources.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const N = sources.length;
if (N >= UNOWNED_LAND - 1) throw new Error('Too many provinces for 16-bit labels');
log(`${N} provinces`);

// ---------------------------------------------------------------------------------------------
// Rasterize

const projection = new MillerProjection(
  config.raster.width,
  config.raster.latNorth,
  config.raster.latSouth,
);
const W = projection.width;
const H = projection.height;
const labels = new Uint16Array(W * H);
const overlaps = new Map<number, number>();

const projectMP = (mp: MultiPolygon): MultiPolygon =>
  mp.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => projection.project(lon, lat))));

const projected = sources.map((s) => projectMP(s.geometry));
projected.forEach((mp, id) => {
  const label = id + 1;
  fillMultiPolygon(mp, W, H, (y, x0, x1) => {
    const row = y * W;
    for (let x = x0; x <= x1; x++) {
      const old = labels[row + x]!;
      if (old !== WATER && old !== label) {
        const key = Math.min(old, label) * 65536 + Math.max(old, label);
        overlaps.set(key, (overlaps.get(key) ?? 0) + 1);
      }
      labels[row + x] = label;
    }
  });
});
for (const code of config.owners.unownedLand) {
  const f = admin0.find((g) => g.properties.ADM0_A3 === code);
  if (!f?.geometry) continue;
  fillMultiPolygon(projectMP(toMultiPolygon(f.geometry)), W, H, (y, x0, x1) => {
    for (let x = x0; x <= x1; x++)
      if (labels[y * W + x] === WATER) labels[y * W + x] = UNOWNED_LAND;
  });
}
log(`rasterized ${W}x${H}`);

const pixelCount = new Int32Array(N + 1);
for (let i = 0; i < labels.length; i++) {
  const l = labels[i]!;
  if (l !== UNOWNED_LAND) pixelCount[l]!++;
}

// Provinces smaller than a pixel get one pixel at their label point, taken from water or from a
// province that has more than one pixel.
function labelPointOf(s: Source): Position {
  if (s.labelPoint && containsPoint(s.geometry, ...s.labelPoint)) return s.labelPoint;
  let best: Position | undefined;
  let bestArea = -1;
  for (const poly of s.geometry) {
    const a = multiPolygonAreaKm2([poly]);
    if (a > bestArea) {
      bestArea = a;
      const ring = poly[0]!;
      const avg: Position = [
        ring.reduce((t, p) => t + p[0], 0) / ring.length,
        ring.reduce((t, p) => t + p[1], 0) / ring.length,
      ];
      best = containsPoint([poly], ...avg) ? avg : ring[0]!;
    }
  }
  return best!;
}

let stamped = 0;
for (let id = 0; id < N; id++) {
  const label = id + 1;
  if (pixelCount[label]! > 0) continue;
  const [px, py] = projection.project(...labelPointOf(sources[id]!));
  const cx = Math.min(W - 1, Math.max(0, Math.floor(px)));
  const cy = Math.min(H - 1, Math.max(0, Math.floor(py)));
  let done = false;
  for (let r = 0; r < 64 && !done; r++) {
    for (let dy = -r; dy <= r && !done; dy++) {
      for (let dx = -r; dx <= r && !done; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = (cx + dx + W) % W;
        const y = cy + dy;
        if (y < 0 || y >= H) continue;
        const old = labels[y * W + x]!;
        if (old === WATER || old === UNOWNED_LAND || pixelCount[old]! > 1) {
          if (old !== WATER && old !== UNOWNED_LAND) pixelCount[old]!--;
          labels[y * W + x] = label;
          pixelCount[label] = 1;
          done = true;
        }
      }
    }
  }
  if (!done) throw new Error(`Could not place a pixel for province ${sources[id]!.key}`);
  stamped++;
}
log(`${stamped} sub-pixel provinces given one pixel`);

// ---------------------------------------------------------------------------------------------
// Province statistics from the raster

const sumX = new Float64Array(N + 1);
const sumX2 = new Float64Array(N + 1);
const sumXs = new Float64Array(N + 1);
const sumXs2 = new Float64Array(N + 1);
const sumY = new Float64Array(N + 1);
const box = Array.from({ length: N + 1 }, () => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
}));
const boxS = Array.from({ length: N + 1 }, () => ({
  minX: Infinity,
  minY: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
}));
const neighborKeys = new Set<number>();
const addNeighbor = (a: number, b: number): void => {
  neighborKeys.add(a < b ? a * 65536 + b : b * 65536 + a);
};
const isProv = (l: number): boolean => l !== WATER && l !== UNOWNED_LAND;
const grow = (bx: BBox, x: number, y: number): void => {
  if (x < bx.minX) bx.minX = x;
  if (x > bx.maxX) bx.maxX = x;
  if (y < bx.minY) bx.minY = y;
  if (y > bx.maxY) bx.maxY = y;
};

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const l = labels[y * W + x]!;
    if (!isProv(l)) continue;
    const cx = x + 0.5;
    const shifted = cx < W / 2 ? cx + W : cx;
    sumX[l]! += cx;
    sumX2[l]! += cx * cx;
    sumXs[l]! += shifted;
    sumXs2[l]! += shifted * shifted;
    sumY[l]! += y + 0.5;
    grow(box[l]!, x, y);
    grow(boxS[l]!, x < W / 2 ? x + W : x, y);
    const right = labels[y * W + ((x + 1) % W)]!;
    if (isProv(right) && right !== l) addNeighbor(l - 1, right - 1);
    if (y + 1 < H) {
      const down = labels[(y + 1) * W + x]!;
      if (isProv(down) && down !== l) addNeighbor(l - 1, down - 1);
    }
  }
}
const rasterNeighborPairs = neighborKeys.size;

// Vector adjacency: provinces sharing at least two exact boundary vertices are neighbors even if
// the shared border is thinner than a pixel.
{
  const firstOwner = new Map<number, number | number[]>();
  const shared = new Map<number, number>();
  sources.forEach((s, id) => {
    const seen = new Set<number>();
    for (const poly of s.geometry) {
      for (const ring of poly) {
        for (const [lon, lat] of ring) {
          const key = Math.round((lon + 180) * 1e5) * 2e7 + Math.round((lat + 90) * 1e5);
          if (seen.has(key)) continue;
          seen.add(key);
          const prev = firstOwner.get(key);
          if (prev === undefined) firstOwner.set(key, id);
          else {
            const list = typeof prev === 'number' ? [prev] : prev;
            for (const other of list) {
              const pk = Math.min(other, id) * 65536 + Math.max(other, id);
              shared.set(pk, (shared.get(pk) ?? 0) + 1);
            }
            list.push(id);
            firstOwner.set(key, list);
          }
        }
      }
    }
  });
  for (const [pk, n] of shared) if (n >= 2) neighborKeys.add(pk);
}
log(`${neighborKeys.size} neighbor pairs (${rasterNeighborPairs} from the raster)`);

const neighbors: number[][] = Array.from({ length: N }, () => []);
for (const key of [...neighborKeys].sort((a, b) => a - b)) {
  const a = Math.floor(key / 65536);
  const b = key % 65536;
  neighbors[a]!.push(b);
  neighbors[b]!.push(a);
}

// Centroid: pixel mean (taking the date-line wrap into account), moved onto the province's own
// nearest pixel so labels and generated cities always sit inside it.
const centroids: Position[] = [];
const boxes: BBox[] = [];
for (let id = 0; id < N; id++) {
  const l = id + 1;
  const n = pixelCount[l]!;
  const varPlain = sumX2[l]! / n - (sumX[l]! / n) ** 2;
  const varShift = sumXs2[l]! / n - (sumXs[l]! / n) ** 2;
  const useShift = varShift + 1e-6 < varPlain;
  let cx = (useShift ? sumXs[l]! : sumX[l]!) / n;
  const cy = sumY[l]! / n;
  boxes.push(useShift ? boxS[l]! : box[l]!);
  cx = cx % W;
  const ix = Math.floor(cx);
  const iy = Math.floor(cy);
  if (labels[iy * W + ix] === l) {
    centroids.push([cx, cy]);
    continue;
  }
  const b = useShift ? boxS[l]! : box[l]!;
  let best: Position = [cx, cy];
  let bestD = Infinity;
  for (let y = b.minY; y <= b.maxY; y++) {
    for (let xx = b.minX; xx <= b.maxX; xx++) {
      const x = xx % W;
      if (labels[y * W + x] !== l) continue;
      let dx = Math.abs(x + 0.5 - cx);
      dx = Math.min(dx, W - dx);
      const d = dx * dx + (y + 0.5 - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = [x + 0.5, y + 0.5];
      }
    }
  }
  centroids.push(best);
}

// ---------------------------------------------------------------------------------------------
// Water, coast, cities, ports, sea routes

const grid = new WaterGrid(
  labels,
  W,
  H,
  projection,
  config.sea.coarseFactor,
  config.sea.forcedWater,
  config.sea.minNavigableKm2,
);
const navigableWater = (x: number, y: number): boolean =>
  labels[y * W + x] === WATER && grid.navigable[grid.cellOf(x, y)] === 1;
const navigableComponents = grid.componentAreaKm2.filter(
  (a) => a >= config.sea.minNavigableKm2,
).length;
log(
  `water grid ${grid.width}x${grid.height}, ${grid.componentAreaKm2.length} water bodies, ${navigableComponents} navigable`,
);

const coastal = new Uint8Array(N);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const l = labels[y * W + x]!;
    if (!isProv(l) || coastal[l - 1]) continue;
    if (
      navigableWater((x + 1) % W, y) ||
      navigableWater((x - 1 + W) % W, y) ||
      (y > 0 && navigableWater(x, y - 1)) ||
      (y + 1 < H && navigableWater(x, y + 1))
    ) {
      coastal[l - 1] = 1;
    }
  }
}

const bboxes = sources.map((s) => bboxOf(s.geometry));
interface CityDraft {
  name: string;
  provinceId: number;
  population: number;
  lonLat: Position;
  neClass: string;
  neCapital: boolean;
  generated: boolean;
}
const cityDrafts: CityDraft[] = [];
let droppedCities = 0;
let nearestAssigned = 0;
const extraPlaces: Props[] = config.extraCities.map((c) => ({
  NAME: c.name,
  LONGITUDE: c.lonLat[0],
  LATITUDE: c.lonLat[1],
  POP_MAX: c.population,
  FEATURECLA: 'Extra city (tools/map/config.json)',
  ADM0CAP: 0,
  ADM0_A3: '',
}));
for (const p of [...places.map((f) => f.properties), ...extraPlaces]) {
  const lon = Number(p.LONGITUDE);
  const lat = Number(p.LATITUDE);
  if (lat > config.raster.latNorth || lat < config.raster.latSouth) {
    droppedCities++;
    warnings.push(
      `City ${String(p.NAME)} (${lat.toFixed(2)}° lat) lies outside the map's latitude range; skipped`,
    );
    continue;
  }
  const preferredOwner = unitOwner.get(String(p.ADM0_A3));
  const hits: number[] = [];
  for (let id = 0; id < N; id++) {
    const b = bboxes[id]!;
    if (lon < b.minX || lon > b.maxX || lat < b.minY || lat > b.maxY) continue;
    if (containsPoint(sources[id]!.geometry, lon, lat)) hits.push(id);
  }
  let provinceId = hits.find((id) => sources[id]!.owner === preferredOwner) ?? hits[0];
  if (provinceId === undefined) {
    // Coastal cities can sit just off the simplified coastline: take the nearest province pixel.
    const [px, py] = projection.project(lon, lat);
    const radius = Math.min(200, Math.ceil(10 / Math.max(0.05, projection.pixelKm(py))));
    let bestD = Infinity;
    let bestSame = false;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const y = Math.floor(py) + dy;
        if (y < 0 || y >= H) continue;
        const x = (Math.floor(px) + dx + W) % W;
        const l = labels[y * W + x]!;
        if (!isProv(l)) continue;
        const same = sources[l - 1]!.owner === preferredOwner;
        const d = dx * dx + dy * dy;
        if ((same && !bestSame) || (same === bestSame && d < bestD)) {
          bestD = d;
          bestSame = same;
          provinceId = l - 1;
        }
      }
    }
    if (provinceId !== undefined) nearestAssigned++;
  }
  if (provinceId === undefined) {
    droppedCities++;
    warnings.push(
      `City ${String(p.NAME)} (${lon.toFixed(2)}, ${lat.toFixed(2)}) is not near any province; skipped`,
    );
    continue;
  }
  const neName = String(p.NAME).replace(/\s+/g, ' ').trim();
  cityDrafts.push({
    name: config.cityRenames[neName] ?? neName,
    provinceId,
    population: Math.max(0, Math.round(Number(p.POP_MAX) || 0)),
    lonLat: [lon, lat],
    neClass: String(p.FEATURECLA),
    neCapital: Number(p.ADM0CAP) === 1 && p.FEATURECLA === 'Admin-0 capital',
    generated: false,
  });
}
const provincesWithCity = new Set(cityDrafts.map((c) => c.provinceId));
let generatedCities = 0;
for (let id = 0; id < N; id++) {
  if (provincesWithCity.has(id)) continue;
  cityDrafts.push({
    name: sources[id]!.name,
    provinceId: id,
    population: 0,
    lonLat: projection.unproject(...centroids[id]!),
    neClass: 'generated',
    neCapital: false,
    generated: true,
  });
  generatedCities++;
}
cityDrafts.sort(
  (a, b) =>
    a.provinceId - b.provinceId ||
    b.population - a.population ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
);
log(
  `${cityDrafts.length} cities (${generatedCities} generated, ${nearestAssigned} snapped to the nearest province, ${droppedCities} skipped)`,
);

// Distance from a city to navigable water, searched on the full raster.
function waterDistanceKm(lonLat: Position, maxKm: number): number {
  const [px, py] = projection.project(...lonLat);
  const pk = Math.max(0.05, projection.pixelKm(py));
  const r = Math.min(400, Math.ceil(maxKm / pk));
  let best = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    const y = Math.floor(py) + dy;
    if (y < 0 || y >= H) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = (Math.floor(px) + dx + W) % W;
      if (!navigableWater(x, y)) continue;
      const d = Math.sqrt(dx * dx + dy * dy) * pk;
      if (d < best) best = d;
    }
  }
  return best <= maxKm ? best : Infinity;
}

const isPort = cityDrafts.map(
  (c) => coastal[c.provinceId] === 1 && waterDistanceKm(c.lonLat, config.sea.portMaxKm) < Infinity,
);
log(`${isPort.filter(Boolean).length} cities within ${config.sea.portMaxKm} km of navigable water`);
const provinceHasPort = new Set(cityDrafts.filter((_, i) => isPort[i]).map((c) => c.provinceId));
let promoted = 0;
let coastalWithoutPort = 0;
for (let id = 0; id < N; id++) {
  if (!coastal[id] || provinceHasPort.has(id)) continue;
  let best = -1;
  let bestD = Infinity;
  cityDrafts.forEach((c, i) => {
    if (c.provinceId !== id) return;
    const d = waterDistanceKm(c.lonLat, config.sea.portPromoteMaxKm);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best >= 0) {
    isPort[best] = true;
    promoted++;
  } else coastalWithoutPort++;
}

log(`${promoted} ports promoted, ${coastalWithoutPort} coastal provinces without a port`);

// Capitals
const countryIds = [...new Set(sources.map((s) => s.owner))].sort();
const capitalCity = new Map<string, number>();
for (const country of countryIds) {
  const inCountry = cityDrafts
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => sources[c.provinceId]!.owner === country);
  const wanted = config.capitals[country];
  let pick = wanted ? inCountry.find(({ c }) => c.name === wanted) : undefined;
  if (wanted && !pick) warnings.push(`Configured capital "${wanted}" not found in ${country}`);
  pick ??= inCountry
    .filter(({ c }) => c.neCapital)
    .sort((a, b) => b.c.population - a.c.population)[0];
  if (!pick) {
    pick = [...inCountry].sort((a, b) => b.c.population - a.c.population)[0]!;
    if (statusOf.get(country) !== 'uninhabited') {
      decisions.push(
        `${country}: no Natural Earth capital inside; using largest city ${pick.c.name}`,
      );
    }
  }
  capitalCity.set(country, pick.i);
}
const capitalSet = new Set(capitalCity.values());

const ports = cityDrafts
  .map((c, i) => ({ c, i }))
  .filter(({ i }) => isPort[i])
  .map(({ c, i }) => {
    const [px, py] = projection.project(...c.lonLat);
    const maxCells = Math.min(
      50,
      Math.ceil(
        (config.sea.portPromoteMaxKm + 5) / (Math.max(0.05, projection.pixelKm(py)) * grid.factor),
      ) + 1,
    );
    return { id: i, cell: grid.nearestNavigable(px, py, maxCells), lonLat: c.lonLat };
  });
const unreachablePorts = ports.filter((p) => p.cell < 0);
for (const p of unreachablePorts)
  warnings.push(`Port ${cityDrafts[p.id]!.name} has no navigable sea cell nearby`);
const seaRoutes = buildSeaRoutes(
  grid,
  ports.filter((p) => p.cell >= 0),
  distanceKm,
);
log(`${ports.length} ports, ${seaRoutes.length} sea routes`);

// ---------------------------------------------------------------------------------------------
// Borders

const borderEdges = traceBorders(labels, W, H, 0.75);
let borderPoints = 0;
for (const e of borderEdges) for (const p of e.paths) borderPoints += p.length / 2;
log(`${borderEdges.length} border edges, ${borderPoints} points`);

// ---------------------------------------------------------------------------------------------
// Write outputs

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const meta = (what: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  description: what,
  source: `Natural Earth ${config.naturalEarth.version} 1:10m (public domain), https://www.naturalearthdata.com`,
  generatedBy: 'tools/map/build.ts',
  generated: today,
  checked: today,
  checkedBy: 'tools/validate (automatic); manual review pending',
  ...extra,
});
const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, JSON.stringify(value) + '\n');

mkdirSync(MAP_DIR, { recursive: true });
for (const f of readdirSync(MAP_DIR)) if (f.endsWith('.png')) rmSync(join(MAP_DIR, f));
rmSync(join(MAP_DIR, 'tiles'), { recursive: true, force: true });

const provinces = sources.map((s, id) => {
  const c = centroids[id]!;
  const b = boxes[id]!;
  return {
    id,
    key: s.key,
    name: s.name,
    owner: s.owner,
    centroid: [r1(c[0]), r1(c[1])],
    lonLat: projection.unproject(...c).map(r4),
    areaKm2: Math.round(multiPolygonAreaKm2(s.geometry) * 100) / 100,
    neighbors: neighbors[id],
    isCoastal: coastal[id] === 1,
    pixels: pixelCount[id + 1],
    bbox: [b.minX, b.minY, b.maxX + 1, b.maxY + 1],
  };
});
writeJson(join(DATA_DIR, 'provinces.json'), {
  meta: meta(
    'Provinces (Natural Earth admin-1 regions, none merged). centroid and bbox are in map pixels (see map/province-map.json); bbox maxX may exceed the map width for provinces crossing the date line.',
  ),
  provinces,
});

const countries = countryIds.map((id) => {
  const provinceIds = provinces.filter((p) => p.owner === id).map((p) => p.id);
  return {
    id,
    nameKey: `country.${id}`,
    status: statusOf.get(id),
    capitalProvinceId: cityDrafts[capitalCity.get(id)!]!.provinceId,
    provinceIds,
  };
});
writeJson(join(DATA_DIR, 'countries.json'), {
  meta: meta(
    'Country skeleton: ids (ISO 3166-1 alpha-3 where possible; X.. codes for territories without one), status per GDD section 4. Economic and political fields come in Phase 3.',
  ),
  countries,
});

const cities = cityDrafts.map((c, id) => ({
  id,
  name: c.name,
  provinceId: c.provinceId,
  population: c.population,
  isCapital: capitalSet.has(id),
  isPort: isPort[id] === true,
  lonLat: c.lonLat.map(r4),
  position: projection.project(...c.lonLat).map(r1),
  ...(c.generated ? { generated: true } : {}),
}));
writeJson(join(DATA_DIR, 'cities.json'), {
  meta: meta(
    'Cities (Natural Earth populated places). Provinces without one get a generated city at their centroid, named after the province (generated: true, population 0). position is in map pixels.',
  ),
  cities,
});

writeJson(join(DATA_DIR, 'sea-routes.json'), {
  meta: meta(
    'Draft sea-route graph between port cities (city ids). Built from nearest-port sea catchments on a coarse water grid; km is the sea distance. Refined in Phase 7.',
    {
      forcedWater: config.sea.forcedWater.map((f) => f.name),
    },
  ),
  routes: seaRoutes,
});

// Tile pyramid: level 0 is the full raster; each further level halves it (nearest sample at the
// block center, so labels stay exact). The renderer picks the level that matches the zoom.
interface Tile {
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
const T = config.raster.tileSize;
const levels: { level: number; scale: number; width: number; height: number; tiles: Tile[] }[] = [];
for (let level = 0; level < config.raster.levels; level++) {
  const f = 2 ** level;
  const lw = Math.ceil(W / f);
  const lh = Math.ceil(H / f);
  const half = Math.floor(f / 2);
  const dir = join(MAP_DIR, 'tiles', `L${level}`);
  mkdirSync(dir, { recursive: true });
  const tiles: Tile[] = [];
  for (let ty = 0; ty * T < lh; ty++) {
    for (let tx = 0; tx * T < lw; tx++) {
      const tw = Math.min(T, lw - tx * T);
      const th = Math.min(T, lh - ty * T);
      const png = new PNG({ width: tw, height: th });
      for (let y = 0; y < th; y++) {
        const sy = Math.min(H - 1, (ty * T + y) * f + half);
        for (let x = 0; x < tw; x++) {
          const sx = Math.min(W - 1, (tx * T + x) * f + half);
          const l = labels[sy * W + sx]!;
          const o = (y * tw + x) * 4;
          if (l === UNOWNED_LAND) png.data[o + 2] = 255;
          else {
            png.data[o] = l & 255;
            png.data[o + 1] = l >> 8;
          }
          png.data[o + 3] = 255;
        }
      }
      const file = `tiles/L${level}/${tx}-${ty}.png`;
      writeFileSync(join(MAP_DIR, file), PNG.sync.write(png, { colorType: 2 }));
      tiles.push({ file, x: tx * T, y: ty * T, width: tw, height: th });
    }
  }
  levels.push({ level, scale: f, width: lw, height: lh, tiles });
}
log(`${levels.reduce((n, l) => n + l.tiles.length, 0)} tiles in ${levels.length} levels`);
const hex = (l: number): string =>
  '#' + [l & 255, l >> 8, 0].map((v) => v.toString(16).padStart(2, '0')).join('');
writeJson(join(MAP_DIR, 'province-map.json'), {
  meta: meta(
    "Province ID map as a tile pyramid. Level 0 is the full map; level n is downscaled by 2^n (tile x, y, width, height are in that level's pixels).",
  ),
  width: W,
  height: H,
  tileSize: T,
  projection: projection.describe(),
  encoding: {
    province: 'label = R + 256 * G (B = 0); province id = label - 1',
    water: '#000000',
    unownedLand: '#0000ff',
  },
  levels,
  colorToProvince: Object.fromEntries(provinces.map((p) => [hex(p.id + 1), p.id])),
});

const labelToId = (l: number): number => (l === WATER ? -1 : l === UNOWNED_LAND ? -2 : l - 1);
writeJson(join(MAP_DIR, 'borders.json'), {
  meta: meta(
    'Borders traced from the province ID map. Each edge separates provinces a and b (-1 = water, -2 = unowned land); a country border is any edge whose two provinces have different owners. Paths are flat [x0, y0, x1, y1, ...] in map pixels.',
  ),
  edges: borderEdges.map((e) => {
    const ids = [labelToId(e.a), labelToId(e.b)].sort((p, q) => (p < 0 ? 1 : q < 0 ? -1 : p - q));
    return { a: ids[0], b: ids[1], paths: e.paths };
  }),
});

// ---------------------------------------------------------------------------------------------
// Report

const overlapList = [...overlaps.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([key, px]) => {
    const a = sources[Math.floor(key / 65536) - 1]!;
    const b = sources[(key % 65536) - 1]!;
    return `${a.key} ${a.name} / ${b.key} ${b.name}: ${px} px`;
  });
const report = {
  naturalEarth: config.naturalEarth.version,
  generated: today,
  map: {
    width: W,
    height: H,
    tiles: levels.map((l) => l.tiles.length),
    projection: 'Miller cylindrical',
  },
  counts: {
    admin1Regions: admin1.length,
    provinces: N,
    countries: countries.length,
    full: countries.filter((c) => c.status === 'full').length,
    disputed: countries.filter((c) => c.status === 'disputed').length,
    uninhabited: countries.filter((c) => c.status === 'uninhabited').length,
    cities: cities.length,
    generatedCities,
    citiesSnappedToNearestProvince: nearestAssigned,
    citiesSkipped: droppedCities,
    ports: ports.length,
    portsPromoted: promoted,
    coastalProvincesWithoutPort: coastalWithoutPort,
    seaRoutes: seaRoutes.length,
    coastalProvinces: provinces.filter((p) => p.isCoastal).length,
    provincesWithoutNeighbors: provinces.filter((p) => p.neighbors!.length === 0).length,
    subPixelProvinces: stamped,
    provincesUnder10Pixels: provinces.filter((p) => p.pixels! < 10).length,
    borderEdges: borderEdges.length,
    borderPoints,
  },
  capitals: Object.fromEntries(
    countryIds.map((id) => [id, cityDrafts[capitalCity.get(id)!]!.name]),
  ),
  decisions,
  overlaps: overlapList,
  warnings,
};
writeFileSync(join(MAP_DIR, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
log('done');
console.log(JSON.stringify(report.counts, null, 2));
console.log(
  `decisions: ${decisions.length}, overlaps: ${overlapList.length}, warnings: ${warnings.length} (see data/modern/map/build-report.json)`,
);
