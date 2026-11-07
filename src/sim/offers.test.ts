import { describe, expect, it } from 'vitest';
import diplomacyRulesData from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import { applyCommand } from './commands';
import { nonAggressionBetween } from './deals';
import {
  hasAccess,
  relation,
  sanctioned,
  type DiplomacyEvent,
  type DiplomacyRules,
} from './diplomacy';
import type { EconomyRules, SimContext } from './economy';
import type { MilitaryRules } from './military';
import { createNewGame, type GameState } from './newGame';
import { offerCandidates, offersPhase } from './offers';
import type { PopulationRules } from './population';
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

// PLR (player) 0-1, BBB 2-3 (the player's only neighbor), FAR 4, SML 5. BBB and SML are rivals.
const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    country('PLR', [0, 1]),
    country('BBB', [2, 3]),
    country('FAR', [4]),
    country('SML', [5]),
  ],
  provinceOwners: ['PLR', 'PLR', 'BBB', 'BBB', 'FAR', 'SML'],
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

const newGame = (w = world()): GameState => {
  const game = createNewGame(
    w,
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: 'PLR',
      leaderName: 'P',
      seed: 3,
    },
    sim,
  );
  for (const id of ['PLR', 'BBB', 'FAR', 'SML']) game.economy.countries[id]!.treasury = 1e10;
  return game;
};

const setRelation = (game: GameState, a: string, b: string, value: number): void => {
  game.diplomacy.relations[a < b ? `${a}|${b}` : `${b}|${a}`] = value;
};

/** Puts one candidate offer in front of the player, as offersPhase would. */
const offer = (game: GameState, kind: string, from: string) => {
  const c = offerCandidates(game, sim).find((x) => x.kind === kind && x.from === from);
  if (!c) throw new Error(`no ${kind} offer from ${from}`);
  const id = game.diplomacy.nextId++;
  game.diplomacy.requests.push({ id, type: 'deal', ...c, until: game.turn + 4 });
  return id;
};

const answer = (game: GameState, requestId: number, accept: boolean) => {
  const r = applyCommand(game, { type: 'answerRequest', countryId: 'PLR', requestId, accept }, sim);
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('AI offers to the player (Dario, idea 5)', () => {
  it('a wary neighbor offers a non-aggression pact; accepting signs it', () => {
    const game = newGame();
    setRelation(game, 'PLR', 'BBB', 0);
    const id = offer(game, 'nonAggression', 'BBB');
    // Only neighbors make this offer.
    expect(
      offerCandidates(game, sim).some((c) => c.kind === 'nonAggression' && c.from !== 'BBB'),
    ).toBe(false);
    const yes = answer(game, id, true);
    expect(nonAggressionBetween(yes, 'PLR', 'BBB')).toBe(true);
    expect(yes.diplomacy.requests).toHaveLength(0);
  });

  it('a poorer friend asks for aid; refusing costs relations, accepting moves the money', () => {
    const game = newGame();
    setRelation(game, 'PLR', 'FAR', 50);
    game.economy.countries.FAR!.gdp = game.economy.countries.PLR!.gdp / 2;
    const id = offer(game, 'aid', 'FAR');
    const request = game.diplomacy.requests.find((r) => r.id === id)!;
    const money = request.type === 'deal' ? request.deal.take.money! : 0;
    expect(money).toBeGreaterThan(0);
    const yes = answer(game, id, true);
    expect(yes.economy.countries.PLR!.treasury).toBeCloseTo(1e10 - money, -2);
    expect(yes.economy.countries.FAR!.treasury).toBeCloseTo(1e10 + money, -2);
    expect(relation(yes, sim, 'PLR', 'FAR')).toBeGreaterThan(50);
    const no = answer(game, id, false);
    expect(no.economy.countries.PLR!.treasury).toBe(1e10);
    expect(relation(no, sim, 'PLR', 'FAR')).toBe(50 + diplomacyRulesData.offers.refusedRelation);
  });

  it('a country at war pays for passage to an enemy on our border', () => {
    const w = world();
    w.wars = [{ id: 'w', sides: [['SML'], ['BBB']] }];
    const game = newGame(w);
    setRelation(game, 'PLR', 'SML', 10);
    const id = offer(game, 'buyAccess', 'SML');
    const yes = answer(game, id, true);
    expect(hasAccess(yes, 'SML', 'PLR')).toBe(true);
    expect(yes.economy.countries.PLR!.treasury).toBeGreaterThan(1e10);
    // Never through the land of the enemy's ally.
    const allied = newGame(w);
    allied.world.alliances.push({ id: 'p', type: 'pact', members: ['PLR', 'BBB'] });
    setRelation(allied, 'PLR', 'SML', 10);
    expect(offerCandidates(allied, sim).some((c) => c.kind === 'buyAccess')).toBe(false);
  });

  it('a friend pays for sanctions on a rival both dislike', () => {
    const game = newGame();
    setRelation(game, 'PLR', 'BBB', 40);
    setRelation(game, 'PLR', 'SML', -20);
    const id = offer(game, 'coalition', 'BBB');
    const yes = answer(game, id, true);
    expect(sanctioned(yes, 'PLR', 'SML')).toBe(true);
    // No coalition against a country the player likes.
    const friendly = newGame();
    setRelation(friendly, 'PLR', 'BBB', 40);
    setRelation(friendly, 'PLR', 'SML', 20);
    expect(offerCandidates(friendly, sim).some((c) => c.kind === 'coalition')).toBe(false);
  });

  it('an offer that became impossible does nothing when accepted', () => {
    const game = newGame();
    setRelation(game, 'PLR', 'FAR', 50);
    game.economy.countries.FAR!.gdp = game.economy.countries.PLR!.gdp / 2;
    const id = offer(game, 'aid', 'FAR');
    game.economy.countries.PLR!.treasury = 0;
    const r = applyCommand(
      game,
      { type: 'answerRequest', countryId: 'PLR', requestId: id, accept: true },
      sim,
    );
    expect(r.ok && r.accepted).toBe(false);
    expect(r.ok && r.state.economy.countries.FAR!.treasury).toBe(1e10);
  });

  it('offers come now and then, one at a time, the same with the same seed', () => {
    const run = () => {
      const game = newGame();
      setRelation(game, 'PLR', 'BBB', 0);
      const events: DiplomacyEvent[] = [];
      const turns: number[] = [];
      for (let turn = 1; turn <= 200; turn++) {
        game.turn = turn;
        offersPhase(game, sim, (e) => events.push(e));
        if (game.diplomacy.requests.length > 0) {
          turns.push(turn);
          // At most one offer waits at a time; the player refuses it.
          expect(game.diplomacy.requests).toHaveLength(1);
          game.diplomacy.requests = [];
        }
      }
      return { events: events.length, turns };
    };
    const a = run();
    expect(a.turns.length).toBeGreaterThan(0);
    expect(a.events).toBe(a.turns.length);
    // The same offer (kind and country) is not repeated within a year.
    for (let i = 1; i < a.turns.length; i++)
      expect(a.turns[i]! - a.turns[i - 1]!).toBeGreaterThanOrEqual(
        diplomacyRulesData.offers.repeatGapWeeks,
      );
    expect(run()).toEqual(a);
  });
});
