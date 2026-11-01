// The player's history for the charts in the economy panel (Dario, Phase 26): GDP, treasury,
// support, provinces, technology and world rank, recorded every few weeks.
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import { nationalSupport } from './population';
import { rankings } from './rankings';
import { techIndex } from './technology';

export interface HistoryPoint {
  turn: number;
  gdp: number;
  treasury: number;
  support: number;
  provinces: number;
  tech: number;
  /** Place in the world power ranking. */
  rank: number;
}

/** A point is recorded every EVERY turns; the oldest ones go beyond MAX points. */
export const HISTORY_EVERY = 4;
const MAX = 400;

export function historyPoint(state: GameState, ctx: SimContext): HistoryPoint {
  const id = state.player.countryId;
  const e = state.economy.countries[id];
  const country = state.world.countries.find((c) => c.id === id);
  const tech = ctx.economy.technology;
  return {
    turn: state.turn,
    gdp: e?.gdp ?? 0,
    treasury: e?.treasury ?? 0,
    support: ctx.population ? nationalSupport(state, ctx, id) : 0,
    provinces: country?.provinceIds.length ?? 0,
    tech: tech && e?.tech ? techIndex(tech, e.tech) : 0,
    rank: rankings(state, ctx, 'power').find((r) => r.countryId === id)?.rank ?? 0,
  };
}

/** Turn step 9: records the player's numbers every few weeks. */
export function historyPhase(state: GameState, ctx: SimContext): void {
  if (state.turn % HISTORY_EVERY !== 0) return;
  const history = (state.history ??= []);
  history.push(historyPoint(state, ctx));
  if (history.length > MAX) history.splice(0, history.length - MAX);
}
