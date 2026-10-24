// Creates the initial game state from the three setup choices (GDD section 3).
import { initEconomy, type EconomyState, type SimContext } from './economy';
import { emptyDiplomacy, initDiplomacy, type DiplomacyState } from './diplomacy';
import { emptyMilitary, initMilitary, type MilitaryState } from './military';
import { initPopulation, type PopulationState } from './population';
import { emptyWeapons, initWeapons, type WeaponsState } from './weapons';
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
  return {
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
  };
}
