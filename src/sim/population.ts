// Population (GDD section 7): public support per province, riots, revolution, rebels, secession and
// assimilation. All numbers come from data/modern/population.json (PopulationRules).
import { growthRate, type SimContext } from './economy';
import type { GameState } from './newGame';
import type { Rng } from './rng';
import { alliesOf, rivalsOf, type WorldCountry } from './world';

export interface PopulationRules {
  support: {
    start: number;
    base: number;
    adjustPerTurn: number;
    growthEffect: number;
    servicesNeutral: number;
    servicesEffect: number;
    inflationNeutral: number;
    inflationEffect: number;
    taxNeutral: number;
    taxEffect: number;
    debtNeutral: number;
    debtEffect: number;
    buildingEffect: number;
    buildingEffectMax: number;
    unassimilatedPenalty: number;
    assimilatingPenalty: number;
    rebelNeighborPenalty: number;
    riotAftermathPenalty: number;
  };
  riots: { threshold: number; endThreshold: number; productionPenalty: number };
  revolution: {
    nationalThreshold: number;
    /** Largest share of the country's provinces the rebels take when they rise. */
    initialShare: number;
    minRiotTurns: number;
    minRiotPopulationShare: number;
    rebelGainSupport: number;
    rebelLoseSupport: number;
    spreadChance: number;
    retakeChance: number;
    crushedGdpLoss: number;
    crushedDebtShareOfGdp: number;
    secessionTurns: number;
    successSupport: number;
  };
  assimilation: {
    costPerPersonUsd: number;
    minCostUsd: number;
    distanceDefault: number;
    distanceAllied: number;
    distanceRival: number;
    turns: number;
    unassimilatedProductionPenalty: number;
  };
}

export interface Faction {
  /** Country id of the faction (it is a country in the world while it holds provinces). */
  id: string;
  /** Country it rose against. */
  parent: string;
  startedTurn: number;
}

export interface PopulationState {
  /** Support for the owner's government per province, 0-100. */
  support: number[];
  /** Turns a province has been rioting (0 = calm). */
  riotTurns: number[];
  /** Country whose people live there: the owner at the start, or after assimilation. */
  culture: string[];
  /** Turn when an ongoing assimilation completes, or -1. */
  assimilateUntil: number[];
  factions: Faction[];
  nextFactionId: number;
}

export type PopulationEvent =
  | { type: 'riotsStarted'; countryId: string; provinces: number }
  | { type: 'revolution'; countryId: string; factionId: string }
  | { type: 'revolutionCrushed'; countryId: string; factionId: string }
  | { type: 'revolutionSucceeded'; countryId: string; factionId: string }
  | { type: 'secession'; countryId: string; newCountryId: string };

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

function rulesOf(ctx: SimContext): PopulationRules {
  if (!ctx.population) throw new Error('Population rules missing from the simulation context');
  return ctx.population;
}

const populationOf = (ctx: SimContext, provinceId: number): number =>
  Math.max(1000, ctx.provincePopulation?.[provinceId] ?? 0);

export function initPopulation(
  state: Pick<GameState, 'world'>,
  rules: PopulationRules,
): PopulationState {
  const n = state.world.provinceOwners.length;
  return {
    support: new Array<number>(n).fill(rules.support.start),
    riotTurns: new Array<number>(n).fill(0),
    culture: [...state.world.provinceOwners],
    assimilateUntil: new Array<number>(n).fill(-1),
    factions: [],
    nextFactionId: 1,
  };
}

/** Adds the population to games saved before Phase 6. */
export function ensurePopulation(state: GameState, rules: PopulationRules): GameState {
  if (state.population) return state;
  return { ...state, population: initPopulation(state, rules) };
}

/** Population-weighted average support of a country's provinces (0-100). */
export function nationalSupport(state: GameState, ctx: SimContext, countryId: string): number {
  const country = state.world.countries.find((c) => c.id === countryId);
  if (!country || country.provinceIds.length === 0) return 0;
  let sum = 0;
  let weight = 0;
  for (const p of country.provinceIds) {
    const w = populationOf(ctx, p);
    sum += state.population.support[p]! * w;
    weight += w;
  }
  return sum / weight;
}

/** Share of a country's population living in provinces that match a condition. */
function populationShare(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  test: (p: number) => boolean,
): number {
  const country = state.world.countries.find((c) => c.id === countryId);
  if (!country) return 0;
  let match = 0;
  let total = 0;
  for (const p of country.provinceIds) {
    const w = populationOf(ctx, p);
    total += w;
    if (test(p)) match += w;
  }
  return total > 0 ? match / total : 0;
}

export function isAssimilated(state: GameState, provinceId: number): boolean {
  return state.population.culture[provinceId] === state.world.provinceOwners[provinceId];
}

/**
 * Share of normal production a country keeps: riots and not-yet-assimilated provinces produce
 * less (GDD section 7). Applied to tax income.
 */
export function productionFactor(state: GameState, ctx: SimContext, countryId: string): number {
  if (!state.population || !ctx.population) return 1;
  const rules = ctx.population;
  const rioting = populationShare(state, ctx, countryId, (p) => state.population.riotTurns[p]! > 0);
  const foreign = populationShare(state, ctx, countryId, (p) => !isAssimilated(state, p));
  return clamp(
    1 -
      rules.riots.productionPenalty * rioting -
      rules.assimilation.unassimilatedProductionPenalty * foreign,
    0.1,
    1,
  );
}

/** Support a province is moving toward. */
export function targetSupport(
  state: GameState,
  ctx: SimContext,
  provinceId: number,
  growthByCountry?: Map<string, number>,
): number {
  const rules = rulesOf(ctx).support;
  const owner = state.world.provinceOwners[provinceId]!;
  const e = state.economy.countries[owner];
  let target = rules.base;
  if (e) {
    const growth = growthByCountry?.get(owner) ?? growthRate(e, ctx.economy);
    target += rules.growthEffect * (growth - ctx.economy.growth.base);
    target += rules.servicesEffect * (e.servicesShare - rules.servicesNeutral);
    target -= rules.inflationEffect * Math.max(0, e.inflation - rules.inflationNeutral);
    target -= rules.taxEffect * Math.max(0, e.taxRate - rules.taxNeutral);
    target -= rules.debtEffect * Math.max(0, e.debt / Math.max(1, e.gdp) - rules.debtNeutral);
  }
  let buildings = 0;
  for (const b of state.economy.buildings) {
    if (b.completed && ctx.cityProvince[b.cityId] === provinceId) buildings++;
  }
  target += Math.min(rules.buildingEffectMax, buildings * rules.buildingEffect);
  if (state.population.assimilateUntil[provinceId]! >= 0) target -= rules.assimilatingPenalty;
  else if (!isAssimilated(state, provinceId)) target -= rules.unassimilatedPenalty;
  const neighbors = ctx.provinceNeighbors?.[provinceId] ?? [];
  if (
    neighbors.some((n) =>
      state.population.factions.some((f) => f.id === state.world.provinceOwners[n]),
    )
  ) {
    target -= rules.rebelNeighborPenalty;
  }
  return clamp(target, 0, 100);
}

/** Moves a province to a new owner, keeping country lists and GDP shares consistent. */
export function transferProvince(
  state: GameState,
  ctx: SimContext,
  provinceId: number,
  newOwner: string,
): void {
  const oldOwner = state.world.provinceOwners[provinceId]!;
  if (oldOwner === newOwner) return;
  const from = state.world.countries.find((c) => c.id === oldOwner);
  const to = state.world.countries.find((c) => c.id === newOwner);
  if (!from || !to) throw new Error(`Unknown country in transfer of province ${provinceId}`);
  // The province's share of the old owner's GDP moves with it.
  const share = populationShare(state, ctx, oldOwner, (p) => p === provinceId);
  const eFrom = state.economy.countries[oldOwner];
  const eTo = state.economy.countries[newOwner];
  if (eFrom && eTo) {
    const amount = eFrom.gdp * share;
    eFrom.gdp -= amount;
    eTo.gdp += amount;
  }
  from.provinceIds = from.provinceIds.filter((p) => p !== provinceId);
  to.provinceIds = [...to.provinceIds, provinceId].sort((a, b) => a - b);
  state.world.provinceOwners[provinceId] = newOwner;
  if (from.capitalProvinceId === provinceId && from.provinceIds.length > 0) {
    from.capitalProvinceId = mostPopulous(ctx, from.provinceIds);
  }
}

const mostPopulous = (ctx: SimContext, provinces: readonly number[]): number =>
  provinces.reduce(
    (best, p) => (populationOf(ctx, p) > populationOf(ctx, best) ? p : best),
    provinces[0]!,
  );

function startRevolution(
  state: GameState,
  ctx: SimContext,
  country: WorldCountry,
  emit: (e: PopulationEvent) => void,
): void {
  const rules = rulesOf(ctx);
  const pop = state.population;
  let taken = country.provinceIds.filter((p) => pop.riotTurns[p]! >= rules.revolution.minRiotTurns);
  // The government always keeps its capital when the revolution begins, and the rebels start
  // with the angriest provinces, not all of them, so the player has a chance to fight back.
  const limit = Math.max(1, Math.ceil(country.provinceIds.length * rules.revolution.initialShare));
  taken = taken
    .filter((p) => p !== country.capitalProvinceId)
    .sort((a, b) => pop.support[a]! - pop.support[b]! || a - b)
    .slice(0, limit);
  if (taken.length === 0) return;
  const id = `R${String(pop.nextFactionId++).padStart(2, '0')}`;
  state.world.countries.push({
    id,
    status: 'rebels',
    capitalProvinceId: mostPopulous(ctx, taken),
    provinceIds: [],
    stats: {
      gdpUsd: null,
      population: null,
      militaryPersonnel: null,
      militaryExpenditureUsd: null,
      stability: null,
    },
    leader: { name: null, title: 'transitionalPresident' },
    faction: { kind: 'rebels', parent: country.id },
  });
  state.economy.countries[id] = {
    gdp: 0,
    treasury: 0,
    debt: 0,
    taxRate: ctx.economy.start.taxRate,
    servicesShare: ctx.economy.limits.servicesShareMin,
    militaryShare: 0,
    inflation: ctx.economy.start.inflation,
    printed: 0,
    inflationAlerted: false,
  };
  state.world.wars.push({ id: `revolution-${id}`, sides: [[country.id], [id]] });
  pop.factions.push({ id, parent: country.id, startedTurn: state.turn });
  for (const p of taken) transferProvince(state, ctx, p, id);
  emit({ type: 'revolution', countryId: country.id, factionId: id });
}

function removeFaction(state: GameState, faction: Faction): void {
  state.population.factions = state.population.factions.filter((f) => f.id !== faction.id);
  state.world.wars = state.world.wars.filter((w) => w.id !== `revolution-${faction.id}`);
  state.world.countries = state.world.countries.filter((c) => c.id !== faction.id);
  delete state.economy.countries[faction.id];
}

function resolveFaction(
  state: GameState,
  ctx: SimContext,
  rng: Rng,
  faction: Faction,
  emit: (e: PopulationEvent) => void,
): void {
  const rules = rulesOf(ctx).revolution;
  const owners = state.world.provinceOwners;
  const rebels = state.world.countries.find((c) => c.id === faction.id)!;
  const government = state.world.countries.find((c) => c.id === faction.parent);

  // Until armies exist (Phase 7), the struggle follows public support in government land.
  if (government && government.provinceIds.length > 0) {
    const support = nationalSupport(state, ctx, government.id);
    const borders = (from: readonly number[], toOwner: string): number[] =>
      [...new Set(from.flatMap((p) => ctx.provinceNeighbors?.[p] ?? []))].filter(
        (n) => owners[n] === toOwner,
      );
    if (support < rules.rebelGainSupport && rng.chance(rules.spreadChance)) {
      const front = borders(rebels.provinceIds, government.id).filter(
        (p) => p !== government.capitalProvinceId,
      );
      const candidates =
        front.length > 0
          ? front
          : government.provinceIds.filter((p) => p !== government.capitalProvinceId);
      const target = [...candidates].sort(
        (a, b) => state.population.support[a]! - state.population.support[b]! || a - b,
      )[0];
      if (target !== undefined) transferProvince(state, ctx, target, faction.id);
      else transferProvince(state, ctx, government.capitalProvinceId, faction.id);
    } else if (support > rules.rebelLoseSupport && rng.chance(rules.retakeChance)) {
      const front = borders(government.provinceIds, faction.id);
      const target = [...(front.length > 0 ? front : rebels.provinceIds)].sort((a, b) => a - b)[0];
      if (target !== undefined) transferProvince(state, ctx, target, government.id);
    }
  }

  if (rebels.provinceIds.length === 0) {
    // The government won: the country survives with economic and financial damage.
    const e = government && state.economy.countries[government.id];
    if (e) {
      e.gdp *= 1 - rules.crushedGdpLoss;
      e.debt += e.gdp * rules.crushedDebtShareOfGdp;
    }
    removeFaction(state, faction);
    emit({ type: 'revolutionCrushed', countryId: faction.parent, factionId: faction.id });
    return;
  }
  if (!government || government.provinceIds.length === 0) {
    emit({ type: 'revolutionSucceeded', countryId: faction.parent, factionId: faction.id });
    if (state.player.countryId === faction.parent) {
      state.gameOver = { reason: 'revolution', turn: state.turn };
      return;
    }
    // An AI country: the revolutionaries become its new government.
    if (government) {
      for (const p of [...rebels.provinceIds]) transferProvince(state, ctx, p, government.id);
      government.leader = { name: null, title: 'transitionalPresident' };
      for (const p of government.provinceIds)
        state.population.support[p] = rulesOf(ctx).revolution.successSupport;
    }
    removeFaction(state, faction);
    return;
  }
  if (state.turn - faction.startedTurn >= rules.secessionTurns) {
    // The rebels held out long enough: their land becomes a new country.
    rebels.status = 'full';
    rebels.faction = { kind: 'seceded', parent: faction.parent };
    state.population.factions = state.population.factions.filter((f) => f.id !== faction.id);
    for (const p of rebels.provinceIds) {
      state.population.culture[p] = rebels.id;
      state.population.support[p] = rulesOf(ctx).revolution.successSupport;
      state.population.riotTurns[p] = 0;
    }
    emit({ type: 'secession', countryId: faction.parent, newCountryId: rebels.id });
  }
}

/** Turn step 7: support, riots, assimilation, revolutions and rebels. */
export function populationPhase(
  state: GameState,
  ctx: SimContext,
  rng: Rng,
  emit: (e: PopulationEvent) => void,
): void {
  const rules = rulesOf(ctx);
  const pop = state.population;
  const growth = new Map(
    Object.entries(state.economy.countries).map(([id, e]) => [id, growthRate(e, ctx.economy)]),
  );
  const factionIds = new Set(pop.factions.map((f) => f.id));
  const newRiots = new Map<string, number>();

  for (let p = 0; p < pop.support.length; p++) {
    const owner = state.world.provinceOwners[p]!;
    if (pop.assimilateUntil[p]! >= 0 && state.turn >= pop.assimilateUntil[p]!) {
      pop.culture[p] = owner;
      pop.assimilateUntil[p] = -1;
    }
    // Rebel-held land is outside the government's reach; its support stays frozen.
    if (factionIds.has(owner)) continue;
    const target = targetSupport(state, ctx, p, growth);
    pop.support[p] = clamp(
      pop.support[p]! + (target - pop.support[p]!) * rules.support.adjustPerTurn,
      0,
      100,
    );
    if (pop.support[p]! < rules.riots.threshold) {
      if (pop.riotTurns[p] === 0) newRiots.set(owner, (newRiots.get(owner) ?? 0) + 1);
      pop.riotTurns[p]!++;
    } else if (pop.riotTurns[p]! > 0 && pop.support[p]! > rules.riots.endThreshold) {
      pop.riotTurns[p] = 0;
    }
  }
  for (const [countryId, provinces] of newRiots)
    emit({ type: 'riotsStarted', countryId, provinces });

  for (const country of [...state.world.countries]) {
    if (country.status !== 'full' || pop.factions.some((f) => f.parent === country.id)) continue;
    if (nationalSupport(state, ctx, country.id) >= rules.revolution.nationalThreshold) continue;
    const share = populationShare(
      state,
      ctx,
      country.id,
      (p) => pop.riotTurns[p]! >= rules.revolution.minRiotTurns,
    );
    if (share >= rules.revolution.minRiotPopulationShare)
      startRevolution(state, ctx, country, emit);
  }
  for (const faction of [...pop.factions]) resolveFaction(state, ctx, rng, faction, emit);
}

export interface AssimilationQuote {
  provinceIds: number[];
  totalCost: number;
  turns: number;
  affordable: boolean;
}

/** Cost of assimilating provinces (GDD: grows with size and cultural distance). */
export function assimilationQuote(
  state: GameState,
  ctx: SimContext,
  countryId: string,
  provinceIds: readonly number[],
): AssimilationQuote {
  const rules = rulesOf(ctx).assimilation;
  const eligible = provinceIds.filter(
    (p) =>
      state.world.provinceOwners[p] === countryId &&
      !isAssimilated(state, p) &&
      state.population.assimilateUntil[p] === -1,
  );
  const allies = alliesOf(state.world, countryId);
  const rivals = rivalsOf(state.world, countryId);
  let totalCost = 0;
  for (const p of eligible) {
    const culture = state.population.culture[p]!;
    const distance = rivals.includes(culture)
      ? rules.distanceRival
      : allies.includes(culture)
        ? rules.distanceAllied
        : rules.distanceDefault;
    totalCost += Math.max(
      rules.minCostUsd,
      populationOf(ctx, p) * rules.costPerPersonUsd * distance,
    );
  }
  const treasury = state.economy.countries[countryId]?.treasury ?? 0;
  return {
    provinceIds: eligible,
    totalCost,
    turns: rules.turns,
    affordable: eligible.length > 0 && totalCost <= treasury,
  };
}

/** All provinces of a country that are not assimilated yet. */
export function unassimilatedProvinces(state: GameState, countryId: string): number[] {
  const country = state.world.countries.find((c) => c.id === countryId);
  return (country?.provinceIds ?? []).filter((p) => !isAssimilated(state, p));
}
