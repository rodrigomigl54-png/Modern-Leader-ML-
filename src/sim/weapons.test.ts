import { describe, expect, it } from 'vitest';
import economyRules from '../../data/modern/economy.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import weaponsRulesData from '../../data/modern/weapons.json';
import { applyCommand, type Command } from './commands';
import type { EconomyRules, SimContext } from './economy';
import type { MilitaryRules } from './military';
import { militaryTotals } from './military';
import { createNewGame, type GameState } from './newGame';
import type { PopulationRules } from './population';
import { advanceTurn, type TurnEvent } from './turn';
import { aiWeaponsOrders } from './ai';
import { cityDistanceKm, nuclearBasesOf, type WeaponsEvent, type WeaponsRules } from './weapons';
import type { World, WorldCountry } from './world';

const base = weaponsRulesData as unknown as WeaponsRules;
const rules: WeaponsRules = {
  ...base,
  nuclear: { ...base.nuclear, countries: { AAA: { warheads: 3, bases: [] } } },
};

const country = (id: string, provinceIds: number[]): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: 1e11,
    population: 3e6,
    militaryPersonnel: 20000,
    militaryExpenditureUsd: 2e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

// Provinces 0-1-2 (AAA) - 3-4 (BBB) - 5 (CCC) in a row, one city each, 200 km apart.
const world = (): World => ({
  startDate: '2027-01-01',
  countries: [country('AAA', [0, 1, 2]), country('BBB', [3, 4]), country('CCC', [5])],
  provinceOwners: ['AAA', 'AAA', 'AAA', 'BBB', 'BBB', 'CCC'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: militaryRulesData as MilitaryRules,
  weapons: rules,
  cityProvince: [0, 1, 2, 3, 4, 5],
  cityPopulation: [1e6, 1e6, 1e6, 1e6, 1e6, 1e6],
  cityLonLat: [0, 1, 2, 3, 4, 5].map((i) => [i * 1.8, 0] as [number, number]),
  provincePopulation: [1e6, 1e6, 1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]],
  nuclearBaseCities: { AAA: [1] },
};

const newGame = (player = 'AAA'): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: player,
      leaderName: 'P',
      seed: 9,
    },
    sim,
  );

function issue(state: GameState, command: Command): GameState {
  const result = applyCommand(state, command, sim);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function play(state: GameState, turns: number, events: TurnEvent[] = []): GameState {
  for (let i = 0; i < turns; i++) {
    const result = advanceTurn(state, sim);
    state = result.state;
    events.push(...result.events);
  }
  return state;
}

const strikes = (events: TurnEvent[]) =>
  events.filter((e): e is Extract<WeaponsEvent, { type: 'strike' }> => e.type === 'strike');

const atWar = (player = 'AAA'): GameState =>
  issue(newGame(player), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });

describe('starting arsenal', () => {
  it('comes from military spending and the country tech level', () => {
    const game = newGame();
    const a = game.weapons.countries.AAA!;
    expect(a.missiles).toEqual([16, 6, 0, 0]);
    expect(a.drones).toEqual([60, 16, 0]);
    expect(a.warheads).toBe(3);
    // 2 bn of spending: level 1 air defense in the capital.
    expect(game.weapons.airDefense[0]).toBe(1);
    expect(nuclearBasesOf(game, sim, 'AAA')).toEqual([1]);
  });

  it('measures distances on the globe', () => {
    expect(cityDistanceKm(sim, 0, 1)).toBeCloseTo(200, -1);
  });
});

describe('missiles', () => {
  it('can only be fired at a country at war, within range', () => {
    const game = newGame();
    const fire = (g: GameState, targetCityId: number, tier: number) =>
      applyCommand(
        g,
        { type: 'launchMissiles', countryId: 'AAA', targetCityId, tier, count: 1 },
        sim,
      );
    expect(fire(game, 3, 1)).toEqual({ ok: false, error: 'notAtWar' });
    const war = atWar();
    // Bases are in the capital (city 0) and the largest cities; city 4 is 800 km from city 0.
    war.military.bases.fill(0);
    war.military.bases[0] = 1;
    expect(fire(war, 4, 1)).toEqual({ ok: false, error: 'outOfRange' });
    expect(fire(war, 4, 2).ok).toBe(true);
  });

  it('hit next turn, kill soldiers and destroy buildings', () => {
    let game = atWar();
    game.weapons.airDefense.fill(0);
    game.military.armies = game.military.armies.filter((a) => a.owner !== 'BBB');
    game.military.armies.push({
      id: 900,
      owner: 'BBB',
      provinceId: 3,
      regulars: 5000,
      special: 0,
      path: [],
      from: 3,
    });
    game = issue(game, {
      type: 'launchMissiles',
      countryId: 'AAA',
      targetCityId: 3,
      tier: 1,
      count: 5,
    });
    expect(game.weapons.countries.AAA!.missiles[0]).toBe(11);
    const events: TurnEvent[] = [];
    game = play(game, 1, events);
    const s = strikes(events).find((e) => e.attacker === 'AAA');
    expect(s).toMatchObject({ defender: 'BBB', launched: 5, intercepted: 0 });
    expect(s!.soldiersKilled).toBe(5 * rules.missiles[0]!.soldiers);
    expect(game.world.provinceOwners[3]).toBe('BBB');
  });

  it('are intercepted by air defense until it is overwhelmed', () => {
    const game = atWar();
    game.weapons.airDefense.fill(0);
    game.weapons.airDefense[3] = 1;
    const capacity = rules.airDefense.levels[0]!.capacity;
    const fired = issue(game, {
      type: 'launchMissiles',
      countryId: 'AAA',
      targetCityId: 3,
      tier: 1,
      count: 16,
    });
    const events: TurnEvent[] = [];
    play(fired, 1, events);
    const s = strikes(events).find((e) => e.attacker === 'AAA')!;
    expect(s.intercepted).toBeGreaterThan(0);
    expect(s.intercepted).toBeLessThanOrEqual(capacity);
  });
});

describe('drones', () => {
  it('fly one province per turn and strike where they arrive', () => {
    let game = atWar();
    game.weapons.airDefense.fill(0);
    game.military.bases.fill(0);
    game.military.bases[0] = 1;
    game = issue(game, {
      type: 'launchDrones',
      countryId: 'AAA',
      targetProvinceId: 3,
      tier: 1,
      count: 10,
    });
    const events: TurnEvent[] = [];
    game = play(game, 2, events);
    expect(strikes(events).some((e) => e.attacker === 'AAA' && e.weapon === 'drone')).toBe(false);
    game = play(game, 1, events);
    expect(strikes(events).find((e) => e.attacker === 'AAA' && e.weapon === 'drone')).toMatchObject(
      { launched: 10 },
    );
    expect(
      applyCommand(
        game,
        { type: 'launchDrones', countryId: 'AAA', targetProvinceId: 4, tier: 1, count: 1 },
        sim,
      ).ok,
    ).toBe(true);
    expect(
      applyCommand(
        game,
        { type: 'launchDrones', countryId: 'AAA', targetProvinceId: 5, tier: 1, count: 1 },
        sim,
      ),
    ).toEqual({ ok: false, error: 'notAtWar' });
  });
});

describe('production and air defense', () => {
  it('needs factories; finished weapons join the stock', () => {
    const game = newGame();
    game.weapons.countries.AAA!.startFactories = { missile: 0, drone: 0, airDefense: 0 };
    const order = {
      type: 'produceWeapons',
      countryId: 'AAA',
      weapon: 'missile',
      tier: 1,
      count: 10,
    } as const;
    expect(applyCommand(game, order, sim)).toEqual({ ok: false, error: 'noFactory' });
    expect(applyCommand(game, { ...order, tier: 3 }, sim)).toEqual({
      ok: false,
      error: 'tierLocked',
    });
    game.weapons.countries.AAA!.startFactories.missile = 1;
    let state = issue(game, order);
    state = play(state, 2);
    expect(state.weapons.countries.AAA!.missiles[0]).toBe(16 + 10);
  });

  it('builds and upgrades air defense in a city', () => {
    const game = newGame();
    game.economy.countries.AAA!.treasury = 1e10;
    game.weapons.countries.AAA!.startFactories.airDefense = 1;
    let state = issue(game, { type: 'buildAirDefense', countryId: 'AAA', cityId: 0 });
    expect(
      applyCommand(state, { type: 'buildAirDefense', countryId: 'AAA', cityId: 0 }, sim),
    ).toEqual({ ok: false, error: 'maxLevel' });
    state = play(state, rules.airDefense.levels[1]!.buildTurns);
    expect(state.weapons.airDefense[0]).toBe(2);
    expect(
      applyCommand(state, { type: 'buildAirDefense', countryId: 'AAA', cityId: 3 }, sim),
    ).toEqual({ ok: false, error: 'notOwnCity' });
  });
});

describe('nuclear weapons', () => {
  it('cannot be intercepted, devastate the target and turn on the user', () => {
    let game = atWar();
    game.weapons.airDefense.fill(3);
    const support = game.population.support[0]!;
    game = issue(game, { type: 'launchNuclear', countryId: 'AAA', targetCityId: 4 });
    const soldiers = militaryTotals(game, 'BBB').regulars;
    const events: TurnEvent[] = [];
    game = play(game, 1, events);
    expect(events.some((e) => e.type === 'nuclearStrike' && e.attacker === 'AAA')).toBe(true);
    expect(militaryTotals(game, 'BBB').regulars).toBeLessThan(soldiers);
    expect(game.weapons.countries.AAA!.nuclearUser).toBe(true);
    expect(game.population.support[0]).toBeLessThan(support - rules.nuclear.userSupport + 5);
  });

  it('a captured base can no longer launch', () => {
    const game = newGame();
    game.world.provinceOwners[1] = 'BBB';
    expect(nuclearBasesOf(game, sim, 'AAA')).toEqual([]);
  });

  it('a country without them can start a long program', () => {
    const game = newGame('BBB');
    game.economy.countries.BBB!.treasury = rules.nuclear.programCostUsd;
    let state = issue(game, { type: 'startNuclearProgram', countryId: 'BBB' });
    expect(applyCommand(state, { type: 'startNuclearProgram', countryId: 'BBB' }, sim)).toEqual({
      ok: false,
      error: 'programRunning',
    });
    state.weapons.countries.BBB!.nuclearProgramUntil = state.turn + 1;
    state = play(state, 1);
    expect(state.weapons.countries.BBB!.warheads).toBe(rules.nuclear.programWarheads);
    expect(nuclearBasesOf(state, sim, 'BBB').length).toBe(1);
  });
});

describe('AI and determinism', () => {
  it('an AI country at war fires missiles', () => {
    const game = issue(newGame('CCC'), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });
    const events: TurnEvent[] = [];
    play(game, 3, events);
    expect(strikes(events).some((e) => e.attacker === 'AAA' || e.attacker === 'BBB')).toBe(true);
  });

  it('gives the same result for the same seed', () => {
    const start = atWar();
    expect(play(start, 10)).toEqual(play(start, 10));
  });
});

describe('AI last-resort nuclear strike', () => {
  const desperate = (): GameState => {
    const game = issue(newGame('CCC'), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });
    // AAA has lost most of its land and an enemy army stands next to its capital.
    game.weapons.countries.AAA!.startProvinces = 20;
    game.military.armies.push({
      id: 999,
      owner: 'BBB',
      provinceId: 1,
      regulars: 50000,
      special: 0,
      path: [],
      from: 1,
    });
    return game;
  };

  it('fires at most once per cooldown', () => {
    const game = desperate();
    aiWeaponsOrders(game, sim);
    expect(game.weapons.countries.AAA!.warheads).toBe(2);
    aiWeaponsOrders(game, sim);
    expect(game.weapons.countries.AAA!.warheads).toBe(2);
    game.turn += rules.nuclear.aiCooldownTurns!;
    aiWeaponsOrders(game, sim);
    expect(game.weapons.countries.AAA!.warheads).toBe(1);
  });

  it('never fires at rebels', () => {
    const game = desperate();
    game.world.countries.find((c) => c.id === 'BBB')!.status = 'rebels';
    aiWeaponsOrders(game, sim);
    expect(game.weapons.countries.AAA!.warheads).toBe(3);
  });
});
