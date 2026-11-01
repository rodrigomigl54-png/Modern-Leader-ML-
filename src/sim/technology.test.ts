import { describe, expect, it } from 'vitest';
import economyRules from '../../data/modern/economy.json';
import populationRules from '../../data/modern/population.json';
import { applyCommand, type Command } from './commands';
import {
  ensureEconomy,
  investmentQuote,
  weeklyBudget,
  type EconomyRules,
  type SimContext,
} from './economy';
import { createNewGame, type GameState } from './newGame';
import { targetSupport, type PopulationRules } from './population';
import {
  aiAssignPoints,
  researchWeek,
  startingTech,
  techIndex,
  TECH_CATEGORIES,
  type TechState,
} from './technology';
import { advanceTurn } from './turn';
import { HISTORY_EVERY } from './history';
import type { World, WorldCountry } from './world';

const rules = economyRules as EconomyRules;
const tech = rules.technology!;

const country = (id: string, gdp: number, population: number, provinceIds: number[]) =>
  ({
    id,
    status: 'full',
    capitalProvinceId: provinceIds[0]!,
    provinceIds,
    stats: {
      gdpUsd: gdp,
      population,
      militaryPersonnel: 1e4,
      militaryExpenditureUsd: gdp * 0.02,
      stability: 0,
    },
    leader: { name: 'X', title: 'president' },
  }) as WorldCountry;

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [country('RICH', 1e12, 1e7, [0]), country('POOR', 1e10, 1e7, [1])],
  provinceOwners: ['RICH', 'POOR'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: rules,
  population: populationRules as PopulationRules,
  cityProvince: [0, 1],
  provincePopulation: [1e7, 1e7],
  provinceNeighbors: [[1], [0]],
};

const newGame = (): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: 'RICH',
      leaderName: 'P',
      seed: 2,
    },
    sim,
  );

const run = (state: GameState, command: Command): GameState => {
  const r = applyCommand(state, command, sim);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('technology (Dario, Phase 26)', () => {
  it('starts from GDP per person, with points to assign', () => {
    const rich = startingTech(tech, 1e12, 1e7); // 100,000 USD per person
    const poor = startingTech(tech, 1e10, 1e7); // 1,000 USD per person
    expect(techIndex(tech, rich)).toBeGreaterThan(techIndex(tech, poor));
    expect(techIndex(tech, poor)).toBeCloseTo(tech.startIndexAt1000, 5);
    expect(rich.points).toBeGreaterThan(poor.points);
  });

  it('research money fills levels that bring points; each level costs more', () => {
    const t: TechState = { start: 0.5, levels: 0, progress: 0, points: 0, spent: {} };
    const gdp = 1e12;
    const first = gdp * tech.levelGdpShare;
    expect(researchWeek(tech, t, gdp, first * 0.99)).toBe(0);
    expect(researchWeek(tech, t, gdp, first * 0.02)).toBe(1);
    expect(t.points).toBe(tech.pointsPerLevel);
    expect(techIndex(tech, t)).toBeCloseTo(0.5 + tech.indexPerLevel, 6);
    // The second level needs more money than the first.
    expect(researchWeek(tech, t, gdp, first)).toBe(0);
  });

  it('points raise taxes, cut upkeep and services, speed growth and support', () => {
    const game = newGame();
    const e = game.economy.countries.RICH!;
    e.tech!.points = 100;
    const before = weeklyBudget(game, 'RICH', sim);
    const supportBefore = targetSupport(game, sim, 0);
    let state = game;
    for (const category of ['taxes', 'militaryUpkeep', 'administration', 'stability'] as const)
      for (let i = 0; i < 4; i++)
        state = run(state, { type: 'assignTech', countryId: 'RICH', category });
    const after = weeklyBudget(state, 'RICH', sim);
    expect(after.taxes).toBeCloseTo(before.taxes * (1 + 4 * tech.categories.taxes.perPoint), 0);
    expect(after.military).toBeLessThan(before.military);
    expect(after.services).toBeLessThan(before.services);
    expect(targetSupport(state, sim, 0)).toBeCloseTo(
      supportBefore + 4 * tech.categories.stability.perPoint,
      5,
    );
    // A category is capped.
    state.economy.countries.RICH!.tech!.spent.taxes = tech.categories.taxes.max;
    expect(
      applyCommand(state, { type: 'assignTech', countryId: 'RICH', category: 'taxes' }, sim),
    ).toEqual({ ok: false, error: 'noTechPoints' });
  });

  it('investment technology lowers the price but not the value of a building', () => {
    const game = newGame();
    const full = investmentQuote(game, sim, 'RICH', [0], 'factory')!;
    game.economy.countries.RICH!.tech!.spent.investmentCost = 10;
    const cheap = investmentQuote(game, sim, 'RICH', [0], 'factory')!;
    expect(cheap.totalCost).toBeCloseTo(
      full.totalCost * (1 - 10 * tech.categories.investmentCost.perPoint),
      0,
    );
    expect(cheap.ownGdpPerYear).toBe(full.ownGdpPerYear);
  });

  it('research spending is part of the budget and is limited', () => {
    const game = newGame();
    const set = run(game, { type: 'setResearch', countryId: 'RICH', share: 0.03 });
    expect(weeklyBudget(set, 'RICH', sim).research).toBeCloseTo(
      (set.economy.countries.RICH!.gdp * 0.03) / 52,
      0,
    );
    const capped = run(game, { type: 'setResearch', countryId: 'RICH', share: 1 });
    expect(capped.economy.countries.RICH!.research).toBe(tech.maxResearch);
    // A year of heavy research brings at least one level.
    let state = set;
    for (let i = 0; i < 52; i++) state = advanceTurn(state, sim).state;
    expect(state.economy.countries.RICH!.tech!.levels).toBeGreaterThan(0);
  });

  it('AI countries assign their points; old saves get technology', () => {
    const t: TechState = { start: 0.5, levels: 0, progress: 0, points: 5, spent: {} };
    aiAssignPoints(tech, t);
    expect(t.points).toBe(0);
    expect(t.spent[tech.aiOrder[0]!]).toBe(5);
    const old = newGame();
    for (const e of Object.values(old.economy.countries)) {
      delete e.tech;
      delete e.research;
    }
    const fixed = ensureEconomy(old, rules);
    expect(fixed.economy.countries.POOR!.tech).toBeDefined();
    expect(TECH_CATEGORIES).toContain(tech.aiOrder[0]);
  });
});

describe('history for the charts', () => {
  it('records the player every few weeks', () => {
    let state = newGame();
    for (let i = 0; i < HISTORY_EVERY * 2; i++) state = advanceTurn(state, sim).state;
    expect(state.history).toHaveLength(2);
    const last = state.history!.at(-1)!;
    expect(last.turn).toBe(HISTORY_EVERY * 2);
    expect(last.gdp).toBe(state.economy.countries.RICH!.gdp);
    expect(last.provinces).toBe(1);
    expect(last.rank).toBeGreaterThanOrEqual(1);
  });
});
