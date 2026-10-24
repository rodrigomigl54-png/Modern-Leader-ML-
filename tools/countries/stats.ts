// Builds data/modern/country-stats.json.
// Usage: npm run data:stats             World Bank API + IMF (needs api.worldbank.org, www.imf.org)
//        npm run data:stats -- --mirror World Bank GDP and population from the datasets/* GitHub
//                                       mirrors, when the APIs cannot be reached
// Gaps are filled from tools/countries/estimates.json (drafted, marked in the output).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, ROOT } from '../map/paths.ts';

type Key = 'gdpUsd' | 'population' | 'militaryPersonnel' | 'militaryExpenditureUsd' | 'stability';

interface Value {
  value: number;
  year: number | null;
  source: string;
}

interface Indicator {
  key: Key;
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

// GitHub mirrors of the World Bank series (Open Knowledge "datasets"), pinned to a commit.
const MIRRORS: Partial<Record<Key, { url: string; description: string }>> = {
  gdpUsd: {
    url: 'https://raw.githubusercontent.com/datasets/gdp/36d761dc5617982d3e50b213e02b9a1b47c4e958/data/gdp.csv',
    description: 'World Bank NY.GDP.MKTP.CD via github.com/datasets/gdp',
  },
  population: {
    url: 'https://raw.githubusercontent.com/datasets/population/d4b1a4a9a17e2123baf0ef119de05bceced1ab1b/data/population.csv',
    description: 'World Bank SP.POP.TOTL via github.com/datasets/population',
  },
};

// IMF World Economic Outlook fallback for economies the World Bank does not cover (e.g. Taiwan).
const IMF: Partial<Record<Key, { code: string; scale: number }>> = {
  gdpUsd: { code: 'NGDPD', scale: 1e9 },
  population: { code: 'LP', scale: 1e6 },
};
const LAST_ACTUAL_YEAR = 2025;

interface Estimates {
  sources: Record<string, string>;
  military: Record<string, { activePersonnel: number; expenditureUsd?: number; rough?: boolean }>;
  economy: Record<
    string,
    { gdpUsd: number; gdpYear: number; population: number; populationYear: number }
  >;
}

const mirror = process.argv.includes('--mirror');
const estimates = JSON.parse(
  readFileSync(join(ROOT, 'tools', 'countries', 'estimates.json'), 'utf8'),
) as Estimates;
const countries = (
  JSON.parse(readFileSync(join(DATA_DIR, 'countries.json'), 'utf8')) as {
    countries: { id: string }[];
  }
).countries.map((c) => c.id);

async function get(url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url);
    if (response.ok) return response;
    if (attempt >= 3) throw new Error(`Request failed (${response.status}): ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
}

async function worldBank(indicator: Indicator): Promise<Map<string, Value>> {
  const source = indicator.source ? `&source=${indicator.source}` : '';
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator.code}?format=json&mrnev=1&per_page=20000${source}`;
  const json = (await (await get(url)).json()) as [
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

/** Latest value per country code from a "Country Name,Country Code,Year,Value" CSV. */
async function mirrorSeries(url: string, source: string): Promise<Map<string, Value>> {
  const text = await (await get(url)).text();
  const out = new Map<string, Value>();
  for (const line of text.split('\n').slice(1)) {
    // Country names may contain quoted commas; the last three fields are plain.
    const parts = line.trim().split(',');
    if (parts.length < 4) continue;
    const value = Number(parts.at(-1));
    const year = Number(parts.at(-2));
    const code = parts.at(-3)!;
    if (!Number.isFinite(value) || !/^[A-Z]{3}$/.test(code)) continue;
    const old = out.get(code);
    if (!old || year > old.year!) out.set(code, { value, year, source });
  }
  return out;
}

async function imf(code: string, id: string, scale: number): Promise<Value | null> {
  const json = (await (
    await get(`https://www.imf.org/external/datamapper/api/v1/${code}/${id}`)
  ).json()) as {
    values?: Record<string, Record<string, Record<string, number>>>;
  };
  const series = json.values?.[code]?.[id];
  if (!series) return null;
  const year = Object.keys(series)
    .map(Number)
    .filter((y) => y <= LAST_ACTUAL_YEAR)
    .sort((a, b) => b - a)[0];
  if (year === undefined) return null;
  return {
    value: series[String(year)]! * scale,
    year,
    source: `IMF World Economic Outlook ${code}`,
  };
}

function estimate(key: Key, id: string): Value | null {
  const m = estimates.military[id];
  const e = estimates.economy[id];
  if (key === 'militaryPersonnel' && m) {
    return {
      value: m.activePersonnel,
      year: null,
      source: `estimate: ${estimates.sources.activePersonnel}${m.rough ? ' (rough)' : ''}`,
    };
  }
  if (key === 'militaryExpenditureUsd' && m?.expenditureUsd) {
    return {
      value: m.expenditureUsd,
      year: 2024,
      source: `estimate: ${estimates.sources.expenditureUsd}`,
    };
  }
  if (key === 'gdpUsd' && e)
    return { value: e.gdpUsd, year: e.gdpYear, source: `estimate: ${estimates.sources[id]}` };
  if (key === 'population' && e) {
    return {
      value: e.population,
      year: e.populationYear,
      source: `estimate: ${estimates.sources[id]}`,
    };
  }
  return null;
}

const series = new Map<Key, Map<string, Value>>();
const used: string[] = [];
for (const indicator of INDICATORS) {
  const m = MIRRORS[indicator.key];
  if (mirror) {
    if (m) {
      series.set(indicator.key, await mirrorSeries(m.url, m.description));
      used.push(m.description);
    } else series.set(indicator.key, new Map());
  } else {
    series.set(indicator.key, await worldBank(indicator));
    used.push(`World Bank ${indicator.code} ${indicator.description}`);
  }
  console.log(`${indicator.key}: ${series.get(indicator.key)!.size} economies`);
}

const stats: Record<string, Record<string, unknown>> = {};
const estimated: string[] = [];
const missing: string[] = [];
for (const id of countries) {
  const entry: Record<string, unknown> = {};
  for (const indicator of INDICATORS) {
    let v = series.get(indicator.key)!.get(id) ?? null;
    const fallback = IMF[indicator.key];
    if (!v && fallback && !mirror)
      v = await imf(fallback.code, id, fallback.scale).catch(() => null);
    if (!v) v = estimate(indicator.key, id);
    entry[indicator.key] = v ? Math.round(v.value * 1000) / 1000 : null;
    entry[`${indicator.key}Year`] = v?.year ?? null;
    if (v && !v.source.startsWith('World Bank') && !v.source.includes('via github')) {
      entry[`${indicator.key}Source`] = v.source;
      if (v.source.startsWith('estimate')) estimated.push(`${id} ${indicator.key}`);
    }
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
          'Economic and military indicators per country, most recent non-empty value. A *Source field marks values not taken from the World Bank (IMF or drafted estimates). null = no data (the game treats it as unknown).',
        source: `${used.join('; ')}. World Bank Open Data is licensed CC BY 4.0. Gaps: tools/countries/estimates.json.`,
        mode: mirror
          ? 'mirror (World Bank API not reachable; military and stability from estimates or missing)'
          : 'World Bank API + IMF',
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
console.log(
  `Wrote ${countries.length} countries; ${estimated.length} estimated values; ${missing.length} missing`,
);
console.log('missing:', missing.join(', '));
