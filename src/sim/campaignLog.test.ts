import { describe, expect, it } from 'vitest';
import { emptyLog, logEntry, MAX_LOG, recordLog } from './campaignLog';
import type { GameState } from './newGame';
import type { TurnEvent } from './turn';

/** Just the parts of a game the log reads. */
const game = (): GameState =>
  ({
    turn: 5,
    player: { countryId: 'AAA', leaderName: 'Ana' },
    world: {
      wars: [{ id: 'old', sides: [['BBB'], ['CCC']] }],
      alliances: [],
    },
    economy: {
      buildings: [
        { id: 1, category: 'factory', owner: 'AAA' },
        { id: 2, category: 'factory', owner: 'AAA' },
        { id: 3, category: 'hospital', owner: 'BBB' },
      ],
    },
  }) as unknown as GameState;

describe('campaign log', () => {
  it('starts with the start of the campaign and knows the wars already going on', () => {
    const g = game();
    g.log = emptyLog(g);
    expect(g.log.entries).toEqual([{ turn: 5, category: 'national', kind: 'start', a: 'AAA' }]);
    recordLog(g, []);
    expect(g.log.entries).toHaveLength(1);
  });

  it('records new wars, the player’s land and peace, and sums up battles and buildings', () => {
    const g = game();
    g.log = emptyLog(g);
    g.turn = 6;
    g.world.wars.push({ id: 'new', sides: [['AAA'], ['DDD']] } as never);
    const events: TurnEvent[] = [
      {
        type: 'battle',
        provinceId: 1,
        attacker: 'AAA',
        defender: 'DDD',
        winner: 'attacker',
        attackerLosses: 1,
        defenderLosses: 2,
      },
      {
        type: 'battle',
        provinceId: 2,
        attacker: 'AAA',
        defender: 'DDD',
        winner: 'defender',
        attackerLosses: 1,
        defenderLosses: 2,
      },
      {
        type: 'battle',
        provinceId: 3,
        attacker: 'BBB',
        defender: 'CCC',
        winner: 'attacker',
        attackerLosses: 1,
        defenderLosses: 2,
      },
      { type: 'provinceCaptured', provinceId: 7, from: 'DDD', to: 'AAA' },
      { type: 'provinceCaptured', provinceId: 8, from: 'CCC', to: 'BBB' },
      { type: 'buildingCompleted', buildingId: 1, owner: 'AAA' },
      { type: 'buildingCompleted', buildingId: 2, owner: 'AAA' },
      { type: 'buildingCompleted', buildingId: 3, owner: 'BBB' },
      { type: 'peace', a: 'BBB', b: 'CCC' },
    ];
    recordLog(g, events);
    const kinds = g.log.entries.slice(1).map((e) => [e.turn, e.category, e.kind, e.n, e.m]);
    expect(kinds).toEqual([
      [6, 'war', 'war', undefined, undefined],
      [6, 'territory', 'provinceTaken', 7, undefined],
      [6, 'peace', 'peace', undefined, undefined],
      [6, 'war', 'battles', 1, 1],
      [6, 'economy', 'buildings', 2, undefined],
    ]);
    // Recorded once: the next week the war is no longer new.
    recordLog(g, []);
    expect(g.log.entries).toHaveLength(6);
  });

  it('keeps the start entry and the latest entries when full', () => {
    const g = game();
    g.log = emptyLog(g);
    for (let i = 0; i < MAX_LOG + 50; i++)
      logEntry(g, { category: 'economy', kind: 'inflation', n: i });
    expect(g.log.entries).toHaveLength(MAX_LOG);
    expect(g.log.entries[0]!.kind).toBe('start');
    expect(g.log.entries.at(-1)!.n).toBe(MAX_LOG + 49);
  });

  it('starts a log for games saved without one', () => {
    const g = game();
    recordLog(g, [{ type: 'riotsStarted', countryId: 'AAA', provinces: 2 }]);
    expect(g.log!.entries.map((e) => e.kind)).toEqual(['start', 'riots']);
  });
});
