// Summits (GDD section 12): a regular summit once a year (UN General Assembly, G20-style economic
// summit, regional summit, alliance summit) and emergency summits after major events. The player
// attends (answering 2-4 questions built from the current situation) or skips (lower relations,
// lost credibility, sometimes a resolution against the player). Numbers and answers are in
// data/modern/summits.json (SummitRules).
import { changeRelation, relation, sanctioned, type DiplomacyEvent } from './diplomacy';
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import { shiftSupport } from './population';
import { cityDistanceKm } from './weapons';
import { alliesOf, enemiesAtWar } from './world';
import type { TurnEvent } from './turn';
import { provinceSeat } from './military';

export type SummitKind = 'un' | 'g20' | 'regional' | 'alliance' | 'emergency';

export interface AnswerEffect {
  members?: number;
  hosts?: number;
  target?: number;
  rival?: number;
  side?: number;
  support?: number;
  credibility?: number;
  treasuryGdp?: number;
  /** The player joins sanctions on the question's country. */
  sanction?: boolean;
}

export interface SummitRules {
  regularEvery: number;
  firstTurn: number;
  rotation: SummitKind[];
  g20Size: number;
  regionalKm: number;
  emergency: { largePowers: number; minTurnsBetween: number };
  answerTurns: number;
  questions: { regular: number; emergency: number };
  skip: {
    members: number;
    hosts: number;
    credibility: number;
    resolutionSanctionsRelation: number;
    /** Support points lost at home. */
    support?: number;
  };
  templates: Record<string, Record<string, AnswerEffect>>;
}

export interface SummitQuestion {
  id: string;
  /** Live data for the template: country ids and numbers. */
  country?: string;
  rival?: string;
  side?: string;
  value?: number;
  answers: string[];
}

export interface Summit {
  id: number;
  kind: SummitKind;
  host: string;
  members: string[];
  turn: number;
  deadline: number;
  questions: SummitQuestion[];
  /** What triggered an emergency summit. */
  cause?: { kind: 'war' | 'nuclear' | 'revolution'; a: string; b?: string };
}

export interface SummitState {
  nextId: number;
  held: number;
  lastEmergency: number;
  pending: Summit | null;
}

export type SummitEvent =
  | { type: 'summitInvitation'; summitId: number }
  | { type: 'summitHeld'; kind: SummitKind; host: string; attended: boolean };

export function summitRules(ctx: SimContext): SummitRules {
  if (!ctx.summits) throw new Error('Summit rules missing from the simulation context');
  return ctx.summits;
}

export function emptySummits(): SummitState {
  return { nextId: 1, held: 0, lastEmergency: -1000, pending: null };
}

export function ensureSummits(state: GameState): GameState {
  if (state.summits) return state;
  return { ...state, summits: emptySummits() };
}

const live = (state: GameState): string[] =>
  state.world.countries
    .filter((c) => c.provinceIds.length > 0 && c.status !== 'uninhabited' && c.status !== 'rebels')
    .map((c) => c.id);

const byGdp = (state: GameState, ids: string[]): string[] =>
  [...ids].sort(
    (a, b) =>
      (state.economy.countries[b]?.gdp ?? 0) - (state.economy.countries[a]?.gdp ?? 0) ||
      (a < b ? -1 : 1),
  );

function capitalCity(state: GameState, ctx: SimContext, id: string): number {
  const c = state.world.countries.find((x) => x.id === id);
  return c ? provinceSeat(ctx, c.capitalProvinceId) : -1;
}

/** Who meets: everyone, the largest economies, the player's region or its alliance. */
function membersOf(state: GameState, ctx: SimContext, kind: SummitKind): string[] {
  const r = summitRules(ctx);
  const all = live(state);
  const player = state.player.countryId;
  if (kind === 'un') return all;
  if (kind === 'g20' || kind === 'emergency') return byGdp(state, all).slice(0, r.g20Size);
  if (kind === 'alliance') {
    const al = state.world.alliances
      .filter((a) => a.type !== 'vassal' && a.members.includes(player))
      .sort((a, b) => b.members.length - a.members.length)[0];
    return al ? al.members.filter((m) => all.includes(m)) : all;
  }
  const home = capitalCity(state, ctx, player);
  return all.filter((id) => {
    const c = capitalCity(state, ctx, id);
    return c >= 0 && home >= 0 && cityDistanceKm(ctx, home, c) <= r.regionalKm;
  });
}

function hostOf(state: GameState, kind: SummitKind, members: string[], year: number): string {
  const player = state.player.countryId;
  const candidates = byGdp(
    state,
    members.filter((m) => m !== player),
  );
  if (kind === 'un')
    return members.includes('USA') && 'USA' !== player ? 'USA' : (candidates[0] ?? player);
  if (kind === 'g20')
    return candidates[year % Math.max(1, Math.min(candidates.length, 20))] ?? player;
  return candidates[0] ?? player;
}

/** Questions from the current situation, most pressing first. */
function questionsFor(
  state: GameState,
  ctx: SimContext,
  count: number,
  cause?: Summit['cause'],
): SummitQuestion[] {
  const r = summitRules(ctx);
  const player = state.player.countryId;
  const answers = (id: string): string[] => Object.keys(r.templates[id] ?? {});
  const q: SummitQuestion[] = [];
  const push = (x: Omit<SummitQuestion, 'answers'>): void => {
    if (q.length < count && !q.some((y) => y.id === x.id)) q.push({ ...x, answers: answers(x.id) });
  };
  const enemies = enemiesAtWar(state.world, player);

  if (cause?.kind === 'revolution') push({ id: 'rebels', country: cause.a });
  if (cause?.kind === 'nuclear' && (state.weapons?.countries[player]?.warheads ?? 0) > 0)
    push({ id: 'noFirstUse' });

  // Our forces in someone else's land.
  const occupied = state.world.provinceOwners.findIndex(
    (o, p) =>
      o === player &&
      state.population?.culture[p] !== player &&
      enemies.includes(state.population?.culture[p] ?? ''),
  );
  const attacked = state.world.wars.find((w) => w.sides[0][0] === player);
  if (occupied >= 0) push({ id: 'occupation', country: state.population.culture[occupied] });
  else if (attacked) push({ id: 'occupation', country: attacked.sides[1][0] });

  const inflation = state.economy.countries[player]?.inflation ?? 0;
  if (inflation >= 0.1) push({ id: 'inflationAid', value: Math.round(inflation * 100) });

  // A war between a friend and a foe of the player.
  for (const w of state.world.wars) {
    if (w.sides[0].includes(player) || w.sides[1].includes(player)) continue;
    for (const [mine, theirs] of [
      [w.sides[0], w.sides[1]],
      [w.sides[1], w.sides[0]],
    ] as const) {
      const side = mine.find((x) => relation(state, ctx, player, x) >= 50);
      const rival = theirs.find((x) => relation(state, ctx, player, x) <= -30);
      if (side && rival) push({ id: 'weaponsAccusation', rival, side });
    }
  }

  // A call for a ceasefire in a war far from the player.
  const distant = state.world.wars.find(
    (w) =>
      !w.id.startsWith('revolution-') &&
      !w.sides[0].includes(player) &&
      !w.sides[1].includes(player),
  );
  if (distant?.sides[0][0] && distant.sides[1][0])
    push({ id: 'ceasefire', country: distant.sides[0][0], side: distant.sides[1][0] });

  // Joint sanctions on an aggressor (or the cause of an emergency summit).
  const aggressor =
    cause?.kind === 'war' || cause?.kind === 'nuclear'
      ? cause.a
      : state.world.wars
          .map((w) => w.sides[0][0])
          .find((a) => a && a !== player && !alliesOf(state.world, player).includes(a));
  if (aggressor && aggressor !== player && !sanctioned(state, player, aggressor))
    push({ id: 'jointSanctions', country: aggressor });
  if ((state.weapons?.countries[player]?.warheads ?? 0) > 0) push({ id: 'noFirstUse' });
  if ((state.weapons?.countries[player]?.nuclearProgramUntil ?? -1) > state.turn)
    push({ id: 'nuclearProgram' });
  push({ id: 'climate' });
  push({ id: 'trade' });
  push({ id: 'refugees' });
  return q;
}

function createSummit(
  state: GameState,
  ctx: SimContext,
  kind: SummitKind,
  cause?: Summit['cause'],
): Summit {
  const r = summitRules(ctx);
  const members = membersOf(state, ctx, kind);
  const year = Math.floor(state.turn / 52);
  const count = kind === 'emergency' ? r.questions.emergency : r.questions.regular;
  return {
    id: state.summits.nextId++,
    kind,
    host:
      kind === 'emergency' && cause
        ? (byGdp(
            state,
            members.filter((m) => m !== state.player.countryId && m !== cause.a && m !== cause.b),
          )[0] ?? cause.a)
        : hostOf(state, kind, members, year),
    members,
    turn: state.turn,
    deadline: state.turn + r.answerTurns,
    questions: questionsFor(state, ctx, count, cause),
    ...(cause ? { cause } : {}),
  };
}

function applyEffect(
  state: GameState,
  ctx: SimContext,
  s: Summit,
  q: SummitQuestion,
  e: AnswerEffect,
): void {
  const player = state.player.countryId;
  const group = (ids: (string | undefined)[], delta: number | undefined): void => {
    if (!delta) return;
    for (const id of ids) if (id && id !== player) changeRelation(state, ctx, player, id, delta);
  };
  group(s.members, e.members);
  group([s.host], e.hosts);
  group([q.country], e.target);
  group([q.rival], e.rival);
  group([q.side], e.side);
  if (e.support && state.population) {
    const country = state.world.countries.find((c) => c.id === player);
    for (const p of country?.provinceIds ?? [])
      state.population.support[p] = Math.max(
        0,
        Math.min(100, state.population.support[p]! + e.support),
      );
  }
  if (e.credibility && state.diplomacy)
    state.diplomacy.credibility[player] = Math.max(
      0,
      Math.min(100, (state.diplomacy.credibility[player] ?? 50) + e.credibility),
    );
  const econ = state.economy.countries[player];
  if (e.treasuryGdp && econ) econ.treasury += econ.gdp * e.treasuryGdp;
  if (e.sanction && q.country && !sanctioned(state, player, q.country) && state.diplomacy)
    state.diplomacy.sanctions.push({ from: player, to: q.country, since: state.turn });
}

function close(state: GameState, s: Summit): void {
  state.summits.pending = null;
  state.summits.held++;
  state.chronicle?.news.push({ turn: state.turn, kind: 'summit', a: s.host, extra: s.kind });
}

/** The player attends: one answer per question. */
export function attendSummit(
  state: GameState,
  ctx: SimContext,
  summitId: number,
  answers: readonly string[],
): boolean {
  const s = state.summits?.pending;
  if (!s || s.id !== summitId) return false;
  const r = summitRules(ctx);
  s.questions.forEach((q, i) => {
    const answer = answers[i] ?? q.answers[q.answers.length - 1]!;
    const effect = r.templates[q.id]?.[answer];
    if (effect) applyEffect(state, ctx, s, q, effect);
  });
  close(state, s);
  return true;
}

/** The player skips: lower relations, lost credibility, maybe a resolution against it. */
export function skipSummit(state: GameState, ctx: SimContext, summitId: number): boolean {
  const s = state.summits?.pending;
  if (!s || s.id !== summitId) return false;
  const r = summitRules(ctx).skip;
  const player = state.player.countryId;
  for (const m of s.members) if (m !== player) changeRelation(state, ctx, player, m, r.members);
  if (s.host !== player) changeRelation(state, ctx, player, s.host, r.hosts - r.members);
  if (state.diplomacy)
    state.diplomacy.credibility[player] = Math.max(
      0,
      (state.diplomacy.credibility[player] ?? 50) + r.credibility,
    );
  // The people notice an ignored summit (GDD section 7).
  if (r.support) shiftSupport(state, player, r.support);
  // An aggressor that does not show up faces a resolution: the hostile members sanction it.
  const aggressor =
    state.world.wars.some((w) => w.sides[0][0] === player) ||
    state.weapons?.countries[player]?.nuclearUser;
  if (aggressor && state.diplomacy) {
    for (const m of s.members) {
      if (m === player || sanctioned(state, m, player)) continue;
      if (relation(state, ctx, m, player) < r.resolutionSanctionsRelation)
        state.diplomacy.sanctions.push({ from: m, to: player, since: state.turn });
    }
  }
  close(state, s);
  return true;
}

/** Turn step 9: unanswered invitations lapse, regular and emergency summits are called. */
export function summitPhase(
  state: GameState,
  ctx: SimContext,
  events: readonly TurnEvent[],
  emit: (e: SummitEvent | DiplomacyEvent) => void,
): void {
  const r = summitRules(ctx);
  const s = state.summits;
  if (s.pending && state.turn >= s.pending.deadline) {
    const { kind, host, id } = s.pending;
    skipSummit(state, ctx, id);
    emit({ type: 'summitHeld', kind, host, attended: false });
  }
  if (s.pending) return;

  // Emergency: war between large powers, nuclear use or threat, a large country in revolution.
  const powers = new Set(byGdp(state, live(state)).slice(0, r.emergency.largePowers));
  let cause: Summit['cause'] | undefined;
  // New wars between large powers, the player's own declarations included (they happen as
  // commands before the turn, so they are found by their start turn, not by an event).
  for (const w of state.world.wars) {
    const started = state.diplomacy?.wars[w.id]?.startTurn ?? -Infinity;
    const [a, b] = [w.sides[0][0], w.sides[1][0]];
    if (started >= state.turn - 1 && a && b && powers.has(a) && powers.has(b))
      cause = { kind: 'war', a, b };
  }
  for (const e of events) {
    if (e.type === 'nuclearStrike' || e.type === 'nuclearThreat')
      cause = { kind: 'nuclear', a: e.type === 'nuclearStrike' ? e.attacker : e.from };
    if (e.type === 'revolution' && powers.has(e.countryId))
      cause = { kind: 'revolution', a: e.countryId };
  }
  if (cause && state.turn - s.lastEmergency >= r.emergency.minTurnsBetween) {
    s.lastEmergency = state.turn;
    s.pending = createSummit(state, ctx, 'emergency', cause);
  } else if (state.turn >= r.firstTurn && (state.turn - r.firstTurn) % r.regularEvery === 0) {
    let kind = r.rotation[s.held % r.rotation.length]!;
    const inAlliance = state.world.alliances.some(
      (a) => a.type !== 'vassal' && a.members.includes(state.player.countryId),
    );
    if (kind === 'alliance' && !inAlliance) kind = 'un';
    s.pending = createSummit(state, ctx, kind);
  }
  if (s.pending) emit({ type: 'summitInvitation', summitId: s.pending.id });
}
