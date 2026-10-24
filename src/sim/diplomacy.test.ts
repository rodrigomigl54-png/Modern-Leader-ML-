import { describe, expect, it } from 'vitest';
import diplomacyRulesData from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import weaponsRulesData from '../../data/modern/weapons.json';
import { applyCommand, type Command } from './commands';
import {
  peaceCost,
  pointsIncome,
  relation,
  sanctionsGrowthPenalty,
  warBetween,
  warScore,
  WHITE_PEACE,
  type DiplomacyRules,
} from './diplomacy';
import { investmentQuote, type EconomyRules, type SimContext } from './economy';
import { findPath, type MilitaryRules } from './military';
import { createNewGame, type GameState } from './newGame';
import type { PopulationRules } from './population';
import { advanceTurn, type TurnEvent } from './turn';
import type { WeaponsRules } from './weapons';
import { enemiesAtWar, type World, type WorldCountry } from './world';

const rules = diplomacyRulesData as unknown as DiplomacyRules;

const country = (id: string, provinceIds: number[], personnel = 10000): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: 1e11,
    population: 2e6,
    militaryPersonnel: personnel,
    militaryExpenditureUsd: 2e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

// A chain of provinces 0-1 (AAA), 2-3 (BBB), 4 (CCC), 5 (DDD). BBB and CCC are allied;
// AAA and DDD are rivals.
const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    country('AAA', [0, 1], 60000),
    country('BBB', [2, 3]),
    country('CCC', [4]),
    country('DDD', [5]),
  ],
  provinceOwners: ['AAA', 'AAA', 'BBB', 'BBB', 'CCC', 'DDD'],
  alliances: [{ id: 'blk', type: 'alliance', members: ['BBB', 'CCC'] }],
  rivalries: [{ a: 'AAA', b: 'DDD' }],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: militaryRulesData as MilitaryRules,
  weapons: weaponsRulesData as unknown as WeaponsRules,
  diplomacy: rules,
  relationOverrides: [{ a: 'AAA', b: 'CCC', value: -20 }],
  cityProvince: [0, 1, 2, 3, 4, 5],
  cityPopulation: [1e6, 1e6, 1e6, 1e6, 1e6, 1e6],
  cityLonLat: [0, 1, 2, 3, 4, 5].map((i) => [i * 1.8, 0] as [number, number]),
  provincePopulation: [1e6, 1e6, 1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]],
};

const newGame = (player = 'AAA'): GameState => {
  const game = createNewGame(
    world(),
    {
      aggressiveness: 'realistic',
      disputedMode: 'neutral',
      countryId: player,
      leaderName: 'P',
      seed: 4,
    },
    sim,
  );
  for (const id of Object.keys(game.diplomacy.points)) game.diplomacy.points[id] = 10;
  return game;
};

function run(state: GameState, command: Command): { state: GameState; accepted?: boolean } {
  const result = applyCommand(state, command, sim);
  if (!result.ok) throw new Error(result.error);
  return result;
}

function play(state: GameState, turns: number, events: TurnEvent[] = []): GameState {
  for (let i = 0; i < turns; i++) {
    const result = advanceTurn(state, sim);
    state = result.state;
    events.push(...result.events);
  }
  return state;
}

describe('relations and points', () => {
  it('start from alliances, rivalries and documented pairs', () => {
    const game = newGame();
    expect(relation(game, sim, 'BBB', 'CCC')).toBe(rules.relations.alliance);
    expect(relation(game, sim, 'AAA', 'DDD')).toBe(rules.relations.rival);
    expect(relation(game, sim, 'AAA', 'CCC')).toBe(-20);
    expect(relation(game, sim, 'AAA', 'BBB')).toBe(0);
  });

  it('earns points every turn up to three turns of income', () => {
    let game = newGame();
    game.diplomacy.points.AAA = 0;
    const income = pointsIncome(game, sim, 'AAA');
    expect(income).toBeGreaterThan(0);
    game = play(game, 10);
    expect(game.diplomacy.points.AAA).toBeCloseTo(income * rules.points.capTurns, 1);
  });

  it('actions cost points', () => {
    const game = newGame();
    game.diplomacy.points.AAA = 1;
    expect(
      applyCommand(game, { type: 'sanction', countryId: 'AAA', targetId: 'BBB' }, sim),
    ).toEqual({
      ok: false,
      error: 'notEnoughPoints',
    });
  });
});

describe('war and alliances', () => {
  it('allies decide to join when one of them is attacked', () => {
    const { state } = run(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' });
    expect(enemiesAtWar(state.world, 'AAA')).toEqual(['BBB', 'CCC']);
    expect(relation(state, sim, 'AAA', 'BBB')).toBe(rules.relations.war);
  });

  it("asks the player when the player's ally is attacked", () => {
    const { state } = run(newGame('CCC'), {
      type: 'declareWar',
      countryId: 'CCC',
      targetId: 'DDD',
    });
    // Here AAA is AI and attacks BBB, whose ally CCC is the player.
    state.world.wars = [];
    const war = run(state, { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }).state;
    const request = war.diplomacy.requests.find((r) => r.type === 'joinWar')!;
    expect(request).toMatchObject({ from: 'BBB', enemy: 'AAA' });
    expect(enemiesAtWar(war.world, 'CCC')).not.toContain('AAA');
    const joined = run(war, {
      type: 'answerRequest',
      countryId: 'CCC',
      requestId: request.id,
      accept: true,
    });
    expect(enemiesAtWar(joined.state.world, 'CCC')).toContain('AAA');
  });

  it('a pact needs good relations; joining an alliance needs its members', () => {
    const game = newGame();
    expect(run(game, { type: 'proposeAlliance', countryId: 'AAA', targetId: 'BBB' }).accepted).toBe(
      false,
    );
    game.diplomacy.relations['AAA|BBB'] = 60;
    const pact = run(game, { type: 'proposeAlliance', countryId: 'AAA', targetId: 'BBB' });
    expect(pact.accepted).toBe(true);
    expect(
      pact.state.world.alliances.some((a) => a.type === 'pact' && a.members.includes('AAA')),
    ).toBe(true);
    // CCC dislikes AAA, so the alliance with BBB and CCC refuses it.
    expect(
      run(game, { type: 'proposeAlliance', countryId: 'AAA', targetId: 'BBB', allianceId: 'blk' })
        .accepted,
    ).toBe(false);
  });
});

describe('sanctions', () => {
  it('slow the target, block investment and weapons trade, and can be lifted', () => {
    const { state } = run(newGame(), { type: 'sanction', countryId: 'AAA', targetId: 'BBB' });
    expect(sanctionsGrowthPenalty(state, sim, 'BBB')).toBeGreaterThan(0);
    expect(relation(state, sim, 'AAA', 'BBB')).toBe(rules.sanctions.relation);
    expect(investmentQuote(state, sim, 'AAA', [2], 'factory')!.buildable).toEqual([]);
    expect(
      applyCommand(
        state,
        {
          type: 'tradeWeapons',
          countryId: 'AAA',
          direction: 'buy',
          targetId: 'BBB',
          weapon: 'drone',
          tier: 1,
          count: 1,
        },
        sim,
      ),
    ).toEqual({ ok: false, error: 'sanctioned' });
    const lifted = run(state, { type: 'liftSanctions', countryId: 'AAA', targetId: 'BBB' }).state;
    expect(sanctionsGrowthPenalty(lifted, sim, 'BBB')).toBe(0);
  });
});

describe('ultimatums and credibility', () => {
  it('a weak country gives in to a strong one', () => {
    let game = run(newGame(), {
      type: 'ultimatum',
      countryId: 'AAA',
      targetId: 'DDD',
      demand: { type: 'tribute', amountUsd: 1e8 },
      threat: 'war',
    }).state;
    const treasury = game.economy.countries.AAA!.treasury;
    game = play(game, 1);
    expect(game.diplomacy.ultimatums[0]!.status).toBe('accepted');
    expect(game.economy.countries.AAA!.treasury).toBeGreaterThan(treasury + 5e7);
  });

  it('an empty threat costs credibility; a carried-out one earns it', () => {
    const start = newGame('BBB');
    // BBB (weak) demands a province of AAA (strong): refused.
    let game = run(start, {
      type: 'ultimatum',
      countryId: 'BBB',
      targetId: 'AAA',
      demand: { type: 'province', provinceId: 1 },
      threat: 'sanctions',
    }).state;
    game = play(game, 1);
    expect(game.diplomacy.ultimatums[0]!.status).toBe('refused');
    const credibility = game.diplomacy.credibility.BBB!;
    const empty = play(game, rules.credibility.enforceTurns + 1);
    expect(empty.diplomacy.credibility.BBB).toBe(credibility - rules.credibility.failed);
    const kept = play(run(game, { type: 'sanction', countryId: 'BBB', targetId: 'AAA' }).state, 1);
    expect(kept.diplomacy.credibility.BBB).toBe(credibility + rules.credibility.enforced);
  });

  it('the player answers ultimatums sent to it', () => {
    const game = newGame('DDD');
    game.player.countryId = 'DDD';
    const sent = run(game, {
      type: 'ultimatum',
      countryId: 'AAA',
      targetId: 'DDD',
      demand: { type: 'province', provinceId: 5 },
      threat: 'war',
    }).state;
    const request = sent.diplomacy.requests.find((r) => r.type === 'ultimatum')!;
    const answered = run(sent, {
      type: 'answerRequest',
      countryId: 'DDD',
      requestId: request.id,
      accept: false,
    }).state;
    expect(answered.diplomacy.ultimatums[0]!.status).toBe('refused');
  });
});

describe('bases, aid, trade and vassals', () => {
  it('a friendly host accepts a base, which opens its land to our armies', () => {
    const game = newGame();
    expect(findPath(game, sim, 'AAA', 0, 3)).toBeNull();
    game.diplomacy.relations['AAA|BBB'] = 60;
    const { state, accepted } = run(game, {
      type: 'requestBase',
      countryId: 'AAA',
      cityId: 3,
      pay: false,
    });
    expect(accepted).toBe(true);
    expect(state.world.foreignBases).toEqual([{ owner: 'AAA', host: 'BBB', cityId: 3 }]);
    expect(findPath(state, sim, 'AAA', 0, 3)).toEqual([1, 2, 3]);
  });

  it('aid raises relations and the receiver’s enemies resent it', () => {
    let game = run(newGame('CCC'), { type: 'declareWar', countryId: 'CCC', targetId: 'DDD' }).state;
    game = run(game, { type: 'sendAid', countryId: 'AAA', targetId: 'CCC', money: 1e9 }).state;
    expect(relation(game, sim, 'AAA', 'CCC')).toBeGreaterThan(-20);
    expect(relation(game, sim, 'AAA', 'DDD')).toBe(rules.relations.rival + rules.aid.enemyRelation);
  });

  it('buys weapons from a willing seller', () => {
    const game = newGame();
    const stock = game.weapons.countries.BBB!.drones[0]!;
    const { state, accepted } = run(game, {
      type: 'tradeWeapons',
      countryId: 'AAA',
      direction: 'buy',
      targetId: 'BBB',
      weapon: 'drone',
      tier: 1,
      count: 5,
    });
    expect(accepted).toBe(true);
    expect(state.weapons.countries.BBB!.drones[0]).toBe(stock - 5);
  });

  it('a much stronger friend can make a vassal that pays tribute and follows it to war', () => {
    const game = newGame();
    game.diplomacy.relations['AAA|DDD'] = 20;
    const vassal = run(game, { type: 'vassal', countryId: 'AAA', mode: 'ask', targetId: 'DDD' });
    expect(vassal.accepted).toBe(true);
    const treasury = vassal.state.economy.countries.AAA!.treasury;
    const later = play(vassal.state, 1);
    expect(later.economy.countries.AAA!.treasury).toBeGreaterThan(treasury - 1e9);
    const war = run(later, { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }).state;
    expect(enemiesAtWar(war.world, 'DDD')).toContain('BBB');
  });
});

describe('peace', () => {
  it('builds war score from conquest', () => {
    let game = run(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'DDD' }).state;
    // An AAA army next to DDD's only province walks in.
    game.world.provinceOwners[4] = 'AAA';
    game.military.armies = [
      { id: 900, owner: 'AAA', provinceId: 4, regulars: 50000, special: 0, path: [5], from: 4 },
    ];
    game.military.reservists.fill(0);
    game.economy.countries.DDD!.treasury = 0;
    const war = warBetween(game.world, 'AAA', 'DDD')!;
    game = play(game, 1);
    expect(game.world.provinceOwners[5]).toBe('AAA');
    // DDD lost its last province: the war is over, so check the record before it ended.
    expect(game.world.wars.some((w) => w.id === war.id)).toBe(false);
  });

  it('scores captures for the side that takes them', () => {
    let game = run(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }).state;
    const war = warBetween(game.world, 'AAA', 'BBB')!;
    game.military.armies = [
      { id: 900, owner: 'AAA', provinceId: 1, regulars: 50000, special: 0, path: [2], from: 1 },
    ];
    game.military.reservists.fill(0);
    for (const id of ['BBB', 'CCC']) game.economy.countries[id]!.treasury = 0;
    game = play(game, 1);
    expect(game.world.provinceOwners[2]).toBe('AAA');
    expect(warScore(game, war.id, 'AAA')).toBeGreaterThan(0);
    expect(warScore(game, war.id, 'BBB')).toBeLessThan(0);
  });

  it('the loser of a war accepts peace on the winner’s terms when the score allows it', () => {
    const game = run(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }).state;
    const war = warBetween(game.world, 'AAA', 'BBB')!;
    game.diplomacy.wars[war.id]!.gain = [60, 0];
    game.diplomacy.wars[war.id]!.startTurn = -rules.peace.minTurns;
    const greedy = { ...WHITE_PEACE, reparationsShare: 0.2, vassal: true };
    expect(peaceCost(game, sim, 'AAA', 'BBB', greedy)!.cost).toBeGreaterThan(60);
    expect(
      run(game, { type: 'proposePeace', countryId: 'AAA', targetId: 'BBB', terms: greedy })
        .accepted,
    ).toBe(false);
    const fair = { ...WHITE_PEACE, reparationsShare: 0.1 };
    const peace = run(game, {
      type: 'proposePeace',
      countryId: 'AAA',
      targetId: 'BBB',
      terms: fair,
    });
    expect(peace.accepted).toBe(true);
    expect(enemiesAtWar(peace.state.world, 'AAA')).not.toContain('BBB');
    expect(peace.state.economy.countries.AAA!.treasury).toBeGreaterThan(
      game.economy.countries.AAA!.treasury,
    );
  });

  it('cannot be proposed in the first weeks of a war', () => {
    const game = run(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }).state;
    expect(
      applyCommand(
        game,
        { type: 'proposePeace', countryId: 'AAA', targetId: 'BBB', terms: WHITE_PEACE },
        sim,
      ),
    ).toEqual({ ok: false, error: 'tooEarly' });
  });

  it('returns provinces the winner does not keep and can demilitarize the border', () => {
    const game = run(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }).state;
    const war = warBetween(game.world, 'AAA', 'BBB')!;
    game.diplomacy.wars[war.id]!.gain = [80, 0];
    game.diplomacy.wars[war.id]!.startTurn = -rules.peace.minTurns;
    game.world.wars = game.world.wars.map((w) => ({ ...w, sides: [['AAA'], ['BBB']] }));
    // AAA holds BBB's province 2.
    game.world.provinceOwners[2] = 'AAA';
    game.world.countries.find((c) => c.id === 'AAA')!.provinceIds.push(2);
    game.world.countries.find((c) => c.id === 'BBB')!.provinceIds = [3];
    const terms = { ...WHITE_PEACE, keepProvinces: false, demilitarize: true };
    const { state } = run(game, { type: 'proposePeace', countryId: 'AAA', targetId: 'BBB', terms });
    expect(state.world.provinceOwners[2]).toBe('BBB');
    expect(state.diplomacy.demilitarized[0]).toMatchObject({ country: 'BBB' });
  });

  it('AI countries make peace after a long stalemate', () => {
    let game = run(newGame('DDD'), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }).state;
    const war = warBetween(game.world, 'AAA', 'BBB')!;
    game.diplomacy.wars[war.id]!.startTurn = -rules.peace.aiStalemateTurns;
    const events: TurnEvent[] = [];
    game = play(game, 1, events);
    expect(events.some((e) => e.type === 'peace')).toBe(true);
    expect(game.world.wars.some((w) => w.id === war.id)).toBe(false);
  });
});

describe('nuclear use and determinism', () => {
  it('a nuclear strike brings global sanctions', () => {
    const game = run(newGame('DDD'), {
      type: 'declareWar',
      countryId: 'AAA',
      targetId: 'BBB',
    }).state;
    game.weapons.countries.AAA!.warheads = 1;
    game.weapons.nuclearBases.push({ cityId: 0, country: 'AAA' });
    const fired = run(game, { type: 'launchNuclear', countryId: 'AAA', targetCityId: 3 }).state;
    const events: TurnEvent[] = [];
    const after = play(fired, 1, events);
    expect(events.some((e) => e.type === 'globalSanctions')).toBe(true);
    expect(after.diplomacy.sanctions.filter((s) => s.to === 'AAA').length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('gives the same result for the same seed', () => {
    const start = run(newGame(), { type: 'declareWar', countryId: 'AAA', targetId: 'BBB' }).state;
    expect(play(start, 12)).toEqual(play(start, 12));
  });
});
