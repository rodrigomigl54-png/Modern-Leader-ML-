// The political world at the scenario start, as the simulation sees it.

/** 'rebels' are factions created by a revolution during the game (GDD section 7). */
export type CountryStatus = 'full' | 'disputed' | 'uninhabited' | 'rebels';
export type DisputedMode = 'neutral' | 'states' | 'parent';
export type Aggressiveness = 'peaceful' | 'realistic' | 'aggressive' | 'chaos';

export const AGGRESSIVENESS_LEVELS: readonly Aggressiveness[] = [
  'peaceful',
  'realistic',
  'aggressive',
  'chaos',
];
export const DISPUTED_MODES: readonly DisputedMode[] = ['neutral', 'states', 'parent'];

export interface CountryStats {
  gdpUsd: number | null;
  population: number | null;
  militaryPersonnel: number | null;
  militaryExpenditureUsd: number | null;
  /** World Bank "Political Stability and Absence of Violence" estimate, about -2.5 to 2.5. */
  stability: number | null;
}

export interface Leader {
  name: string | null;
  title: string;
}

export interface WorldCountry {
  id: string;
  status: CountryStatus;
  capitalProvinceId: number;
  provinceIds: number[];
  stats: CountryStats;
  leader: Leader;
  /** Set for countries born during the game: rebels, or a state that seceded from its parent. */
  faction?: { kind: 'rebels' | 'seceded'; parent: string };
}

export interface Alliance {
  id: string;
  /** 'vassal': members are [overlord, vassal] (GDD section 10). */
  type: 'alliance' | 'pact' | 'vassal';
  members: string[];
}

/** A military base of one country in another country's city (GDD section 10). */
export interface ForeignBase {
  owner: string;
  host: string;
  cityId: number;
}

export interface Rivalry {
  a: string;
  b: string;
}

export interface War {
  id: string;
  sides: [string[], string[]];
}

export interface World {
  startDate: string;
  countries: WorldCountry[];
  /** Owner country id per province id. */
  provinceOwners: string[];
  alliances: Alliance[];
  rivalries: Rivalry[];
  wars: War[];
  disputed: { id: string; parent: string }[];
  /** Bases abroad; a base lets its owner's armies enter the host's land. */
  foreignBases?: ForeignBase[];
  /** Military access: the host lets the guest's armies cross its land (GDD section 5). */
  militaryAccess?: { host: string; guest: string }[];
}

/**
 * Applies the disputed-territories setting (GDD section 4). It changes the game data, not just
 * the visuals: as states they become playable, as part of their parent state they disappear.
 */
export function applyDisputedSetting(world: World, mode: DisputedMode): World {
  const disputedIds = new Set(world.disputed.map((d) => d.id));
  if (mode === 'neutral') {
    return {
      ...world,
      countries: world.countries.map((c) =>
        disputedIds.has(c.id) ? { ...c, status: 'disputed' } : c,
      ),
    };
  }
  if (mode === 'states') {
    return {
      ...world,
      countries: world.countries.map((c) => (disputedIds.has(c.id) ? { ...c, status: 'full' } : c)),
    };
  }

  const parentOf = new Map(world.disputed.map((d) => [d.id, d.parent]));
  const resolve = (id: string): string => parentOf.get(id) ?? id;
  const countries = world.countries
    .filter((c) => !disputedIds.has(c.id))
    .map((c) => {
      const absorbed = world.countries.filter((d) => parentOf.get(d.id) === c.id);
      if (absorbed.length === 0) return c;
      return {
        ...c,
        provinceIds: [...c.provinceIds, ...absorbed.flatMap((d) => d.provinceIds)].sort(
          (a, b) => a - b,
        ),
      };
    });
  const involvesDisputed = (ids: string[]): boolean => ids.some((id) => disputedIds.has(id));
  return {
    ...world,
    countries,
    provinceOwners: world.provinceOwners.map(resolve),
    alliances: world.alliances
      .map((a) => ({ ...a, members: a.members.filter((m) => !disputedIds.has(m)) }))
      .filter((a) => a.members.length >= 2),
    rivalries: world.rivalries.filter((r) => !involvesDisputed([r.a, r.b])),
    wars: world.wars.filter((w) => !involvesDisputed([...w.sides[0], ...w.sides[1]])),
    disputed: [],
  };
}

export function alliesOf(world: World, id: string): string[] {
  const allies = new Set<string>();
  for (const a of world.alliances) {
    if (!a.members.includes(id)) continue;
    for (const m of a.members) if (m !== id) allies.add(m);
  }
  return [...allies].sort();
}

export function rivalsOf(world: World, id: string): string[] {
  const rivals = new Set<string>();
  for (const r of world.rivalries) {
    if (r.a === id) rivals.add(r.b);
    if (r.b === id) rivals.add(r.a);
  }
  return [...rivals].sort();
}

export function enemiesAtWar(world: World, id: string): string[] {
  const enemies = new Set<string>();
  for (const w of world.wars) {
    const [a, b] = w.sides;
    if (a.includes(id)) b.forEach((e) => enemies.add(e));
    if (b.includes(id)) a.forEach((e) => enemies.add(e));
  }
  return [...enemies].sort();
}

export function playableCountries(world: World): WorldCountry[] {
  return world.countries.filter((c) => c.status === 'full');
}
