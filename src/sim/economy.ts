// Economy (GDD section 6): budget, GDP growth, inflation, money printing and investment in own and
// foreign cities. All numbers come from data/modern/economy.json (EconomyRules).
import { armyUpkeep, type MilitaryRules, type SeaLink } from './military';
import {
  sanctionsBetween,
  sanctionsGrowthPenalty,
  type DiplomacyRules,
  type RelationOverride,
} from './diplomacy';
import type { GameState } from './newGame';
import type { AiProfile, AiRules } from './profiles';
import type { SummitRules } from './summits';
import type { GoalRules } from './goals';
import { shortageLoss, type ResourcesData } from './resources';
import { pariahPenalty, type WeaponsRules } from './weapons';
import { productionFactor, type PopulationRules } from './population';
import { enemiesAtWar, rivalsOf, type World, type WorldCountry } from './world';

export interface InvestmentCategory {
  id: string;
  costUsd: number;
  buildTurns: number;
  gdpPerYearShare: number;
  upkeepShare: number;
  military?: boolean;
}

export interface EconomyRules {
  start: {
    taxRate: number;
    treasuryShareOfGdp: number;
    inflation: number;
    debtShareOfGdp: number;
    fallbackGdpPerCapita: number;
    fallbackGdp: number;
    defaultMilitaryShareOfGdp: number;
    servicesDeficit: number;
  };
  limits: {
    taxRateMin: number;
    taxRateMax: number;
    servicesShareMin: number;
    servicesShareMax: number;
  };
  growth: {
    base: number;
    taxThreshold: number;
    taxDrag: number;
    servicesNeutral: number;
    servicesEffect: number;
    inflationThreshold: number;
    inflationDrag: number;
    debtThreshold: number;
    debtDrag: number;
    minGrowth: number;
    maxGrowth: number;
  };
  debt: { interestRate: number; interestPerDebtShare: number };
  inflation: {
    base: number;
    deficitThreshold: number;
    deficitEffect: number;
    printedEffect: number;
    spendingThreshold: number;
    spendingEffect: number;
    adjustPerTurn: number;
    printedDecayPerTurn: number;
    alertThreshold: number;
    min: number;
    max: number;
  };
  printing: { shareOfGdp: number };
  investment: {
    foreignReturnShare: number;
    /** Most buildings of one kind a single order can place in each city. */
    maxPerCity?: number;
    categories: InvestmentCategory[];
  };
}

/** Static facts the simulation needs besides the game state. */
export interface SimContext {
  economy: EconomyRules;
  population?: PopulationRules;
  /** Province id of every city id. */
  cityProvince: readonly number[];
  /** Inhabitants per province (sum of its cities). */
  provincePopulation?: readonly number[];
  /** Land neighbors per province. */
  provinceNeighbors?: readonly (readonly number[])[];
  military?: MilitaryRules;
  /** Inhabitants per city. */
  cityPopulation?: readonly number[];
  /** Sea routes between port provinces. */
  seaRoutes?: readonly SeaLink[];
  /** Countries with mandatory military service at the start. */
  serviceAtStart?: readonly string[];
  weapons?: WeaponsRules;
  /** Longitude and latitude per city (missile ranges, air-defense radius). */
  cityLonLat?: readonly (readonly [number, number])[];
  /** Nuclear base city ids per country at the start. */
  nuclearBaseCities?: Readonly<Record<string, readonly number[]>>;
  diplomacy?: DiplomacyRules;
  relationOverrides?: readonly RelationOverride[];
  /** Sanctions in force at the start. */
  startSanctions?: readonly { from: string; to: string }[];
  resources?: ResourcesData;
  /** AI behavior profiles per country and the rules that turn them into actions. */
  profiles?: Readonly<Record<string, AiProfile>>;
  aiRules?: AiRules;
  /** Public debt at the start (data/modern/debt.json); none means economy.json's share. */
  startDebt?: StartDebt;
  /** Summit and goal rules (GDD sections 12-13). */
  summits?: SummitRules;
  goals?: GoalRules;
}

export interface CountryEconomy {
  /** Real GDP per year, USD. */
  gdp: number;
  treasury: number;
  debt: number;
  taxRate: number;
  /** Public services spending as a share of GDP. */
  servicesShare: number;
  /** Military spending as a share of GDP (from SIPRI data, or the default). */
  militaryShare: number;
  /** Annual inflation, e.g. 0.03 = 3 %. */
  inflation: number;
  /** Money printed recently (USD); decays each turn and pushes inflation up. */
  printed: number;
  /** True after the Minister of Finance warned about high inflation (reset when it falls). */
  inflationAlerted: boolean;
  /** Foreign war aid received this week (USD); deficits it covers do not drive inflation. */
  aid?: number;
  /** Donors of war aid and the last turn of their aid after the war (reconstruction). */
  aidFrom?: Record<string, number>;
}

export interface Building {
  id: number;
  category: string;
  cityId: number;
  /** Country that paid for it. */
  owner: string;
  /** Country where the city lies when it was started. */
  host: string;
  costUsd: number;
  startedTurn: number;
  completeTurn: number;
  completed: boolean;
}

export interface EconomyState {
  countries: Record<string, CountryEconomy>;
  buildings: Building[];
  nextBuildingId: number;
}

export type EconomyEvent =
  | { type: 'buildingCompleted'; buildingId: number; owner: string }
  | { type: 'inflationAlert'; countryId: string; inflation: number };

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

export function startingGdp(c: WorldCountry, rules: EconomyRules): number {
  if (c.stats.gdpUsd) return c.stats.gdpUsd;
  if (c.stats.population) return c.stats.population * rules.start.fallbackGdpPerCapita;
  return rules.start.fallbackGdp;
}

/** Starting public debt per country (data/modern/debt.json). */
export interface StartDebt {
  defaultShare: number;
  debtShareOfGdp: Record<string, number>;
}

export function initialEconomy(
  c: WorldCountry,
  rules: EconomyRules,
  startDebt?: StartDebt,
): CountryEconomy {
  const gdp = startingGdp(c, rules);
  const debtShare = startDebt
    ? (startDebt.debtShareOfGdp[c.id] ?? startDebt.defaultShare)
    : rules.start.debtShareOfGdp;
  // Interest on that debt is part of the starting budget.
  const interest =
    debtShare * (rules.debt.interestRate + rules.debt.interestPerDebtShare * debtShare);
  const militaryShare =
    c.stats.militaryExpenditureUsd && c.stats.gdpUsd
      ? c.stats.militaryExpenditureUsd / c.stats.gdpUsd
      : rules.start.defaultMilitaryShareOfGdp;
  const { limits, start } = rules;
  return {
    gdp,
    treasury: gdp * start.treasuryShareOfGdp,
    debt: gdp * debtShare,
    taxRate: start.taxRate,
    // A roughly balanced budget with a small deficit, as most states run.
    servicesShare: clamp(
      start.taxRate - militaryShare - interest + start.servicesDeficit,
      limits.servicesShareMin,
      limits.servicesShareMax,
    ),
    militaryShare,
    inflation: start.inflation,
    printed: 0,
    inflationAlerted: false,
  };
}

export function initEconomy(
  world: World,
  rules: EconomyRules,
  startDebt?: StartDebt,
): EconomyState {
  const countries: Record<string, CountryEconomy> = {};
  for (const c of world.countries) countries[c.id] = initialEconomy(c, rules, startDebt);
  return { countries, buildings: [], nextBuildingId: 1 };
}

/** Adds the economy to games saved before Phase 5. */
export function ensureEconomy(state: GameState, rules: EconomyRules): GameState {
  if (state.economy) return state;
  return { ...state, economy: initEconomy(state.world, rules) };
}

export function category(rules: EconomyRules, id: string): InvestmentCategory | undefined {
  return rules.investment.categories.find((c) => c.id === id);
}

const atWar = (world: World, a: string, b: string): boolean => enemiesAtWar(world, a).includes(b);

export interface WeeklyBudget {
  taxes: number;
  investmentReturns: number;
  /** The treasury's share of resource exports (GDD section 6). */
  trade: number;
  military: number;
  services: number;
  interest: number;
  upkeep: number;
  income: number;
  spending: number;
  balance: number;
}

/** Budget of one country for one week (one turn). */
export function weeklyBudget(state: GameState, countryId: string, ctx: SimContext): WeeklyBudget {
  const rules = ctx.economy;
  const e = state.economy.countries[countryId]!;
  let investmentReturns = 0;
  let upkeep = 0;
  for (const b of state.economy.buildings) {
    if (b.owner !== countryId) continue;
    const cat = category(rules, b.category);
    if (cat) upkeep += b.costUsd * cat.upkeepShare;
    // Returns from investments abroad are frozen while the two countries are at war.
    if (
      b.completed &&
      b.host !== countryId &&
      !atWar(state.world, countryId, b.host) &&
      !sanctionsBetween(state, countryId, b.host)
    ) {
      investmentReturns += b.costUsd * rules.investment.foreignReturnShare;
    }
  }
  const debtShare = e.gdp > 0 ? e.debt / e.gdp : 0;
  const interestRate =
    rules.debt.interestRate + rules.debt.interestPerDebtShare * Math.max(0, debtShare);
  const week = {
    // Riots and unassimilated provinces produce less (GDD section 7).
    taxes: (e.gdp * e.taxRate * productionFactor(state, ctx, countryId)) / 52,
    investmentReturns: investmentReturns / 52,
    trade: (state.resources?.trade[countryId]?.income ?? 0) / 52,
    // With armies (Phase 7) the military costs what the soldiers cost.
    military:
      ctx.military && state.military
        ? armyUpkeep(state, ctx, countryId)
        : (e.gdp * e.militaryShare) / 52,
    services: (e.gdp * e.servicesShare) / 52,
    interest: (e.debt * interestRate) / 52,
    upkeep: upkeep / 52,
  };
  const income = week.taxes + week.investmentReturns + week.trade;
  const spending = week.military + week.services + week.interest + week.upkeep;
  return { ...week, income, spending, balance: income - spending };
}

/** Annual GDP growth rate from taxes, services, inflation and debt. */
export function growthRate(e: CountryEconomy, rules: EconomyRules): number {
  const g = rules.growth;
  const rate =
    g.base -
    g.taxDrag * Math.max(0, e.taxRate - g.taxThreshold) +
    g.servicesEffect * (e.servicesShare - g.servicesNeutral) -
    g.inflationDrag * Math.max(0, e.inflation - g.inflationThreshold) -
    g.debtDrag * Math.max(0, e.debt / Math.max(1, e.gdp) - g.debtThreshold);
  return clamp(rate, g.minGrowth, g.maxGrowth);
}

/** Inflation the economy is moving toward (GDD: printing, large deficits, overspending). */
export function targetInflation(
  e: CountryEconomy,
  budget: WeeklyBudget,
  rules: EconomyRules,
): number {
  const r = rules.inflation;
  const gdp = Math.max(1, e.gdp);
  const deficitShare = Math.max(0, -(budget.balance + (e.aid ?? 0)) * 52) / gdp;
  const spendingShare = (budget.spending * 52) / gdp;
  return clamp(
    r.base +
      r.deficitEffect * Math.max(0, deficitShare - r.deficitThreshold) +
      r.printedEffect * (e.printed / gdp) +
      r.spendingEffect * Math.max(0, spendingShare - r.spendingThreshold),
    r.min,
    r.max,
  );
}

/** Turn step 5: finished buildings start adding to their host's GDP. */
export function constructionPhase(
  state: GameState,
  ctx: SimContext,
  emit: (event: EconomyEvent) => void,
): void {
  for (const b of state.economy.buildings) {
    if (b.completed || state.turn < b.completeTurn) continue;
    b.completed = true;
    const cat = category(ctx.economy, b.category);
    const host = state.economy.countries[b.host];
    if (cat && host) host.gdp += b.costUsd * cat.gdpPerYearShare;
    emit({ type: 'buildingCompleted', buildingId: b.id, owner: b.owner });
  }
}

/** Turn step 6: budget, debt, inflation and growth for every country. */
export function economyPhase(
  state: GameState,
  ctx: SimContext,
  emit: (event: EconomyEvent) => void,
): void {
  const rules = ctx.economy;
  const budgets = new Map(
    Object.keys(state.economy.countries).map((id) => [id, weeklyBudget(state, id, ctx)]),
  );
  for (const [id, e] of Object.entries(state.economy.countries)) {
    const budget = budgets.get(id)!;
    e.treasury += budget.balance;
    // Deficits the treasury cannot cover become national debt.
    if (e.treasury < 0) {
      e.debt += -e.treasury;
      e.treasury = 0;
    }
    const target = targetInflation(e, budget, rules);
    e.inflation += (target - e.inflation) * rules.inflation.adjustPerTurn;
    e.printed *= 1 - rules.inflation.printedDecayPerTurn;
    // Inflation eats the real value of money in the treasury.
    e.treasury /= 1 + e.inflation / 52;
    e.gdp *=
      1 +
      (growthRate(e, rules) -
        pariahPenalty(state, ctx, id) -
        sanctionsGrowthPenalty(state, ctx, id) -
        shortageLoss(state, ctx, id)) /
        52;

    const alert = rules.inflation.alertThreshold;
    if (!e.inflationAlerted && e.inflation >= alert) {
      e.inflationAlerted = true;
      emit({ type: 'inflationAlert', countryId: id, inflation: e.inflation });
    } else if (e.inflationAlerted && e.inflation < alert * 0.8) {
      e.inflationAlerted = false;
    }
  }
}

export type Consent = 'own' | 'accepts' | 'refuses';

/**
 * Whether a host country lets another country invest in its cities. For now a rule from the
 * current relations: no investment between rivals or countries at war. Relation-based AI
 * decisions come with diplomacy (Phase 9) and AI profiles (Phase 11).
 */
export function hostConsent(world: World, investor: string, host: string): Consent {
  if (investor === host) return 'own';
  if (atWar(world, investor, host) || rivalsOf(world, investor).includes(host)) return 'refuses';
  const hostCountry = world.countries.find((c) => c.id === host);
  return hostCountry?.status === 'full' ? 'accepts' : 'refuses';
}

export interface InvestmentQuote {
  category: InvestmentCategory;
  cities: { cityId: number; host: string; consent: Consent }[];
  /** Cities that will actually be built in (own or consenting hosts). */
  buildable: number[];
  /** Buildings per city (1 to investment.maxPerCity). */
  count: number;
  totalCost: number;
  buildTurns: number;
  /** GDP added per year once finished: to the investor's own economy and to foreign hosts. */
  ownGdpPerYear: number;
  foreignGdpPerYear: number;
  /** Yearly return to the investor from cities abroad. */
  returnPerYear: number;
  affordable: boolean;
}

export function cityOwner(state: GameState, ctx: SimContext, cityId: number): string | undefined {
  const province = ctx.cityProvince[cityId];
  return province === undefined ? undefined : state.world.provinceOwners[province];
}

export function investmentQuote(
  state: GameState,
  ctx: SimContext,
  investor: string,
  cityIds: readonly number[],
  categoryId: string,
  perCity = 1,
): InvestmentQuote | null {
  const cat = category(ctx.economy, categoryId);
  const economy = state.economy.countries[investor];
  if (!cat || !economy) return null;
  const count = Math.max(
    1,
    Math.min(ctx.economy.investment.maxPerCity ?? 1, Math.floor(perCity) || 1),
  );
  const cities = [...new Set(cityIds)].flatMap((cityId) => {
    const host = cityOwner(state, ctx, cityId);
    if (!host) return [];
    // Sanctions freeze investment both ways (GDD section 10).
    const consent = sanctionsBetween(state, investor, host)
      ? 'refuses'
      : hostConsent(state.world, investor, host);
    return [{ cityId, host, consent }];
  });
  const buildable = cities.filter((c) => c.consent !== 'refuses');
  const own = buildable.filter((c) => c.consent === 'own').length;
  const foreign = buildable.length - own;
  const totalCost = cat.costUsd * buildable.length * count;
  return {
    category: cat,
    cities,
    buildable: buildable.map((c) => c.cityId),
    count,
    totalCost,
    buildTurns: cat.buildTurns,
    ownGdpPerYear: cat.costUsd * cat.gdpPerYearShare * own * count,
    foreignGdpPerYear: cat.costUsd * cat.gdpPerYearShare * foreign * count,
    returnPerYear: cat.costUsd * ctx.economy.investment.foreignReturnShare * foreign * count,
    affordable: buildable.length > 0 && totalCost <= economy.treasury,
  };
}

/** Extra cash one money print gives the country right now. */
export function printAmount(state: GameState, countryId: string, rules: EconomyRules): number {
  return state.economy.countries[countryId]!.gdp * rules.printing.shareOfGdp;
}
