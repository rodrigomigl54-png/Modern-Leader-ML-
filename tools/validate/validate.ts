// Validates the Modern World map data in data/modern/.
// Usage: npm run data:validate   (also runs as part of npm test)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { CONFIG_PATH, DATA_DIR, MAP_DIR, ROOT } from '../map/paths.ts';

interface Meta {
  source?: string;
  checked?: string;
}
interface Province {
  id: number;
  key: string;
  name: string;
  owner: string;
  centroid: [number, number];
  areaKm2: number;
  neighbors: number[];
  isCoastal: boolean;
  pixels: number;
}
interface Country {
  id: string;
  nameKey: string;
  status: string;
  capitalProvinceId: number;
  provinceIds: number[];
}
interface City {
  id: number;
  name: string;
  provinceId: number;
  population: number;
  isCapital: boolean;
  isPort: boolean;
}
interface ProvinceMap {
  meta: Meta;
  width: number;
  height: number;
  tiles: { file: string; x: number; y: number; width: number; height: number }[];
  colorToProvince: Record<string, number>;
}

export interface ValidationResult {
  errors: string[];
  stats: Record<string, number>;
  sizes: { file: string; bytes: number; gzipBytes: number }[];
}

const GDD_DISPUTED = ['XKX', 'ESH', 'XNC', 'XAB', 'XSO', 'XTR', 'XSL'];
const GDD_EXTRA_FULL = ['VAT', 'PSE', 'TWN'];

export function validateModernData(options: { checkRaster?: boolean } = {}): ValidationResult {
  const errors: string[] = [];
  const err = (msg: string): void => {
    if (errors.length < 200) errors.push(msg);
  };
  const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
  const checkMeta = (file: string, meta: Meta | undefined): void => {
    if (!meta?.source) err(`${file}: meta.source missing`);
    if (!meta?.checked) err(`${file}: meta.checked missing`);
  };

  const provFile = read<{ meta: Meta; provinces: Province[] }>(join(DATA_DIR, 'provinces.json'));
  const countryFile = read<{ meta: Meta; countries: Country[] }>(join(DATA_DIR, 'countries.json'));
  const cityFile = read<{ meta: Meta; cities: City[] }>(join(DATA_DIR, 'cities.json'));
  const routeFile = read<{ meta: Meta; routes: { a: number; b: number; km: number }[] }>(
    join(DATA_DIR, 'sea-routes.json'),
  );
  const map = read<ProvinceMap>(join(MAP_DIR, 'province-map.json'));
  const borders = read<{ meta: Meta; edges: { a: number; b: number; paths: number[][] }[] }>(
    join(MAP_DIR, 'borders.json'),
  );
  checkMeta('provinces.json', provFile.meta);
  checkMeta('countries.json', countryFile.meta);
  checkMeta('cities.json', cityFile.meta);
  checkMeta('sea-routes.json', routeFile.meta);
  checkMeta('map/province-map.json', map.meta);
  checkMeta('map/borders.json', borders.meta);

  const provinces = provFile.provinces;
  const countries = countryFile.countries;
  const cities = cityFile.cities;
  const countryById = new Map(countries.map((c) => [c.id, c]));

  // Provinces
  provinces.forEach((p, i) => {
    if (p.id !== i) err(`province index ${i} has id ${p.id}`);
    if (!p.name?.trim()) err(`province ${p.id} has no name`);
    if (typeof p.owner !== 'string' || !countryById.has(p.owner))
      err(`province ${p.id} has unknown owner ${p.owner}`);
    if (!(p.areaKm2 > 0 && p.areaKm2 < 20_000_000))
      err(`province ${p.id} area out of range: ${p.areaKm2}`);
    if (!(p.pixels >= 1)) err(`province ${p.id} (${p.name}) is empty on the map`);
    const [x, y] = p.centroid;
    if (!(x >= 0 && x <= map.width && y >= 0 && y <= map.height))
      err(`province ${p.id} centroid outside the map`);
    if (new Set(p.neighbors).size !== p.neighbors.length)
      err(`province ${p.id} has duplicate neighbors`);
    for (const n of p.neighbors) {
      const other = provinces[n];
      if (!other) err(`province ${p.id} neighbor ${n} does not exist`);
      else if (n === p.id) err(`province ${p.id} is its own neighbor`);
      else if (!other.neighbors.includes(p.id)) err(`neighbors not symmetric: ${p.id} -> ${n}`);
    }
  });
  if (new Set(provinces.map((p) => p.key)).size !== provinces.length)
    err('province keys are not unique');

  // Countries
  if (countryById.size !== countries.length) err('country ids are not unique');
  const config = read<{ statuses: { unMembers: string[] } }>(CONFIG_PATH);
  const owned = new Map<number, string>();
  for (const c of countries) {
    if (!/^[A-Z]{3}$/.test(c.id)) err(`country id ${c.id} is not a 3-letter code`);
    if (!['full', 'disputed', 'uninhabited'].includes(c.status))
      err(`country ${c.id} has status ${c.status}`);
    if (c.provinceIds.length === 0) err(`country ${c.id} has no provinces`);
    for (const pid of c.provinceIds) {
      if (owned.has(pid)) err(`province ${pid} listed by ${owned.get(pid)} and ${c.id}`);
      owned.set(pid, c.id);
      if (provinces[pid]?.owner !== c.id)
        err(`country ${c.id} lists province ${pid} owned by ${provinces[pid]?.owner}`);
    }
    if (provinces[c.capitalProvinceId]?.owner !== c.id)
      err(`country ${c.id} capital province ${c.capitalProvinceId} is not its own`);
  }
  for (const p of provinces)
    if (!owned.has(p.id)) err(`province ${p.id} is not listed by any country`);
  const expectedFull = new Set([...config.statuses.unMembers, ...GDD_EXTRA_FULL]);
  if (config.statuses.unMembers.length !== 193)
    err(`UN member list has ${config.statuses.unMembers.length} entries, expected 193`);
  for (const id of expectedFull)
    if (countryById.get(id)?.status !== 'full') err(`${id} must exist with full status`);
  for (const id of GDD_DISPUTED)
    if (countryById.get(id)?.status !== 'disputed') err(`${id} must exist with disputed status`);
  for (const c of countries) {
    if (c.status === 'full' && !expectedFull.has(c.id))
      err(`${c.id} has full status but is not a UN member or GDD exception`);
  }
  const i18nDir = join(ROOT, 'src', 'i18n');
  for (const lang of ['en', 'sr']) {
    const file = join(i18nDir, `countries.${lang}.json`);
    const names = existsSync(file) ? read<Record<string, string>>(file) : {};
    for (const c of countries) if (!names[c.nameKey]) err(`missing ${lang} name for ${c.nameKey}`);
  }

  // Cities
  const provinceHasCity = new Uint8Array(provinces.length);
  const capitalsByCountry = new Map<string, number>();
  cities.forEach((c, i) => {
    if (c.id !== i) err(`city index ${i} has id ${c.id}`);
    const p = provinces[c.provinceId];
    if (!p) {
      err(`city ${c.id} has unknown province ${c.provinceId}`);
      return;
    }
    provinceHasCity[c.provinceId] = 1;
    if (!c.name?.trim()) err(`city ${c.id} has no name`);
    if (!(Number.isInteger(c.population) && c.population >= 0 && c.population < 60_000_000))
      err(`city ${c.id} population out of range`);
    if (c.isPort && !p.isCoastal) err(`city ${c.id} (${c.name}) is a port in an inland province`);
    if (c.isCapital) {
      if (capitalsByCountry.has(p.owner)) err(`country ${p.owner} has more than one capital city`);
      capitalsByCountry.set(p.owner, c.id);
      if (countryById.get(p.owner)?.capitalProvinceId !== c.provinceId)
        err(`capital city ${c.name} is not in ${p.owner}'s capital province`);
    }
  });
  provinces.forEach((p) => {
    if (!provinceHasCity[p.id]) err(`province ${p.id} (${p.name}) has no city`);
  });
  for (const c of countries)
    if (!capitalsByCountry.has(c.id)) err(`country ${c.id} has no capital city`);

  // Sea routes
  const routeKeys = new Set<string>();
  for (const r of routeFile.routes) {
    if (r.a === r.b) err(`sea route from city ${r.a} to itself`);
    if (!cities[r.a]?.isPort || !cities[r.b]?.isPort)
      err(`sea route ${r.a}-${r.b} connects a non-port`);
    if (!(r.km >= 0)) err(`sea route ${r.a}-${r.b} has invalid length`);
    const key = `${Math.min(r.a, r.b)}-${Math.max(r.a, r.b)}`;
    if (routeKeys.has(key)) err(`duplicate sea route ${key}`);
    routeKeys.add(key);
  }

  // Borders
  for (const e of borders.edges) {
    for (const id of [e.a, e.b])
      if (!(id >= -2 && id < provinces.length)) err(`border edge references ${id}`);
    for (const path of e.paths) {
      if (path.length < 4 || path.length % 2) err(`border path ${e.a}-${e.b} is malformed`);
    }
  }

  // Province ID raster
  const stats: Record<string, number> = {
    provinces: provinces.length,
    countries: countries.length,
    cities: cities.length,
    ports: cities.filter((c) => c.isPort).length,
    seaRoutes: routeFile.routes.length,
    borderEdges: borders.edges.length,
  };
  if (options.checkRaster !== false) {
    const counts = new Int32Array(provinces.length);
    for (const tile of map.tiles) {
      const path = join(MAP_DIR, tile.file);
      if (!existsSync(path)) {
        err(`missing tile ${tile.file}`);
        continue;
      }
      const png = PNG.sync.read(readFileSync(path));
      if (png.width !== tile.width || png.height !== tile.height)
        err(`tile ${tile.file} has the wrong size`);
      if (png.width > 4096 || png.height > 4096) err(`tile ${tile.file} exceeds 4096 px`);
      const d = png.data;
      for (let o = 0; o < d.length; o += 4) {
        const r = d[o]!;
        const g = d[o + 1]!;
        const b = d[o + 2]!;
        if (b === 0) {
          const label = r + 256 * g;
          if (label === 0) continue;
          if (label > provinces.length) {
            err(`tile ${tile.file} has unknown color ${r},${g},${b}`);
            break;
          }
          counts[label - 1]!++;
        } else if (!(r === 0 && g === 0 && b === 255)) {
          err(`tile ${tile.file} has unknown color ${r},${g},${b}`);
          break;
        }
      }
    }
    provinces.forEach((p) => {
      if (counts[p.id] === 0) err(`province ${p.id} (${p.name}) has no pixels in the ID map`);
      else if (counts[p.id] !== p.pixels)
        err(`province ${p.id} pixel count ${counts[p.id]} != ${p.pixels}`);
    });
    for (const [color, id] of Object.entries(map.colorToProvince)) {
      const label = parseInt(color.slice(1, 3), 16) + 256 * parseInt(color.slice(3, 5), 16);
      if (label !== id + 1) err(`colorToProvince ${color} -> ${id} does not match the encoding`);
    }
    if (Object.keys(map.colorToProvince).length !== provinces.length)
      err('colorToProvince does not cover every province');
  }

  const sizes: ValidationResult['sizes'] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        const content = readFileSync(path);
        sizes.push({
          file: relative(DATA_DIR, path),
          bytes: content.length,
          gzipBytes: gzipSync(content).length,
        });
      }
    }
  };
  walk(DATA_DIR);
  return { errors, stats, sizes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = validateModernData();
  const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`.padStart(10);
  console.log('Stats:', result.stats);
  console.log('\nFile sizes (raw / gzip):');
  for (const s of result.sizes) console.log(`${kb(s.bytes)} ${kb(s.gzipBytes)}  ${s.file}`);
  const total = result.sizes.reduce((t, s) => t + s.bytes, 0);
  const totalGz = result.sizes.reduce((t, s) => t + s.gzipBytes, 0);
  console.log(`${kb(total)} ${kb(totalGz)}  total`);
  if (result.errors.length) {
    console.error(`\n${result.errors.length} error(s):`);
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('\nValidation passed.');
}
