// Copies a flag SVG for every country into data/modern/flags/<id>.svg.
// Usage: npm run data:flags
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ROOT } from '../map/paths.ts';

interface FlagConfig {
  flags: { baseUrl: string; commit: string; iso2: Record<string, string>; ownFlags: string[] };
}

const dir = join(ROOT, 'tools', 'countries');
const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')) as FlagConfig;
const countries = (
  JSON.parse(readFileSync(join(DATA_DIR, 'countries.json'), 'utf8')) as {
    countries: { id: string }[];
  }
).countries;
const out = join(DATA_DIR, 'flags');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const own = join(dir, 'own-flags');
for (const file of readdirSync(own)) copyFileSync(join(own, file), join(out, file));

for (const { id } of countries) {
  if (config.flags.ownFlags.includes(id)) continue;
  const iso2 = config.flags.iso2[id];
  if (!iso2) throw new Error(`No ISO 3166-1 alpha-2 code for ${id} in tools/countries/config.json`);
  const url = `${config.flags.baseUrl}/${config.flags.commit}/svg/${iso2.toLowerCase()}.svg`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Flag download failed (${response.status}): ${url}`);
  writeFileSync(join(out, `${id}.svg`), Buffer.from(await response.arrayBuffer()));
}
console.log(`${readdirSync(out).length} flags in data/modern/flags`);
