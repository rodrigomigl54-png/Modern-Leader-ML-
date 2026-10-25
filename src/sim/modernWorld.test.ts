import { describe, expect, it } from 'vitest';
import aiRulesData from '../../data/modern/ai-rules.json';
import diplomacyRulesData from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import goalsData from '../../data/modern/goals.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import summitsData from '../../data/modern/summits.json';
import weaponsRulesData from '../../data/modern/weapons.json';
import { applyCommand } from './commands';
import {
  applyPeace,
  dependenceOn,
  sanctionWeight,
  WHITE_PEACE,
  type DiplomacyRules,
} from './diplomacy';
import type { EconomyRules, SimContext } from './economy';
import type { GoalRules } from './goals';
import type { MilitaryRules } from './military';
import { createNewGame, type GameState } from './newGame';
import {
  nationalSupport,
  transferProvince,
  warSupportPhase,
  type PopulationRules,
} from './population';
import type { AiRules } from './profiles';
import type { SummitRules } from './summits';
import { advanceTurn, type TurnEvent } from './turn';
import { convoyInterceptionPhase, type WeaponsRules } from './weapons';
import { enemiesAtWar, type World, type WorldCountry } from './world';

const country = (id: string, provinceIds: number[], gdp: number): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: gdp,
    population: 2e6,
    militaryPersonnel: 5000,
    militaryExpenditureUsd: 2e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [
    country('AAA', [0], 5e11),
    country('BBB', [1, 4], 3e11),
    country('PLR', [2], 1e11),
    country('FAR', [3], 1e11),
  ],
  provinceOwners: ['AAA', 'BBB', 'PLR', 'FAR', 'BBB'],
  alliances: [{ id: 'bloc', type: 'alliance', members: ['AAA', 'PLR'] }],
  rivalries: [],
  wars: [],
  disputed: [],
});

const sim: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: militaryRulesData as MilitaryRules,
  weapons: weaponsRulesData as unknown as WeaponsRules,
  diplomacy: diplomacyRulesData as unknown as DiplomacyRules,
  aiRules: aiRulesData as unknown as AiRules,
  profiles: {},
  summits: summitsData as unknown as SummitRules,
  goals: goalsData as unknown as GoalRules,
  cityProvince: [0, 1, 2, 3, 4],
  cityPopulation: [1e6, 1e6, 1e6, 1e6, 1e6],
  // FAR is on the other side of the world: outside the player's region.
  cityLonLat: [
    [0, 0],
    [5, 0],
    [2, 0],
    [170, 0],
    [7, 0],
  ],
  provincePopulation: [1e6, 1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1, 2], [0, 2, 4], [0, 1], [], [1]],
};

const newGame = (): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'peaceful',
      disputedMode: 'neutral',
      countryId: 'PLR',
      leaderName: 'P',
      seed: 3,
    },
    sim,
  );

const support = (s: GameState, id: string): number => nationalSupport(s, sim, id);

describe('support and the course of wars (GDD section 7)', () => {
  it('won battles and taken provinces raise support, lost ones lower it, capped per turn', () => {
    const game = newGame();
    const before = { a: support(game, 'AAA'), b: support(game, 'BBB') };
    warSupportPhase(game, sim, [
      { type: 'battle', attacker: 'AAA', defender: 'BBB', winner: 'attacker' },
      { type: 'provinceCaptured', provinceId: 1, from: 'BBB', to: 'AAA' },
    ]);
    expect(support(game, 'AAA')).toBeGreaterThan(before.a);
    expect(support(game, 'BBB')).toBeLessThan(before.b);
    const many = Array.from({ length: 50 }, () => ({
      type: 'battle',
      attacker: 'AAA',
      defender: 'BBB',
      winner: 'defender',
    }));
    const a = support(game, 'AAA');
    warSupportPhase(game, sim, many);
    const cap = (populationRules as PopulationRules).support.war!.maxPerTurn;
    expect(a - support(game, 'AAA')).toBeCloseTo(cap, 5);
  });

  it('a won peace raises support, a lost one lowers it', () => {
    const declared = applyCommand(
      newGame(),
      { type: 'declareWar', countryId: 'BBB', targetId: 'FAR' },
      sim,
    );
    if (!declared.ok) throw new Error(declared.error);
    const game = declared.state;
    const war = game.world.wars.find((w) => w.sides[0][0] === 'BBB')!;
    game.diplomacy.wars[war.id]!.gain = [40, 0];
    const before = { b: support(game, 'BBB'), f: support(game, 'FAR') };
    applyPeace(game, sim, 'BBB', 'FAR', WHITE_PEACE);
    expect(support(game, 'BBB')).toBeGreaterThan(before.b);
    expect(support(game, 'FAR')).toBeLessThan(before.f);
    expect(game.chronicle.news.some((n) => n.kind === 'peace')).toBe(true);
  });

  it('skipping a summit costs support at home', () => {
    let game = newGame();
    for (let i = 0; i < (summitsData as { firstTurn: number }).firstTurn; i++)
      game = advanceTurn(game, sim).state;
    const s = game.summits.pending!;
    const before = support(game, 'PLR');
    const skipped = applyCommand(
      game,
      { type: 'summit', countryId: 'PLR', summitId: s.id, answers: null },
      sim,
    );
    if (!skipped.ok) throw new Error(skipped.error);
    expect(support(skipped.state, 'PLR')).toBeLessThan(before);
  });
});

describe('peace with a whole side', () => {
  it("when the side's leader makes peace, its allies leave the war too", () => {
    const game = newGame();
    game.world.wars.push({ id: 'w1', sides: [['BBB'], ['AAA', 'PLR']] });
    game.diplomacy.wars.w1 = {
      startTurn: 0,
      gain: [0, 0],
      startPopulation: { BBB: 1e6, AAA: 1e6, PLR: 1e6 },
      lastOffer: -100,
    };
    applyPeace(game, sim, 'BBB', 'AAA', WHITE_PEACE);
    expect(enemiesAtWar(game.world, 'PLR')).toEqual([]);
    expect(game.world.wars).toEqual([]);
  });
});

describe('naval crossings can be intercepted (GDD section 8)', () => {
  it('a convoy sailing to enemy land loses soldiers, more under enemy air defense', () => {
    const lost = (airDefense: number): number => {
      const declared = applyCommand(
        newGame(),
        { type: 'declareWar', countryId: 'FAR', targetId: 'BBB' },
        sim,
      );
      if (!declared.ok) throw new Error(declared.error);
      const game = declared.state;
      game.weapons.airDefense[1] = airDefense;
      game.military.armies.push({
        id: 999,
        owner: 'FAR',
        provinceId: 1,
        regulars: 10000,
        special: 0,
        path: [],
        from: 3,
        arriveTurn: game.turn + 3,
      });
      const events: TurnEvent[] = [];
      convoyInterceptionPhase(game, sim, (e) => events.push(e));
      expect(events.some((e) => e.type === 'convoyIntercepted' && e.owner === 'FAR')).toBe(true);
      return 10000 - (game.military.armies.find((a) => a.id === 999)?.regulars ?? 0);
    };
    expect(lost(0)).toBeGreaterThan(0);
    expect(lost(1)).toBeGreaterThan(lost(0));
  });
});

describe('AI air defense', () => {
  it('an AI country at war builds air defense when it can afford it', () => {
    const declared = applyCommand(
      newGame(),
      { type: 'declareWar', countryId: 'PLR', targetId: 'BBB' },
      sim,
    );
    if (!declared.ok) throw new Error(declared.error);
    let game = declared.state;
    game.economy.countries.BBB!.treasury = 1e13;
    for (let i = 0; i < 20; i++) game = advanceTurn(game, sim).state;
    expect(
      game.weapons.airDefenseBuilds.some((b) => b.owner === 'BBB') ||
        game.weapons.airDefense.some((lvl, city) => lvl > 0 && sim.cityProvince[city] === 1),
    ).toBe(true);
  });
});

describe('emergency summits', () => {
  it("the player's own war on a large power calls an emergency summit", () => {
    const declared = applyCommand(
      newGame(),
      { type: 'declareWar', countryId: 'PLR', targetId: 'BBB' },
      sim,
    );
    if (!declared.ok) throw new Error(declared.error);
    const next = advanceTurn(declared.state, sim).state;
    expect(next.summits.pending?.kind).toBe('emergency');
    expect(next.summits.pending?.cause).toEqual({ kind: 'war', a: 'PLR', b: 'BBB' });
  });
});

describe('AI goals (GDD section 13)', () => {
  it('every AI country gets 3-5 goals that are checked every turn', () => {
    const game = newGame();
    for (const id of ['AAA', 'BBB', 'FAR']) {
      const goals = game.aiGoals[id]!;
      expect(goals.length).toBeGreaterThanOrEqual(3);
      expect(goals.length).toBeLessThanOrEqual(5);
    }
    game.economy.countries.BBB!.gdp *= 2;
    const later = advanceTurn(game, sim).state;
    expect(later.aiGoals.BBB!.find((g) => g.kind === 'gdpGrowth')?.status).toBe('done');
  });
});

describe('revolutions', () => {
  it('a country that crushed a revolution gets a calm period before the next one', () => {
    const revolts = (calm: boolean): boolean => {
      const game = newGame();
      for (const p of [1, 4]) {
        game.population.support[p] = 5;
        game.population.riotTurns[p] = 20;
      }
      if (calm) game.population.calmUntil = { BBB: game.turn + 10 };
      const events = advanceTurn(game, sim).events;
      return events.some((e) => e.type === 'revolution' && e.countryId === 'BBB');
    };
    expect(revolts(false)).toBe(true);
    expect(revolts(true)).toBe(false);
  });
});

describe('sanctions by dependence (GDD section 6)', () => {
  it('near and large economies weigh most; sanctions cut those ties', () => {
    const game = newGame();
    // PLR's capital is between AAA (larger, near) and FAR (far away).
    const dep = dependenceOn(game, sim, 'PLR');
    expect([...dep.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    expect(dep.get('AAA')!).toBeGreaterThan(dep.get('FAR')!);
    game.diplomacy.sanctions.push({ from: 'AAA', to: 'PLR', since: 0 });
    const near = sanctionWeight(game, sim, 'PLR');
    const far = newGame();
    far.diplomacy.sanctions.push({ from: 'FAR', to: 'PLR', since: 0 });
    expect(near).toBeCloseTo(dep.get('AAA')!, 6);
    expect(near).toBeGreaterThan(sanctionWeight(far, sim, 'PLR'));
  });
});

describe('AI countries follow their goals', () => {
  const pacts = (kind: 'neutrality' | 'joinAlliance'): number => {
    let game = newGame();
    game.world.alliances = [];
    game.aiGoals.BBB = [{ kind, deadline: 10000, status: 'active' }];
    game.diplomacy.relations['AAA|BBB'] = 90;
    let count = 0;
    for (let i = 0; i < 300; i++) {
      game = advanceTurn(game, {
        ...sim,
        profiles: {
          BBB: {
            ...(Object.fromEntries(
              [
                'interventionism',
                'sanctions',
                'pressure',
                'expansionism',
                'risk',
                'nuclear',
                'economy',
              ].map((t) => [t, [0, 'test']]),
            ) as object),
            loyalty: [100, 'test'],
            partners: ['AAA'],
            rivals: [],
          } as never,
        },
      }).state;
      if (game.world.alliances.some((a) => a.members.includes('BBB'))) {
        count++;
        game.world.alliances = [];
      }
    }
    return count;
  };

  it('a country that wants to stay neutral proposes no pacts; one that wants an alliance does', () => {
    expect(pacts('neutrality')).toBe(0);
    expect(pacts('joinAlliance')).toBeGreaterThan(0);
  });
});

describe('debt and lost land', () => {
  it("a lost province takes its share of the country's debt with it", () => {
    const game = newGame();
    const e = game.economy.countries.BBB!;
    e.debt = e.gdp;
    transferProvince(game, sim, 4, 'AAA');
    expect(e.debt / e.gdp).toBeCloseTo(1, 6);
    expect(game.economy.countries.AAA!.debt).toBe(newGame().economy.countries.AAA!.debt);
  });
});
