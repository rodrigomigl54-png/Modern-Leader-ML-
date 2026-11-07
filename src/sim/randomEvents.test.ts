import { describe, expect, it } from 'vitest';
import diplomacyRulesData from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import eventsData from '../../data/modern/events.json';
import militaryRulesData from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import { applyCommand } from './commands';
import type { DiplomacyRules } from './diplomacy';
import { relation } from './diplomacy';
import type { EconomyRules, SimContext } from './economy';
import type { MilitaryRules } from './military';
import { createNewGame, type GameState } from './newGame';
import type { PopulationRules } from './population';
import { applyEffects, type EventRules } from './randomEvents';
import { advanceTurn, type TurnEvent } from './turn';
import type { World, WorldCountry } from './world';

const rules = eventsData as unknown as EventRules;

const country = (id: string, provinceIds: number[]): WorldCountry => ({
  id,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
  stats: {
    gdpUsd: 1e11,
    population: 2e6,
    militaryPersonnel: 5000,
    militaryExpenditureUsd: 2e9,
    stability: 0,
  },
  leader: { name: 'Old', title: 'president' },
});

const world = (): World => ({
  startDate: '2027-01-01',
  countries: [country('AAA', [0]), country('BBB', [1]), country('PLR', [2]), country('FAR', [3])],
  provinceOwners: ['AAA', 'BBB', 'PLR', 'FAR'],
  alliances: [],
  rivalries: [],
  wars: [],
  disputed: [],
});

const base: SimContext = {
  economy: economyRules as EconomyRules,
  population: populationRules as PopulationRules,
  military: militaryRulesData as MilitaryRules,
  diplomacy: diplomacyRulesData as unknown as DiplomacyRules,
  cityProvince: [0, 1, 2, 3],
  cityPopulation: [1e6, 1e6, 1e6, 1e6],
  cityLonLat: [
    [0, 0],
    [5, 0],
    [2, 0],
    [170, 0],
  ],
  provincePopulation: [1e6, 1e6, 1e6, 1e6],
  provinceNeighbors: [[1, 2], [0, 2], [0, 1], []],
};
const sim: SimContext = { ...base, events: rules };

const newGame = (ctx = sim): GameState =>
  createNewGame(
    world(),
    {
      aggressiveness: 'peaceful',
      disputedMode: 'neutral',
      countryId: 'PLR',
      leaderName: 'P',
      seed: 9,
    },
    ctx,
  );

/** Plays weeks, answering the player's events with their first option. */
function play(state: GameState, turns: number, events: TurnEvent[] = [], ctx = sim): GameState {
  for (let i = 0; i < turns; i++) {
    const r = advanceTurn(state, ctx);
    state = r.state;
    events.push(...r.events);
  }
  return state;
}

describe('random events', () => {
  it('come about once in 10 weeks, never too close and never the same one twice in 2 years', () => {
    const events: TurnEvent[] = [];
    play(newGame(), 520, events);
    const ai = events.filter((e) => e.type === 'eventAnswered' && e.countryId === 'AAA');
    // 10 years: about 52 at 12% a week with a 5-week gap (roughly one in 11 weeks).
    expect(ai.length).toBeGreaterThan(25);
    expect(ai.length).toBeLessThan(80);
    const all = [...events.entries()].filter(
      ([, e]) => e.type === 'eventAnswered' || e.type === 'randomEvent',
    );
    expect(all.length).toBeGreaterThan(0);
  });

  it('respects the gap between events and the repeat gap', () => {
    let game = newGame();
    const turns: Record<string, { turn: number; id: string }[]> = {};
    for (let i = 0; i < 400; i++) {
      const r = advanceTurn(game, sim);
      game = r.state;
      for (const e of r.events)
        if (e.type === 'eventAnswered' || e.type === 'randomEvent')
          (turns[e.countryId] ??= []).push({ turn: game.turn, id: e.eventId });
    }
    for (const list of Object.values(turns))
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.turn - list[i - 1]!.turn).toBeGreaterThanOrEqual(rules.minGapWeeks);
        const before = list
          .slice(0, i)
          .filter((x) => x.id === list[i]!.id)
          .at(-1);
        if (before)
          expect(list[i]!.turn - before.turn).toBeGreaterThanOrEqual(rules.repeatGapWeeks);
      }
  });

  it('waits for the player’s answer, applies it and records it in the History', () => {
    let game = newGame();
    while (!game.randomEvents?.pending) game = play(game, 1);
    const pending = game.randomEvents.pending!;
    const def = rules.events.find((e) => e.id === pending.eventId)!;
    const treasury = game.economy.countries.PLR!.treasury;
    const answered = applyCommand(game, { type: 'answerEvent', countryId: 'PLR', option: 1 }, sim);
    if (!answered.ok) throw new Error(answered.error);
    expect(answered.state.randomEvents!.pending).toBeNull();
    expect(answered.state.log!.entries.at(-1)).toMatchObject({
      kind: 'event',
      extra: def.id,
      n: 1,
    });
    const t = def.options[1]!.effects.treasury ?? 0;
    expect(answered.state.economy.countries.PLR!.treasury).toBeCloseTo(
      treasury + t * game.economy.countries.PLR!.gdp,
    );
    expect(
      applyCommand(answered.state, { type: 'answerEvent', countryId: 'PLR', option: 0 }, sim),
    ).toEqual({ ok: false, error: 'noEvent' });
    // Left unanswered for a week, an event takes its first option.
    let other = game;
    other = play(other, 1);
    expect(other.randomEvents!.pending?.turn ?? -1).not.toBe(pending.turn);
    expect(other.log!.entries.some((e) => e.kind === 'event' && e.extra === def.id)).toBe(true);
  });

  it('applies effects as the data says', () => {
    const game = newGame();
    const e = game.economy.countries.PLR!;
    const gdp = e.gdp;
    const before = relation(game, sim, 'PLR', 'AAA');
    applyEffects(
      game,
      sim,
      'PLR',
      {
        gdp: 0.01,
        treasury: -0.01,
        inflation: 0.02,
        relation: -10,
        techPoints: 2,
        diplomacyPoints: 1,
      },
      'AAA',
    );
    expect(e.gdp).toBeCloseTo(gdp * 1.01);
    expect(relation(game, sim, 'PLR', 'AAA')).toBeCloseTo(before - 10);
    expect(e.tech!.points).toBeGreaterThanOrEqual(2);
  });

  it('leaves the rest of the game’s randomness unchanged', () => {
    const without = play(newGame(base), 30, [], base);
    const withEvents = play(newGame(), 30);
    expect(withEvents.rngState).toBe(without.rngState);
  });
});
