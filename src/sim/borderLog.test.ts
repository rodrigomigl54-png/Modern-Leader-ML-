import { describe, expect, it } from 'vitest';
import economyRules from '../../data/modern/economy.json';
import populationRules from '../../data/modern/population.json';
import { borderReplay, MAX_BORDER_LOG } from './borderLog';
import type { EconomyRules, SimContext } from './economy';
import { createNewGame, type GameState } from './newGame';
import { transferProvince, type PopulationRules } from './population';
import type { World, WorldCountry } from './world';

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

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [country('AAA', [0, 1, 2]), country('BBB', [3, 4, 5])],
  provinceOwners: ['AAA', 'AAA', 'AAA', 'BBB', 'BBB', 'BBB'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  cityProvince: [0, 1, 2, 3, 4, 5],
  provincePopulation: [1e6, 1e6, 1e6, 1e6, 1e6, 1e6],
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

describe('border timelapse (Dario, idea 8)', () => {
  it('logs only the changes and rebuilds every past map from them', () => {
    const game = newGame();
    expect(borderReplay(game, 10)).toEqual([]);
    game.turn = 10;
    transferProvince(game, sim, 3, 'AAA');
    game.turn = 20;
    transferProvince(game, sim, 4, 'AAA');
    transferProvince(game, sim, 0, 'BBB');
    game.turn = 30;
    transferProvince(game, sim, 3, 'BBB');
    expect(game.borderLog).toEqual([
      [10, 3, 'BBB'],
      [20, 4, 'BBB'],
      [20, 0, 'AAA'],
      [30, 3, 'AAA'],
    ]);
    const frames = borderReplay(game, 3);
    expect(frames.map((f) => f.turn)).toEqual([9, 16, 23, 30]);
    expect(frames[0]!.owners).toEqual(world().provinceOwners);
    expect(frames[1]!.owners).toEqual(['AAA', 'AAA', 'AAA', 'AAA', 'BBB', 'BBB']);
    expect(frames[2]!.owners).toEqual(['BBB', 'AAA', 'AAA', 'AAA', 'AAA', 'BBB']);
    expect(frames[3]!.owners).toEqual(game.world.provinceOwners);
    // The scenario's own changes before the first week are part of the start.
    const early = newGame();
    transferProvince(early, sim, 5, 'AAA');
    expect(borderReplay(early, 5)).toEqual([]);
  });

  it('keeps the log bounded', () => {
    const game = newGame();
    for (let i = 0; i < MAX_BORDER_LOG + 10; i++) {
      game.turn = i + 1;
      transferProvince(game, sim, 3, i % 2 === 0 ? 'AAA' : 'BBB');
    }
    expect(game.borderLog).toHaveLength(MAX_BORDER_LOG);
    const frames = borderReplay(game, 50);
    expect(frames.at(-1)!.owners).toEqual(game.world.provinceOwners);
    expect(frames.length).toBe(51);
  });
});
