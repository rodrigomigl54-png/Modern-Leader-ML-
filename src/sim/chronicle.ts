// The world's chronicle (GDD section 12): news headlines from the week's events and the general
// report every 10 turns. The simulation stores ids and numbers only; the presentation writes
// the headlines in the player's language.
import { relation } from './diplomacy';
import { weeklyBudget, type SimContext } from './economy';
import type { GameState } from './newGame';
import { nationalSupport } from './population';
import type { TurnEvent } from './turn';

export type NewsKind =
  | 'war'
  | 'warEnded'
  | 'warJoined'
  | 'peace'
  | 'conquered'
  | 'revolution'
  | 'revolutionWon'
  | 'secession'
  | 'nuclear'
  | 'sanctions'
  | 'globalSanctions'
  | 'alliance'
  | 'summit';

export interface NewsItem {
  turn: number;
  kind: NewsKind;
  /** Countries involved, in the order the headline names them. */
  a: string;
  b?: string;
  /** Extra id (summit kind, city id as text). */
  extra?: string;
}

export interface ReportData {
  turn: number;
  sinceTurn: number;
  gdp: number;
  gdpBefore: number;
  treasury: number;
  balance: number;
  debt: number;
  support: number;
  supportBefore: number;
  warsStarted: number;
  warsEnded: number;
  sanctions: number;
  alliances: number;
  /** Biggest changes of relations with the player. */
  relationChanges: { id: string; before: number; after: number }[];
}

export interface ChronicleState {
  news: NewsItem[];
  knownWars: string[];
  knownAlliances: string[];
  snapshot: {
    turn: number;
    gdp: number;
    support: number;
    relations: Record<string, number>;
  } | null;
}

const MAX_NEWS = 40;

export function emptyChronicle(state?: Pick<GameState, 'world'>): ChronicleState {
  return {
    news: [],
    knownWars: (state?.world.wars ?? []).map((w) => w.id),
    knownAlliances: (state?.world.alliances ?? []).map((a) => a.id),
    snapshot: null,
  };
}

/** Adds the chronicle to games saved before Phase 12. */
export function ensureChronicle(state: GameState): GameState {
  if (state.chronicle) return state;
  return { ...state, chronicle: emptyChronicle(state) };
}

function snapshot(state: GameState, ctx: SimContext): ChronicleState['snapshot'] {
  const id = state.player.countryId;
  const relations: Record<string, number> = {};
  for (const c of state.world.countries)
    if (c.id !== id) relations[c.id] = relation(state, ctx, id, c.id);
  return {
    turn: state.turn,
    gdp: state.economy.countries[id]?.gdp ?? 0,
    support: state.population ? nationalSupport(state, ctx, id) : 0,
    relations,
  };
}

/** Turns this week's events and changes into headlines. */
export function recordNews(state: GameState, events: readonly TurnEvent[]): void {
  const c = (state.chronicle ??= emptyChronicle());
  const add = (kind: NewsKind, a: string, b?: string, extra?: string): void => {
    c.news.push({ turn: state.turn, kind, a, ...(b ? { b } : {}), ...(extra ? { extra } : {}) });
  };
  const wars = new Set(state.world.wars.map((w) => w.id));
  for (const w of state.world.wars) {
    if (c.knownWars.includes(w.id) || w.id.startsWith('revolution-')) continue;
    add('war', w.sides[0][0] ?? '', w.sides[1][0]);
  }
  c.knownWars = [...wars];
  for (const al of state.world.alliances) {
    if (c.knownAlliances.includes(al.id) || al.type === 'vassal') continue;
    add('alliance', al.members[0] ?? '', al.members[1]);
  }
  c.knownAlliances = state.world.alliances.map((a) => a.id);
  for (const e of events) {
    switch (e.type) {
      case 'warJoined':
        add('warJoined', e.countryId, e.ally);
        break;
      case 'countryConquered':
        add('conquered', e.countryId, e.by);
        break;
      case 'revolution':
        add('revolution', e.countryId);
        break;
      case 'revolutionSucceeded':
        add('revolutionWon', e.countryId);
        break;
      case 'secession':
        add('secession', e.newCountryId, e.countryId);
        break;
      case 'nuclearStrike':
        add('nuclear', e.attacker, e.defender, String(e.cityId));
        break;
      case 'sanctionsImposed':
        add('sanctions', e.from, e.to);
        break;
      case 'globalSanctions':
        add('globalSanctions', e.countryId);
        break;
    }
  }
  if (c.news.length > MAX_NEWS) c.news = c.news.slice(-MAX_NEWS);
}

/** The general report (GDD section 12): what changed since the last one. */
export function buildReport(state: GameState, ctx: SimContext): ReportData {
  const c = (state.chronicle ??= emptyChronicle());
  const before = c.snapshot ?? snapshot(state, ctx)!;
  const now = snapshot(state, ctx)!;
  const id = state.player.countryId;
  const e = state.economy.countries[id];
  const since = c.news.filter((n) => n.turn > before.turn);
  const relationChanges = Object.entries(now.relations)
    .map(([other, after]) => ({ id: other, before: before.relations[other] ?? after, after }))
    .filter((x) => Math.abs(x.after - x.before) >= 5)
    .sort(
      (x, y) =>
        Math.abs(y.after - y.before) - Math.abs(x.after - x.before) || (x.id < y.id ? -1 : 1),
    )
    .slice(0, 3);
  return {
    turn: state.turn,
    sinceTurn: before.turn,
    gdp: now.gdp,
    gdpBefore: before.gdp,
    treasury: e?.treasury ?? 0,
    balance: e ? weeklyBudget(state, id, ctx).balance : 0,
    debt: e?.debt ?? 0,
    support: now.support,
    supportBefore: before.support,
    warsStarted: since.filter((n) => n.kind === 'war').length,
    warsEnded: since.filter((n) => n.kind === 'peace' || n.kind === 'conquered').length,
    sanctions: since.filter((n) => n.kind === 'sanctions' || n.kind === 'globalSanctions').length,
    alliances: since.filter((n) => n.kind === 'alliance').length,
    relationChanges,
  };
}

/** Remembers the state the next report compares with. */
export function markReport(state: GameState, ctx: SimContext): void {
  (state.chronicle ??= emptyChronicle()).snapshot = snapshot(state, ctx);
}
