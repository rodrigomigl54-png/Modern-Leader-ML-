// Resources and trade (GDD section 6): oil, gas, food, rare metals and semiconductors. Each
// country produces some and imports the rest on a world market; sanctions and wars block trade
// between the countries involved, and the effect depends on how much a country depends on them.
// Shortages cost GDP (food also support) and chip shortages stop missile and drone factories.
// All numbers come from data/modern/resources.json (ResourcesData).
import { category, type SimContext } from './economy';
import type { GameState } from './newGame';
import { enemiesAtWar } from './world';

export const RESOURCES = ['oil', 'gas', 'food', 'rareMetals', 'chips'] as const;
export type ResourceId = (typeof RESOURCES)[number];

export interface ResourceData {
  id: ResourceId;
  /** Value of world trade per year, USD (sets the price). */
  tradeValueUsd: number;
  /** Share of GDP lost per year when a country gets none of what it needs. */
  importance: number;
  /** Percentage shares of world production / consumption. */
  production?: Record<string, number>;
  consumption?: Record<string, number>;
  /** Food: production / consumption per country. */
  selfSufficiency?: Record<string, number>;
  defaultSelfSufficiency?: number;
  consumptionBy?: 'gdp' | 'population';
}

export interface ResourcesData {
  resources: ResourceData[];
  rules: {
    exportTaxShare: number;
    redirectLoss: number;
    foodShortageSupport: number;
    chipsStopBelow: number;
    shortageAlert: number;
    /** Production added by finished investments, as a share of their cost per year. */
    buildings: Record<string, Partial<Record<ResourceId, number>>>;
  };
}

export interface CountryTrade {
  /** Share of consumption covered (own production plus imports), per resource. */
  supply: number[];
  /** Units exported and imported per resource (per year). */
  exports: number[];
  imports: number[];
  /** Export revenue per year, USD. */
  exportValue: number;
  /** Share of the export revenue that reaches the treasury, per year. */
  income: number;
  alerted: boolean;
}

export interface ResourcesState {
  /** Production units per year per resource and province (conquest moves it). */
  production: number[][];
  /** Consumption units per year per country at the start, per resource. */
  baseConsumption: Record<string, number[]>;
  baseGdp: Record<string, number>;
  baseWorldGdp: number;
  /** Price per unit, USD. */
  price: number[];
  trade: Record<string, CountryTrade>;
}

export type ResourcesEvent = { type: 'shortage'; countryId: string; resources: ResourceId[] };

const WORLD = 1000;

export function resourcesData(ctx: SimContext): ResourcesData {
  if (!ctx.resources) throw new Error('Resource data missing from the simulation context');
  return ctx.resources;
}

const worldGdp = (state: Pick<GameState, 'economy'>): number =>
  Object.values(state.economy.countries).reduce((s, e) => s + e.gdp, 0) || 1;

const countryPopulation = (state: Pick<GameState, 'world'>, ctx: SimContext, id: string): number =>
  (state.world.countries.find((c) => c.id === id)?.provinceIds ?? []).reduce(
    (s, p) => s + (ctx.provincePopulation?.[p] ?? 0),
    0,
  );

// ---- Setup ----

export function emptyResources(state: Pick<GameState, 'world'>): ResourcesState {
  return {
    production: RESOURCES.map(() => state.world.provinceOwners.map(() => 0)),
    baseConsumption: {},
    baseGdp: {},
    baseWorldGdp: 1,
    price: RESOURCES.map(() => 0),
    trade: {},
  };
}

/** Starting production, consumption and prices from the data (GDD section 14: open statistics). */
export function initResources(
  state: Pick<GameState, 'world' | 'economy'>,
  ctx: SimContext,
): ResourcesState {
  const data = resourcesData(ctx);
  const r = emptyResources(state);
  const countries = state.world.countries.filter(
    (c) => c.provinceIds.length > 0 && c.status !== 'uninhabited',
  );
  const gdp = (id: string): number => state.economy.countries[id]?.gdp ?? 0;
  const totalGdp = countries.reduce((s, c) => s + gdp(c.id), 0) || 1;
  const totalPop = countries.reduce((s, c) => s + countryPopulation(state, ctx, c.id), 0) || 1;
  r.baseWorldGdp = worldGdp(state);
  for (const c of countries) {
    r.baseGdp[c.id] = gdp(c.id);
    r.baseConsumption[c.id] = RESOURCES.map(() => 0);
  }

  data.resources.forEach((res, ri) => {
    const byPopulation = res.consumptionBy === 'population';
    const weight = (id: string): number =>
      byPopulation ? countryPopulation(state, ctx, id) / totalPop : gdp(id) / totalGdp;
    // Consumption: listed shares, the rest of the world by GDP (or population).
    const listed = res.consumption ?? {};
    const listedShare = Object.values(listed).reduce((s, v) => s + v, 0);
    const unlistedWeight =
      countries.filter((c) => listed[c.id] === undefined).reduce((s, c) => s + weight(c.id), 0) ||
      1;
    const consumption = new Map<string, number>();
    for (const c of countries) {
      const share = listed[c.id] ?? ((100 - listedShare) * weight(c.id)) / unlistedWeight;
      consumption.set(c.id, (Math.max(0, share) / 100) * WORLD);
    }
    // Production: listed shares, or self-sufficiency ratios; scaled to match world consumption.
    const production = new Map<string, number>();
    for (const c of countries) {
      const p = res.selfSufficiency
        ? consumption.get(c.id)! * (res.selfSufficiency[c.id] ?? res.defaultSelfSufficiency ?? 1)
        : ((res.production?.[c.id] ?? 0) / 100) * WORLD;
      production.set(c.id, p);
    }
    const totalProduction = [...production.values()].reduce((s, v) => s + v, 0) || 1;
    const scale = WORLD / totalProduction;
    for (const c of countries) {
      r.baseConsumption[c.id]![ri] = consumption.get(c.id)!;
      // A country's production is spread over its provinces by population.
      const pop = countryPopulation(state, ctx, c.id);
      for (const p of c.provinceIds) {
        const share = pop > 0 ? (ctx.provincePopulation?.[p] ?? 0) / pop : 1 / c.provinceIds.length;
        r.production[ri]![p] = production.get(c.id)! * scale * share;
      }
    }
    // Price: world trade value over the units traded at the start.
    let surplus = 0;
    let deficit = 0;
    for (const c of countries) {
      const net = production.get(c.id)! * scale - consumption.get(c.id)!;
      if (net > 0) surplus += net;
      else deficit -= net;
    }
    r.price[ri] = res.tradeValueUsd / Math.max(1e-9, Math.min(surplus, deficit));
  });
  return r;
}

/** Adds resources to games saved before Phase 10. */
export function ensureResources(state: GameState, ctx: SimContext): GameState {
  if (state.resources || !ctx.resources) return state;
  const resources = initResources(state, ctx);
  const next = { ...state, resources };
  resourcesPhase(next, ctx, () => undefined, false);
  return next;
}

// ---- Queries ----

export function productionOf(state: GameState, countryId: string, ri: number): number {
  const country = state.world.countries.find((c) => c.id === countryId);
  return (country?.provinceIds ?? []).reduce(
    (s, p) => s + (state.resources.production[ri]![p] ?? 0),
    0,
  );
}

/** Consumption grows with the country's economy relative to the world's. */
export function consumptionOf(state: GameState, countryId: string, ri: number): number {
  const r = state.resources;
  const base = r.baseConsumption[countryId]?.[ri];
  if (base === undefined) return 0;
  const g = (state.economy.countries[countryId]?.gdp ?? 0) / Math.max(1, r.baseGdp[countryId] ?? 1);
  const w = worldGdp(state) / Math.max(1, r.baseWorldGdp);
  return base * (g / w);
}

/** Share of needed chips a country gets (1 when it needs none). */
export function chipsSupply(state: GameState, countryId: string): number {
  return state.resources?.trade[countryId]?.supply[RESOURCES.indexOf('chips')] ?? 1;
}

/** True when a chip shortage stops missile and drone factories (GDD section 6). */
export function factoriesStopped(state: GameState, ctx: SimContext, countryId: string): boolean {
  return !!ctx.resources && chipsSupply(state, countryId) < ctx.resources.rules.chipsStopBelow;
}

/** GDP lost per year to shortages (share of GDP). */
export function shortageLoss(state: GameState, ctx: SimContext, countryId: string): number {
  if (!ctx.resources || !state.resources) return 0;
  const t = state.resources.trade[countryId];
  if (!t) return 0;
  return ctx.resources.resources.reduce(
    (s, res, ri) => s + res.importance * (1 - (t.supply[ri] ?? 1)),
    0,
  );
}

// ---- Turn ----

/**
 * Clears the world market for every resource: exporters sell their surplus, importers buy what
 * they lack. Trade between countries under sanctions or at war is blocked; part of it can be
 * rerouted through third countries, the rest is lost.
 */
export function resourcesPhase(
  state: GameState,
  ctx: SimContext,
  emit: (e: ResourcesEvent) => void,
  addBuildings = true,
): void {
  const data = resourcesData(ctx);
  const r = state.resources;
  const rules = data.rules;
  const ids = state.world.countries
    .filter((c) => c.provinceIds.length > 0 && r.baseConsumption[c.id])
    .map((c) => c.id);

  // Finished agriculture and energy investments add production where they stand.
  if (addBuildings) {
    for (const b of state.economy.buildings) {
      if (!b.completed || b.completeTurn !== state.turn) continue;
      const yields = rules.buildings[b.category];
      if (!yields || !category(ctx.economy, b.category)) continue;
      const p = ctx.cityProvince[b.cityId];
      if (p === undefined) continue;
      RESOURCES.forEach((id, ri) => {
        const share = yields[id];
        if (share && r.price[ri]! > 0) r.production[ri]![p]! += (b.costUsd * share) / r.price[ri]!;
      });
    }
  }

  // Who cannot trade with whom: sanctions (either way) and wars.
  const blockedWith = new Map<string, Set<string>>();
  const block = (a: string, b: string): void => {
    if (!blockedWith.has(a)) blockedWith.set(a, new Set());
    blockedWith.get(a)!.add(b);
  };
  for (const s of state.diplomacy?.sanctions ?? []) {
    block(s.from, s.to);
    block(s.to, s.from);
  }
  for (const id of ids) for (const e of enemiesAtWar(state.world, id)) block(id, e);

  const trade: Record<string, CountryTrade> = {};
  for (const id of ids)
    trade[id] = {
      supply: RESOURCES.map(() => 1),
      exports: RESOURCES.map(() => 0),
      imports: RESOURCES.map(() => 0),
      exportValue: 0,
      income: 0,
      alerted: r.trade[id]?.alerted ?? false,
    };

  RESOURCES.forEach((_, ri) => {
    const net = new Map<string, number>();
    const need = new Map<string, number>();
    let surplus = 0;
    let deficit = 0;
    for (const id of ids) {
      const p = productionOf(state, id, ri);
      const c = consumptionOf(state, id, ri);
      need.set(id, c);
      net.set(id, p - c);
      if (p > c) surplus += p - c;
      else deficit += c - p;
    }
    const buyScale = deficit > 0 ? Math.min(1, surplus / deficit) : 1;
    const sellScale = surplus > 0 ? Math.min(1, deficit / surplus) : 1;
    for (const id of ids) {
      const n = net.get(id)!;
      const blocked = blockedWith.get(id);
      const t = trade[id]!;
      if (n < 0) {
        // Importer: supply lost with blocked exporters, partly rerouted.
        let lost = 0;
        if (blocked) for (const b of blocked) lost += Math.max(0, net.get(b) ?? 0);
        const reach = 1 - (surplus > 0 ? lost / surplus : 0) * rules.redirectLoss;
        const imports = -n * buyScale * reach;
        t.imports[ri] = imports;
        const c = need.get(id)!;
        t.supply[ri] = c > 0 ? Math.min(1, (c + n + imports) / c) : 1;
      } else if (n > 0) {
        let lost = 0;
        if (blocked) for (const b of blocked) lost += Math.max(0, -(net.get(b) ?? 0));
        const reach = 1 - (deficit > 0 ? lost / deficit : 0) * rules.redirectLoss;
        const sold = n * sellScale * reach;
        t.exports[ri] = sold;
        t.exportValue += sold * r.price[ri]!;
      }
    }
  });

  for (const id of ids) {
    const t = trade[id]!;
    t.income = t.exportValue * rules.exportTaxShare;
    const short = RESOURCES.filter((_, ri) => t.supply[ri]! < rules.shortageAlert);
    if (short.length > 0 && !t.alerted) {
      t.alerted = true;
      emit({ type: 'shortage', countryId: id, resources: [...short] });
    } else if (short.length === 0) {
      t.alerted = false;
    }
  }
  r.trade = trade;
}

/** Support lost in a province's country to food shortage (points). */
export function foodShortageSupport(state: GameState, ctx: SimContext, countryId: string): number {
  if (!ctx.resources || !state.resources) return 0;
  const supply = state.resources.trade[countryId]?.supply[RESOURCES.indexOf('food')] ?? 1;
  return ctx.resources.rules.foodShortageSupport * (1 - supply);
}
