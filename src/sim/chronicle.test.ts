import { describe, expect, it } from 'vitest';
import aiRulesData from '../../data/modern/ai-rules.json';
import diplomacyRulesData from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import goalsData from '../../data/modern/goals.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import weaponsRulesData from '../../data/modern/weapons.json';
import { applyCommand } from './commands';
import type { DiplomacyRules } from './diplomacy';
import type { EconomyRules, SimContext } from './economy';
import { ensureGoals, goalProgress, goalReward, goalTerm, type GoalRules } from './goals';
import { relation } from './diplomacy';
import type { MilitaryRules } from './military';
import { createNewGame, type GameState } from './newGame';
import type { PopulationRules } from './population';
import type { AiRules } from './profiles';
import { advanceTurn, type TurnEvent } from './turn';
import type { WeaponsRules } from './weapons';
import type { World, WorldCountry } from './world';

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
    country('BBB', [1], 3e11),
    country('PLR', [2], 1e11),
    country('FAR', [3], 1e11),
  ],
  provinceOwners: ['AAA', 'BBB', 'PLR', 'FAR'],
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
  goals: goalsData as unknown as GoalRules,
  cityProvince: [0, 1, 2, 3],
  cityPopulation: [1e6, 1e6, 1e6, 1e6],
  // FAR is on the other side of the world: outside the player's region.
  cityLonLat: [
    [0, 0],
    [5, 0],
    [2, 0],
    [170, 0],
  ],
  provincePopulation: [1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1, 2], [0, 2], [0, 1], []],
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

function play(state: GameState, turns: number, events: TurnEvent[] = []): GameState {
  for (let i = 0; i < turns; i++) {
    const r = advanceTurn(state, sim);
    state = r.state;
    events.push(...r.events);
  }
  return state;
}

describe('news and reports', () => {
  it('writes a headline when a war starts and a report every 10 turns', () => {
    let game = newGame();
    const war = applyCommand(game, { type: 'declareWar', countryId: 'BBB', targetId: 'FAR' }, sim);
    if (!war.ok) throw new Error(war.error);
    const events: TurnEvent[] = [];
    game = play(war.state, 10, events);
    expect(
      game.chronicle.news.some((n) => n.kind === 'war' && n.a === 'BBB' && n.b === 'FAR'),
    ).toBe(true);
    const report = events.find((e) => e.type === 'report');
    expect(report?.type === 'report' && report.report.warsStarted).toBe(1);
    expect(report?.type === 'report' && report.report.sinceTurn).toBe(0);
    // The next report compares with this one.
    const later: TurnEvent[] = [];
    play(game, 10, later);
    const next = later.find((e) => e.type === 'report');
    expect(next?.type === 'report' && next.report.sinceTurn).toBe(10);
    expect(next?.type === 'report' && next.report.warsStarted).toBe(0);
  });
});

describe('goals', () => {
  it('gives the player 3-5 goals that fit the situation', () => {
    const game = newGame();
    // 3-5 country goals (GDD section 13), plus the player's objectives (master plan, phase 6).
    const objectives = ['buildings', 'techLevels', 'rank'];
    const country = game.goals.filter((g) => !objectives.includes(g.kind));
    expect(country.length).toBeGreaterThanOrEqual(3);
    expect(country.length).toBeLessThanOrEqual(5);
    expect(game.goals.filter((g) => objectives.includes(g.kind)).length).toBeGreaterThanOrEqual(2);
    expect(game.goals.some((g) => g.kind === 'stayInAlliance' && g.allianceId === 'bloc')).toBe(
      true,
    );
    for (const g of game.goals) expect(goalProgress(game, sim, g)).toBeGreaterThanOrEqual(0);
  });

  it('fails the alliance goal when the player leaves and completes GDP growth when reached', () => {
    const game = newGame();
    const left = applyCommand(
      game,
      { type: 'leaveAlliance', countryId: 'PLR', allianceId: 'bloc' },
      sim,
    );
    if (!left.ok) throw new Error(left.error);
    left.state.economy.countries.PLR!.gdp *= 2;
    const events: TurnEvent[] = [];
    const later = play(left.state, 1, events);
    expect(later.goals.find((g) => g.kind === 'stayInAlliance')?.status).toBe('failed');
    expect(later.goals.find((g) => g.kind === 'gdpGrowth')?.status).toBe('done');
    expect(events.some((e) => e.type === 'goalDone' && e.kind === 'gdpGrowth')).toBe(true);
    expect(events.some((e) => e.type === 'goalFailed' && e.kind === 'stayInAlliance')).toBe(true);
  });

  it('is deterministic', () => {
    expect(play(newGame(), 30)).toEqual(play(newGame(), 30));
  });
});

describe('player objectives (master plan, phase 6)', () => {
  const rules = goalsData as unknown as GoalRules;

  it('adds a short-, a medium- and a long-term objective to the player only', () => {
    const game = newGame();
    const byKind = (k: string) => game.goals.find((g) => g.kind === k)!;
    expect(goalTerm(sim, byKind('buildings'))).toBe('short');
    expect(goalTerm(sim, byKind('techLevels'))).toBe('medium');
    expect(goalTerm(sim, byKind('rank'))).toBe('long');
    expect(goalTerm(sim, byKind('gdpGrowth'))).toBe('long');
    expect(byKind('buildings').target).toBe(rules.buildings!.count);
    for (const goals of Object.values(game.aiGoals))
      expect(goals.some((g) => ['buildings', 'techLevels', 'rank'].includes(g.kind))).toBe(false);
  });

  it('rewards a finished goal with support, relations with friends, technology and points', () => {
    const game = newGame();
    const done = structuredClone(game);
    // Make the buildings objective already met in one copy.
    done.goals.find((g) => g.kind === 'buildings')!.target = 0;
    const control = play(game, 1);
    const events: TurnEvent[] = [];
    const after = play(done, 1, events);
    const goal = after.goals.find((g) => g.kind === 'buildings')!;
    expect(goal.status).toBe('done');
    expect(events.some((e) => e.type === 'goalDone' && e.kind === 'buildings')).toBe(true);
    const reward = goalReward(sim, goal)!;
    expect(reward).toEqual(rules.rewards!.short);
    expect(
      after.economy.countries.PLR!.tech!.points - control.economy.countries.PLR!.tech!.points,
    ).toBe(reward.techPoints);
    expect(after.diplomacy.points.PLR! - control.diplomacy.points.PLR!).toBeCloseTo(
      reward.diplomacyPoints,
    );
    // The ally gains relations; a country without ties does not.
    expect(relation(after, sim, 'PLR', 'AAA') - relation(control, sim, 'PLR', 'AAA')).toBeCloseTo(
      reward.relation,
    );
    expect(relation(after, sim, 'PLR', 'FAR')).toBeCloseTo(relation(control, sim, 'PLR', 'FAR'));
    expect(after.population.support[2]!).toBeGreaterThan(control.population.support[2]!);
    expect(after.log!.entries.some((e) => e.kind === 'goalDone' && e.extra === 'buildings')).toBe(
      true,
    );
  });

  it('shows progress and gives older saves the objectives', () => {
    const game = newGame();
    for (const g of game.goals) expect(goalProgress(game, sim, g)).toBeGreaterThanOrEqual(0);
    const old = {
      ...game,
      goals: game.goals.filter((g) => !['buildings', 'techLevels', 'rank'].includes(g.kind)),
    };
    const loaded = ensureGoals(old, sim);
    expect(loaded.goals.some((g) => g.kind === 'buildings')).toBe(true);
    expect(ensureGoals(loaded, sim)).toBe(loaded);
  });
});
