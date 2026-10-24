// Fetches economic and military indicators into data/modern/country-stats.json.
// Usage: npm run data:stats   (needs access to api.worldbank.org and www.imf.org)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../map/paths.ts';

interface Indicator {
  key: 'gdpUsd' | 'population' | 'militaryPersonnel' | 'militaryExpenditureUsd' | 'stability';
  code: string;
  source?: number;
  description: string;
}

// World Bank indicators. Personnel comes from IISS, spending from SIPRI, stability from the
// Worldwide Governance Indicators (WGI).
const INDICATORS: Indicator[] = [
  { key: 'gdpUsd', code: 'NY.GDP.MKTP.CD', description: 'GDP (current US$)' },
  { key: 'population', code: 'SP.POP.TOTL', description: 'Population, total' },
  {
    key: 'militaryPersonnel',
    code: 'MS.MIL.TOTL.P1',
    description: 'Armed forces personnel, total (IISS)',
  },
  {
    key: 'militaryExpenditureUsd',
    code: 'MS.MIL.XPND.CD',
    description: 'Military expenditure (current US$, SIPRI)',
  },
  {
    key: 'stability',
    code: 'PV.EST',
    source: 3,
    description: 'Political Stability and Absence of Violence/Terrorism: Estimate (WGI)',
  },
];

// IMF World Economic Outlook fallback for economies the World Bank does not cover (e.g. Taiwan).
const IMF = {
  gdpUsd: { code: 'NGDPD', scale: 1e9 },
  population: { code: 'LP', scale: 1e6 },
};
const LAST_ACTUAL_YEAR = 2025;

interface Value {
  value: number;
  year: number;
  source: string;
}

const countries = (
  JSON.parse(readFileSync(join(DATA_DIR, 'countries.json'), 'utf8')) as {
    countries: { id: string }[];
  }
).countries.map((c) => c.id);

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response.json();
    if (attempt >= 3) throw new Error(`Request failed (${response.status}): ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function worldBank(indicator: Indicator): Promise<Map<string, Value>> {
  const source = indicator.source ? `&source=${indicator.source}` : '';
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator.code}?format=json&mrnev=1&per_page=20000${source}`;
  const json = (await getJson(url)) as [
    unknown,
    { countryiso3code: string; date: string; value: number | null }[] | null,
  ];
  const out = new Map<string, Value>();
  for (const row of json[1] ?? []) {
    if (row.value === null || !row.countryiso3code) continue;
    out.set(row.countryiso3code, {
      value: row.value,
      year: Number(row.date),
      source: `World Bank ${indicator.code}`,
    });
  }
  return out;
}

async function imf(code: string, id: string, scale: number): Promise<Value | null> {
  const json = (await getJson(`https://www.imf.org/external/datamapper/api/v1/${code}/${id}`)) as {
    values?: Record<string, Record<string, Record<string, number>>>;
  };
  const series = json.values?.[code]?.[id];
  if (!series) return null;
  const years = Object.keys(series)
    .map(Number)
    .filter((y) => y <= LAST_ACTUAL_YEAR)
    .sort((a, b) => b - a);
  const year = years[0];
  if (year === undefined) return null;
  return {
    value: series[String(year)]! * scale,
    year,
    source: `IMF World Economic Outlook ${code}`,
  };
}

const results = new Map<string, Map<string, Value>>();
for (const indicator of INDICATORS) {
  results.set(indicator.key, await worldBank(indicator));
  console.log(`${indicator.code}: ${results.get(indicator.key)!.size} economies`);
}

const stats: Record<string, Record<string, unknown>> = {};
const missing: string[] = [];
for (const id of countries) {
  const entry: Record<string, unknown> = {};
  for (const indicator of INDICATORS) {
    let v = results.get(indicator.key)!.get(id) ?? null;
    const fallback = IMF[indicator.key as keyof typeof IMF];
    if (!v && fallback) v = await imf(fallback.code, id, fallback.scale).catch(() => null);
    entry[indicator.key] = v ? Math.round(v.value * 1000) / 1000 : null;
    entry[`${indicator.key}Year`] = v?.year ?? null;
    if (v && v.source !== `World Bank ${indicator.code}`)
      entry[`${indicator.key}Source`] = v.source;
    if (!v) missing.push(`${id} ${indicator.key}`);
  }
  stats[id] = entry;
}

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(DATA_DIR, 'country-stats.json'),
  JSON.stringify(
    {
      meta: {
        description:
          'Economic and military indicators per country, most recent non-empty value. null = no data in the sources (the game treats it as unknown).',
        source: `World Bank Open Data (CC BY 4.0): ${INDICATORS.map((i) => `${i.code} ${i.description}`).join('; ')}. Fallback: IMF World Economic Outlook (NGDPD, LP).`,
        generatedBy: 'tools/countries/stats.ts',
        generated: today,
        checked: today,
        checkedBy: 'tools/validate (automatic); spot checks pending',
      },
      stats,
    },
    null,
    1,
  ) + '\n',
);
console.log(`Wrote ${countries.length} countries; ${missing.length} missing values`);
console.log(missing.join(', '));
