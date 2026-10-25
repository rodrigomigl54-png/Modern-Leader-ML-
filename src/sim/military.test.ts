import { describe, expect, it } from 'vitest';
import economyRules from '../../data/modern/economy.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import { applyCommand, type Command } from './commands';
import type { EconomyRules, SimContext } from './economy';
import { weeklyBudget } from './economy';
import {
  armyUpkeep,
  findPath,
  militaryTotals,
  recruitQuote,
  type Army,
  type MilitaryEvent,
  type MilitaryRules,
} from './military';
import { createNewGame, type GameState } from './newGame';
import type { PopulationRules } from './population';
import { advanceTurn } from './turn';
import type { World, WorldCountry } from './world';

const rules = militaryRulesData as MilitaryRules;

const country = (id: string, provinceIds: number[], personnel: number): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: 1e11,
    population: 3e6,
    militaryPersonnel: personnel,
    militaryExpenditureUsd: 2e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

// A chain 0-1-2 (AAA) - 3-4 (BBB) - 5 (CCC); a sea route links 0 and 5. DDD (6) is AAA's ally,
// next to 2.
const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    country('AAA', [0, 1, 2], 30000),
    country('BBB', [3, 4], 10000),
    country('CCC', [5], 1000),
    country('DDD', [6], 1000),
  ],
  provinceOwners: ['AAA', 'AAA', 'AAA', 'BBB', 'BBB', 'CCC', 'DDD'],
  alliances: [{ id: 'pact', type: 'pact', members: ['AAA', 'DDD'] }],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: rules,
  cityProvince: [0, 1, 2, 3, 4, 5, 6],
  cityPopulation: [1e6, 1e6, 1e6, 1e6, 1e6, 1e6, 1e6],
  provincePopulation: [1e6, 1e6, 1e6, 1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1], [0, 2], [1, 3, 6], [2, 4], [3, 5], [4], [2]],
  seaRoutes: [{ a: 0, b: 5, km: 2500 }],
  serviceAtStart: ['BBB'],
};

const newGame = (player = 'AAA'): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: player,
      leaderName: 'P',
      seed: 5,
    },
    sim,
  );

function issue(state: GameState, command: Command): GameState {
  const result = applyCommand(state, command, sim);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function play(state: GameState, turns: number, events: MilitaryEvent[] = []): GameState {
  for (let i = 0; i < turns; i++) {
    const result = advanceTurn(state, sim);
    state = result.state;
    for (const e of result.events)
      if (['battle', 'provinceCaptured', 'countryConquered', 'trainingDone'].includes(e.type))
        events.push(e as MilitaryEvent);
  }
  return state;
}

const armiesOf = (state: GameState, owner: string): Army[] =>
  state.military.armies.filter((a) => a.owner === owner);

/** Replaces all armies with the given ones (and clears reserves) for a controlled test. */
function setArmies(state: GameState, armies: Omit<Army, 'id' | 'path' | 'from' | 'special'>[]) {
  state.military.armies = armies.map((a, i) => ({
    ...a,
    id: 100 + i,
    special: 0,
    path: [],
    from: a.provinceId,
  }));
  state.military.reservists.fill(0);
}

describe('starting military', () => {
  it('places the real army in the capital and the largest provinces', () => {
    const game = newGame();
    const t = militaryTotals(game, 'AAA');
    expect(t.regulars).toBeCloseTo(30000, -1);
    const capital = armiesOf(game, 'AAA').find((a) => a.provinceId === 0)!;
    expect(capital.regulars).toBe(30000 * rules.army.capitalShare);
    expect(game.military.bases[0]).toBe(rules.bases.capitalStartLevel);
    // Countries with mandatory service start with more reservists.
    expect(militaryTotals(game, 'BBB').reservists).toBeCloseTo(
      10000 * rules.reserves.startRatioWithService,
      -1,
    );
    expect(game.military.countries.BBB!.service).toBe(true);
    expect(game.military.countries.AAA!.service).toBe(false);
  });

  it('a country already at war starts with most of its army on the front', () => {
    const w = world();
    w.wars = [{ id: 'w', sides: [['AAA'], ['BBB']] }];
    const game = createNewGame(
      w,
      {
        aggressiveness: 'realistic',
        disputedMode: 'neutral',
        countryId: 'CCC',
        leaderName: 'P',
        seed: 5,
      },
      sim,
    );
    const share = rules.army.frontShareAtWar!;
    // AAA's front is province 2, BBB's is province 3.
    const at = (owner: string, p: number): number =>
      armiesOf(game, owner)
        .filter((a) => a.provinceId === p)
        .reduce((s, a) => s + a.regulars, 0);
    expect(at('AAA', 2)).toBeGreaterThanOrEqual(Math.round(30000 * share));
    expect(at('BBB', 3)).toBeGreaterThanOrEqual(Math.round(10000 * share));
    expect(militaryTotals(game, 'AAA').regulars).toBeCloseTo(30000, -1);
  });

  it('costs its real military spending', () => {
    const game = newGame();
    expect(armyUpkeep(game, sim, 'AAA') * 52).toBeCloseTo(2e9, -6);
    expect(weeklyBudget(game, 'AAA', sim).military * 52).toBeCloseTo(2e9, -6);
  });
});

describe('movement', () => {
  it('follows the border rule: own, allied or enemy land only', () => {
    const game = newGame();
    expect(findPath(game, sim, 'AAA', 0, 6)).toEqual([1, 2, 6]);
    expect(findPath(game, sim, 'AAA', 0, 3)).toBeNull();
    const war = issue(game, { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });
    expect(findPath(war, sim, 'AAA', 0, 4)).toEqual([1, 2, 3, 4]);
  });

  it('moves one province per turn', () => {
    let game = newGame();
    setArmies(game, [{ owner: 'AAA', provinceId: 0, regulars: 1000 }]);
    game = issue(game, {
      type: 'moveArmies',
      countryId: 'AAA',
      armyIds: [100],
      targetProvinceId: 6,
    });
    game = play(game, 1);
    expect(game.military.armies[0]!.provinceId).toBe(1);
    game = play(game, 2);
    expect(game.military.armies[0]!.provinceId).toBe(6);
    expect(game.military.armies[0]!.path).toEqual([]);
  });

  it('crosses the sea in several turns', () => {
    let game = issue(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'CCC' });
    setArmies(game, [{ owner: 'AAA', provinceId: 0, regulars: 1000 }]);
    game = issue(game, {
      type: 'moveArmies',
      countryId: 'AAA',
      armyIds: [100],
      targetProvinceId: 5,
    });
    const turns = Math.ceil(2500 / rules.naval.kmPerTurn);
    game = play(game, turns - 1);
    expect(game.world.provinceOwners[5]).toBe('CCC');
    game = play(game, 1);
    expect(game.world.provinceOwners[5]).toBe('AAA');
  });

  it('splits an army in two', () => {
    let game = newGame();
    setArmies(game, [{ owner: 'AAA', provinceId: 0, regulars: 1001 }]);
    game = issue(game, { type: 'splitArmy', countryId: 'AAA', armyId: 100 });
    expect(armiesOf(game, 'AAA').map((a) => a.regulars)).toEqual([501, 500]);
  });
});

describe('combat and conquest', () => {
  const atWar = (): GameState =>
    issue(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });

  it('takes an undefended enemy province with its GDP', () => {
    let game = atWar();
    setArmies(game, [{ owner: 'AAA', provinceId: 2, regulars: 1000 }]);
    // BBB cannot pay for new recruits (trainees would defend their city).
    game.economy.countries.BBB!.treasury = 0;
    const gdp = game.economy.countries.AAA!.gdp;
    game = issue(game, {
      type: 'moveArmies',
      countryId: 'AAA',
      armyIds: [100],
      targetProvinceId: 3,
    });
    const events: MilitaryEvent[] = [];
    game = play(game, 1, events);
    expect(game.world.provinceOwners[3]).toBe('AAA');
    expect(events).toContainEqual({
      type: 'provinceCaptured',
      provinceId: 3,
      from: 'BBB',
      to: 'AAA',
    });
    expect(game.economy.countries.AAA!.gdp).toBeGreaterThan(gdp);
    // The people keep their culture until assimilated.
    expect(game.population.culture[3]).toBe('BBB');
  });

  it('a stronger attacker wins and the defender retreats', () => {
    let game = atWar();
    setArmies(game, [
      { owner: 'AAA', provinceId: 2, regulars: 20000 },
      { owner: 'BBB', provinceId: 3, regulars: 2000 },
    ]);
    game = issue(game, {
      type: 'moveArmies',
      countryId: 'AAA',
      armyIds: [100],
      targetProvinceId: 3,
    });
    const events: MilitaryEvent[] = [];
    game = play(game, 1, events);
    const battle = events.find((e) => e.type === 'battle');
    expect(battle).toMatchObject({ attacker: 'AAA', defender: 'BBB', winner: 'attacker' });
    expect(game.world.provinceOwners[3]).toBe('AAA');
    expect(armiesOf(game, 'BBB').every((a) => a.provinceId === 4)).toBe(true);
  });

  it('a weaker attacker loses and falls back', () => {
    let game = atWar();
    setArmies(game, [
      { owner: 'AAA', provinceId: 2, regulars: 1000 },
      { owner: 'BBB', provinceId: 3, regulars: 5000 },
    ]);
    game = issue(game, {
      type: 'moveArmies',
      countryId: 'AAA',
      armyIds: [100],
      targetProvinceId: 3,
    });
    const events: MilitaryEvent[] = [];
    game = play(game, 1, events);
    expect(events.find((e) => e.type === 'battle')).toMatchObject({ winner: 'defender' });
    expect(game.world.provinceOwners[3]).toBe('BBB');
    for (const a of armiesOf(game, 'AAA')) expect(a.provinceId).toBe(2);
  });

  it('reservists defend only where a base calls them up', () => {
    const game = atWar();
    setArmies(game, [{ owner: 'AAA', provinceId: 2, regulars: 1000 }]);
    game.military.reservists[3] = 50000;
    game.military.bases[3] = 0;
    const noBase = play(
      issue(game, { type: 'moveArmies', countryId: 'AAA', armyIds: [100], targetProvinceId: 3 }),
      1,
    );
    expect(noBase.world.provinceOwners[3]).toBe('AAA');
    game.military.bases[3] = 1;
    const withBase = play(
      issue(game, { type: 'moveArmies', countryId: 'AAA', armyIds: [100], targetProvinceId: 3 }),
      1,
    );
    expect(withBase.world.provinceOwners[3]).toBe('BBB');
  });

  it('conquering a whole country ends the game for its player', () => {
    let game = issue(newGame('BBB'), { type: 'declareWar', countryId: 'BBB', targetId: 'CCC' });
    setArmies(game, [{ owner: 'CCC', provinceId: 5, regulars: 50000 }]);
    // CCC is controlled by the AI and walks in.
    const events: MilitaryEvent[] = [];
    game = play(game, 6, events);
    expect(events.some((e) => e.type === 'countryConquered' && e.countryId === 'BBB')).toBe(true);
    expect(game.gameOver).toEqual({ reason: 'conquered', turn: expect.any(Number) });
  });
});

describe('recruitment, reserves and service', () => {
  it('recruits a fixed number or a share of each city, within base caps', () => {
    const game = newGame();
    const fixed = recruitQuote(game, sim, 'AAA', [0, 1, 3], 'regular', 'fixed', 5000);
    // City 3 is not ours; the capital has a base (higher cap), city 1 has none.
    expect(fixed.skipped).toEqual([3]);
    expect(fixed.cities.map((c) => c.taken)).toEqual([
      5000,
      Math.min(5000, rules.recruitment.capPerTurnByBase[game.military.bases[1]!]!),
    ]);
    const percent = recruitQuote(game, sim, 'AAA', [0], 'regular', 'percent', 10);
    expect(percent.total).toBe(
      Math.min(
        Math.floor(game.military.manpower[0]! * 0.1),
        rules.recruitment.capPerTurnByBase[game.military.bases[0]!]!,
      ),
    );
  });

  it('pays, trains and then adds the soldiers to an army', () => {
    let game = newGame();
    const before = militaryTotals(game, 'AAA').regulars;
    const treasury = game.economy.countries.AAA!.treasury;
    game = issue(game, {
      type: 'recruit',
      countryId: 'AAA',
      cityIds: [0],
      kind: 'regular',
      mode: 'fixed',
      amount: 1000,
    });
    expect(game.economy.countries.AAA!.treasury).toBeLessThan(treasury);
    expect(militaryTotals(game, 'AAA').trainees).toBe(1000);
    game = play(game, rules.recruitment.regularTrainTurns);
    expect(militaryTotals(game, 'AAA').regulars).toBe(before + 1000);
    expect(militaryTotals(game, 'AAA').trainees).toBe(0);
  });

  it('trains special forces only at a large base', () => {
    const game = newGame();
    game.military.bases[1] = 0;
    expect(
      applyCommand(
        game,
        {
          type: 'recruit',
          countryId: 'AAA',
          cityIds: [1],
          kind: 'special',
          mode: 'fixed',
          amount: 100,
        },
        sim,
      ),
    ).toEqual({ ok: false, error: 'needsBase' });
    expect(
      applyCommand(
        game,
        {
          type: 'recruit',
          countryId: 'AAA',
          cityIds: [0],
          kind: 'special',
          mode: 'fixed',
          amount: 100,
        },
        sim,
      ).ok,
    ).toBe(true);
  });

  it('service grows reserves but costs support; without it reserves shrink', () => {
    const game = newGame();
    const support = game.population.support[0]!;
    const drafted = issue(game, { type: 'setService', countryId: 'AAA', enabled: true });
    expect(drafted.population.support[0]).toBe(support - rules.reserves.introduceSupportPenalty);
    const r0 = militaryTotals(game, 'AAA').reservists;
    expect(militaryTotals(play(drafted, 10), 'AAA').reservists).toBeGreaterThan(r0);
    expect(militaryTotals(play(game, 10), 'AAA').reservists).toBeLessThan(r0);
  });
});

describe('war declaration', () => {
  it('refuses allies, repeated wars and itself', () => {
    const game = newGame();
    const err = (targetId: string) =>
      applyCommand(game, { type: 'declareWar', countryId: 'AAA', targetId }, sim);
    expect(err('DDD')).toEqual({ ok: false, error: 'allied' });
    expect(err('AAA')).toEqual({ ok: false, error: 'invalidTarget' });
    const war = issue(game, { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });
    expect(
      applyCommand(war, { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }, sim),
    ).toEqual({ ok: false, error: 'alreadyAtWar' });
  });
});

describe('AI and determinism', () => {
  it('an AI country at war attacks a weak neighbor', () => {
    let game = issue(newGame('CCC'), { type: 'declareWar', countryId: 'CCC', targetId: 'BBB' });
    // AAA (AI) declares on BBB, which has only a small army far away.
    game = issue(game, { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });
    setArmies(game, [
      { owner: 'AAA', provinceId: 2, regulars: 20000 },
      { owner: 'BBB', provinceId: 4, regulars: 500 },
    ]);
    game = play(game, 4);
    expect(game.world.provinceOwners[3]).toBe('AAA');
  });

  it('gives the same result for the same seed', () => {
    const start = issue(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });
    expect(play(start, 20)).toEqual(play(start, 20));
  });
});

describe('revolution with armies', () => {
  it('rebels rise with fighters', () => {
    let game = newGame('BBB');
    for (let i = 0; i < 12; i++) {
      for (const p of [0, 1, 2]) game.population.support[p] = 5;
      game = play(game, 1);
    }
    const rebels = game.world.countries.find((c) => c.status === 'rebels' || c.faction);
    expect(rebels).toBeDefined();
    expect(
      game.military.armies.some((a) => a.owner === rebels!.id) || rebels!.provinceIds.length === 0,
    ).toBe(true);
  });
});
