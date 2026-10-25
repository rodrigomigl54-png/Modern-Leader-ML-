// Builds data/modern/debt.json: general government gross debt as a share of GDP at the start.
// Usage: npm run data:debt   (needs www.imf.org; Node needs NODE_USE_ENV_PROXY=1 behind a proxy)
// Source: IMF World Economic Outlook GGXWDG_NGDP, latest value up to YEAR. Countries the IMF does
// not cover keep their value from the existing file, or start with defaultShare.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../map/paths.ts';

// The last year with an IMF estimate before the game starts (2027-01-01).
const YEAR = 2025;
const URL = 'https://www.imf.org/external/datamapper/api/v1/GGXWDG_NGDP';

const file = join(DATA_DIR, 'debt.json');
const old = JSON.parse(readFileSync(file, 'utf8')) as {
  defaultShare: number;
  debtShareOfGdp: Record<string, number>;
};
const countries = (
  JSON.parse(readFileSync(join(DATA_DIR, 'countries.json'), 'utf8')) as {
    countries: { id: string }[];
  }
).countries.map((c) => c.id);

// The IMF rejects requests without a browser-like user agent.
const response = await fetch(URL, {
  headers: { 'User-Agent': 'Mozilla/5.0 (modern-leader data tool)' },
});
if (!response.ok) throw new Error(`${URL}: HTTP ${response.status}`);
const series = (
  (await response.json()) as { values: { GGXWDG_NGDP: Record<string, Record<string, number>> } }
).values.GGXWDG_NGDP;

const shares: Record<string, number> = {};
const kept: string[] = [];
for (const id of countries) {
  const years = Object.entries(series[id] ?? {})
    .filter(([y, v]) => Number(y) <= YEAR && Number.isFinite(v))
    .sort(([a], [b]) => Number(b) - Number(a));
  if (years[0]) shares[id] = Math.round(years[0][1] * 10) / 1000;
  else if (old.debtShareOfGdp[id] !== undefined) {
    shares[id] = old.debtShareOfGdp[id];
    kept.push(id);
  }
}

writeFileSync(
  file,
  JSON.stringify(
    {
      meta: {
        description:
          'General government gross debt as a share of GDP at the start (GDD section 6: deficits add to national debt). Countries not listed start with defaultShare.',
        source: `IMF World Economic Outlook GGXWDG_NGDP, latest value up to ${YEAR}${kept.length ? `; kept from the earlier draft: ${kept.join(', ')}` : ''}`,
        generatedBy: 'tools/countries/debt.ts',
      },
      defaultShare: old.defaultShare,
      debtShareOfGdp: Object.fromEntries(
        Object.entries(shares).sort(([a], [b]) => a.localeCompare(b)),
      ),
    },
    null,
    2,
  ) + '\n',
);
console.log(`Wrote ${Object.keys(shares).length} countries (${kept.length} kept from the draft)`);
