import { describe, expect, it } from 'vitest';
import economyRules from '../../data/modern/economy.json';
import populationRules from '../../data/modern/population.json';
import type { PopulationRules } from './population';
import { applyCommand, type Command } from './commands';
import {
  growthRate,
  hostConsent,
  initialEconomy,
  investmentQuote,
  buildingLevel,
  weeklyBudget,
  type EconomyRules,
  type SimContext,
} from './economy';
import { createNewGame, type GameState } from './newGame';
import { advanceTurn } from './turn';
import type { World, WorldCountry } from './world';

const rules = economyRules as EconomyRules;

const country = (id: string, gdp: number, provinceIds: number[]): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: gdp,
    population: 1e7,
    militaryPersonnel: 1e4,
    militaryExpenditureUsd: gdp * 0.02,
    stability: 0,
  },
  leader: { name: 'X', title: 'president' },
});

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [country('AAA', 1e12, [0]), country('BBB', 1e11, [1]), country('CCC', 5e10, [2])],
  provinceOwners: ['AAA', 'BBB', 'CCC'],
  alliances: [],
  rivalries: [{ a: 'AAA', b: 'CCC' }],
  wars: [],
  disputed: [],
});

// Cities 0-1 in AAA, 2 in BBB, 3 in CCC.
const sim: SimContext = {
  economy: rules,
  population: populationRules as PopulationRules,
  cityProvince: [0, 0, 1, 2],
  provincePopulation: [1e6, 1e6, 1e6],
  provinceNeighbors: [[1], [0, 2], [1]],
};

const newGame = (): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: 'AAA',
      leaderName: 'P',
      seed: 1,
    },
    sim,
  );

const run = (state: GameState, command: Command): GameState => {
  const result = applyCommand(state, command, sim);
  if (!result.ok) throw new Error(result.error);
  return result.state;
};

const play = (state: GameState, turns: number): GameState => {
  for (let i = 0; i < turns; i++) state = advanceTurn(state, sim).state;
  return state;
};

describe('starting economy', () => {
  it('starts from real GDP with a roughly balanced budget', () => {
    const game = newGame();
    const e = game.economy.countries.AAA!;
    expect(e.gdp).toBe(1e12);
    expect(e.militaryShare).toBeCloseTo(0.02);
    const b = weeklyBudget(game, 'AAA', sim);
    expect(b.balance).toBeLessThan(0);
    expect(Math.abs(b.balance) / b.income).toBeLessThan(0.05);
  });
});

describe('budget and debt', () => {
  it('turns deficits the treasury cannot cover into debt', () => {
    let game = run(newGame(), { type: 'setTax', countryId: 'AAA', rate: 0.05 });
    game = play(game, 10);
    const e = game.economy.countries.AAA!;
    expect(e.treasury).toBe(0);
    expect(e.debt).toBeGreaterThan(0);
  });

  it('builds savings with a surplus', () => {
    const start = newGame().economy.countries.AAA!.treasury;
    const game = play(run(newGame(), { type: 'setTax', countryId: 'AAA', rate: 0.35 }), 10);
    expect(game.economy.countries.AAA!.treasury).toBeGreaterThan(start);
  });

  it('rejects tax rates outside the limits', () => {
    expect(applyCommand(newGame(), { type: 'setTax', countryId: 'AAA', rate: 0.9 }, sim)).toEqual({
      ok: false,
      error: 'outOfRange',
    });
  });
});

describe('inflation and money printing', () => {
  it('gives instant cash and pushes inflation up', () => {
    const game = newGame();
    const printed = run(game, { type: 'printMoney', countryId: 'AAA' });
    const gain = printed.economy.countries.AAA!.treasury - game.economy.countries.AAA!.treasury;
    expect(gain).toBeCloseTo(1e12 * rules.printing.shareOfGdp);
    let heavy = game;
    for (let i = 0; i < 20; i++) heavy = run(heavy, { type: 'printMoney', countryId: 'AAA' });
    expect(play(heavy, 20).economy.countries.AAA!.inflation).toBeGreaterThan(
      play(game, 20).economy.countries.AAA!.inflation + 0.05,
    );
  });

  it('warns once when inflation passes the threshold', () => {
    let game = newGame();
    for (let i = 0; i < 60; i++) game = run(game, { type: 'printMoney', countryId: 'AAA' });
    const alerts: number[] = [];
    for (let i = 0; i < 40; i++) {
      const result = advanceTurn(game, sim);
      game = result.state;
      for (const e of result.events)
        if (e.type === 'inflationAlert' && e.countryId === 'AAA') alerts.push(game.turn);
    }
    expect(alerts.length).toBe(1);
  });

  it('slows growth with high taxes and high inflation', () => {
    const e = newGame().economy.countries.AAA!;
    expect(growthRate({ ...e, taxRate: 0.55 }, rules)).toBeLessThan(growthRate(e, rules));
    expect(growthRate({ ...e, inflation: 0.3 }, rules)).toBeLessThan(growthRate(e, rules));
  });
});

describe('investment', () => {
  it('builds in own and consenting foreign cities and refuses rivals', () => {
    const game = newGame();
    expect(hostConsent(game.world, 'AAA', 'AAA')).toBe('own');
    expect(hostConsent(game.world, 'AAA', 'BBB')).toBe('accepts');
    expect(hostConsent(game.world, 'AAA', 'CCC')).toBe('refuses');
    const quote = investmentQuote(game, sim, 'AAA', [0, 1, 2, 3], 'factory')!;
    expect(quote.buildable).toEqual([0, 1, 2]);
    expect(quote.totalCost).toBe(3 * 5e8);
    expect(quote.ownGdpPerYear).toBe(2 * 5e8 * 0.25);
    expect(quote.foreignGdpPerYear).toBe(5e8 * 0.25);
    expect(quote.returnPerYear).toBe(5e8 * rules.investment.foreignReturnShare);
  });

  it('pays at once, finishes after the build time and adds GDP to the host', () => {
    const game = newGame();
    const invested = run(game, {
      type: 'invest',
      countryId: 'AAA',
      cityIds: [0, 2],
      category: 'factory',
    });
    expect(invested.economy.countries.AAA!.treasury).toBeCloseTo(
      game.economy.countries.AAA!.treasury - 1e9,
    );
    expect(invested.economy.buildings.map((b) => [b.host, b.completed])).toEqual([
      ['AAA', false],
      ['BBB', false],
    ]);
    const beforeHost = play(game, 12).economy.countries.BBB!.gdp;
    const after = play(invested, 12);
    expect(after.economy.buildings.every((b) => b.completed)).toBe(true);
    expect(after.economy.countries.BBB!.gdp - beforeHost).toBeGreaterThan(5e8 * 0.25 * 0.9);
    expect(weeklyBudget(after, 'AAA', sim).investmentReturns).toBeGreaterThan(0);
  });

  it('places several levels per city in one order, each level dearer than the last', () => {
    const game = newGame();
    const g = 1 + rules.investment.levelCostGrowth!;
    const quote = investmentQuote(game, sim, 'AAA', [0, 1], 'factory', 3)!;
    expect(quote.count).toBe(3);
    // Levels 1-3 in each of two cities.
    expect(quote.totalCost).toBeCloseTo(2 * 5e8 * (1 + g + g * g), 0);
    expect(quote.ownGdpPerYear).toBeCloseTo(quote.totalCost * 0.25, 0);
    expect(investmentQuote(game, sim, 'AAA', [0], 'factory', 999)!.count).toBe(
      rules.investment.maxPerCity,
    );
    game.economy.countries.AAA!.treasury = 1e10;
    const before = game.economy.countries.AAA!.treasury;
    const invested = run(game, {
      type: 'invest',
      countryId: 'AAA',
      cityIds: [0, 1],
      category: 'factory',
      count: 2,
    });
    expect(invested.economy.buildings.map((b) => b.cityId)).toEqual([0, 0, 1, 1]);
    expect(invested.economy.buildings.map((b) => b.costUsd)).toEqual([5e8, 5e8 * g, 5e8, 5e8 * g]);
    expect(invested.economy.countries.AAA!.treasury).toBeCloseTo(before - 2 * 5e8 * (1 + g), 0);
    expect(buildingLevel(invested, 0, 'factory')).toBe(2);
    // The next upgrade of city 0 is level 3: dearer again.
    expect(investmentQuote(invested, sim, 'AAA', [0], 'factory')!.totalCost).toBeCloseTo(
      5e8 * g * g,
      0,
    );
  });

  it('shows what an investment adds to the weekly budget', () => {
    const game = newGame();
    const quote = investmentQuote(game, sim, 'AAA', [0], 'factory')!;
    const e = game.economy.countries.AAA!;
    expect(quote.budgetPerWeek).toBeCloseTo(
      (quote.ownGdpPerYear * e.taxRate - quote.upkeepPerYear) / 52,
      0,
    );
    expect(quote.budgetPerWeek).toBeGreaterThan(0);
  });

  it('a country can refuse all foreign investment; its own still works', () => {
    const game = newGame();
    const refused = run(game, { type: 'setForeignInvestment', countryId: 'BBB', reject: true });
    expect(refused.economy.countries.BBB!.rejectForeignInvestment).toBe(true);
    // AAA cannot build in BBB's city 2.
    expect(investmentQuote(refused, sim, 'AAA', [2], 'factory')!.buildable).toEqual([]);
    expect(
      applyCommand(
        refused,
        { type: 'invest', countryId: 'AAA', cityIds: [2], category: 'factory' },
        sim,
      ),
    ).toEqual({ ok: false, error: 'allRefused' });
    // BBB still builds at home; AAA still builds at home.
    refused.economy.countries.BBB!.treasury = 1e10;
    expect(investmentQuote(refused, sim, 'BBB', [2], 'factory')!.buildable).toEqual([2]);
    expect(investmentQuote(refused, sim, 'AAA', [0], 'factory')!.buildable).toEqual([0]);
    // Switching it off allows foreign investment again.
    const open = run(refused, { type: 'setForeignInvestment', countryId: 'BBB', reject: false });
    expect(investmentQuote(open, sim, 'AAA', [2], 'factory')!.buildable).toEqual([2]);
  });

  it('freezes returns from a country at war with the investor', () => {
    let game = run(newGame(), {
      type: 'invest',
      countryId: 'AAA',
      cityIds: [2],
      category: 'agriculture',
    });
    game = play(game, 8);
    expect(weeklyBudget(game, 'AAA', sim).investmentReturns).toBeGreaterThan(0);
    game.world.wars.push({ id: 'w', sides: [['AAA'], ['BBB']] });
    expect(weeklyBudget(game, 'AAA', sim).investmentReturns).toBe(0);
  });

  it('refuses when money is short or no city consents', () => {
    const game = newGame();
    expect(
      applyCommand(
        game,
        { type: 'invest', countryId: 'AAA', cityIds: [3], category: 'factory' },
        sim,
      ),
    ).toEqual({
      ok: false,
      error: 'allRefused',
    });
    const poor = structuredClone(game);
    poor.economy.countries.AAA!.treasury = 1;
    expect(
      applyCommand(
        poor,
        { type: 'invest', countryId: 'AAA', cityIds: [0], category: 'factory' },
        sim,
      ),
    ).toEqual({
      ok: false,
      error: 'notEnoughMoney',
    });
  });

  it('is deterministic', () => {
    const a = play(
      run(newGame(), { type: 'invest', countryId: 'AAA', cityIds: [0, 2], category: 'energy' }),
      30,
    );
    const b = play(
      run(newGame(), { type: 'invest', countryId: 'AAA', cityIds: [0, 2], category: 'energy' }),
      30,
    );
    expect(a).toEqual(b);
  });
});

describe('starting debt', () => {
  it('comes from the debt data; interest is part of a balanced starting budget', () => {
    const c = {
      id: 'HIGH',
      status: 'full',
      capitalProvinceId: 0,
      provinceIds: [0],
      stats: {
        gdpUsd: 1e12,
        population: 1e7,
        militaryPersonnel: 0,
        militaryExpenditureUsd: 2e10,
        stability: 0,
      },
      leader: { name: 'X', title: 'president' },
    } as const;
    const debt = { defaultShare: 0.5, debtShareOfGdp: { HIGH: 2 } };
    const high = initialEconomy(c as never, rules, debt);
    const usual = initialEconomy({ ...c, id: 'OTHER' } as never, rules, debt);
    expect(high.debt).toBeCloseTo(2e12, 0);
    expect(usual.debt).toBeCloseTo(0.5e12, 0);
    // More interest to pay leaves less for public services at the start.
    expect(high.servicesShare).toBeLessThan(usual.servicesShare);
  });
});
