import { describe, expect, it } from 'vitest';
import { computeDifficulty, percentileRanks } from './difficulty';
import { createNewGame, validateNewGame } from './newGame';
import {
  alliesOf,
  applyDisputedSetting,
  enemiesAtWar,
  rivalsOf,
  type World,
  type WorldCountry,
} from './world';

const country = (
  id: string,
  provinceIds: number[],
  gdp: number | null,
  extra: Partial<WorldCountry> = {},
): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: gdp,
    population: gdp === null ? null : 1e6,
    militaryPersonnel: gdp === null ? null : gdp / 1e7,
    militaryExpenditureUsd: null,
    stability: 0,
  },
  leader: { name: `Leader ${id}`, title: 'president' },
  ...extra,
});

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    country('BIG', [0, 1], 2e13),
    country('MID', [2], 5e11),
    country('SML', [3], 5e9),
    country('PAR', [4], 1e10),
    country('DIS', [5], 1e9, { status: 'disputed' }),
  ],
  provinceOwners: ['BIG', 'BIG', 'MID', 'SML', 'PAR', 'DIS'],
  alliances: [{ id: 'a', type: 'alliance', members: ['BIG', 'MID', 'DIS'] }],
  rivalries: [
    { a: 'BIG', b: 'SML' },
    { a: 'PAR', b: 'DIS' },
  ],
  wars: [{ id: 'w', sides: [['SML'], ['DIS']] }],
  disputed: [{ id: 'DIS', parent: 'PAR' }],
});

describe('world relations', () => {
  it('lists allies, rivals and enemies', () => {
    const w = world();
    expect(alliesOf(w, 'BIG')).toEqual(['DIS', 'MID']);
    expect(rivalsOf(w, 'SML')).toEqual(['BIG']);
    expect(enemiesAtWar(w, 'DIS')).toEqual(['SML']);
  });
});

describe('applyDisputedSetting', () => {
  it('keeps disputed territories neutral and not playable', () => {
    const w = applyDisputedSetting(world(), 'neutral');
    expect(w.countries.find((c) => c.id === 'DIS')!.status).toBe('disputed');
  });

  it('makes them playable states', () => {
    const w = applyDisputedSetting(world(), 'states');
    expect(w.countries.find((c) => c.id === 'DIS')!.status).toBe('full');
  });

  it('merges them into the parent state and drops their relations', () => {
    const w = applyDisputedSetting(world(), 'parent');
    expect(w.countries.map((c) => c.id)).toEqual(['BIG', 'MID', 'SML', 'PAR']);
    expect(w.countries.find((c) => c.id === 'PAR')!.provinceIds).toEqual([4, 5]);
    expect(w.provinceOwners[5]).toBe('PAR');
    expect(w.alliances[0]!.members).toEqual(['BIG', 'MID']);
    expect(w.rivalries).toEqual([{ a: 'BIG', b: 'SML' }]);
    expect(w.wars).toEqual([]);
  });
});

describe('percentileRanks', () => {
  it('ranks values and gives ties the same rank', () => {
    expect(percentileRanks([10, 30, 20, null, 20], 0)).toEqual([0, 1, 0.5, 0, 0.5]);
  });
});

describe('computeDifficulty', () => {
  it('rates only playable countries, the strongest as easiest', () => {
    const result = computeDifficulty(world());
    expect([...result.keys()].sort()).toEqual(['BIG', 'MID', 'PAR', 'SML']);
    expect(result.get('BIG')!.stars).toBeLessThan(result.get('SML')!.stars);
    expect(result.get('BIG')!.stars).toBe(1);
  });

  it('is deterministic', () => {
    expect([...computeDifficulty(world())]).toEqual([...computeDifficulty(world())]);
  });

  it('spreads many countries over all five star levels', () => {
    const w = world();
    w.countries = Array.from({ length: 100 }, (_, i) => country(`C${i}`, [i], 1e9 * (i + 1)));
    w.alliances = [];
    w.rivalries = [];
    w.wars = [];
    const counts = [0, 0, 0, 0, 0];
    for (const r of computeDifficulty(w).values()) counts[r.stars - 1]!++;
    expect(counts).toEqual([12, 23, 30, 23, 12]);
  });
});

describe('createNewGame', () => {
  const options = {
    aggressiveness: 'realistic' as const,
    disputedMode: 'neutral' as const,
    countryId: 'MID',
    leaderName: '  Ana   Petrović ',
    seed: 42,
  };

  it('replaces only the player country leader', () => {
    const game = createNewGame(world(), options);
    expect(game.player).toEqual({ countryId: 'MID', leaderName: 'Ana Petrović' });
    expect(game.world.countries.find((c) => c.id === 'MID')!.leader.name).toBe('Ana Petrović');
    expect(game.world.countries.find((c) => c.id === 'BIG')!.leader.name).toBe('Leader BIG');
    expect(game.date).toBe('2027-01-01');
    expect(game.turn).toBe(0);
  });

  it('rejects empty names and countries that are not playable', () => {
    expect(validateNewGame(world(), { ...options, leaderName: '   ' })).toBe('invalidLeaderName');
    expect(validateNewGame(world(), { ...options, countryId: 'DIS' })).toBe('countryNotPlayable');
    expect(
      validateNewGame(world(), { ...options, countryId: 'DIS', disputedMode: 'states' }),
    ).toBeNull();
    expect(validateNewGame(world(), { ...options, countryId: 'DIS', disputedMode: 'parent' })).toBe(
      'countryNotPlayable',
    );
  });
});
