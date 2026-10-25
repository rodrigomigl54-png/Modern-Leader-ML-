import { describe, expect, it } from 'vitest';
import economyRules from '../../data/modern/economy.json';
import populationRules from '../../data/modern/population.json';
import type { EconomyRules, SimContext } from './economy';
import { createNewGame, type GameState } from './newGame';
import type { PopulationRules } from './population';
import { advanceTurn } from './turn';
import { victoryPhase } from './victory';
import type { World, WorldCountry } from './world';

const country = (id: string, provinceIds: number[], status: WorldCountry['status'] = 'full') => ({
  id,
  status,
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: 1e11,
    population: 1e6,
    militaryPersonnel: 1000,
    militaryExpenditureUsd: null,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [country('PLR', [0]), country('BBB', [1]), country('ICE', [2], 'uninhabited')],
  provinceOwners: ['PLR', 'BBB', 'ICE'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  cityProvince: [0, 1],
  provincePopulation: [1e6, 1e6, 0],
  provinceNeighbors: [[1], [0], []],
};

const newGame = (): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'peaceful',
      disputedMode: 'neutral',
      countryId: 'PLR',
      leaderName: 'P',
      seed: 1,
    },
    sim,
  );

describe('victory', () => {
  it('is not won while another country holds an inhabited province', () => {
    const game = newGame();
    victoryPhase(game);
    expect(game.gameOver).toBeUndefined();
  });

  it('is won when the player owns every inhabited province', () => {
    const game = newGame();
    game.world.provinceOwners[1] = 'PLR';
    const next = advanceTurn(game, sim).state;
    expect(next.gameOver).toEqual({ reason: 'victory', turn: 1 });
  });

  it('does not replace a defeat', () => {
    const game = newGame();
    game.world.provinceOwners[1] = 'PLR';
    game.gameOver = { reason: 'revolution', turn: 0 };
    victoryPhase(game);
    expect(game.gameOver.reason).toBe('revolution');
  });
});
