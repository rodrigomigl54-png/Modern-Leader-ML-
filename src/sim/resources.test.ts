import { describe, expect, it } from 'vitest';
import diplomacyRulesData from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import resourcesFile from '../../data/modern/resources.json';
import weaponsRulesData from '../../data/modern/weapons.json';
import { applyCommand, type Command } from './commands';
import type { DiplomacyRules } from './diplomacy';
import { weeklyBudget, type EconomyRules, type SimContext } from './economy';
import type { MilitaryRules } from './military';
import { createNewGame, type GameState } from './newGame';
import { targetSupport, transferProvince, type PopulationRules } from './population';
import {
  consumptionOf,
  factoriesStopped,
  productionOf,
  RESOURCES,
  resourcesPhase,
  shortageLoss,
  type ResourcesData,
} from './resources';
import { advanceTurn } from './turn';
import { productionQuote, type WeaponsRules } from './weapons';
import type { World, WorldCountry } from './world';

const OIL = RESOURCES.indexOf('oil');
const FOOD = RESOURCES.indexOf('food');
const CHIPS = RESOURCES.indexOf('chips');
const fileRules = (resourcesFile as unknown as ResourcesData).rules;

// AAA pumps oil and grows food; BBB needs oil and food; CCC makes chips that AAA needs.
const data: ResourcesData = {
  resources: [
    {
      id: 'oil',
      tradeValueUsd: 1e11,
      importance: 0.06,
      production: { AAA: 100 },
      consumption: { AAA: 20, BBB: 70, CCC: 10 },
    },
    {
      id: 'gas',
      tradeValueUsd: 1e10,
      importance: 0.03,
      production: { BBB: 100 },
      consumption: { BBB: 100 },
    },
    {
      id: 'food',
      tradeValueUsd: 5e10,
      importance: 0.05,
      selfSufficiency: { AAA: 2, BBB: 0.3 },
      defaultSelfSufficiency: 1,
      consumptionBy: 'population',
    },
    {
      id: 'rareMetals',
      tradeValueUsd: 1e9,
      importance: 0.01,
      production: { CCC: 100 },
      consumption: { CCC: 100 },
    },
    {
      id: 'chips',
      tradeValueUsd: 3e10,
      importance: 0.03,
      production: { CCC: 100 },
      consumption: { AAA: 50, CCC: 50 },
    },
  ],
  rules: fileRules,
};

const country = (id: string, provinceIds: number[]): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: 1e11,
    population: 2e6,
    militaryPersonnel: 10000,
    militaryExpenditureUsd: 2e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [country('AAA', [0, 1]), country('BBB', [2, 3]), country('CCC', [4])],
  provinceOwners: ['AAA', 'AAA', 'BBB', 'BBB', 'CCC'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: militaryRulesData as MilitaryRules,
  weapons: weaponsRulesData as unknown as WeaponsRules,
  diplomacy: diplomacyRulesData as unknown as DiplomacyRules,
  resources: data,
  cityProvince: [0, 1, 2, 3, 4],
  cityPopulation: [1e6, 1e6, 1e6, 1e6, 1e6],
  cityLonLat: [0, 1, 2, 3, 4].map((i) => [i * 1.8, 0] as [number, number]),
  provincePopulation: [1e6, 1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1], [0, 2], [1, 3], [2, 4], [3]],
};

const newGame = (player = 'BBB'): GameState => {
  const game = createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: player,
      leaderName: 'P',
      seed: 6,
    },
    sim,
  );
  for (const id of Object.keys(game.diplomacy.points)) game.diplomacy.points[id] = 10;
  return game;
};

const issue = (state: GameState, command: Command): GameState => {
  const result = applyCommand(state, command, sim);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

const play = (state: GameState, turns: number): GameState => {
  for (let i = 0; i < turns; i++) state = advanceTurn(state, sim).state;
  return state;
};

const supply = (s: GameState, id: string, r: number): number => s.resources.trade[id]!.supply[r]!;

describe('world market', () => {
  it('starts balanced: everyone gets what it needs', () => {
    const game = newGame();
    expect(productionOf(game, 'AAA', OIL)).toBeCloseTo(1000);
    expect(consumptionOf(game, 'BBB', OIL)).toBeCloseTo(700);
    for (const id of ['AAA', 'BBB', 'CCC'])
      for (const r of [OIL, FOOD, CHIPS]) expect(supply(game, id, r)).toBeCloseTo(1);
    expect(shortageLoss(game, sim, 'BBB')).toBeCloseTo(0);
  });

  it('pays exporters: the treasury gets its share of export revenue', () => {
    const game = newGame();
    const t = game.resources.trade.AAA!;
    expect(t.exportValue).toBeCloseTo(1e11 + 5e10, -8);
    expect(weeklyBudget(game, 'AAA', sim).trade * 52).toBeCloseTo(
      t.exportValue * fileRules.exportTaxShare,
      -6,
    );
    expect(weeklyBudget(game, 'BBB', sim).trade).toBe(0);
  });
});

describe('sanctions and war cut trade', () => {
  it('a sanctioned supplier leaves the importer short, with GDP and support losses', () => {
    const game = newGame();
    const before = targetSupport(game, sim, 2);
    let state = issue(game, { type: 'sanction', countryId: 'BBB', targetId: 'AAA' });
    state = play(state, 1);
    // AAA is the only oil and food exporter.
    expect(supply(state, 'BBB', OIL)).toBeLessThan(0.7);
    expect(supply(state, 'BBB', FOOD)).toBeLessThan(0.9);
    expect(shortageLoss(state, sim, 'BBB')).toBeGreaterThan(0);
    expect(state.resources.trade.AAA!.exportValue).toBeLessThan(
      game.resources.trade.AAA!.exportValue,
    );
    expect(targetSupport(state, sim, 2)).toBeLessThan(before);
  });

  it('war blocks trade between the countries at war', () => {
    const state = play(
      issue(newGame(), { type: 'declareWar', countryId: 'BBB', targetId: 'AAA' }),
      1,
    );
    expect(supply(state, 'BBB', OIL)).toBeLessThan(1);
  });
});

describe('production moves and grows', () => {
  it('a conquered province brings its production', () => {
    const game = newGame();
    transferProvince(game, sim, 1, 'BBB');
    expect(productionOf(game, 'BBB', OIL)).toBeCloseTo(500);
  });

  it('finished agriculture adds food production', () => {
    let game = newGame();
    game.economy.countries.BBB!.treasury = 1e11;
    game = issue(game, { type: 'invest', countryId: 'BBB', cityIds: [2], category: 'agriculture' });
    const food = productionOf(game, 'BBB', FOOD);
    const turns = (economyRules as EconomyRules).investment.categories.find(
      (c) => c.id === 'agriculture',
    )!.buildTurns;
    game = play(game, turns);
    expect(productionOf(game, 'BBB', FOOD)).toBeGreaterThan(food);
  });
});

describe('chips', () => {
  it('a chip shortage stops missile and drone factories', () => {
    let game = issue(newGame('AAA'), { type: 'sanction', countryId: 'AAA', targetId: 'CCC' });
    game.weapons.countries.AAA!.startFactories.missile = 1;
    game = issue(game, {
      type: 'produceWeapons',
      countryId: 'AAA',
      weapon: 'missile',
      tier: 1,
      count: 6,
    });
    const stock = game.weapons.countries.AAA!.missiles[0]!;
    game = play(game, 4);
    expect(supply(game, 'AAA', CHIPS)).toBeLessThan(fileRules.chipsStopBelow);
    expect(factoriesStopped(game, sim, 'AAA')).toBe(true);
    expect(game.weapons.countries.AAA!.missiles[0]).toBe(stock);
    expect(productionQuote(game, sim, 'AAA', 'missile', 1, 1).allowed).toBe('noChips');
  });
});

describe('determinism', () => {
  it('gives the same result for the same seed', () => {
    const start = issue(newGame(), { type: 'sanction', countryId: 'BBB', targetId: 'AAA' });
    expect(play(start, 6)).toEqual(play(start, 6));
  });
});

describe('trade between partner countries', () => {
  // Oil from two exporters: AAA (next to BBB) and CCC (farther away).
  const twoExporters: SimContext = {
    ...sim,
    resources: {
      ...data,
      resources: data.resources.map((r) =>
        r.id === 'oil'
          ? { ...r, production: { AAA: 60, CCC: 60 }, consumption: { AAA: 20, BBB: 60, CCC: 20 } }
          : r,
      ),
    },
  };
  twoExporters.cityLonLat = [0, 1, 2, 3, 4].map((i) => [i * 1.8 + (i === 4 ? 20 : 0), 0]);
  const game = (): GameState =>
    createNewGame(
      world(),
      {
        aggressiveness: 'peaceful',
        disputedMode: 'neutral',
        countryId: 'BBB',
        leaderName: 'P',
        seed: 6,
      },
      twoExporters,
    );

  it('an importer buys more from the nearer exporter and records its suppliers and partners', () => {
    // More oil than the world needs: the importer picks, and nearness decides.
    const g = game();
    for (const p of [0, 1, 4]) g.resources.production[OIL]![p]! *= 2;
    resourcesPhase(g, twoExporters, () => undefined, false);
    const t = g.resources.trade.BBB!;
    expect(t.supply[OIL]).toBeCloseTo(1, 6);
    const sources = Object.fromEntries(t.sources[OIL]!);
    expect(sources.AAA!).toBeGreaterThan(sources.CCC!);
    expect(t.partners.map(([id]) => id)).toContain('AAA');
  });

  it('sanctions cut one partner; the importer turns to the other while it has enough', () => {
    const start = game();
    // CCC alone has a little more than its usual surplus.
    for (const p of [4]) start.resources.production[OIL]![p]! *= 1.5;
    const cut = applyCommand(
      start,
      { type: 'sanction', countryId: 'BBB', targetId: 'AAA' },
      twoExporters,
    );
    if (!cut.ok) throw new Error(cut.error);
    const later = advanceTurn(cut.state, twoExporters).state;
    const t = later.resources.trade.BBB!;
    expect(t.sources[OIL]!.map(([id]) => id)).toEqual(['CCC']);
    // CCC alone cannot cover all of it: some oil is missing.
    expect(t.supply[OIL]).toBeLessThan(1);
    expect(t.supply[OIL]).toBeGreaterThan(0.3);
  });
});

describe('prices follow the market', () => {
  it('a cut supplier makes the price rise; it falls back when trade returns', () => {
    const start = newGame();
    const base = start.resources.price[OIL]!;
    let state = issue(start, { type: 'sanction', countryId: 'BBB', targetId: 'AAA' });
    state = play(state, 20);
    const high = state.resources.price[OIL]!;
    expect(high).toBeGreaterThan(base * 1.2);
    state = issue(state, { type: 'liftSanctions', countryId: 'BBB', targetId: 'AAA' });
    state = play(state, 40);
    expect(state.resources.price[OIL]!).toBeLessThan(high);
  });
});
