import { describe, expect, it } from 'vitest';
import diplomacyRulesData from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import { applyCommand } from './commands';
import { dealLikelihood, dealRules, dealScore, nonAggressionBetween, type Deal } from './deals';
import { hasAccess, sanctioned, type DiplomacyRules } from './diplomacy';
import type { EconomyRules, SimContext } from './economy';
import type { MilitaryRules } from './military';
import { createNewGame, type GameState } from './newGame';
import type { PopulationRules } from './population';
import { alliesOf, enemiesAtWar, type World, type WorldCountry } from './world';

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

// PLR (player) 0-1, BBB 2-3, BIG 4 (strong), SML 5 (weak).
const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    country('PLR', [0, 1], 20000),
    country('BBB', [2, 3], 20000),
    country('BIG', [4], 400000),
    country('SML', [5], 1000),
  ],
  provinceOwners: ['PLR', 'PLR', 'BBB', 'BBB', 'BIG', 'SML'],
  alliances: [],
  rivalries: [{ a: 'BBB', b: 'SML' }],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: militaryRulesData as MilitaryRules,
  diplomacy: diplomacyRulesData as unknown as DiplomacyRules,
  cityProvince: [0, 1, 2, 3, 4, 5],
  provincePopulation: [1e6, 1e6, 1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]],
};

const newGame = (): GameState => {
  const game = createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: 'PLR',
      leaderName: 'P',
      seed: 1,
    },
    sim,
  );
  for (const id of Object.keys(game.diplomacy.points)) game.diplomacy.points[id] = 10;
  return game;
};

const propose = (game: GameState, deal: Deal) =>
  applyCommand(game, { type: 'proposeDeal', countryId: 'PLR', targetId: 'BBB', deal }, sim);

describe('trade requests (Dario, Phase 26)', () => {
  it('a generous offer buys a province; the money and the land change hands', () => {
    const game = newGame();
    game.economy.countries.PLR!.treasury = 6e10;
    // Province 3 holds half of BBB's people: it wants a lot for it.
    const deal: Deal = { give: { money: 5.5e10 }, take: { provinces: [3] } };
    expect(dealScore(game, sim, 'PLR', 'BBB', deal)).toBeGreaterThanOrEqual(0);
    const r = propose(game, deal);
    if (!r.ok) throw new Error(r.error);
    expect(r.accepted).toBe(true);
    expect(r.state.world.provinceOwners[3]).toBe('PLR');
    expect(r.state.economy.countries.PLR!.treasury).toBeCloseTo(0.5e10, -3);
    // A stingy offer for the same land is refused and changes nothing but the points.
    const stingy = propose(game, { give: { money: 1e8 }, take: { provinces: [3] } });
    expect(stingy.ok && stingy.accepted).toBe(false);
    expect(stingy.ok && stingy.state.world.provinceOwners[3]).toBe('BBB');
  });

  it('a war against a much stronger country is a hard sell; against a rival it is easier', () => {
    const game = newGame();
    const vsBig = dealScore(game, sim, 'PLR', 'BBB', { give: {}, take: { declareWarOn: 'BIG' } });
    const vsRival = dealScore(game, sim, 'PLR', 'BBB', { give: {}, take: { declareWarOn: 'SML' } });
    expect(vsRival).toBeGreaterThan(vsBig);
    expect(dealLikelihood(vsBig, dealRules(sim))).toMatch(/low|veryLow/);
  });

  it('treaties, sanctions and access take effect when accepted', () => {
    const game = newGame();
    game.diplomacy.relations['BBB|PLR'] = 80;
    const r = propose(game, {
      give: { sanctionsOn: 'SML' },
      take: { militaryAccess: true },
      defensePact: true,
      nonAggression: true,
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.accepted).toBe(true);
    expect(alliesOf(r.state.world, 'PLR')).toContain('BBB');
    expect(nonAggressionBetween(r.state, 'PLR', 'BBB')).toBe(true);
    expect(sanctioned(r.state, 'PLR', 'SML')).toBe(true);
    expect(hasAccess(r.state, 'PLR', 'BBB')).toBe(true);
  });

  it('a non-aggression pact blocks a declaration of war', () => {
    const game = newGame();
    game.diplomacy.nonAggression = [{ a: 'PLR', b: 'SML', until: 50 }];
    expect(
      applyCommand(game, { type: 'declareWar', countryId: 'PLR', targetId: 'SML' }, sim),
    ).toEqual({ ok: false, error: 'nonAggression' });
    expect(enemiesAtWar(game.world, 'PLR')).toEqual([]);
  });

  it('refuses impossible deals: a capital, land one does not own, money one does not have', () => {
    const game = newGame();
    expect(propose(game, { give: {}, take: { provinces: [2] } })).toEqual({
      ok: false,
      error: 'invalidTarget',
    });
    expect(propose(game, { give: { provinces: [4] }, take: {} })).toEqual({
      ok: false,
      error: 'invalidTarget',
    });
    expect(propose(game, { give: { money: 1e15 }, take: {} })).toEqual({
      ok: false,
      error: 'notEnoughMoney',
    });
    expect(propose(game, { give: {}, take: {} })).toEqual({ ok: false, error: 'invalidTarget' });
  });
});
