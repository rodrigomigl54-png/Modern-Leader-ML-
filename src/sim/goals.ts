// Country goals (GDD section 13): 3-5 goals per country chosen from its situation at the start
// (grow the economy, avoid riots, keep inflation and debt low, join or stay in an alliance, or
// stay neutral). Templates and numbers are in data/modern/goals.json (GoalRules).
import type { SimContext } from './economy';
import type { GameState } from './newGame';
import { nationalSupport } from './population';
import { trait } from './profiles';

export interface GoalRules {
  gdpGrowth: { factor: number; turns: number };
  noRiots: { turns: number; minSupportMargin: number };
  lowInflation: { max: number; streak: number; turns: number };
  lowDebt: { maxShare: number; turns: number };
  joinAlliance: { turns: number };
  stayInAlliance: { turns: number };
  neutrality: { maxLoyalty: number; turns: number };
}

export type GoalKind =
  | 'gdpGrowth'
  | 'noRiots'
  | 'lowInflation'
  | 'lowDebt'
  | 'joinAlliance'
  | 'stayInAlliance'
  | 'neutrality';

export interface Goal {
  kind: GoalKind;
  deadline: number;
  status: 'active' | 'done' | 'failed';
  /** GDP target, alliance id, or the current streak (turns). */
  target?: number;
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
  return goals;
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
  if (Array.isArray(state.goals) && state.aiGoals) return state;
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
    }
  }
}
