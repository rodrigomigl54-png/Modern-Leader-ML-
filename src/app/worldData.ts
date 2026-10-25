// Loads the Modern World game data (data/modern/) into the simulation's World.
import type { MapData } from '../map/mapData';
import type { EconomyRules, SimContext, StartDebt } from '../sim/economy';
import type { DiplomacyRules, RelationOverride } from '../sim/diplomacy';
import type { MilitaryRules, SeaLink } from '../sim/military';
import type { PopulationRules } from '../sim/population';
import type { ResourcesData } from '../sim/resources';
import type { AiProfile, AiRules } from '../sim/profiles';
import type { WeaponsRules } from '../sim/weapons';
import type { SummitRules } from '../sim/summits';
import type { GoalRules } from '../sim/goals';
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
interface ServiceFile {
  service: string[];
}
interface SeaRoutesFile {
  routes: { a: number; b: number; km: number }[];
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
  const urls = await Promise.all([
    import('../../data/modern/leaders.json?url'),
    import('../../data/modern/diplomacy.json?url'),
    import('../../data/modern/scenario.json?url'),
    import('../../data/modern/economy.json?url'),
    import('../../data/modern/population.json?url'),
    import('../../data/modern/military.json?url'),
    import('../../data/modern/military-service.json?url'),
    import('../../data/modern/sea-routes.json?url'),
    import('../../data/modern/weapons.json?url'),
    import('../../data/modern/diplomacy-rules.json?url'),
    import('../../data/modern/relations.json?url'),
    import('../../data/modern/resources.json?url'),
    import('../../data/modern/ai-profiles.json?url'),
    import('../../data/modern/ai-rules.json?url'),
    import('../../data/modern/summits.json?url'),
    import('../../data/modern/goals.json?url'),
    import('../../data/modern/debt.json?url'),
  ]);
  const [leadersUrl, diplomacyUrl, scenarioUrl, economyUrl, populationUrl] = urls;
  const [
    militaryUrl,
    serviceUrl,
    seaUrl,
    weaponsUrl,
    diplomacyRulesUrl,
    relationsUrl,
    resourcesUrl,
    profilesUrl,
    aiRulesUrl,
    summitsUrl,
    goalsUrl,
    debtUrl,
  ] = urls.slice(5);
  const statsUrl = Object.values(optionalStats)[0];
  const [
    leaders,
    diplomacy,
    scenario,
    economy,
    population,
    military,
    service,
    sea,
    weapons,
    diplomacyRules,
    relations,
    resources,
    profiles,
    aiRules,
    summits,
    goals,
    startDebt,
    stats,
  ] = await Promise.all([
    fetchJson<LeadersFile>(leadersUrl.default),
    fetchJson<DiplomacyFile>(diplomacyUrl.default),
    fetchJson<ScenarioFile>(scenarioUrl.default),
    fetchJson<EconomyRules>(economyUrl.default),
    fetchJson<PopulationRules>(populationUrl.default),
    fetchJson<MilitaryRules>(militaryUrl!.default),
    fetchJson<ServiceFile>(serviceUrl!.default),
    fetchJson<SeaRoutesFile>(seaUrl!.default),
    fetchJson<WeaponsRules>(weaponsUrl!.default),
    fetchJson<DiplomacyRules>(diplomacyRulesUrl!.default),
    fetchJson<{ pairs: RelationOverride[]; sanctions: { from: string; to: string }[] }>(
      relationsUrl!.default,
    ),
    fetchJson<ResourcesData>(resourcesUrl!.default),
    fetchJson<{ profiles: Record<string, AiProfile> }>(profilesUrl!.default),
    fetchJson<AiRules>(aiRulesUrl!.default),
    fetchJson<SummitRules>(summitsUrl!.default),
    fetchJson<GoalRules>(goalsUrl!.default),
    fetchJson<StartDebt>(debtUrl!.default),
    statsUrl ? fetchJson<StatsFile>(statsUrl) : Promise.resolve(null),
  ]);

  return assembleWorld(map, {
    leaders,
    diplomacy,
    scenario,
    economy,
    population,
    military,
    service,
    sea,
    weapons,
    diplomacyRules,
    relations,
    resources,
    profiles,
    aiRules,
    summits,
    goals,
    startDebt,
    stats,
  });
}

/** Parsed data/modern files the world is built from. */
export interface WorldFiles {
  leaders: LeadersFile;
  diplomacy: DiplomacyFile;
  scenario: ScenarioFile;
  economy: EconomyRules;
  population: PopulationRules;
  military: MilitaryRules;
  service: ServiceFile;
  sea: SeaRoutesFile;
  weapons: WeaponsRules;
  diplomacyRules: DiplomacyRules;
  relations: { pairs: RelationOverride[]; sanctions: { from: string; to: string }[] };
  resources: ResourcesData;
  profiles: { profiles: Record<string, AiProfile> };
  aiRules: AiRules;
  summits: SummitRules;
  goals: GoalRules;
  startDebt: StartDebt;
  stats: StatsFile | null;
}

/** The map facts the simulation needs (tiles are not needed). */
export type MapFacts = Pick<MapData, 'provinces' | 'countries' | 'cities'>;

/** Builds the World and the simulation context; shared by the game and tools/balance. */
export function assembleWorld(map: MapFacts, files: WorldFiles): WorldBundle {
  const {
    leaders,
    diplomacy,
    scenario,
    economy,
    population,
    military,
    service,
    sea,
    weapons,
    diplomacyRules,
    relations,
    resources,
    profiles,
    aiRules,
    summits,
    goals,
    startDebt,
    stats,
  } = files;
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
    sim: {
      economy,
      population,
      cityProvince: map.cities.map((c) => c.provinceId),
      provincePopulation: provincePopulation(map),
      provinceNeighbors: map.provinces.map((p) => p.neighbors),
      military,
      cityPopulation: map.cities.map((c) => c.population),
      seaRoutes: seaLinks(map, sea),
      serviceAtStart: service.service,
      weapons,
      cityLonLat: map.cities.map((c) => c.lonLat),
      nuclearBaseCities: nuclearBases(map, weapons),
      diplomacy: diplomacyRules,
      relationOverrides: relations.pairs,
      startSanctions: relations.sanctions,
      profiles: profiles.profiles,
      aiRules,
      resources,
      summits,
      goals,
      startDebt,
    },
  };
}

/** Inhabitants per province: the sum of its cities' populations. */
function provincePopulation(map: MapFacts): number[] {
  const totals = new Array<number>(map.provinces.length).fill(0);
  for (const c of map.cities) totals[c.provinceId]! += c.population;
  return totals;
}

/** Sea routes between port cities, as links between their provinces. */
function seaLinks(map: MapFacts, file: SeaRoutesFile): SeaLink[] {
  const links: SeaLink[] = [];
  for (const r of file.routes) {
    const a = map.cities[r.a]?.provinceId;
    const b = map.cities[r.b]?.provinceId;
    if (a === undefined || b === undefined || a === b) continue;
    links.push({ a, b, km: r.km });
  }
  return links;
}

/** Nuclear base cities by name, within the country (data/modern/weapons.json). */
function nuclearBases(map: MapFacts, rules: WeaponsRules): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const [country, { bases }] of Object.entries(rules.nuclear.countries)) {
    result[country] = bases
      .map(
        (name) =>
          map.cities.find((c) => c.name === name && map.provinces[c.provinceId]?.owner === country)
            ?.id,
      )
      .filter((id): id is number => id !== undefined);
  }
  return result;
}
