// Creates the initial game state from the three setup choices (GDD section 3).
import { initEconomy, type EconomyState, type SimContext } from './economy';
import { emptyDiplomacy, initDiplomacy, type DiplomacyState } from './diplomacy';
import { emptyMilitary, initMilitary, type MilitaryState } from './military';
import { initPopulation, type PopulationState } from './population';
import { emptyResources, initResources, resourcesPhase, type ResourcesState } from './resources';
import { emptyWeapons, initWeapons, type WeaponsState } from './weapons';
import { emptyChronicle, markReport, type ChronicleState } from './chronicle';
import { createGoals, type Goal } from './goals';
import { emptySummits, type SummitState } from './summits';
import { applyDisputedSetting, type Aggressiveness, type DisputedMode, type World } from './world';

export const LEADER_NAME_MAX = 40;

export interface NewGameOptions {
  aggressiveness: Aggressiveness;
  disputedMode: DisputedMode;
  countryId: string;
  leaderName: string;
  /** Seed for all randomness in this game. */
  seed: number;
}

export interface GameState {
  version: 1;
  seed: number;
  /** Seeded random generator state; advances deterministically every turn. */
  rngState: number;
  /** Turns played; turn 0 is the start date. */
  turn: number;
  date: string;
  settings: { aggressiveness: Aggressiveness; disputedMode: DisputedMode };
  player: { countryId: string; leaderName: string };
  world: World;
  economy: EconomyState;
  population: PopulationState;
  military: MilitaryState;
  weapons: WeaponsState;
  diplomacy: DiplomacyState;
  resources: ResourcesState;
  /** News headlines and the snapshot for the next general report. */
  chronicle: ChronicleState;
  summits: SummitState;
  /** The player's goals (GDD section 13). */
  goals: Goal[];
  /** Set when the player's government has fallen or the country was conquered. */
  gameOver?: { reason: 'revolution' | 'conquered'; turn: number };
}

export type NewGameError = 'invalidLeaderName' | 'countryNotPlayable';

export function normalizeLeaderName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

export function validateNewGame(world: World, options: NewGameOptions): NewGameError | null {
  const name = normalizeLeaderName(options.leaderName);
  if (name.length === 0 || name.length > LEADER_NAME_MAX) return 'invalidLeaderName';
  const effective = applyDisputedSetting(world, options.disputedMode);
  const country = effective.countries.find((c) => c.id === options.countryId);
  if (country?.status !== 'full') return 'countryNotPlayable';
  return null;
}

export function createNewGame(world: World, options: NewGameOptions, sim: SimContext): GameState {
  const error = validateNewGame(world, options);
  if (error) throw new Error(`Cannot start a new game: ${error}`);
  const effective = applyDisputedSetting(world, options.disputedMode);
  const leaderName = normalizeLeaderName(options.leaderName);
  const economy = initEconomy(effective, sim.economy);
  if (!sim.population) throw new Error('Population rules missing from the simulation context');
  const population = initPopulation({ world: effective }, sim.population);
  const military = sim.military
    ? initMilitary({ world: effective, economy }, sim)
    : emptyMilitary(effective, sim);
  const weapons = sim.weapons ? initWeapons({ world: effective, economy }, sim) : emptyWeapons(sim);
  const game: GameState = {
    version: 1,
    seed: options.seed >>> 0,
    rngState: options.seed >>> 0,
    turn: 0,
    date: effective.startDate,
    settings: { aggressiveness: options.aggressiveness, disputedMode: options.disputedMode },
    player: { countryId: options.countryId, leaderName },
    world: {
      ...effective,
      // The player replaces the current leader; everyone else keeps theirs.
      countries: effective.countries.map((c) =>
        c.id === options.countryId ? { ...c, leader: { ...c.leader, name: leaderName } } : c,
      ),
    },
    economy,
    population,
    military,
    weapons,
    diplomacy: sim.diplomacy
      ? initDiplomacy({ world: effective, turn: 0, economy }, sim)
      : emptyDiplomacy(),
    resources: emptyResources({ world: effective }),
    chronicle: emptyChronicle({ world: effective }),
    summits: emptySummits(),
    goals: [],
  };
  if (sim.resources) {
    game.resources = initResources(game, sim);
    resourcesPhase(game, sim, () => undefined, false);
  }
  if (sim.goals) game.goals = createGoals(game, sim);
  markReport(game, sim);
  return game;
}

/** Deep copy of plain data (objects, arrays, primitives), as saves hold. */
function copyData<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    const n = value.length;
    const out = new Array<unknown>(n);
    for (let i = 0; i < n; i++) {
      const x: unknown = value[i];
      out[i] = typeof x === 'object' && x !== null ? copyData(x) : x;
    }
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const x = (value as Record<string, unknown>)[key];
    out[key] = typeof x === 'object' && x !== null ? copyData(x) : x;
  }
  return out as T;
}

/**
 * Copies a state for the next turn or a command. The state is plain data, so a direct copy
 * is several times faster than structuredClone (most of it is long arrays of numbers).
 */
export function cloneState(state: GameState): GameState {
  return copyData(state);
}
