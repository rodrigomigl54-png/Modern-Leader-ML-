// Random events (master plan, phase 5): now and then a country faces a boom, a recession, a
// strike, a flood, a border incident... and picks one of two answers with clear effects. The AI
// answers at once by the options' weights; the player answers in a small panel (a command).
// Rules and texts' ids are in data/modern/events.json. Events use their own random stream, so
// the rest of the game's randomness (battles, the AI) is the same as without them.
import { logEntry } from './campaignLog';
import { changeRelation } from './diplomacy';
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import { nationalSupport, shiftSupport } from './population';
import { createRng, type Rng } from './rng';
import { enemiesAtWar } from './world';

export type EventCategory =
  'economic' | 'social' | 'political' | 'disaster' | 'military' | 'diplomatic' | 'technology';

export interface EventEffects {
  /** Share of GDP gained (+) or lost (-). */
  gdp?: number;
  /** Share of GDP paid into (+) or out of (-) the treasury. */
  treasury?: number;
  /** Support points in every province. */
  support?: number;
  /** Added to inflation (0.01 = one percentage point). */
  inflation?: number;
  /** Relations with the other country of the event. */
  relation?: number;
  techPoints?: number;
  diplomacyPoints?: number;
}

export interface EventOption {
  effects: EventEffects;
  /** How likely the AI is to pick this option. */
  aiWeight: number;
}

export interface EventDefinition {
  id: string;
  category: EventCategory;
  weight: number;
  when?: {
    /** Needs a neighboring country (the other side of the event). */
    neighbor?: boolean;
    /** Only at war (true) or only at peace (false). */
    atWar?: boolean;
    /** Only while national support is at most this. */
    maxSupport?: number;
  };
  options: EventOption[];
}

export interface EventRules {
  chancePerWeek: number;
  minGapWeeks: number;
  repeatGapWeeks: number;
  events: EventDefinition[];
}

/** An event waiting for the player's answer. */
export interface PendingEvent {
  eventId: string;
  turn: number;
  /** The other country of the event, if any. */
  other?: string;
}

export interface EventsState {
  /** Own random stream (see the file comment). */
  rng: number;
  pending: PendingEvent | null;
  /** Week of each country's last event. */
  last: Record<string, number>;
  /** Week each country last had each event. */
  seen: Record<string, Record<string, number>>;
}

export type RandomEventEvent =
  | { type: 'randomEvent'; countryId: string; eventId: string; other?: string }
  | { type: 'eventAnswered'; countryId: string; eventId: string; option: number };

export function emptyEvents(seed: number): EventsState {
  return { rng: (seed ^ 0x5bd1e995) >>> 0, pending: null, last: {}, seen: {} };
}

/** The neighbors of a country (land borders), sorted. */
function neighborsOf(state: GameState, ctx: SimContext, id: string): string[] {
  const owners = state.world.provinceOwners;
  const land = ctx.provinceNeighbors ?? [];
  const result = new Set<string>();
  const country = state.world.countries.find((c) => c.id === id);
  for (const p of country?.provinceIds ?? [])
    for (const q of land[p] ?? []) {
      const o = owners[q]!;
      if (o !== id && state.world.countries.some((c) => c.id === o && c.provinceIds.length > 0))
        result.add(o);
    }
  return [...result].sort();
}

function eligible(
  state: GameState,
  ctx: SimContext,
  id: string,
  e: EventDefinition,
  neighbors: string[],
): boolean {
  const w = e.when ?? {};
  if (w.neighbor && neighbors.length === 0) return false;
  if (w.atWar !== undefined && w.atWar !== enemiesAtWar(state.world, id).length > 0) return false;
  if (
    w.maxSupport !== undefined &&
    state.population &&
    nationalSupport(state, ctx, id) > w.maxSupport
  )
    return false;
  return true;
}

function pick<T>(rng: Rng, items: T[], weight: (x: T) => number): T | undefined {
  const total = items.reduce((s, x) => s + Math.max(0, weight(x)), 0);
  if (total <= 0) return undefined;
  let r = rng.next() * total;
  for (const x of items) {
    r -= Math.max(0, weight(x));
    if (r < 0) return x;
  }
  return items.at(-1);
}

/** Applies an option's effects to a country. */
export function applyEffects(
  state: GameState,
  ctx: SimContext,
  id: string,
  effects: EventEffects,
  other?: string,
): void {
  const e = state.economy.countries[id];
  if (!e) return;
  const gdp = e.gdp;
  if (effects.gdp) e.gdp *= 1 + effects.gdp;
  if (effects.treasury) e.treasury += effects.treasury * gdp;
  if (effects.inflation) e.inflation += effects.inflation;
  if (effects.support && state.population) shiftSupport(state, id, effects.support);
  if (effects.relation && other && ctx.diplomacy && state.diplomacy)
    changeRelation(state, ctx, id, other, effects.relation);
  if (effects.techPoints && e.tech) e.tech.points = Math.max(0, e.tech.points + effects.techPoints);
  if (effects.diplomacyPoints && state.diplomacy)
    state.diplomacy.points[id] = Math.max(
      0,
      (state.diplomacy.points[id] ?? 0) + effects.diplomacyPoints,
    );
}

export function eventRules(ctx: SimContext): EventRules | undefined {
  return ctx.events;
}

/**
 * The player answers the pending event: its option's effects apply and the History records it.
 * Returns false when there is no such event or option.
 */
export function answerEvent(state: GameState, ctx: SimContext, option: number): boolean {
  const ev = state.randomEvents;
  const pending = ev?.pending;
  const def = pending && eventRules(ctx)?.events.find((e) => e.id === pending.eventId);
  const chosen = def?.options[option];
  if (!ev || !pending || !def || !chosen) return false;
  applyEffects(state, ctx, state.player.countryId, chosen.effects, pending.other);
  ev.pending = null;
  logEntry(state, {
    category: 'national',
    kind: 'event',
    extra: def.id,
    n: option,
    ...(pending.other ? { a: pending.other } : {}),
  });
  return true;
}

/** Turn step 9: new events for every country; the AI answers at once. */
export function randomEventsPhase(
  state: GameState,
  ctx: SimContext,
  emit: (e: RandomEventEvent) => void,
): void {
  const rules = eventRules(ctx);
  if (!rules) return;
  const ev = (state.randomEvents ??= emptyEvents(state.rngState));
  const rng = createRng(ev.rng);
  const player = state.player.countryId;
  // An event the player left unanswered for a week takes its first option.
  if (ev.pending && state.turn - ev.pending.turn >= 1) answerEvent(state, ctx, 0);
  for (const country of state.world.countries) {
    const id = country.id;
    if (country.status !== 'full' || country.provinceIds.length === 0) continue;
    // Draw for every country every week, so one country's events never shift another's.
    const roll = rng.next();
    if (state.turn - (ev.last[id] ?? -Infinity) < rules.minGapWeeks) continue;
    if (id === player && ev.pending) continue;
    if (roll >= rules.chancePerWeek) continue;
    const neighbors = neighborsOf(state, ctx, id);
    const seen = ev.seen[id] ?? {};
    const options = rules.events.filter(
      (e) =>
        state.turn - (seen[e.id] ?? -Infinity) >= rules.repeatGapWeeks &&
        eligible(state, ctx, id, e, neighbors),
    );
    const def = pick(rng, options, (e) => e.weight);
    if (!def) continue;
    const other = def.when?.neighbor ? neighbors[rng.int(0, neighbors.length - 1)] : undefined;
    ev.last[id] = state.turn;
    (ev.seen[id] ??= {})[def.id] = state.turn;
    if (id === player) {
      ev.pending = { eventId: def.id, turn: state.turn, ...(other ? { other } : {}) };
      emit({ type: 'randomEvent', countryId: id, eventId: def.id, ...(other ? { other } : {}) });
      continue;
    }
    const choice = pick(
      rng,
      def.options.map((o, i) => ({ o, i })),
      (x) => x.o.aiWeight,
    );
    if (choice) {
      applyEffects(state, ctx, id, choice.o.effects, other);
      emit({ type: 'eventAnswered', countryId: id, eventId: def.id, option: choice.i });
    }
  }
  ev.rng = rng.state;
}
