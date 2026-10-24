// Missiles, drones, air defense and nuclear weapons (GDD section 9). Missiles and drones destroy
// but never capture; air defense intercepts a share of them within its radius, up to a number per
// turn; nuclear weapons cannot be intercepted and bring catastrophic consequences for the user.
// All numbers come from data/modern/weapons.json (WeaponsRules).
import { category, type SimContext } from './economy';
import { armySize, citiesOfProvince, entryRule, findPath, provinceSeat } from './military';
import type { GameState } from './newGame';
import type { Rng } from './rng';
import { alliesOf, enemiesAtWar } from './world';

export interface StrikeDamage {
  soldiers: number;
  buildingChance: number;
  baseChance: number;
  airDefenseChance: number;
  nuclearBaseChance: number;
  gdpShare: number;
  support: number;
}

export interface MissileTier extends StrikeDamage {
  tier: number;
  rangeKm: number;
  costUsd: number;
  /** Cities hit by one missile. */
  cities: number;
}

export interface DroneTier extends StrikeDamage {
  tier: number;
  rangeProvinces: number;
  costUsd: number;
}

export interface AirDefenseLevel {
  level: number;
  radiusKm: number;
  intercept: number;
  capacity: number;
  costUsd: number;
  buildTurns: number;
}

export interface WeaponsRules {
  missiles: MissileTier[];
  drones: DroneTier[];
  airDefense: { levels: AirDefenseLevel[]; droneInterceptFactor: number };
  production: {
    missilesPerFactory: number;
    dronesPerFactory: number;
    missileTierWeight: number[];
    droneTierWeight: number[];
    minTurns: number;
  };
  start: {
    minSpendingUsd: number;
    missilesPerBillion: number[];
    dronesPerBillion: number[];
    defaultMissileTier: number;
    defaultDroneTier: number;
    /** [highest missile tier, highest drone tier] per country. */
    techTiers: Record<string, [number, number]>;
    airDefenseBySpending: { minSpendingUsd: number; capital: number; largestCities: number }[];
    factoriesBySpending: { minSpendingUsd: number; factories: number }[];
  };
  ai: {
    missileShare: number;
    missileMax: number;
    droneShare: number;
    droneMax: number;
    productionTreasuryShare: number;
  };
  nuclear: {
    programCostUsd: number;
    programTurns: number;
    programWarheads: number;
    rangeKm: number;
    provinceSoldiersKilled: number;
    neighborSoldiersKilled: number;
    provinceGdpLost: number;
    targetSupport: number;
    provinceSupport: number;
    userSupport: number;
    userGdpLoss: number;
    pariahGrowthPenalty: number;
    aiLastResortShare: number;
    countries: Record<string, { warheads: number; bases: string[] }>;
  };
}

export type WeaponKind = 'missile' | 'drone';

export interface CountryArsenal {
  /** Missiles in stock per tier (index 0 = tier 1). */
  missiles: number[];
  drones: number[];
  warheads: number;
  /** Highest tier the country can produce: [missile, drone]. */
  tech: [number, number];
  /** Factories the country starts with (finished factory investments add to these). */
  startFactories: { missile: number; drone: number; airDefense: number };
  /** Turn the nuclear program finishes, or -1. */
  nuclearProgramUntil: number;
  /** Used nuclear weapons: the world treats it as a pariah. */
  nuclearUser: boolean;
  startProvinces: number;
}

export interface Production {
  owner: string;
  weapon: WeaponKind;
  tier: number;
  count: number;
  readyTurn: number;
}

export interface AirDefenseBuild {
  owner: string;
  cityId: number;
  level: number;
  readyTurn: number;
}

export interface MissileFlight {
  id: number;
  owner: string;
  /** Tier, or 0 for a nuclear warhead. */
  tier: number;
  count: number;
  fromCityId: number;
  targetCityId: number;
  impactTurn: number;
}

export interface DroneFlight {
  id: number;
  owner: string;
  tier: number;
  count: number;
  provinceId: number;
  path: number[];
  targetProvinceId: number;
}

export interface NuclearBase {
  cityId: number;
  country: string;
}

export interface WeaponsState {
  countries: Record<string, CountryArsenal>;
  /** Air-defense level (0-3) per city. */
  airDefense: number[];
  nuclearBases: NuclearBase[];
  production: Production[];
  airDefenseBuilds: AirDefenseBuild[];
  missiles: MissileFlight[];
  drones: DroneFlight[];
  nextId: number;
}

export interface StrikeReport {
  attacker: string;
  defender: string;
  cityId: number;
  weapon: WeaponKind | 'nuclear';
  launched: number;
  intercepted: number;
  soldiersKilled: number;
  buildingsDestroyed: number;
}

export type WeaponsEvent =
  | ({ type: 'strike' } & StrikeReport)
  | { type: 'nuclearStrike'; attacker: string; defender: string; cityId: number }
  | {
      type: 'weaponsReady';
      owner: string;
      weapon: WeaponKind | 'airDefense' | 'nuclear';
      count: number;
    };

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export function weaponsRules(ctx: SimContext): WeaponsRules {
  if (!ctx.weapons) throw new Error('Weapons rules missing from the simulation context');
  return ctx.weapons;
}

/** Great-circle distance between two cities in km. */
export function cityDistanceKm(ctx: SimContext, a: number, b: number): number {
  const p = ctx.cityLonLat?.[a];
  const q = ctx.cityLonLat?.[b];
  if (!p || !q) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (q[1] - p[1]) * rad;
  const dLon = (q[0] - p[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(p[1] * rad) * Math.cos(q[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const ownerOfCity = (state: GameState, ctx: SimContext, cityId: number): string | undefined =>
  state.world.provinceOwners[ctx.cityProvince[cityId] ?? -1];

// ---- Setup ----

function spendingOf(state: Pick<GameState, 'economy'>, id: string): number {
  const e = state.economy.countries[id];
  return e ? e.gdp * e.militaryShare : 0;
}

export function emptyWeapons(ctx: SimContext): WeaponsState {
  return {
    countries: {},
    airDefense: ctx.cityProvince.map(() => 0),
    nuclearBases: [],
    production: [],
    airDefenseBuilds: [],
    missiles: [],
    drones: [],
    nextId: 1,
  };
}

/** Starting arsenals, air defense and nuclear forces (GDD section 9). */
export function initWeapons(
  state: Pick<GameState, 'world' | 'economy'>,
  ctx: SimContext,
): WeaponsState {
  const rules = weaponsRules(ctx);
  const s = rules.start;
  const weapons = emptyWeapons(ctx);
  const pop = (c: number): number => ctx.cityPopulation?.[c] ?? 0;
  for (const country of state.world.countries) {
    const spending = spendingOf(state, country.id);
    const tech = s.techTiers[country.id] ?? [s.defaultMissileTier, s.defaultDroneTier];
    const billions = spending >= s.minSpendingUsd ? spending / 1e9 : 0;
    const stock = (perBillion: number[], max: number): number[] =>
      perBillion.map((n, i) => (i < max ? Math.floor(n * billions) : 0));
    const factories =
      s.factoriesBySpending.find((f) => spending >= f.minSpendingUsd)?.factories ?? 0;
    const nuclear = rules.nuclear.countries[country.id];
    weapons.countries[country.id] = {
      missiles: stock(s.missilesPerBillion, tech[0]),
      drones: stock(s.dronesPerBillion, tech[1]),
      warheads: nuclear?.warheads ?? 0,
      tech: [tech[0], tech[1]],
      startFactories: { missile: factories, drone: factories, airDefense: factories },
      nuclearProgramUntil: -1,
      nuclearUser: false,
      startProvinces: country.provinceIds.length,
    };
    const ad = s.airDefenseBySpending.find((a) => spending >= a.minSpendingUsd);
    if (ad && country.provinceIds.length > 0) {
      const capital = provinceSeat(ctx, country.capitalProvinceId);
      if (capital >= 0) weapons.airDefense[capital] = ad.capital;
      const largest = country.provinceIds
        .flatMap((p) => citiesOfProvince(ctx, p))
        .filter((c) => c !== capital)
        .sort((a, b) => pop(b) - pop(a) || a - b)
        .slice(0, ad.largestCities);
      for (const c of largest) weapons.airDefense[c] = Math.max(weapons.airDefense[c]!, 1);
    }
    for (const cityId of ctx.nuclearBaseCities?.[country.id] ?? [])
      weapons.nuclearBases.push({ cityId, country: country.id });
  }
  return weapons;
}

/** Adds weapons to games saved before Phase 8. */
export function ensureWeapons(state: GameState, ctx: SimContext): GameState {
  if (state.weapons || !ctx.weapons) return state;
  return { ...state, weapons: initWeapons(state, ctx) };
}

// ---- Queries ----

/** Finished factories of a type (own buildings in own cities) plus the starting ones. */
export function factories(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  type: 'missile' | 'drone' | 'airDefense',
): number {
  const id = { missile: 'missileFactory', drone: 'droneFactory', airDefense: 'airDefenseFactory' }[
    type
  ];
  const built = state.economy.buildings.filter(
    (b) =>
      b.category === id &&
      b.completed &&
      b.owner === countryId &&
      ownerOfCity(state, ctx, b.cityId) === countryId,
  ).length;
  return built + (state.weapons.countries[countryId]?.startFactories[type] ?? 0);
}

/** Active nuclear bases of a country (a captured base no longer launches). */
export function nuclearBasesOf(state: GameState, ctx: SimContext, countryId: string): number[] {
  return state.weapons.nuclearBases
    .filter((b) => b.country === countryId && ownerOfCity(state, ctx, b.cityId) === countryId)
    .map((b) => b.cityId);
}

/** Missile launch sites: own cities with a military base. */
function launchSites(state: GameState, ctx: SimContext, countryId: string): number[] {
  const country = state.world.countries.find((c) => c.id === countryId);
  const own = (country?.provinceIds ?? [])
    .flatMap((p) => citiesOfProvince(ctx, p))
    .filter((c) => (state.military.bases[c] ?? 0) > 0);
  // Bases abroad extend the reach (GDD section 10).
  const abroad = (state.world.foreignBases ?? [])
    .filter((b) => b.owner === countryId && ownerOfCity(state, ctx, b.cityId) === b.host)
    .map((b) => b.cityId);
  return [...own, ...abroad];
}

/** Nearest launch site within range of a target city, or -1. */
export function launchSiteFor(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  targetCityId: number,
  rangeKm: number,
  sites = launchSites(state, ctx, countryId),
): number {
  let best = -1;
  let bestKm = Infinity;
  for (const c of sites) {
    const km = cityDistanceKm(ctx, c, targetCityId);
    if (km <= rangeKm && km < bestKm) {
      best = c;
      bestKm = km;
    }
  }
  return best;
}

export interface Coverage {
  cityId: number;
  level: AirDefenseLevel;
}

/** Air-defense sites of a country and its allies that cover a city. */
export function coverageOf(
  state: GameState,
  ctx: SimContext,
  defender: string,
  cityId: number,
): Coverage[] {
  const rules = weaponsRules(ctx);
  const side = new Set([defender, ...alliesOf(state.world, defender)]);
  const result: Coverage[] = [];
  state.weapons.airDefense.forEach((lvl, site) => {
    if (lvl <= 0) return;
    const owner = ownerOfCity(state, ctx, site);
    if (!owner || !side.has(owner)) return;
    const level = rules.airDefense.levels[lvl - 1]!;
    if (cityDistanceKm(ctx, site, cityId) <= level.radiusKm) result.push({ cityId: site, level });
  });
  return result.sort((a, b) => b.level.intercept - a.level.intercept || a.cityId - b.cityId);
}

/** Interception chance and how many per turn the covering sites can stop (for the strike dialog). */
export function defenseEstimate(
  state: GameState,
  ctx: SimContext,
  defender: string,
  cityId: number,
): { intercept: number; capacity: number } {
  const cover = coverageOf(state, ctx, defender, cityId);
  return {
    intercept: cover[0]?.level.intercept ?? 0,
    capacity: cover.reduce((s, c) => s + c.level.capacity, 0),
  };
}

// ---- Orders (used by commands and the AI) ----

export type WeaponsError =
  | 'notAtWar'
  | 'outOfRange'
  | 'noStock'
  | 'noLaunchSite'
  | 'noFactory'
  | 'tierLocked'
  | 'notEnoughMoney'
  | 'maxLevel'
  | 'programRunning'
  | 'hasNuclear'
  | 'notOwnCity'
  | 'outOfRangeOrBlocked';

export function launchMissiles(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  targetCityId: number,
  tier: number,
  count: number,
): WeaponsError | null {
  const rules = weaponsRules(ctx);
  const t = rules.missiles[tier - 1];
  const arsenal = state.weapons.countries[countryId];
  const target = ownerOfCity(state, ctx, targetCityId);
  if (!t || !arsenal || !target) return 'noStock';
  if (!enemiesAtWar(state.world, countryId).includes(target)) return 'notAtWar';
  const n = Math.floor(count);
  if (n < 1 || (arsenal.missiles[tier - 1] ?? 0) < n) return 'noStock';
  const from = launchSiteFor(state, ctx, countryId, targetCityId, t.rangeKm);
  if (from < 0) return launchSites(state, ctx, countryId).length ? 'outOfRange' : 'noLaunchSite';
  arsenal.missiles[tier - 1]! -= n;
  state.weapons.missiles.push({
    id: state.weapons.nextId++,
    owner: countryId,
    tier,
    count: n,
    fromCityId: from,
    targetCityId,
    impactTurn: state.turn + 1,
  });
  return null;
}

/** Drones fly from the nearest own province with a base, one province per turn. */
export function launchDrones(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  targetProvinceId: number,
  tier: number,
  count: number,
): WeaponsError | null {
  const rules = weaponsRules(ctx);
  const t = rules.drones[tier - 1];
  const arsenal = state.weapons.countries[countryId];
  const target = state.world.provinceOwners[targetProvinceId];
  if (!t || !arsenal || !target) return 'noStock';
  if (!enemiesAtWar(state.world, countryId).includes(target)) return 'notAtWar';
  const n = Math.floor(count);
  if (n < 1 || (arsenal.drones[tier - 1] ?? 0) < n) return 'noStock';
  const sites = [
    ...new Set(launchSites(state, ctx, countryId).map((c) => ctx.cityProvince[c]!)),
  ].sort((a, b) => a - b);
  if (sites.length === 0) return 'noLaunchSite';
  let best: { from: number; path: number[] } | null = null;
  for (const from of sites) {
    const path = findPath(state, ctx, countryId, from, targetProvinceId);
    if (path && path.length <= t.rangeProvinces && (!best || path.length < best.path.length))
      best = { from, path };
  }
  if (!best) return 'outOfRangeOrBlocked';
  arsenal.drones[tier - 1]! -= n;
  state.weapons.drones.push({
    id: state.weapons.nextId++,
    owner: countryId,
    tier,
    count: n,
    provinceId: best.from,
    path: best.path,
    targetProvinceId,
  });
  return null;
}

export function launchNuclear(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  targetCityId: number,
): WeaponsError | null {
  const rules = weaponsRules(ctx);
  const arsenal = state.weapons.countries[countryId];
  const target = ownerOfCity(state, ctx, targetCityId);
  if (!arsenal || !target || arsenal.warheads < 1) return 'noStock';
  if (!enemiesAtWar(state.world, countryId).includes(target)) return 'notAtWar';
  const bases = nuclearBasesOf(state, ctx, countryId);
  if (bases.length === 0) return 'noLaunchSite';
  const from = launchSiteFor(state, ctx, countryId, targetCityId, rules.nuclear.rangeKm, bases);
  if (from < 0) return 'outOfRange';
  arsenal.warheads--;
  state.weapons.missiles.push({
    id: state.weapons.nextId++,
    owner: countryId,
    tier: 0,
    count: 1,
    fromCityId: from,
    targetCityId,
    impactTurn: state.turn + 1,
  });
  return null;
}

export interface ProductionQuote {
  cost: number;
  turns: number;
  factories: number;
  allowed: WeaponsError | null;
}

export function productionQuote(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  weapon: WeaponKind,
  tier: number,
  count: number,
): ProductionQuote {
  const rules = weaponsRules(ctx);
  const p = rules.production;
  const arsenal = state.weapons.countries[countryId];
  const t = weapon === 'missile' ? rules.missiles[tier - 1] : rules.drones[tier - 1];
  const n = Math.max(0, Math.floor(count));
  const f = factories(state, ctx, countryId, weapon);
  const weight = (weapon === 'missile' ? p.missileTierWeight : p.droneTierWeight)[tier - 1] ?? 1;
  const perTurn = f * (weapon === 'missile' ? p.missilesPerFactory : p.dronesPerFactory);
  const cost = t ? t.costUsd * n : 0;
  const turns = perTurn > 0 ? Math.max(p.minTurns, Math.ceil((n * weight) / perTurn)) : 0;
  let allowed: WeaponsError | null = null;
  if (!t || !arsenal) allowed = 'noStock';
  else if (tier > arsenal.tech[weapon === 'missile' ? 0 : 1]) allowed = 'tierLocked';
  else if (f === 0) allowed = 'noFactory';
  else if (n < 1 || cost > (state.economy.countries[countryId]?.treasury ?? 0))
    allowed = 'notEnoughMoney';
  return { cost, turns, factories: f, allowed };
}

export function startProduction(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  weapon: WeaponKind,
  tier: number,
  count: number,
): WeaponsError | null {
  const q = productionQuote(state, ctx, countryId, weapon, tier, count);
  if (q.allowed) return q.allowed;
  state.economy.countries[countryId]!.treasury -= q.cost;
  state.weapons.production.push({
    owner: countryId,
    weapon,
    tier,
    count: Math.floor(count),
    readyTurn: state.turn + q.turns,
  });
  return null;
}

/** Next air-defense level for a city: cost and build time, or why it cannot be built. */
export function airDefenseQuote(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  cityId: number,
): { level: AirDefenseLevel | null; allowed: WeaponsError | null } {
  const rules = weaponsRules(ctx);
  const building = state.weapons.airDefenseBuilds.find((b) => b.cityId === cityId);
  const current = building?.level ?? state.weapons.airDefense[cityId] ?? 0;
  const level = rules.airDefense.levels[current] ?? null;
  if (ownerOfCity(state, ctx, cityId) !== countryId) return { level, allowed: 'notOwnCity' };
  if (!level || building) return { level: null, allowed: 'maxLevel' };
  if (factories(state, ctx, countryId, 'airDefense') === 0) return { level, allowed: 'noFactory' };
  if (level.costUsd > (state.economy.countries[countryId]?.treasury ?? 0))
    return { level, allowed: 'notEnoughMoney' };
  return { level, allowed: null };
}

// ---- Damage ----

function destroyBuilding(state: GameState, ctx: SimContext, index: number): void {
  const b = state.economy.buildings[index]!;
  const cat = category(ctx.economy, b.category);
  const host = state.economy.countries[b.host];
  if (b.completed && cat && host)
    host.gdp = Math.max(0, host.gdp - b.costUsd * cat.gdpPerYearShare);
  state.economy.buildings.splice(index, 1);
}

/** Kills a number of soldiers in a province (armies first, then trainees). */
function killSoldiers(state: GameState, provinceId: number, owner: string, count: number): number {
  let left = Math.floor(count);
  let killed = 0;
  for (const a of state.military.armies) {
    if (left <= 0) break;
    if (a.provinceId !== provinceId || a.owner === owner) continue;
    const size = armySize(a);
    const k = Math.min(size, left);
    const share = size > 0 ? k / size : 0;
    const special = Math.floor(a.special * share);
    a.special -= special;
    a.regulars = Math.max(0, a.regulars - (k - special));
    killed += k;
    left -= k;
  }
  for (const t of state.military.training) {
    if (left <= 0) break;
    if (t.provinceId !== provinceId) continue;
    const k = Math.min(t.count, left);
    t.count -= k;
    killed += k;
    left -= k;
  }
  state.military.armies = state.military.armies.filter((a) => armySize(a) > 0);
  state.military.training = state.military.training.filter((t) => t.count > 0);
  return killed;
}

/** Applies `hits` strikes of one kind to a city; returns soldiers killed and buildings destroyed. */
function applyDamage(
  state: GameState,
  ctx: SimContext,
  rng: Rng,
  attacker: string,
  cityId: number,
  hits: number,
  d: StrikeDamage,
): { soldiers: number; buildings: number } {
  if (hits <= 0) return { soldiers: 0, buildings: 0 };
  const provinceId = ctx.cityProvince[cityId]!;
  const defender = state.world.provinceOwners[provinceId]!;
  const anyHit = (chance: number): boolean => rng.next() < 1 - (1 - chance) ** hits;
  const soldiers = killSoldiers(state, provinceId, attacker, d.soldiers * hits);
  let buildings = 0;
  for (let i = state.economy.buildings.length - 1; i >= 0; i--) {
    if (state.economy.buildings[i]!.cityId !== cityId) continue;
    if (anyHit(d.buildingChance)) {
      destroyBuilding(state, ctx, i);
      buildings++;
    }
  }
  if ((state.military.bases[cityId] ?? 0) > 0 && anyHit(d.baseChance))
    state.military.bases[cityId]!--;
  if ((state.weapons.airDefense[cityId] ?? 0) > 0 && anyHit(d.airDefenseChance))
    state.weapons.airDefense[cityId]!--;
  if (d.nuclearBaseChance > 0 && state.weapons.nuclearBases.some((b) => b.cityId === cityId)) {
    if (anyHit(d.nuclearBaseChance))
      state.weapons.nuclearBases = state.weapons.nuclearBases.filter((b) => b.cityId !== cityId);
  }
  const e = state.economy.countries[defender];
  if (e) e.gdp = Math.max(0, e.gdp * (1 - Math.min(0.5, d.gdpShare * hits)));
  if (state.population)
    state.population.support[provinceId] = clamp(
      state.population.support[provinceId]! - d.support * hits,
      0,
      100,
    );
  return { soldiers, buildings };
}

/**
 * Interception by the defender's (and allies') air defense: each site stops at most its
 * capacity per turn, each attempt succeeds with the site's interception rate.
 */
function intercept(
  state: GameState,
  ctx: SimContext,
  rng: Rng,
  used: Map<number, number>,
  defender: string,
  cityId: number,
  count: number,
  factor: number,
): number {
  let stopped = 0;
  const cover = coverageOf(state, ctx, defender, cityId);
  for (let i = 0; i < count; i++) {
    const site = cover.find((c) => (used.get(c.cityId) ?? 0) < c.level.capacity);
    if (!site) break;
    used.set(site.cityId, (used.get(site.cityId) ?? 0) + 1);
    if (rng.next() < Math.min(0.95, site.level.intercept * factor)) stopped++;
  }
  return stopped;
}

/** Cities hit by one missile of a tier: the target, then the largest cities nearby. */
function strikeCities(
  state: GameState,
  ctx: SimContext,
  targetCityId: number,
  cities: number,
): number[] {
  const provinceId = ctx.cityProvince[targetCityId]!;
  const owner = state.world.provinceOwners[provinceId];
  const result = [targetCityId];
  const more = [
    ...citiesOfProvince(ctx, provinceId),
    ...(ctx.provinceNeighbors?.[provinceId] ?? [])
      .filter((p) => state.world.provinceOwners[p] === owner)
      .map((p) => provinceSeat(ctx, p)),
  ].filter((c) => c >= 0 && c !== targetCityId);
  for (const c of more) {
    if (result.length >= cities) break;
    if (!result.includes(c)) result.push(c);
  }
  return result;
}

function nuclearImpact(
  state: GameState,
  ctx: SimContext,
  attacker: string,
  cityId: number,
  emit: (e: WeaponsEvent) => void,
): void {
  const n = weaponsRules(ctx).nuclear;
  const provinceId = ctx.cityProvince[cityId]!;
  const defender = state.world.provinceOwners[provinceId]!;
  const killShare = (p: number, share: number): void => {
    for (const a of state.military.armies) {
      if (a.provinceId !== p) continue;
      a.regulars = Math.floor(a.regulars * (1 - share));
      a.special = Math.floor(a.special * (1 - share));
    }
    for (const t of state.military.training)
      if (t.provinceId === p) t.count = Math.floor(t.count * (1 - share));
    state.military.reservists[p] = state.military.reservists[p]! * (1 - share);
  };
  killShare(provinceId, n.provinceSoldiersKilled);
  for (const p of ctx.provinceNeighbors?.[provinceId] ?? []) killShare(p, n.neighborSoldiersKilled);
  state.military.armies = state.military.armies.filter((a) => armySize(a) > 0);
  state.military.training = state.military.training.filter((t) => t.count > 0);
  const cities = new Set(citiesOfProvince(ctx, provinceId));
  for (let i = state.economy.buildings.length - 1; i >= 0; i--)
    if (cities.has(state.economy.buildings[i]!.cityId)) destroyBuilding(state, ctx, i);
  for (const c of cities) {
    state.military.bases[c] = 0;
    state.weapons.airDefense[c] = 0;
  }
  state.weapons.nuclearBases = state.weapons.nuclearBases.filter((b) => !cities.has(b.cityId));
  // The province's economy is mostly destroyed.
  const target = state.world.countries.find((c) => c.id === defender);
  const e = state.economy.countries[defender];
  if (target && e) {
    const pop = (p: number): number => ctx.provincePopulation?.[p] ?? 0;
    const total = target.provinceIds.reduce((s, p) => s + pop(p), 0);
    const share = total > 0 ? pop(provinceId) / total : 1 / Math.max(1, target.provinceIds.length);
    e.gdp *= 1 - share * n.provinceGdpLost;
  }
  if (state.population) {
    for (const p of target?.provinceIds ?? [])
      state.population.support[p] = clamp(state.population.support[p]! - n.targetSupport, 0, 100);
    state.population.support[provinceId] = clamp(
      state.population.support[provinceId]! - n.provinceSupport,
      0,
      100,
    );
    // The user faces the world's horror and its own people's anger (GDD section 9).
    const user = state.world.countries.find((c) => c.id === attacker);
    for (const p of user?.provinceIds ?? [])
      state.population.support[p] = clamp(state.population.support[p]! - n.userSupport, 0, 100);
  }
  const eu = state.economy.countries[attacker];
  if (eu) eu.gdp *= 1 - n.userGdpLoss;
  const arsenal = state.weapons.countries[attacker];
  if (arsenal) arsenal.nuclearUser = true;
  emit({ type: 'nuclearStrike', attacker, defender, cityId });
}

// ---- Turn phases ----

/** Turn step 2: missiles launched last turn hit (GDD section 5). */
export function missileImpactPhase(
  state: GameState,
  ctx: SimContext,
  rng: Rng,
  emit: (e: WeaponsEvent) => void,
): void {
  const rules = weaponsRules(ctx);
  const used = new Map<number, number>();
  const remaining: MissileFlight[] = [];
  for (const m of state.weapons.missiles) {
    if (m.impactTurn > state.turn) {
      remaining.push(m);
      continue;
    }
    const defender = ownerOfCity(state, ctx, m.targetCityId);
    if (!defender) continue;
    if (m.tier === 0) {
      nuclearImpact(state, ctx, m.owner, m.targetCityId, emit);
      continue;
    }
    const t = rules.missiles[m.tier - 1]!;
    const stopped = intercept(state, ctx, rng, used, defender, m.targetCityId, m.count, 1);
    const hits = m.count - stopped;
    let soldiers = 0;
    let buildings = 0;
    for (const c of strikeCities(state, ctx, m.targetCityId, t.cities)) {
      const r = applyDamage(state, ctx, rng, m.owner, c, hits, t);
      soldiers += r.soldiers;
      buildings += r.buildings;
    }
    emit({
      type: 'strike',
      attacker: m.owner,
      defender,
      cityId: m.targetCityId,
      weapon: 'missile',
      launched: m.count,
      intercepted: stopped,
      soldiersKilled: soldiers,
      buildingsDestroyed: buildings,
    });
  }
  state.weapons.missiles = remaining;
}

/** Turn step 3 (with the armies): drones fly one province and strike where they arrive. */
export function droneMovementPhase(
  state: GameState,
  ctx: SimContext,
  rng: Rng,
  emit: (e: WeaponsEvent) => void,
): void {
  const rules = weaponsRules(ctx);
  const used = new Map<number, number>();
  const remaining: DroneFlight[] = [];
  for (const d of state.weapons.drones) {
    const next = d.path[0];
    if (next === undefined) continue;
    if (!entryRule(state.world, d.owner)(state.world.provinceOwners[next]!)) continue;
    d.path.shift();
    d.provinceId = next;
    // Enemy air defense over the province shoots at the drones.
    const owner = state.world.provinceOwners[next]!;
    const seat = provinceSeat(ctx, next);
    let stopped = 0;
    if (owner !== d.owner && seat >= 0 && enemiesAtWar(state.world, d.owner).includes(owner))
      stopped = intercept(
        state,
        ctx,
        rng,
        used,
        owner,
        seat,
        d.count,
        rules.airDefense.droneInterceptFactor,
      );
    const launched = d.count;
    d.count -= stopped;
    if (d.path.length > 0) {
      if (d.count > 0) remaining.push(d);
      continue;
    }
    const t = rules.drones[d.tier - 1]!;
    const r =
      seat >= 0
        ? applyDamage(state, ctx, rng, d.owner, seat, d.count, t)
        : { soldiers: 0, buildings: 0 };
    emit({
      type: 'strike',
      attacker: d.owner,
      defender: owner,
      cityId: seat,
      weapon: 'drone',
      launched,
      intercepted: stopped,
      soldiersKilled: r.soldiers,
      buildingsDestroyed: r.buildings,
    });
  }
  state.weapons.drones = remaining;
}

/** Turn step 5: weapons production, new air defense, nuclear programs. */
export function weaponsProductionPhase(
  state: GameState,
  ctx: SimContext,
  emit: (e: WeaponsEvent) => void,
): void {
  const rules = weaponsRules(ctx);
  const w = state.weapons;
  w.production = w.production.filter((p) => {
    if (p.readyTurn > state.turn) return true;
    const a = w.countries[p.owner];
    if (a) {
      const stock = p.weapon === 'missile' ? a.missiles : a.drones;
      stock[p.tier - 1] = (stock[p.tier - 1] ?? 0) + p.count;
      emit({ type: 'weaponsReady', owner: p.owner, weapon: p.weapon, count: p.count });
    }
    return false;
  });
  w.airDefenseBuilds = w.airDefenseBuilds.filter((b) => {
    if (b.readyTurn > state.turn) return true;
    if (ownerOfCity(state, ctx, b.cityId) === b.owner) {
      w.airDefense[b.cityId] = b.level;
      emit({ type: 'weaponsReady', owner: b.owner, weapon: 'airDefense', count: 1 });
    }
    return false;
  });
  for (const [id, a] of Object.entries(w.countries)) {
    if (a.nuclearProgramUntil < 0 || a.nuclearProgramUntil > state.turn) continue;
    a.nuclearProgramUntil = -1;
    a.warheads += rules.nuclear.programWarheads;
    const country = state.world.countries.find((c) => c.id === id);
    const seat = country ? provinceSeat(ctx, country.capitalProvinceId) : -1;
    if (seat >= 0) w.nuclearBases.push({ cityId: seat, country: id });
    emit({
      type: 'weaponsReady',
      owner: id,
      weapon: 'nuclear',
      count: rules.nuclear.programWarheads,
    });
  }
}

/** Annual growth lost by a country that used nuclear weapons (until sanctions, Phase 9). */
export function pariahPenalty(state: GameState, ctx: SimContext, countryId: string): number {
  return state.weapons?.countries[countryId]?.nuclearUser && ctx.weapons
    ? ctx.weapons.nuclear.pariahGrowthPenalty
    : 0;
}

/**
 * Air-defense coverage of every province's main city as seen by a country (for the map mode):
 * 0 none, 1 own, 2 ally, 3 enemy at war, 4 other.
 */
export function airDefenseMap(state: GameState, ctx: SimContext, viewer: string): Uint8Array {
  const rules = weaponsRules(ctx);
  const n = state.world.provinceOwners.length;
  const result = new Uint8Array(n);
  const allies = new Set(alliesOf(state.world, viewer));
  const enemies = new Set(enemiesAtWar(state.world, viewer));
  const rank = (owner: string): number =>
    owner === viewer ? 1 : allies.has(owner) ? 2 : enemies.has(owner) ? 3 : 4;
  const seats = Array.from({ length: n }, (_, p) => provinceSeat(ctx, p));
  state.weapons.airDefense.forEach((lvl, site) => {
    if (lvl <= 0) return;
    const owner = ownerOfCity(state, ctx, site);
    const at = ctx.cityLonLat?.[site];
    if (!owner || !at) return;
    const radius = rules.airDefense.levels[lvl - 1]!.radiusKm;
    const value = rank(owner);
    const latSpan = radius / 111;
    for (let p = 0; p < n; p++) {
      const seat = seats[p]!;
      const q = seat >= 0 ? ctx.cityLonLat?.[seat] : undefined;
      if (!q || Math.abs(q[1] - at[1]) > latSpan) continue;
      if (cityDistanceKm(ctx, site, seat) > radius) continue;
      // Own and allied cover wins over others when they overlap.
      if (result[p] === 0 || value < result[p]!) result[p] = value;
    }
  });
  return result;
}
