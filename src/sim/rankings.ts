// World rankings (GDD section 13): every country ordered by power, economy, population, army,
// land or public support, for the rankings panel.
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import { nationalSupport } from './population';

export type RankingMetric =
  'power' | 'gdp' | 'gdpPerCapita' | 'population' | 'army' | 'provinces' | 'support';

export const RANKING_METRICS: readonly RankingMetric[] = [
  'power',
  'gdp',
  'gdpPerCapita',
  'population',
  'army',
  'provinces',
  'support',
];

export interface RankingRow {
  rank: number;
  countryId: string;
  value: number;
}

/** Weights of the overall power score: shares of the world's GDP, soldiers and people. */
const POWER_WEIGHTS = { gdp: 0.5, army: 0.3, population: 0.2 };

/** Every living country (not uninhabited), best first; ties keep id order. */
export function rankings(state: GameState, ctx: SimContext, metric: RankingMetric): RankingRow[] {
  const countries = state.world.countries.filter(
    (c) => c.provinceIds.length > 0 && c.status !== 'uninhabited',
  );
  const soldiers = new Map<string, number>();
  for (const a of state.military.armies)
    soldiers.set(a.owner, (soldiers.get(a.owner) ?? 0) + a.regulars + a.special);
  const people = (provinceIds: readonly number[]): number =>
    provinceIds.reduce((s, p) => s + (ctx.provincePopulation?.[p] ?? 0), 0);
  const gdp = (id: string): number => state.economy.countries[id]?.gdp ?? 0;

  let total = { gdp: 0, army: 0, population: 0 };
  if (metric === 'power')
    for (const c of countries)
      total = {
        gdp: total.gdp + gdp(c.id),
        army: total.army + (soldiers.get(c.id) ?? 0),
        population: total.population + people(c.provinceIds),
      };
  const share = (v: number, t: number): number => (t > 0 ? v / t : 0);

  const value = (c: (typeof countries)[number]): number => {
    switch (metric) {
      case 'power':
        return (
          1000 *
          (POWER_WEIGHTS.gdp * share(gdp(c.id), total.gdp) +
            POWER_WEIGHTS.army * share(soldiers.get(c.id) ?? 0, total.army) +
            POWER_WEIGHTS.population * share(people(c.provinceIds), total.population))
        );
      case 'gdp':
        return gdp(c.id);
      case 'gdpPerCapita': {
        const p = people(c.provinceIds);
        return p > 0 ? gdp(c.id) / p : 0;
      }
      case 'population':
        return people(c.provinceIds);
      case 'army':
        return soldiers.get(c.id) ?? 0;
      case 'provinces':
        return c.provinceIds.length;
      case 'support':
        return nationalSupport(state, ctx, c.id);
    }
  };
  return countries
    .map((c) => ({ countryId: c.id, value: value(c) }))
    .sort((a, b) => b.value - a.value || (a.countryId < b.countryId ? -1 : 1))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
