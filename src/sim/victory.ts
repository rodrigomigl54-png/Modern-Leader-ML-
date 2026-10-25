// The end of a game: the player wins by ruling the whole world (every inhabited province) and
// loses when the enemy or the rebels take the last province (military.ts, population.ts).
import type { GameState } from './newGame';

/** Turn step 9: the player who owns every inhabited province has won. */
export function victoryPhase(state: GameState): void {
  if (state.gameOver) return;
  const uninhabited = new Set(
    state.world.countries.filter((c) => c.status === 'uninhabited').map((c) => c.id),
  );
  const player = state.player.countryId;
  const owners = state.world.provinceOwners;
  if (owners.every((owner) => owner === player || uninhabited.has(owner)))
    state.gameOver = { reason: 'victory', turn: state.turn };
}
