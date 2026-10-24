// Loads the Modern World game data (data/modern/) into the simulation's World.
import type { MapData } from '../map/mapData';
import type { EconomyRules, SimContext } from '../sim/economy';
import type { Alliance, CountryStats, Leader, Rivalry, War, World } from '../sim/world';

interface StatsFile {
  stats: Record<string, Partial<Record<keyof CountryStats, number | null>>>;
}
interface LeadersFile {
  leaders: Record<string, Leader & { verify?: boolean }>;
}
interface DiplomacyFile {
  alliances: (Alliance & { nameKey: string })[];
  rivalries: (Rivalry & { reason: string })[];
  wars: War[];
}
interface ScenarioFile {
  startDate: string;
  disputedTerritories: { id: string; parent: string }[];
}

export interface WorldBundle {
  world: World;
  /** False until country-stats.json has been generated (npm run data:stats). */
  hasStats: boolean;
  allianceNames: Map<string, string>;
  /** Rules and static facts for the simulation. */
  sim: SimContext;
}

const optionalStats = import.meta.glob<string>('../../data/modern/country-stats.json', {
  query: '?url',
  import: 'default',
  eager: true,
});

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return (await response.json()) as T;
}

export async function loadWorld(map: MapData): Promise<WorldBundle> {
  const [leadersUrl, diplomacyUrl, scenarioUrl, economyUrl] = await Promise.all([
    import('../../data/modern/leaders.json?url'),
    import('../../data/modern/diplomacy.json?url'),
    import('../../data/modern/scenario.json?url'),
    import('../../data/modern/economy.json?url'),
  ]);
  const statsUrl = Object.values(optionalStats)[0];
  const [leaders, diplomacy, scenario, economy, stats] = await Promise.all([
    fetchJson<LeadersFile>(leadersUrl.default),
    fetchJson<DiplomacyFile>(diplomacyUrl.default),
    fetchJson<ScenarioFile>(scenarioUrl.default),
    fetchJson<EconomyRules>(economyUrl.default),
    statsUrl ? fetchJson<StatsFile>(statsUrl) : Promise.resolve(null),
  ]);

  const world: World = {
    startDate: scenario.startDate,
    countries: map.countries.map((c) => {
      const s = stats?.stats[c.id] ?? {};
      return {
        id: c.id,
        status: c.status,
        capitalProvinceId: c.capitalProvinceId,
        provinceIds: c.provinceIds,
        stats: {
          gdpUsd: s.gdpUsd ?? null,
          population: s.population ?? null,
          militaryPersonnel: s.militaryPersonnel ?? null,
          militaryExpenditureUsd: s.militaryExpenditureUsd ?? null,
          stability: s.stability ?? null,
        } satisfies CountryStats,
        leader: leaders.leaders[c.id] ?? { name: null, title: 'president' },
      };
    }),
    provinceOwners: map.provinces.map((p) => p.owner),
    alliances: diplomacy.alliances.map(({ id, type, members }) => ({ id, type, members })),
    rivalries: diplomacy.rivalries.map(({ a, b }) => ({ a, b })),
    wars: diplomacy.wars.map(({ id, sides }) => ({ id, sides })),
    disputed: scenario.disputedTerritories,
  };
  return {
    world,
    hasStats: stats !== null,
    allianceNames: new Map(diplomacy.alliances.map((a) => [a.id, a.nameKey])),
    sim: { economy, cityProvince: map.cities.map((c) => c.provinceId) },
  };
}
