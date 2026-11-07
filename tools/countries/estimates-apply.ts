// Applies the game's own estimates (tools/countries/game-estimates.json) to the generated data:
// military spending and armed forces in data/modern/country-stats.json, government debt in
// data/modern/debt.json. Usage: npm run data:estimates (no network needed). Run it after
// npm run data:stats.
//
// License audit (Dario): SIPRI (military spending), IISS (armed forces) and IMF (debt) data may
// not be used commercially without permission, so the game does not ship them. These coarse
// levels are the game's own design values.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../map/paths.ts';

interface GameEstimates {
  spendingShareOfGdp: Record<string, number>;
  activePersonnel: Record<string, number>;
  defaultDebtShare: number;
  debtShareOfGdp: Record<string, number>;
}

const SOURCE =
  "The game's own estimates (tools/countries/game-estimates.json): coarse levels, not values from a database";

const estimates = JSON.parse(
  readFileSync(new URL('./game-estimates.json', import.meta.url), 'utf8'),
) as GameEstimates;

const statsFile = join(DATA_DIR, 'country-stats.json');
const stats = JSON.parse(readFileSync(statsFile, 'utf8')) as {
  meta: Record<string, unknown>;
  stats: Record<string, Record<string, unknown>>;
};
for (const [id, entry] of Object.entries(stats.stats)) {
  const gdp = entry.gdpUsd as number | null;
  const share = estimates.spendingShareOfGdp[id];
  entry.militaryExpenditureUsd = gdp && share ? Math.round(gdp * share) : null;
  entry.militaryExpenditureUsdYear = null;
  entry.militaryPersonnel = estimates.activePersonnel[id] ?? null;
  entry.militaryPersonnelYear = null;
  delete entry.militaryExpenditureUsdSource;
  delete entry.militaryPersonnelSource;
}
stats.meta.military = `militaryExpenditureUsd = gdpUsd x spending level; militaryPersonnel: ${SOURCE}.`;
writeFileSync(statsFile, JSON.stringify(stats, null, 1) + '\n');

writeFileSync(
  join(DATA_DIR, 'debt.json'),
  JSON.stringify(
    {
      meta: {
        description:
          'General government gross debt as a share of GDP at the start (GDD section 6: deficits add to national debt). Countries not listed start with defaultShare.',
        source: `${SOURCE}: rounded to 5 points of GDP below 30% and to 10 points above.`,
        generatedBy: 'tools/countries/estimates-apply.ts',
      },
      defaultShare: estimates.defaultDebtShare,
      debtShareOfGdp: estimates.debtShareOfGdp,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Applied: spending ${Object.keys(estimates.spendingShareOfGdp).length}, personnel ${Object.keys(estimates.activePersonnel).length}, debt ${Object.keys(estimates.debtShareOfGdp).length} countries`,
);
