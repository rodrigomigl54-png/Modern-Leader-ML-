import { describe, expect, it } from 'vitest';
import { addDays, dateOfTurn } from './calendar';
import { cloneState, createNewGame, type GameState } from './newGame';
import { createRng } from './rng';
import { createSave, parseSave, serializeSave } from './save';
import economyRules from '../../data/modern/economy.json';
import populationRules from '../../data/modern/population.json';
import type { PopulationRules } from './population';
import type { EconomyRules, SimContext } from './economy';
import { advanceTurn, TURN_PHASES } from './turn';

const rules = economyRules as EconomyRules;
const sim: SimContext = {
  economy: rules,
  population: populationRules as PopulationRules,
  cityProvince: [0],
  provincePopulation: [1e6],
  provinceNeighbors: [[]],
};
import type { World } from './world';

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    {
      id: 'AAA',
      status: 'full',
      capitalProvinceId: 0,
      provinceIds: [0],
      stats: {
        gdpUsd: 1e10,
        population: 1e6,
        militaryPersonnel: 1000,
        militaryExpenditureUsd: null,
        stability: 0,
      },
      leader: { name: 'Old Leader', title: 'president' },
    },
  ],
  provinceOwners: ['AAA'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const newGame = (seed = 7): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: 'AAA',
      leaderName: 'Player',
      seed,
    },
    sim,
  );

const play = (game: GameState, turns: number): GameState => {
  let state = game;
  for (let i = 0; i < turns; i++) state = advanceTurn(state, sim).state;
  return state;
};

describe('calendar', () => {
  it('adds days across months and years in UTC', () => {
    expect(addDays('2027-01-29', 7)).toBe('2027-02-05');
    expect(addDays('2027-12-30', 7)).toBe('2028-01-06');
    expect(dateOfTurn('2027-01-01', 52)).toBe('2027-12-31');
  });
});

describe('createRng', () => {
  it('repeats the same sequence for the same state', () => {
    const a = createRng(123);
    const b = createRng(123);
    const seqA = [a.next(), a.int(1, 6), a.next()];
    expect([b.next(), b.int(1, 6), b.next()]).toEqual(seqA);
    expect(createRng(a.state).next()).toBe(b.next());
  });

  it('stays in range', () => {
    const r = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(-2, 3);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(3);
    }
  });
});

describe('advanceTurn', () => {
  it('moves one week forward without changing the input', () => {
    const game = newGame();
    const { state } = advanceTurn(game, sim);
    expect(state.turn).toBe(1);
    expect(state.date).toBe('2027-01-08');
    expect(game.turn).toBe(0);
    expect(game.date).toBe('2027-01-01');
  });

  it('copies the state deeply: the copy equals it and shares nothing', () => {
    const game = play(newGame(), 3);
    const copy = cloneState(game);
    expect(copy).toEqual(structuredClone(game));
    copy.world.provinceOwners[0] = 'XXX';
    copy.economy.countries[game.player.countryId]!.treasury = -1;
    copy.population.support[0] = -1;
    expect(game.world.provinceOwners[0]).not.toBe('XXX');
    expect(game.economy.countries[game.player.countryId]!.treasury).not.toBe(-1);
    expect(game.population.support[0]).not.toBe(-1);
  });

  it('runs the phases in the GDD order', () => {
    expect(advanceTurn(newGame(), sim).phases).toEqual([...TURN_PHASES]);
    expect(TURN_PHASES[0]).toBe('aiOrders');
    expect(TURN_PHASES.at(-1)).toBe('autosave');
  });

  it('is deterministic for the same state and seed', () => {
    expect(play(newGame(99), 30)).toEqual(play(newGame(99), 30));
    expect(play(newGame(1), 3).rngState).not.toBe(play(newGame(2), 3).rngState);
  });

  it('emits the 10-turn report and the new year', () => {
    let state = newGame();
    const events: string[] = [];
    for (let i = 0; i < 53; i++) {
      const result = advanceTurn(state, sim);
      state = result.state;
      for (const e of result.events) {
        if (e.type === 'report') events.push(`report@${e.turn}`);
        if (e.type === 'newYear') events.push(`year@${e.year}`);
      }
    }
    expect(events).toEqual([
      'report@10',
      'report@20',
      'report@30',
      'report@40',
      'report@50',
      'year@2028',
    ]);
  });
});

describe('save files', () => {
  it('round-trips a game exactly', () => {
    const game = play(newGame(), 5);
    const parsed = parseSave(serializeSave(createSave(game, '2026-10-24T12:00:00Z')));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.save.game).toEqual(game);
      expect(parsed.save.summary).toEqual({
        countryId: 'AAA',
        leaderName: 'Player',
        turn: 5,
        date: '2027-02-05',
      });
      // A loaded game continues exactly like the original.
      expect(play(parsed.save.game, 10)).toEqual(play(game, 10));
    }
  });

  it('rejects other files, newer versions and damaged saves', () => {
    expect(parseSave('not json')).toEqual({ ok: false, error: 'notASave' });
    expect(parseSave('{"hello":1}')).toEqual({ ok: false, error: 'notASave' });
    const save = createSave(newGame(), '2026-10-24T12:00:00Z');
    expect(parseSave(JSON.stringify({ ...save, version: 999 }))).toEqual({
      ok: false,
      error: 'unsupportedVersion',
    });
    const broken = structuredClone(save);
    broken.game.world.provinceOwners[0] = 'ZZZ';
    expect(parseSave(JSON.stringify(broken))).toEqual({ ok: false, error: 'corrupt' });
    const noTurn = structuredClone(save) as unknown as { game: { turn: unknown } };
    noTurn.game.turn = -1;
    expect(parseSave(JSON.stringify(noTurn))).toEqual({ ok: false, error: 'corrupt' });
  });
});
