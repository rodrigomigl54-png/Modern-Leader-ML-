// Country goals (GDD section 13): 3-5 goals per country chosen from its situation at the start
// (grow the economy, avoid riots, keep inflation and debt low, join or stay in an alliance, or
// stay neutral). Templates and numbers are in data/modern/goals.json (GoalRules).
import { changeRelation, relation } from './diplomacy';
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import { nationalSupport, shiftSupport } from './population';
import { trait } from './profiles';
import { rankings } from './rankings';
import { levelCostUsd } from './technology';
import { alliesOf } from './world';

export interface GoalRules {
  gdpGrowth: { factor: number; turns: number };
  noRiots: { turns: number; minSupportMargin: number };
  lowInflation: { max: number; streak: number; turns: number };
  lowDebt: { maxShare: number; turns: number };
  joinAlliance: { turns: number };
  stayInAlliance: { turns: number };
  neutrality: { maxLoyalty: number; turns: number };
  /** Player objectives (master plan, phase 6); absent in older data. */
  buildings?: { count: number; turns: number };
  techLevels?: { levels: number; turns: number };
  rank?: { climb: number; turns: number };
  /** Goals up to shortMax weeks are short-term, up to mediumMax medium-term, longer long-term. */
  terms?: { shortMax: number; mediumMax: number };
  rewards?: {
    /** Countries at least this friendly (and allies) gain relations. */
    friendRelation: number;
  } & Record<GoalTerm, GoalReward>;
}

export type GoalTerm = 'short' | 'medium' | 'long';

export interface GoalReward {
  support: number;
  relation: number;
  techPoints: number;
  diplomacyPoints: number;
}

export type GoalKind =
  | 'gdpGrowth'
  | 'noRiots'
  | 'lowInflation'
  | 'lowDebt'
  | 'joinAlliance'
  | 'stayInAlliance'
  | 'neutrality'
  | 'buildings'
  | 'techLevels'
  | 'rank';

export interface Goal {
  kind: GoalKind;
  deadline: number;
  status: 'active' | 'done' | 'failed';
  /** GDP target, buildings to have finished, technology level or rank to reach. */
  target?: number;
  /** How long the goal runs (weeks), for its term; older saves derive it. */
  turns?: number;
  allianceId?: string;
  streak?: number;
}

export type GoalEvent = { type: 'goalDone' | 'goalFailed'; kind: GoalKind };

export function goalRules(ctx: SimContext): GoalRules {
  if (!ctx.goals) throw new Error('Goal rules missing from the simulation context');
  return ctx.goals;
}

const inAlliance = (state: GameState, id: string): string | undefined =>
  state.world.alliances
    .filter((a) => a.type !== 'vassal' && a.members.includes(id))
    .sort((a, b) => b.members.length - a.members.length)[0]?.id;

/** A country's goals at the start of a game (the player's by default). */
export function createGoals(
  state: GameState,
  ctx: SimContext,
  id: string = state.player.countryId,
): Goal[] {
  const r = goalRules(ctx);
  const e = state.economy.countries[id];
  const at = (turns: number): number => state.turn + turns;
  const goals: Goal[] = [
    {
      kind: 'gdpGrowth',
      deadline: at(r.gdpGrowth.turns),
      status: 'active',
      target: (e?.gdp ?? 0) * r.gdpGrowth.factor,
    },
  ];
  // Calm countries aim to stay calm; a country already near riots gets other goals.
  const calm =
    !ctx.population ||
    nationalSupport(state, ctx, id) >= ctx.population.riots.threshold + r.noRiots.minSupportMargin;
  if (calm) goals.push({ kind: 'noRiots', deadline: at(r.noRiots.turns), status: 'active' });
  const alliance = inAlliance(state, id);
  if (alliance)
    goals.push({
      kind: 'stayInAlliance',
      deadline: at(r.stayInAlliance.turns),
      status: 'active',
      allianceId: alliance,
    });
  else if (trait(state, ctx, id, 'loyalty') <= r.neutrality.maxLoyalty)
    goals.push({ kind: 'neutrality', deadline: at(r.neutrality.turns), status: 'active' });
  else goals.push({ kind: 'joinAlliance', deadline: at(r.joinAlliance.turns), status: 'active' });
  goals.push({
    kind: 'lowInflation',
    deadline: at(r.lowInflation.turns),
    status: 'active',
    streak: 0,
  });
  if (e && e.debt / Math.max(1, e.gdp) > r.lowDebt.maxShare / 2)
    goals.push({ kind: 'lowDebt', deadline: at(r.lowDebt.turns), status: 'active' });
  if (id === state.player.countryId) goals.push(...playerObjectives(state, ctx, id));
  return goals;
}

const finishedBuildings = (state: GameState, id: string): number =>
  state.economy.buildings.filter((b) => b.owner === id && b.completed).length;

const powerRank = (state: GameState, ctx: SimContext, id: string): number =>
  rankings(state, ctx, 'power').find((x) => x.countryId === id)?.rank ?? 0;

/**
 * The player's short-, medium- and long-term objectives (master plan, phase 6): finish
 * buildings, reach a higher technology level, climb the world power ranking. AI countries keep
 * their own goals only, so their behavior does not change.
 */
export function playerObjectives(state: GameState, ctx: SimContext, id: string): Goal[] {
  const r = goalRules(ctx);
  const goals: Goal[] = [];
  const at = (turns: number): number => state.turn + turns;
  if (r.buildings)
    goals.push({
      kind: 'buildings',
      deadline: at(r.buildings.turns),
      turns: r.buildings.turns,
      status: 'active',
      target: finishedBuildings(state, id) + r.buildings.count,
    });
  const tech = state.economy.countries[id]?.tech;
  if (r.techLevels && tech)
    goals.push({
      kind: 'techLevels',
      deadline: at(r.techLevels.turns),
      turns: r.techLevels.turns,
      status: 'active',
      target: tech.levels + r.techLevels.levels,
    });
  const rank = powerRank(state, ctx, id);
  if (r.rank && rank > 1) {
    // Climb some places; near the top, become a great power (top 8), then one of the top 3.
    const target =
      rank <= 3 ? 1 : rank <= 8 ? 3 : rank <= 20 ? 8 : Math.max(20, rank - r.rank.climb);
    goals.push({
      kind: 'rank',
      deadline: at(r.rank.turns),
      turns: r.rank.turns,
      status: 'active',
      target,
    });
  }
  return goals;
}

/** How long a goal runs, in weeks. */
export function goalTurns(ctx: SimContext, g: Goal): number {
  if (g.turns) return g.turns;
  const r = goalRules(ctx) as unknown as Record<string, { turns?: number } | undefined>;
  return r[g.kind]?.turns ?? 260;
}

/** Short-, medium- or long-term. */
export function goalTerm(ctx: SimContext, g: Goal): GoalTerm {
  const t = goalRules(ctx).terms;
  const turns = goalTurns(ctx, g);
  if (!t) return 'long';
  return turns <= t.shortMax ? 'short' : turns <= t.mediumMax ? 'medium' : 'long';
}

/** What finishing a goal gives the player (none in older data). */
export function goalReward(ctx: SimContext, g: Goal): GoalReward | null {
  return goalRules(ctx).rewards?.[goalTerm(ctx, g)] ?? null;
}

/** Gives the reward of a finished goal: support, relations with friends, technology, points. */
export function grantReward(state: GameState, ctx: SimContext, id: string, g: Goal): void {
  const reward = goalReward(ctx, g);
  const rules = goalRules(ctx).rewards;
  if (!reward || !rules) return;
  if (state.population) shiftSupport(state, id, reward.support);
  if (ctx.diplomacy && state.diplomacy) {
    const allies = new Set(alliesOf(state.world, id));
    for (const c of state.world.countries) {
      if (c.id === id || c.provinceIds.length === 0) continue;
      if (allies.has(c.id) || relation(state, ctx, id, c.id) >= rules.friendRelation)
        changeRelation(state, ctx, id, c.id, reward.relation);
    }
    state.diplomacy.points[id] = (state.diplomacy.points[id] ?? 0) + reward.diplomacyPoints;
  }
  const tech = state.economy.countries[id]?.tech;
  if (tech) tech.points += reward.techPoints;
}

/** Goals of every AI country (GDD section 13: each country has 3-5 goals). */
export function createAiGoals(state: GameState, ctx: SimContext): Record<string, Goal[]> {
  const result: Record<string, Goal[]> = {};
  for (const c of state.world.countries)
    if (c.id !== state.player.countryId && c.status === 'full' && c.provinceIds.length > 0)
      result[c.id] = createGoals(state, ctx, c.id);
  return result;
}

/** Adds goals to games saved before they existed. */
export function ensureGoals(state: GameState, ctx: SimContext): GameState {
  if (Array.isArray(state.goals) && state.aiGoals) {
    // Saves from before the player objectives get them now (master plan, phase 6).
    const objectives: GoalKind[] = ['buildings', 'techLevels', 'rank'];
    if (!ctx.goals?.buildings || state.goals.some((g) => objectives.includes(g.kind))) return state;
    return {
      ...state,
      goals: [...state.goals, ...playerObjectives(state, ctx, state.player.countryId)],
    };
  }
  const next = { ...state, goals: state.goals ?? [], aiGoals: state.aiGoals ?? {} };
  if (ctx.goals && !Array.isArray(state.goals)) next.goals = createGoals(next, ctx);
  if (ctx.goals && !state.aiGoals) next.aiGoals = createAiGoals(next, ctx);
  return next;
}

/** Progress toward a goal, 0-1. */
export function goalProgress(
  state: GameState,
  ctx: SimContext,
  g: Goal,
  id: string = state.player.countryId,
): number {
  const r = goalRules(ctx);
  const e = state.economy.countries[id];
  if (g.status !== 'active') return g.status === 'done' ? 1 : 0;
  switch (g.kind) {
    case 'gdpGrowth': {
      const start = (g.target ?? 1) / r.gdpGrowth.factor;
      return Math.max(
        0,
        Math.min(1, ((e?.gdp ?? 0) - start) / Math.max(1, (g.target ?? 1) - start)),
      );
    }
    case 'lowInflation':
      return Math.min(1, (g.streak ?? 0) / r.lowInflation.streak);
    case 'buildings': {
      const need = r.buildings?.count ?? 1;
      const left = (g.target ?? 0) - finishedBuildings(state, id);
      return Math.max(0, Math.min(1, 1 - left / need));
    }
    case 'techLevels': {
      const need = r.techLevels?.levels ?? 1;
      const tech = e?.tech;
      if (!tech) return 0;
      // Levels still missing, less the share of the next level already paid for.
      const rules = ctx.economy.technology;
      const next = rules ? levelCostUsd(rules, tech, e?.gdp ?? 1) : Infinity;
      const left = (g.target ?? 0) - tech.levels - Math.min(1, tech.progress / next);
      return Math.max(0, Math.min(1, 1 - left / need));
    }
    case 'rank': {
      const rank = powerRank(state, ctx, id);
      return rank <= (g.target ?? 1) ? 1 : Math.max(0, Math.min(1, (g.target ?? 1) / rank));
    }
    default: {
      // Goals kept until the deadline: the share of the time already held.
      const total =
        (g.kind === 'noRiots'
          ? r.noRiots.turns
          : g.kind === 'lowDebt'
            ? r.lowDebt.turns
            : r.stayInAlliance.turns) || 1;
      return Math.max(0, Math.min(1, 1 - (g.deadline - state.turn) / total));
    }
  }
}

/** Turn step 9: checks the goals of the player (with events) and of every AI country. */
export function goalsPhase(state: GameState, ctx: SimContext, emit: (e: GoalEvent) => void): void {
  checkGoals(state, ctx, state.player.countryId, state.goals, emit);
  for (const [id, goals] of Object.entries(state.aiGoals ?? {}))
    checkGoals(state, ctx, id, goals, () => undefined);
}

function checkGoals(
  state: GameState,
  ctx: SimContext,
  id: string,
  goals: Goal[],
  emit: (e: GoalEvent) => void,
): void {
  const r = goalRules(ctx);
  const e = state.economy.countries[id];
  const country = state.world.countries.find((c) => c.id === id);
  for (const g of goals) {
    if (g.status !== 'active') continue;
    const finish = (status: 'done' | 'failed'): void => {
      g.status = status;
      if (status === 'done' && id === state.player.countryId) grantReward(state, ctx, id, g);
      emit({ type: status === 'done' ? 'goalDone' : 'goalFailed', kind: g.kind });
    };
    const expired = state.turn >= g.deadline;
    switch (g.kind) {
      case 'gdpGrowth':
        if ((e?.gdp ?? 0) >= (g.target ?? Infinity)) finish('done');
        else if (expired) finish('failed');
        break;
      case 'noRiots':
        if ((country?.provinceIds ?? []).some((p) => (state.population?.riotTurns[p] ?? 0) > 0))
          finish('failed');
        else if (expired) finish('done');
        break;
      case 'lowInflation':
        g.streak = (e?.inflation ?? 1) <= r.lowInflation.max ? (g.streak ?? 0) + 1 : 0;
        if (g.streak >= r.lowInflation.streak) finish('done');
        else if (expired) finish('failed');
        break;
      case 'lowDebt':
        if (expired)
          finish(e && e.debt / Math.max(1, e.gdp) <= r.lowDebt.maxShare ? 'done' : 'failed');
        break;
      case 'joinAlliance':
        if (inAlliance(state, id)) finish('done');
        else if (expired) finish('failed');
        break;
      case 'stayInAlliance':
        if (!state.world.alliances.some((a) => a.id === g.allianceId && a.members.includes(id)))
          finish('failed');
        else if (expired) finish('done');
        break;
      case 'neutrality':
        if (state.world.alliances.some((a) => a.type === 'alliance' && a.members.includes(id)))
          finish('failed');
        else if (expired) finish('done');
        break;
      case 'buildings':
        if (finishedBuildings(state, id) >= (g.target ?? Infinity)) finish('done');
        else if (expired) finish('failed');
        break;
      case 'techLevels':
        if ((e?.tech?.levels ?? 0) >= (g.target ?? Infinity)) finish('done');
        else if (expired) finish('failed');
        break;
      case 'rank': {
        const rank = powerRank(state, ctx, id);
        if (rank > 0 && rank <= (g.target ?? 0)) finish('done');
        else if (expired) finish('failed');
        break;
      }
    }
  }
}
