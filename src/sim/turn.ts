// Turn engine: resolves one turn (one week) in the fixed order of GDD section 5, the same for
// the player and the AI. Pure and deterministic: same state + same commands = same result.
import { dateOfTurn, REPORT_INTERVAL } from './calendar';
import type { Command } from './commands';
import { constructionPhase, economyPhase, type EconomyEvent, type SimContext } from './economy';
import { battlePhase, movementPhase, trainingPhase, type MilitaryEvent } from './military';
import { aiMilitaryOrders, aiWeaponsOrders } from './ai';
import { aiPolicyOrders, type AiPolicyEvent } from './aiPolicy';
import { diplomacyPhase, type DiplomacyEvent } from './diplomacy';
import { resourcesPhase, type ResourcesEvent } from './resources';
import {
  convoyInterceptionPhase,
  droneMovementPhase,
  missileImpactPhase,
  weaponsProductionPhase,
  type WeaponsEvent,
} from './weapons';
import { cloneState, type GameState } from './newGame';
import { populationPhase, warSupportPhase, type PopulationEvent } from './population';
import { createRng, type Rng } from './rng';
import { buildReport, markReport, recordNews, type ReportData } from './chronicle';
import { goalsPhase, type GoalEvent } from './goals';
import { summitPhase, type SummitEvent } from './summits';

export type TurnPhaseId =
  | 'aiOrders'
  | 'missileImpacts'
  | 'movement'
  | 'battles'
  | 'construction'
  | 'economy'
  | 'population'
  | 'diplomacy'
  | 'events'
  | 'autosave';

/** Order of resolution (GDD section 5). Autosave is done by the presentation after the turn. */
export const TURN_PHASES: readonly TurnPhaseId[] = [
  'aiOrders',
  'missileImpacts',
  'movement',
  'battles',
  'construction',
  'economy',
  'population',
  'diplomacy',
  'events',
  'autosave',
];

export type TurnEvent =
  | EconomyEvent
  | PopulationEvent
  | MilitaryEvent
  | WeaponsEvent
  | DiplomacyEvent
  | ResourcesEvent
  | AiPolicyEvent
  | SummitEvent
  | GoalEvent
  /** The 10-turn general report (GDD section 12). */
  | { type: 'report'; turn: number; report: ReportData }
  /** A new year began. */
  | { type: 'newYear'; year: number };

export interface TurnContext {
  /** The state being built for the new turn; phases change it in place. */
  state: GameState;
  commands: readonly Command[];
  sim: SimContext;
  rng: Rng;
  events: TurnEvent[];
}

type Phase = (ctx: TurnContext) => void;

// Each system fills in its phase as it is built (Phase 5 economy, Phase 6 population, ...).
const PHASES: Record<TurnPhaseId, Phase> = {
  aiOrders: (ctx) => {
    // Policy first (budget, diplomacy, wars), then armies and weapons for the wars it leads to.
    if (ctx.sim.aiRules) aiPolicyOrders(ctx.state, ctx.sim, ctx.rng, (e) => ctx.events.push(e));
    if (ctx.sim.military) aiMilitaryOrders(ctx.state, ctx.sim);
    if (ctx.sim.weapons) aiWeaponsOrders(ctx.state, ctx.sim);
  },
  missileImpacts: (ctx) => {
    if (ctx.sim.weapons) missileImpactPhase(ctx.state, ctx.sim, ctx.rng, (e) => ctx.events.push(e));
  },
  movement: (ctx) => {
    if (ctx.sim.military) movementPhase(ctx.state, ctx.sim);
    if (ctx.sim.weapons) {
      droneMovementPhase(ctx.state, ctx.sim, ctx.rng, (e) => ctx.events.push(e));
      convoyInterceptionPhase(ctx.state, ctx.sim, (e) => ctx.events.push(e));
    }
  },
  battles: (ctx) => {
    if (ctx.sim.military) battlePhase(ctx.state, ctx.sim, ctx.rng, (e) => ctx.events.push(e));
  },
  construction: (ctx) => {
    constructionPhase(ctx.state, ctx.sim, (e) => ctx.events.push(e));
    if (ctx.sim.military) trainingPhase(ctx.state, ctx.sim, (e) => ctx.events.push(e));
    if (ctx.sim.weapons) weaponsProductionPhase(ctx.state, ctx.sim, (e) => ctx.events.push(e));
  },
  economy: (ctx) => {
    // Trade first: its income and shortages feed this week's budget and growth.
    if (ctx.sim.resources) resourcesPhase(ctx.state, ctx.sim, (e) => ctx.events.push(e));
    economyPhase(ctx.state, ctx.sim, (e) => ctx.events.push(e));
  },
  population: (ctx) => {
    if (ctx.sim.population) {
      warSupportPhase(ctx.state, ctx.sim, ctx.events);
      populationPhase(ctx.state, ctx.sim, ctx.rng, (e) => ctx.events.push(e));
    }
  },
  diplomacy: (ctx) => {
    if (ctx.sim.diplomacy)
      diplomacyPhase(ctx.state, ctx.sim, [...ctx.events], (e) => ctx.events.push(e));
  },
  events: (ctx) => {
    const { state, sim } = ctx;
    const push = (e: TurnEvent): void => void ctx.events.push(e);
    if (sim.summits) summitPhase(state, sim, [...ctx.events], push);
    if (sim.goals) goalsPhase(state, sim, push);
    recordNews(state, ctx.events);
    if (state.turn % REPORT_INTERVAL === 0) {
      ctx.events.push({ type: 'report', turn: state.turn, report: buildReport(state, sim) });
      markReport(state, sim);
    }
    const previousYear = Number(dateOfTurn(state.world.startDate, state.turn - 1).slice(0, 4));
    const year = Number(state.date.slice(0, 4));
    if (year !== previousYear) ctx.events.push({ type: 'newYear', year });
  },
  autosave: () => undefined,
};

export interface TurnResult {
  state: GameState;
  events: TurnEvent[];
  /** Phases in the order they ran (for tests and debugging). */
  phases: TurnPhaseId[];
}

/** Resolves the current turn and returns the state of the next one; the input is not changed. */
export function advanceTurn(
  previous: GameState,
  sim: SimContext,
  commands: readonly Command[] = [],
): TurnResult {
  const state = cloneState(previous);
  state.turn += 1;
  state.date = dateOfTurn(state.world.startDate, state.turn);
  const ctx: TurnContext = { state, commands, sim, rng: createRng(state.rngState), events: [] };
  const phases: TurnPhaseId[] = [];
  for (const id of TURN_PHASES) {
    PHASES[id](ctx);
    phases.push(id);
  }
  state.rngState = ctx.rng.state;
  return { state, events: ctx.events, phases };
}
