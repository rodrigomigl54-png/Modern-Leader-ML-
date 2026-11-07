// Border changes for the end-of-game timelapse (Dario, idea 8). Every change of a province's
// owner is logged as [turn, province, previous owner]: only the changes, so even a long game
// stays small in the save. Any past map is the current one with the later changes undone.
import type { GameState } from './newGame';

/** [turn, province id, owner before the change]. */
export type BorderChange = [number, number, string];

/** The oldest changes are dropped beyond this; the replay then starts later. */
export const MAX_BORDER_LOG = 20000;

/** Logs a change of owner (called by transferProvince, the one place owners change). */
export function recordBorderChange(state: GameState, provinceId: number, from: string): void {
  const log = (state.borderLog ??= []);
  log.push([state.turn, provinceId, from]);
  if (log.length > MAX_BORDER_LOG) log.splice(0, log.length - MAX_BORDER_LOG);
}

export interface BorderFrame {
  turn: number;
  /** Owner country id per province id at the end of the turn. */
  owners: string[];
}

/**
 * The map at most `steps + 1` moments from the start (after the scenario's own setup at turn 0,
 * or the oldest change still logged) to now, in order. Empty when the borders never changed.
 */
export function borderReplay(state: GameState, steps: number): BorderFrame[] {
  const log = state.borderLog ?? [];
  const changes = log.filter((c) => c[0] > 0);
  if (changes.length === 0) return [];
  const first = Math.max(0, changes[0]![0] - 1);
  const last = state.turn;
  const span = Math.max(1, last - first);
  const n = Math.max(1, Math.min(steps, span));
  const turns: number[] = [];
  for (let i = 0; i <= n; i++) turns.push(Math.round(first + (span * i) / n));
  // Walk back from now, undoing the changes made after each frame's turn.
  const owners = [...state.world.provinceOwners];
  let next = log.length - 1;
  const frames: BorderFrame[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    while (next >= 0 && log[next]![0] > turn) {
      const [, p, from] = log[next]!;
      owners[p] = from;
      next--;
    }
    frames.push({ turn, owners: [...owners] });
  }
  return frames.reverse();
}
