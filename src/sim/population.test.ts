import { describe, expect, it } from 'vitest';
import economyRules from '../../data/modern/economy.json';
import populationRules from '../../data/modern/population.json';
import { applyCommand } from './commands';
import type { EconomyRules, SimContext } from './economy';
import { createNewGame, type GameState } from './newGame';
import {
  assimilationQuote,
  nationalSupport,
  productionFactor,
  targetSupport,
  transferProvince,
  type PopulationEvent,
  type PopulationRules,
} from './population';
import { advanceTurn } from './turn';
import type { World, WorldCountry } from './world';

const rules = populationRules as PopulationRules;

const country = (id: string, provinceIds: number[]): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: 1e11,
    population: 4e6,
    militaryPersonnel: 1e4,
    militaryExpenditureUsd: 2e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

// AAA: provinces 0-3 in a chain, capital 0. BBB: province 4, next to 3.
const world = (): World => ({
  startDate: '2027-01-01',
  countries: [country('AAA', [0, 1, 2, 3]), country('BBB', [4])],
  provinceOwners: ['AAA', 'AAA', 'AAA', 'AAA', 'BBB'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: rules,
  cityProvince: [0, 1, 2, 3, 4],
  provincePopulation: [1e6, 1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1], [0, 2], [1, 3], [2, 4], [3]],
};

const newGame = (player = 'AAA'): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: player,
      leaderName: 'P',
      seed: 3,
    },
    sim,
  );

function play(
  state: GameState,
  turns: number,
  events: PopulationEvent[] = [],
  hold?: (s: GameState) => void,
) {
  for (let i = 0; i < turns; i++) {
    hold?.(state);
    const result = advanceTurn(state, sim);
    state = result.state;
    for (const e of result.events)
      if ('countryId' in e && e.type !== 'inflationAlert') events.push(e as PopulationEvent);
  }
  return state;
}

/** Plays with very low support until the revolution breaks out. */
function untilRevolution(state: GameState, events: PopulationEvent[] = []): GameState {
  for (let i = 0; i < 30 && !events.some((e) => e.type === 'revolution'); i++)
    state = play(state, 1, events, pin(10));
  return state;
}

/** Keeps support in AAA's provinces at a value, as if policies kept it there. */
const pin =
  (value: number, provinces = [0, 1, 2, 3]) =>
  (s: GameState) => {
    for (const p of provinces)
      if (s.world.provinceOwners[p] === 'AAA') s.population.support[p] = value;
  };

describe('public support', () => {
  it('starts at the configured value and falls with high taxes', () => {
    const game = newGame();
    expect(nationalSupport(game, sim, 'AAA')).toBe(rules.support.start);
    const taxed = applyCommand(game, { type: 'setTax', countryId: 'AAA', rate: 0.6 }, sim);
    if (!taxed.ok) throw new Error(taxed.error);
    expect(targetSupport(taxed.state, sim, 0)).toBeLessThan(targetSupport(game, sim, 0));
    expect(nationalSupport(play(taxed.state, 30), sim, 'AAA')).toBeLessThan(
      rules.support.start - 10,
    );
  });

  it('rises with finished buildings in the province', () => {
    const game = newGame();
    game.economy.buildings.push({
      id: 1,
      category: 'hospital',
      cityId: 1,
      owner: 'AAA',
      host: 'AAA',
      costUsd: 4e8,
      startedTurn: 0,
      completeTurn: 0,
      completed: true,
    });
    expect(targetSupport(game, sim, 1)).toBeGreaterThan(targetSupport(game, sim, 2));
  });
});

describe('riots', () => {
  it('start below the threshold and cut production', () => {
    const events: PopulationEvent[] = [];
    const state = play(newGame(), 2, events, pin(10, [3]));
    expect(events.some((e) => e.type === 'riotsStarted' && e.countryId === 'AAA')).toBe(true);
    expect(state.population.riotTurns[3]).toBeGreaterThan(0);
    expect(productionFactor(state, sim, 'AAA')).toBeLessThan(1);
  });
});

describe('revolution', () => {
  it('breaks out after long riots and low national support', () => {
    const events: PopulationEvent[] = [];
    const state = untilRevolution(newGame(), events);
    const revolution = events.find((e) => e.type === 'revolution');
    expect(revolution).toBeDefined();
    const rebels = state.world.countries.find((c) => c.status === 'rebels')!;
    // The rebels rise in the angriest part of the country, not everywhere at once.
    expect(rebels.provinceIds.length).toBe(Math.ceil(4 * rules.revolution.initialShare));
    // The government keeps its capital when the revolution starts.
    expect(state.world.provinceOwners[0]).toBe('AAA');
    expect(state.world.wars.some((w) => w.sides[1].includes(rebels.id))).toBe(true);
  });

  it('is crushed when support recovers, with economic damage', () => {
    const events: PopulationEvent[] = [];
    let state = untilRevolution(newGame());
    let before = state;
    for (let i = 0; i < 60 && !events.some((e) => e.type === 'revolutionCrushed'); i++) {
      before = state;
      state = play(state, 1, events, pin(90));
    }
    expect(events.some((e) => e.type === 'revolutionCrushed')).toBe(true);
    expect(state.world.countries.some((c) => c.status === 'rebels')).toBe(false);
    expect(state.world.wars).toEqual([]);
    expect(state.world.provinceOwners.slice(0, 4)).toEqual(['AAA', 'AAA', 'AAA', 'AAA']);
    // The turn the revolution ends costs GDP and adds debt.
    const [was, now] = [before.economy.countries.AAA!, state.economy.countries.AAA!];
    expect(now.debt - was.debt).toBeGreaterThan(
      now.gdp * rules.revolution.crushedDebtShareOfGdp * 0.9,
    );
  });

  it('ends the game when the rebels take the whole country', () => {
    const events: PopulationEvent[] = [];
    const state = play(newGame(), 120, events, pin(5));
    expect(events.some((e) => e.type === 'revolutionSucceeded' && e.countryId === 'AAA')).toBe(
      true,
    );
    expect(state.gameOver).toEqual({ reason: 'revolution', turn: expect.any(Number) });
  });

  it('turns rebels holding out for a year into a new country', () => {
    const events: PopulationEvent[] = [];
    // Support in the government's land stays in the middle: neither side wins.
    let state = untilRevolution(newGame('BBB'));
    state = play(state, 60, events, pin(45));
    const secession = events.find((e) => e.type === 'secession');
    expect(secession).toBeDefined();
    const seceded = state.world.countries.find(
      (c) => c.id === (secession as { newCountryId: string }).newCountryId,
    )!;
    expect(seceded.status).toBe('full');
    expect(seceded.faction).toEqual({ kind: 'seceded', parent: 'AAA' });
    expect(state.economy.countries[seceded.id]!.gdp).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    expect(play(newGame(), 40, [], pin(20))).toEqual(play(newGame(), 40, [], pin(20)));
  });
});

describe('assimilation', () => {
  const conquered = (): GameState => {
    const game = newGame('BBB');
    transferProvince(game, sim, 3, 'BBB');
    return game;
  };

  it('lowers production and support until assimilated', () => {
    const game = conquered();
    expect(game.world.countries.find((c) => c.id === 'BBB')!.provinceIds).toEqual([3, 4]);
    expect(productionFactor(game, sim, 'BBB')).toBeLessThan(1);
    expect(targetSupport(game, sim, 3)).toBeLessThan(targetSupport(game, sim, 4));
  });

  it('costs money, causes unrest while running and then completes', () => {
    const game = conquered();
    const quote = assimilationQuote(game, sim, 'BBB', [3, 4]);
    expect(quote.provinceIds).toEqual([3]);
    expect(quote.totalCost).toBeGreaterThan(0);
    const result = applyCommand(
      game,
      { type: 'assimilate', countryId: 'BBB', provinceIds: [3, 4] },
      sim,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.state.economy.countries.BBB!.treasury).toBeCloseTo(
      game.economy.countries.BBB!.treasury - quote.totalCost,
    );
    const done = play(result.state, rules.assimilation.turns + 1);
    expect(done.population.culture[3]).toBe('BBB');
    expect(productionFactor(done, sim, 'BBB')).toBe(1);
    expect(
      applyCommand(done, { type: 'assimilate', countryId: 'BBB', provinceIds: [3] }, sim),
    ).toEqual({
      ok: false,
      error: 'nothingToAssimilate',
    });
  });
});
