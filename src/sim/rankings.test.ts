import { describe, expect, it } from 'vitest';
import economyRules from '../../data/modern/economy.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import type { EconomyRules, SimContext } from './economy';
import type { MilitaryRules } from './military';
import { createNewGame } from './newGame';
import type { PopulationRules } from './population';
import { RANKING_METRICS, rankings } from './rankings';
import type { World, WorldCountry } from './world';

const country = (
  id: string,
  provinceIds: number[],
  gdp: number,
  personnel: number,
  status: WorldCountry['status'] = 'full',
): WorldCountry => ({
  id,
  status,
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: gdp,
    population: 1e6,
    militaryPersonnel: personnel,
    militaryExpenditureUsd: 1e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    country('BIG', [0, 1, 2], 1e12, 50000),
    country('MID', [3], 5e11, 200000),
    country('SML', [4], 1e10, 1000),
    country('ICE', [5], 0, 0, 'uninhabited'),
  ],
  provinceOwners: ['BIG', 'BIG', 'BIG', 'MID', 'SML', 'ICE'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: militaryRulesData as MilitaryRules,
  cityProvince: [0, 3, 4],
  provincePopulation: [2e6, 2e6, 2e6, 4e6, 1e5, 0],
  provinceNeighbors: [[1], [0, 2], [1, 3], [2, 4], [3], []],
};

const game = () =>
  createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: 'SML',
      leaderName: 'P',
      seed: 1,
    },
    sim,
  );

describe('world rankings', () => {
  it('orders the living countries by each metric', () => {
    const g = game();
    const order = (m: Parameters<typeof rankings>[2]) =>
      rankings(g, sim, m).map((r) => r.countryId);
    expect(order('gdp')).toEqual(['BIG', 'MID', 'SML']);
    expect(order('army')).toEqual(['MID', 'BIG', 'SML']);
    expect(order('population')).toEqual(['BIG', 'MID', 'SML']);
    expect(order('provinces')).toEqual(['BIG', 'MID', 'SML']);
    expect(rankings(g, sim, 'gdp').map((r) => r.rank)).toEqual([1, 2, 3]);
    // Uninhabited land is not a country to rank.
    for (const m of RANKING_METRICS)
      expect(rankings(g, sim, m).some((r) => r.countryId === 'ICE')).toBe(false);
  });

  it('power weighs economy, army and people', () => {
    const g = game();
    const power = rankings(g, sim, 'power');
    expect(power[0]!.countryId).toBe('BIG');
    expect(power.at(-1)!.countryId).toBe('SML');
    expect(power.reduce((s, r) => s + r.value, 0)).toBeCloseTo(1000, 5);
  });
});
