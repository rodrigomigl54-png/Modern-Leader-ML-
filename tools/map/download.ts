// Downloads the Natural Earth GeoJSON files listed in config.json into tools/.cache/.
// Usage: npm run data:download
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, loadConfig } from './paths.ts';

const config = loadConfig();
const dir = cacheDir(config);
mkdirSync(dir, { recursive: true });

for (const name of config.naturalEarth.files) {
  const target = join(dir, `${name}.geojson`);
  if (existsSync(target)) {
    console.log(`cached  ${name}`);
    continue;
  }
  const url = `${config.naturalEarth.baseUrl}/${config.naturalEarth.version}/geojson/${name}.geojson`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Download failed (${response.status}): ${url}`);
    console.error(`Download the file manually and place it at ${target}`);
    process.exit(1);
  }
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  console.log(`fetched ${name}`);
}
