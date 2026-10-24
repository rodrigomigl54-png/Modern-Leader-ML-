// Military (GDD section 8): armies, recruitment, bases, reserves, movement, battles and conquest.
// Armies stand in provinces and move one province per turn along a path (as in Age of History).
// All numbers come from data/modern/military.json (MilitaryRules).
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import type { Rng } from './rng';
import { transferProvince } from './population';
import { alliesOf, enemiesAtWar, type World } from './world';

export interface MilitaryRules {
  units: {
    regularStrength: number;
    specialStrength: number;
    reservistStrength: number;
    traineeStrength: number;
  };
  upkeep: {
    reservistShare: number;
    specialMultiplier: number;
    defaultPersonnelPerMillion: number;
    minWeeklyPerSoldierUsd: number;
  };
  recruitment: {
    manpowerShare: number;
    manpowerShareWithService: number;
    manpowerRefillPerTurn: number;
    regularCostWeeks: number;
    specialCostWeeks: number;
    regularTrainTurns: number;
    specialTrainTurns: number;
    /** Most soldiers a city can recruit per turn, by base level 0-3. */
    capPerTurnByBase: number[];
    specialMinBase: number;
  };
  bases: {
    maxLevel: number;
    capitalStartLevel: number;
    largestCitiesWithBase: number;
    /** Share of a province's reservists that defend it, by base level 0-3. */
    reservistActivation: number[];
    defenseBonusPerLevel: number;
  };
  reserves: {
    startRatioWithService: number;
    startRatioWithoutService: number;
    growthPerTurnOfPopulation: number;
    maxShareOfPopulation: number;
    shrinkPerTurn: number;
    introduceSupportPenalty: number;
  };
  army: { startGarrisons: number; capitalShare: number };
  combat: {
    defenderBonus: number;
    lossRate: number;
    randomness: number;
    routRatio: number;
    supplyInEnemyLand: number;
    supplyCutOff: number;
  };
  naval: { kmPerTurn: number };
  rebels: {
    startShareOfPopulation: number;
    recruitPerTurnOfPopulation: number;
    neutralSupport: number;
  };
  ai: {
    attackRatio: number;
    targetArmyAtWar: number;
    recruitShareOfGap: number;
    maxTreasuryShare: number;
    /** Share of the enemy strength next to a front province the AI keeps there. */
    frontCover: number;
    minGarrison: number;
    /** Smallest army the AI splits off. */
    minDetachment: number;
  };
}

/** A sea route between the port provinces of two port cities. */
export interface SeaLink {
  a: number;
  b: number;
  km: number;
}

export interface Army {
  id: number;
  owner: string;
  provinceId: number;
  regulars: number;
  special: number;
  /** Provinces still to cross, one per turn (the last one is the target). */
  path: number[];
  /** Province the army came from this turn; it retreats there after a lost attack. */
  from: number;
  /** Set while crossing the sea: the turn it lands in provinceId. */
  arriveTurn?: number;
}

export type UnitKind = 'regular' | 'special';

export interface Training {
  owner: string;
  cityId: number;
  provinceId: number;
  kind: UnitKind;
  count: number;
  readyTurn: number;
}

export interface CountryMilitary {
  /** Mandatory military service. */
  service: boolean;
  /** Weekly cost of one regular soldier, USD. */
  upkeepPerSoldier: number;
}

export interface MilitaryState {
  armies: Army[];
  nextArmyId: number;
  training: Training[];
  countries: Record<string, CountryMilitary>;
  /** Recruitable people per city. */
  manpower: number[];
  /** Base level (0-3) per city. */
  bases: number[];
  /** Reservists per province (defense only). */
  reservists: number[];
}

export type MilitaryEvent =
  | {
      type: 'battle';
      provinceId: number;
      attacker: string;
      defender: string;
      winner: 'attacker' | 'defender';
      attackerLosses: number;
      defenderLosses: number;
    }
  | { type: 'provinceCaptured'; provinceId: number; from: string; to: string }
  | { type: 'countryConquered'; countryId: string; by: string }
  | { type: 'trainingDone'; owner: string; provinceId: number; count: number; kind: UnitKind };

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export function militaryRules(ctx: SimContext): MilitaryRules {
  if (!ctx.military) throw new Error('Military rules missing from the simulation context');
  return ctx.military;
}

// ---- Static geography derived from the context (cached per context) ----

interface Geography {
  /** City ids per province, most populous first. */
  citiesOf: number[][];
  /** Sea links per province: neighbor province and crossing turns. */
  sea: Map<number, { to: number; turns: number }[]>;
  land: readonly (readonly number[])[];
}

const geographies = new WeakMap<SimContext, Geography>();

function geography(ctx: SimContext): Geography {
  let g = geographies.get(ctx);
  if (g) return g;
  const n = ctx.provinceNeighbors?.length ?? 0;
  const citiesOf: number[][] = Array.from({ length: n }, () => []);
  ctx.cityProvince.forEach((p, city) => citiesOf[p]?.push(city));
  const pop = (c: number): number => ctx.cityPopulation?.[c] ?? 0;
  for (const list of citiesOf) list.sort((a, b) => pop(b) - pop(a) || a - b);
  const sea = new Map<number, { to: number; turns: number }[]>();
  const kmPerTurn = ctx.military?.naval.kmPerTurn ?? 1000;
  for (const link of ctx.seaRoutes ?? []) {
    if (link.a === link.b) continue;
    const turns = Math.max(1, Math.ceil(link.km / kmPerTurn));
    for (const [x, y] of [
      [link.a, link.b],
      [link.b, link.a],
    ] as const) {
      const list = sea.get(x) ?? [];
      const existing = list.find((e) => e.to === y);
      if (existing) existing.turns = Math.min(existing.turns, turns);
      else list.push({ to: y, turns });
      sea.set(x, list);
    }
  }
  g = { citiesOf, sea, land: ctx.provinceNeighbors ?? [] };
  geographies.set(ctx, g);
  return g;
}

/** Main (most populous) city of a province, or -1. */
export function provinceSeat(ctx: SimContext, provinceId: number): number {
  return geography(ctx).citiesOf[provinceId]?.[0] ?? -1;
}

export function citiesOfProvince(ctx: SimContext, provinceId: number): readonly number[] {
  return geography(ctx).citiesOf[provinceId] ?? [];
}

const provincePop = (ctx: SimContext, p: number): number => ctx.provincePopulation?.[p] ?? 0;
const cityPop = (ctx: SimContext, c: number): number => ctx.cityPopulation?.[c] ?? 0;

/** Highest base level among a province's cities. */
export function provinceBaseLevel(state: GameState, ctx: SimContext, provinceId: number): number {
  let level = 0;
  for (const c of citiesOfProvince(ctx, provinceId))
    level = Math.max(level, state.military.bases[c] ?? 0);
  return level;
}

// ---- Setup ----

function manpowerCap(ctx: SimContext, cityId: number, service: boolean): number {
  const r = militaryRules(ctx).recruitment;
  return Math.floor(
    cityPop(ctx, cityId) * (service ? r.manpowerShareWithService : r.manpowerShare),
  );
}

/** Starting armies, reserves and bases from real data (GDD section 8). */
export function initMilitary(
  state: Pick<GameState, 'world' | 'economy'>,
  ctx: SimContext,
): MilitaryState {
  const rules = militaryRules(ctx);
  const { world } = state;
  const service = new Set(ctx.serviceAtStart ?? []);
  const military: MilitaryState = {
    armies: [],
    nextArmyId: 1,
    training: [],
    countries: {},
    manpower: ctx.cityProvince.map(() => 0),
    bases: ctx.cityProvince.map(() => 0),
    reservists: world.provinceOwners.map(() => 0),
  };
  for (const country of world.countries) {
    const hasService = service.has(country.id);
    for (const p of country.provinceIds)
      for (const c of citiesOfProvince(ctx, p))
        military.manpower[c] = manpowerCap(ctx, c, hasService);
    const population = country.provinceIds.reduce((s, p) => s + provincePop(ctx, p), 0);
    const personnel =
      country.status === 'uninhabited' || country.provinceIds.length === 0
        ? 0
        : Math.round(
            country.stats.militaryPersonnel ??
              ((country.stats.population ?? population) / 1e6) *
                rules.upkeep.defaultPersonnelPerMillion,
          );
    const reserves =
      personnel *
      (hasService ? rules.reserves.startRatioWithService : rules.reserves.startRatioWithoutService);
    const e = state.economy.countries[country.id];
    const weeklySpend = e ? (e.gdp * e.militaryShare) / 52 : 0;
    const paid = personnel + reserves * rules.upkeep.reservistShare;
    military.countries[country.id] = {
      service: hasService,
      upkeepPerSoldier: Math.max(
        rules.upkeep.minWeeklyPerSoldierUsd,
        paid > 0 ? weeklySpend / paid : rules.upkeep.minWeeklyPerSoldierUsd,
      ),
    };
    if (personnel <= 0) continue;

    // Reserves are spread over the provinces by population.
    for (const p of country.provinceIds) {
      military.reservists[p] =
        population > 0
          ? Math.round((reserves * provincePop(ctx, p)) / population)
          : Math.round(reserves / country.provinceIds.length);
    }

    // Regulars: a share in the capital, the rest in the most populous other provinces.
    const others = country.provinceIds
      .filter((p) => p !== country.capitalProvinceId)
      .sort((a, b) => provincePop(ctx, b) - provincePop(ctx, a) || a - b)
      .slice(0, rules.army.startGarrisons - 1);
    const capitalShare = others.length === 0 ? 1 : rules.army.capitalShare;
    const othersPop = others.reduce((s, p) => s + Math.max(1, provincePop(ctx, p)), 0);
    const garrisons: [number, number][] = [
      [country.capitalProvinceId, Math.round(personnel * capitalShare)],
      ...others.map((p): [number, number] => [
        p,
        Math.round((personnel * (1 - capitalShare) * Math.max(1, provincePop(ctx, p))) / othersPop),
      ]),
    ];
    for (const [provinceId, regulars] of garrisons) {
      if (regulars < 1) continue;
      military.armies.push({
        id: military.nextArmyId++,
        owner: country.id,
        provinceId,
        regulars,
        special: 0,
        path: [],
        from: provinceId,
      });
    }

    // Bases: the capital and the largest cities.
    const capitalSeat = provinceSeat(ctx, country.capitalProvinceId);
    if (capitalSeat >= 0) military.bases[capitalSeat] = rules.bases.capitalStartLevel;
    const largest = country.provinceIds
      .flatMap((p) => citiesOfProvince(ctx, p))
      .filter((c) => c !== capitalSeat)
      .sort((a, b) => cityPop(ctx, b) - cityPop(ctx, a) || a - b)
      .slice(0, rules.bases.largestCitiesWithBase);
    for (const c of largest) military.bases[c] = Math.max(military.bases[c]!, 1);
  }
  return military;
}

/** No armies (simulation contexts without military rules, e.g. tests of other systems). */
export function emptyMilitary(world: World, ctx: SimContext): MilitaryState {
  return {
    armies: [],
    nextArmyId: 1,
    training: [],
    countries: {},
    manpower: ctx.cityProvince.map(() => 0),
    bases: ctx.cityProvince.map(() => 0),
    reservists: world.provinceOwners.map(() => 0),
  };
}

/** Adds the military to games saved before Phase 7. */
export function ensureMilitary(state: GameState, ctx: SimContext): GameState {
  if (state.military || !ctx.military) return state;
  return { ...state, military: initMilitary(state, ctx) };
}

// ---- Queries ----

export function armyStrength(
  rules: MilitaryRules,
  army: Pick<Army, 'regulars' | 'special'>,
): number {
  return army.regulars * rules.units.regularStrength + army.special * rules.units.specialStrength;
}

export const armySize = (army: Pick<Army, 'regulars' | 'special'>): number =>
  army.regulars + army.special;

const atSea = (state: GameState, army: Army): boolean =>
  army.arriveTurn !== undefined && army.arriveTurn > state.turn;

export interface MilitaryTotals {
  regulars: number;
  special: number;
  trainees: number;
  reservists: number;
  armies: number;
}

export function militaryTotals(state: GameState, countryId: string): MilitaryTotals {
  const totals = { regulars: 0, special: 0, trainees: 0, reservists: 0, armies: 0 };
  for (const a of state.military.armies) {
    if (a.owner !== countryId) continue;
    totals.regulars += a.regulars;
    totals.special += a.special;
    totals.armies++;
  }
  for (const t of state.military.training) if (t.owner === countryId) totals.trainees += t.count;
  const country = state.world.countries.find((c) => c.id === countryId);
  for (const p of country?.provinceIds ?? []) totals.reservists += state.military.reservists[p]!;
  return totals;
}

/** Recruitable people in a country's cities. */
export function availableManpower(state: GameState, ctx: SimContext, countryId: string): number {
  const country = state.world.countries.find((c) => c.id === countryId);
  let total = 0;
  for (const p of country?.provinceIds ?? [])
    for (const c of citiesOfProvince(ctx, p)) total += state.military.manpower[c]!;
  return total;
}

/** Weekly cost of a country's soldiers (replaces the fixed military share of GDP). */
export function armyUpkeep(state: GameState, ctx: SimContext, countryId: string): number {
  const m = state.military?.countries[countryId];
  const rules = ctx.military;
  if (!m || !rules) return 0;
  const country = state.world.countries.find((c) => c.id === countryId);
  if (country?.status === 'rebels') return 0;
  const t = militaryTotals(state, countryId);
  return (
    m.upkeepPerSoldier *
    (t.regulars +
      t.trainees +
      t.special * rules.upkeep.specialMultiplier +
      t.reservists * rules.upkeep.reservistShare)
  );
}

/** Border rule (GDD section 5): own land, allies' land, or land of a country at war with us. */
export function entryRule(world: World, mover: string): (owner: string) => boolean {
  const allowed = new Set([mover, ...alliesOf(world, mover), ...enemiesAtWar(world, mover)]);
  return (owner) => allowed.has(owner);
}

/** Shortest path (turns) for an army, land and sea; null when blocked. Excludes the start. */
export function findPath(
  state: GameState,
  ctx: SimContext,
  owner: string,
  from: number,
  to: number,
): number[] | null {
  if (from === to) return [];
  const { land, sea } = geography(ctx);
  const owners = state.world.provinceOwners;
  const canEnter = entryRule(state.world, owner);
  if (!canEnter(owners[to]!)) return null;
  const n = owners.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  dist[from] = 0;
  // Small binary heap keyed by distance, ties by province id for determinism.
  const heap: [number, number][] = [[0, from]];
  const less = (x: [number, number], y: [number, number]): boolean =>
    x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  const push = (item: [number, number]): void => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(heap[i]!, heap[parent]!)) break;
      [heap[i], heap[parent]] = [heap[parent]!, heap[i]!];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l]!, heap[m]!)) m = l;
        if (r < heap.length && less(heap[r]!, heap[m]!)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m]!, heap[i]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [d, p] = pop();
    if (d > dist[p]!) continue;
    if (p === to) break;
    const step = (q: number, cost: number): void => {
      if (!canEnter(owners[q]!)) return;
      const nd = d + cost;
      if (nd < dist[q]!) {
        dist[q] = nd;
        prev[q] = p;
        push([nd, q]);
      }
    };
    for (const q of land[p] ?? []) step(q, 1);
    for (const link of sea.get(p) ?? []) step(link.to, link.turns);
  }
  if (!Number.isFinite(dist[to]!)) return null;
  const path: number[] = [];
  for (let p = to; p !== from; p = prev[p]!) path.push(p);
  return path.reverse();
}

/** Turns to reach the end of a path (sea crossings take longer). */
export function pathTurns(ctx: SimContext, from: number, path: readonly number[]): number {
  const { land, sea } = geography(ctx);
  let turns = 0;
  let at = from;
  for (const p of path) {
    turns += land[at]?.includes(p) ? 1 : (sea.get(at)?.find((l) => l.to === p)?.turns ?? 1);
    at = p;
  }
  return turns;
}

// ---- Recruitment ----

export type RecruitMode = 'fixed' | 'percent';

export interface RecruitQuote {
  kind: UnitKind;
  cities: { cityId: number; wanted: number; taken: number }[];
  total: number;
  cost: number;
  turns: number;
  affordable: boolean;
  /** Cities skipped: not the country's, or no base good enough for special forces. */
  skipped: number[];
}

/**
 * Recruitment in many cities at once (GDD section 8): a fixed number per city (takes what is
 * available) or a share of each city's available manpower.
 */
export function recruitQuote(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  cityIds: readonly number[],
  kind: UnitKind,
  mode: RecruitMode,
  amount: number,
): RecruitQuote {
  const rules = militaryRules(ctx);
  const r = rules.recruitment;
  const m = state.military.countries[countryId];
  const cities: RecruitQuote['cities'] = [];
  const skipped: number[] = [];
  for (const cityId of [...new Set(cityIds)].sort((a, b) => a - b)) {
    const provinceId = ctx.cityProvince[cityId];
    const base = state.military.bases[cityId] ?? 0;
    if (
      provinceId === undefined ||
      state.world.provinceOwners[provinceId] !== countryId ||
      (kind === 'special' && base < r.specialMinBase)
    ) {
      skipped.push(cityId);
      continue;
    }
    const available = Math.floor(state.military.manpower[cityId]!);
    const wanted = Math.max(
      0,
      Math.floor(mode === 'fixed' ? amount : (available * clamp(amount, 0, 100)) / 100),
    );
    const cap = r.capPerTurnByBase[Math.min(base, r.capPerTurnByBase.length - 1)]!;
    cities.push({ cityId, wanted, taken: Math.min(wanted, available, cap) });
  }
  const total = cities.reduce((s, c) => s + c.taken, 0);
  const weeks = kind === 'special' ? r.specialCostWeeks : r.regularCostWeeks;
  const cost = total * (m?.upkeepPerSoldier ?? 0) * weeks;
  const treasury = state.economy.countries[countryId]?.treasury ?? 0;
  return {
    kind,
    cities,
    total,
    cost,
    turns: kind === 'special' ? r.specialTrainTurns : r.regularTrainTurns,
    affordable: total > 0 && cost <= treasury,
    skipped,
  };
}

/** Applies a recruit quote: pays, takes manpower and starts training. */
export function startRecruitment(
  state: GameState,
  countryId: string,
  ctx: SimContext,
  quote: RecruitQuote,
): void {
  state.economy.countries[countryId]!.treasury -= quote.cost;
  for (const c of quote.cities) {
    if (c.taken <= 0) continue;
    state.military.manpower[c.cityId]! -= c.taken;
    state.military.training.push({
      owner: countryId,
      cityId: c.cityId,
      provinceId: ctx.cityProvince[c.cityId]!,
      kind: quote.kind,
      count: c.taken,
      readyTurn: state.turn + quote.turns,
    });
  }
}

// ---- Turn phases ----

/** Adds soldiers to the owner's idle army in a province, or creates one. */
export function reinforce(
  state: GameState,
  owner: string,
  provinceId: number,
  regulars: number,
  special: number,
): Army {
  let army = state.military.armies.find(
    (a) =>
      a.owner === owner && a.provinceId === provinceId && a.path.length === 0 && !atSea(state, a),
  );
  if (!army) {
    army = {
      id: state.military.nextArmyId++,
      owner,
      provinceId,
      regulars: 0,
      special: 0,
      path: [],
      from: provinceId,
    };
    state.military.armies.push(army);
  }
  army.regulars += regulars;
  army.special += special;
  return army;
}

/** Turn step 3: armies move one province (or start/finish a sea crossing). */
export function movementPhase(state: GameState, ctx: SimContext): void {
  const { land, sea } = geography(ctx);
  const owners = state.world.provinceOwners;
  const rules = new Map<string, (owner: string) => boolean>();
  for (const army of state.military.armies) {
    army.from = army.provinceId;
    if (army.arriveTurn !== undefined) {
      if (army.arriveTurn <= state.turn) delete army.arriveTurn;
      continue;
    }
    const next = army.path[0];
    if (next === undefined) continue;
    let canEnter = rules.get(army.owner);
    if (!canEnter) {
      canEnter = entryRule(state.world, army.owner);
      rules.set(army.owner, canEnter);
    }
    if (!canEnter(owners[next]!)) {
      army.path = [];
      continue;
    }
    army.path.shift();
    if (!land[army.provinceId]?.includes(next)) {
      const turns = sea.get(army.provinceId)?.find((l) => l.to === next)?.turns ?? 1;
      // Crossings of more than one turn spend the extra turns at sea.
      if (turns > 1) army.arriveTurn = state.turn + turns - 1;
    }
    army.provinceId = next;
  }
}

function shrinkArmy(army: Army, fraction: number): number {
  const before = armySize(army);
  army.regulars = Math.floor(army.regulars * (1 - fraction));
  army.special = Math.floor(army.special * (1 - fraction));
  return before - armySize(army);
}

/** Moves an army that lost a battle to a neighboring province it may stand in; false if none. */
function retreat(state: GameState, ctx: SimContext, army: Army, avoid: number): boolean {
  const owners = state.world.provinceOwners;
  const friendly = new Set([army.owner, ...alliesOf(state.world, army.owner)]);
  if (army.from !== avoid && friendly.has(owners[army.from]!)) {
    army.provinceId = army.from;
    army.path = [];
    return true;
  }
  const options = (geography(ctx).land[avoid] ?? []).filter((p) => friendly.has(owners[p]!));
  const own = options.filter((p) => owners[p] === army.owner);
  const target = (own.length > 0 ? own : options)[0];
  if (target === undefined) return false;
  army.provinceId = target;
  army.path = [];
  return true;
}

/** Hands a captured province to the attacker (GDD: conquest; culture stays). */
function capture(
  state: GameState,
  ctx: SimContext,
  provinceId: number,
  to: string,
  emit: (e: MilitaryEvent) => void,
): void {
  const from = state.world.provinceOwners[provinceId]!;
  transferProvince(state, ctx, provinceId, to);
  state.military.reservists[provinceId] = 0;
  state.military.training = state.military.training.filter(
    (t) => !(t.provinceId === provinceId && t.owner === from),
  );
  emit({ type: 'provinceCaptured', provinceId, from, to });
}

/** Turn step 4: battles where enemies meet, and capture of undefended enemy provinces. */
export function battlePhase(
  state: GameState,
  ctx: SimContext,
  rng: Rng,
  emit: (e: MilitaryEvent) => void,
): void {
  const rules = militaryRules(ctx);
  const c = rules.combat;
  const owners = state.world.provinceOwners;
  const { land } = geography(ctx);
  const byProvince = new Map<number, Army[]>();
  for (const a of state.military.armies) {
    if (atSea(state, a)) continue;
    const list = byProvince.get(a.provinceId) ?? [];
    list.push(a);
    byProvince.set(a.provinceId, list);
  }
  const losers = new Set<string>();
  for (const provinceId of [...byProvince.keys()].sort((a, b) => a - b)) {
    const owner = owners[provinceId]!;
    const here = byProvince.get(provinceId)!;
    const enemies = new Set(enemiesAtWar(state.world, owner));
    const attackers = here.filter((a) => enemies.has(a.owner) && armySize(a) > 0);
    if (attackers.length === 0) continue;
    const friends = new Set([owner, ...alliesOf(state.world, owner)]);
    const defenders = here.filter((a) => friends.has(a.owner) && armySize(a) > 0);

    // Reservists defend only where a base can call them up; trainees defend their city.
    const level = provinceBaseLevel(state, ctx, provinceId);
    const reservists = Math.floor(
      state.military.reservists[provinceId]! *
        (rules.bases.reservistActivation[
          Math.min(level, rules.bases.reservistActivation.length - 1)
        ] ?? 0),
    );
    const trainees = state.military.training.filter(
      (t) => t.provinceId === provinceId && t.owner === owner,
    );
    const traineeCount = trainees.reduce((s, t) => s + t.count, 0);

    // The largest attacking country leads (and takes the province if it wins).
    const strengthBy = new Map<string, number>();
    for (const a of attackers)
      strengthBy.set(a.owner, (strengthBy.get(a.owner) ?? 0) + armyStrength(rules, a));
    const leader = [...strengthBy.entries()].sort(
      (x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1),
    )[0]![0];

    const defenseBase =
      defenders.reduce((s, a) => s + armyStrength(rules, a), 0) +
      reservists * rules.units.reservistStrength +
      traineeCount * rules.units.traineeStrength;
    if (defenseBase <= 0) {
      capture(state, ctx, provinceId, leader, emit);
      if (state.world.countries.find((x) => x.id === owner)?.provinceIds.length === 0)
        losers.add(owner);
      continue;
    }

    const supplied = (land[provinceId] ?? []).some((p) => {
      const o = owners[p]!;
      return o === leader || alliesOf(state.world, leader).includes(o);
    });
    const vary = (): number => 1 + (rng.next() * 2 - 1) * c.randomness;
    const attack =
      attackers.reduce((s, a) => s + armyStrength(rules, a), 0) *
      (supplied ? c.supplyInEnemyLand : c.supplyCutOff) *
      vary();
    const defense =
      defenseBase * (1 + c.defenderBonus + level * rules.bases.defenseBonusPerLevel) * vary();
    const attackerWins = attack > defense;
    const [win, lose] = attackerWins ? [attack, defense] : [defense, attack];
    const winnerLoss = clamp(c.lossRate * (lose / win), 0, 1);
    const loserLoss = lose / win < c.routRatio ? 1 : clamp(c.lossRate * 2 * (win / lose), 0, 1);
    const [attackerLoss, defenderLoss] = attackerWins
      ? [winnerLoss, loserLoss]
      : [loserLoss, winnerLoss];

    let attackerLosses = 0;
    for (const a of attackers) attackerLosses += shrinkArmy(a, attackerLoss);
    let defenderLosses = 0;
    for (const a of defenders) defenderLosses += shrinkArmy(a, defenderLoss);
    const reservistLosses = Math.floor(reservists * defenderLoss);
    state.military.reservists[provinceId]! -= reservistLosses;
    defenderLosses += reservistLosses;
    for (const t of trainees) {
      const lost = Math.floor(t.count * defenderLoss);
      t.count -= lost;
      defenderLosses += lost;
    }
    state.military.training = state.military.training.filter((t) => t.count > 0);

    if (attackerWins) {
      for (const a of defenders)
        if (armySize(a) > 0 && !retreat(state, ctx, a, provinceId)) shrinkArmy(a, 1);
      capture(state, ctx, provinceId, leader, emit);
      if (state.world.countries.find((x) => x.id === owner)?.provinceIds.length === 0)
        losers.add(owner);
    } else {
      for (const a of attackers)
        if (armySize(a) > 0 && !retreat(state, ctx, a, provinceId)) shrinkArmy(a, 1);
    }
    emit({
      type: 'battle',
      provinceId,
      attacker: leader,
      defender: owner,
      winner: attackerWins ? 'attacker' : 'defender',
      attackerLosses,
      defenderLosses,
    });
  }

  state.military.armies = state.military.armies.filter((a) => armySize(a) > 0);
  for (const id of [...losers].sort()) conquered(state, id, emit);
  mergeArmies(state);
}

/** A country lost its last province to an army. Revolutions are handled by the population. */
function conquered(state: GameState, countryId: string, emit: (e: MilitaryEvent) => void): void {
  const country = state.world.countries.find((c) => c.id === countryId);
  if (!country || country.provinceIds.length > 0 || country.status === 'rebels') return;
  if (state.population?.factions.some((f) => f.parent === countryId)) return;
  const by = [...enemiesAtWar(state.world, countryId)].sort()[0] ?? '';
  state.military.armies = state.military.armies.filter((a) => a.owner !== countryId);
  state.military.training = state.military.training.filter((t) => t.owner !== countryId);
  state.world.wars = state.world.wars
    .map((w) => ({
      ...w,
      sides: [
        w.sides[0].filter((x) => x !== countryId),
        w.sides[1].filter((x) => x !== countryId),
      ] as [string[], string[]],
    }))
    .filter((w) => w.sides[0].length > 0 && w.sides[1].length > 0);
  emit({ type: 'countryConquered', countryId, by });
  if (state.player.countryId === countryId)
    state.gameOver = { reason: 'conquered', turn: state.turn };
}

/** Idle armies of one owner standing in the same province join together. */
export function mergeArmies(state: GameState): void {
  const keep = new Map<string, Army>();
  const result: Army[] = [];
  for (const a of state.military.armies) {
    if (a.path.length > 0 || atSea(state, a)) {
      result.push(a);
      continue;
    }
    const key = `${a.owner}|${a.provinceId}`;
    const first = keep.get(key);
    if (first) {
      first.regulars += a.regulars;
      first.special += a.special;
    } else {
      keep.set(key, a);
      result.push(a);
    }
  }
  state.military.armies = result;
}

/** Turn step 5: training finishes; manpower refills; reserves grow or shrink; new bases. */
export function trainingPhase(
  state: GameState,
  ctx: SimContext,
  emit: (e: MilitaryEvent) => void,
): void {
  const rules = militaryRules(ctx);
  const m = state.military;
  const owners = state.world.provinceOwners;
  const remaining: Training[] = [];
  for (const t of m.training) {
    if (t.readyTurn > state.turn) {
      remaining.push(t);
      continue;
    }
    // Trainees whose city was lost are gone (capture removes them).
    if (owners[t.provinceId] !== t.owner) continue;
    reinforce(
      state,
      t.owner,
      t.provinceId,
      t.kind === 'regular' ? t.count : 0,
      t.kind === 'special' ? t.count : 0,
    );
    emit({
      type: 'trainingDone',
      owner: t.owner,
      provinceId: t.provinceId,
      count: t.count,
      kind: t.kind,
    });
  }
  m.training = remaining;

  for (const b of state.economy.buildings) {
    if (b.category === 'militaryBase' && b.completed && b.completeTurn === state.turn)
      m.bases[b.cityId] = Math.min(rules.bases.maxLevel, (m.bases[b.cityId] ?? 0) + 1);
  }

  const r = rules.reserves;
  for (const country of state.world.countries) {
    const service = m.countries[country.id]?.service ?? false;
    for (const p of country.provinceIds) {
      for (const c of citiesOfProvince(ctx, p)) {
        const cap = manpowerCap(ctx, c, service);
        m.manpower[c] = Math.min(
          cap,
          m.manpower[c]! + cap * rules.recruitment.manpowerRefillPerTurn,
        );
      }
      const pop = provincePop(ctx, p);
      m.reservists[p] = service
        ? Math.min(
            pop * r.maxShareOfPopulation,
            m.reservists[p]! + pop * r.growthPerTurnOfPopulation,
          )
        : m.reservists[p]! * (1 - r.shrinkPerTurn);
    }
  }
}
