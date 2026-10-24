// Commands are the only way the presentation layer (and later the AI) changes the game
// (GDD section 2). They take effect immediately when issued (money is spent at once, a building
// starts at once); the turn engine then advances everything they set in motion.
import { investmentQuote, printAmount, type SimContext } from './economy';
import {
  findPath,
  militaryRules,
  recruitQuote,
  startRecruitment,
  type RecruitMode,
  type UnitKind,
} from './military';
import type { GameState } from './newGame';
import {
  airDefenseQuote,
  launchDrones,
  launchMissiles,
  launchNuclear,
  startProduction,
  weaponsRules,
  type WeaponKind,
  type WeaponsError,
} from './weapons';
import { assimilationQuote } from './population';
import { alliesOf, enemiesAtWar } from './world';

export interface SetTaxCommand {
  type: 'setTax';
  countryId: string;
  rate: number;
}

export interface SetServicesCommand {
  type: 'setServices';
  countryId: string;
  share: number;
}

export interface PrintMoneyCommand {
  type: 'printMoney';
  countryId: string;
}

export interface InvestCommand {
  type: 'invest';
  countryId: string;
  cityIds: number[];
  category: string;
}

/** Assimilates the listed provinces ("Assimilate all" sends every eligible one). */
export interface AssimilateCommand {
  type: 'assimilate';
  countryId: string;
  provinceIds: number[];
}

/** Sends armies toward a province, one province per turn; entering enemy land attacks it. */
export interface MoveArmiesCommand {
  type: 'moveArmies';
  countryId: string;
  armyIds: number[];
  targetProvinceId: number;
}

/** Splits an army in two halves in the same province. */
export interface SplitArmyCommand {
  type: 'splitArmy';
  countryId: string;
  armyId: number;
}

/** Recruits in many cities: a fixed number per city or a percentage of each city's manpower. */
export interface RecruitCommand {
  type: 'recruit';
  countryId: string;
  cityIds: number[];
  kind: UnitKind;
  mode: RecruitMode;
  amount: number;
}

/** Introduces or abolishes mandatory military service. */
export interface SetServiceCommand {
  type: 'setService';
  countryId: string;
  enabled: boolean;
}

/** Declares war (simple until diplomacy, Phase 9). */
export interface DeclareWarCommand {
  type: 'declareWar';
  countryId: string;
  targetId: string;
}

/** Missiles hit the target city next turn (GDD section 9). */
export interface LaunchMissilesCommand {
  type: 'launchMissiles';
  countryId: string;
  targetCityId: number;
  tier: number;
  count: number;
}

/** Drones fly to the target province, one province per turn, and strike on arrival. */
export interface LaunchDronesCommand {
  type: 'launchDrones';
  countryId: string;
  targetProvinceId: number;
  tier: number;
  count: number;
}

export interface LaunchNuclearCommand {
  type: 'launchNuclear';
  countryId: string;
  targetCityId: number;
}

/** Orders missiles or drones from the country's factories. */
export interface ProduceWeaponsCommand {
  type: 'produceWeapons';
  countryId: string;
  weapon: WeaponKind;
  tier: number;
  count: number;
}

/** Builds or upgrades air defense in a city. */
export interface BuildAirDefenseCommand {
  type: 'buildAirDefense';
  countryId: string;
  cityId: number;
}

/** Starts a long and expensive nuclear weapons program. */
export interface StartNuclearProgramCommand {
  type: 'startNuclearProgram';
  countryId: string;
}

export type Command =
  | SetTaxCommand
  | SetServicesCommand
  | PrintMoneyCommand
  | InvestCommand
  | AssimilateCommand
  | MoveArmiesCommand
  | SplitArmyCommand
  | RecruitCommand
  | SetServiceCommand
  | DeclareWarCommand
  | LaunchMissilesCommand
  | LaunchDronesCommand
  | LaunchNuclearCommand
  | ProduceWeaponsCommand
  | BuildAirDefenseCommand
  | StartNuclearProgramCommand;

export type CommandError =
  | 'unknownCountry'
  | 'outOfRange'
  | 'unknownCategory'
  | 'noCities'
  | 'allRefused'
  | 'notEnoughMoney'
  | 'nothingToAssimilate'
  | 'unknownArmy'
  | 'noPath'
  | 'tooSmall'
  | 'nothingToRecruit'
  | 'needsBase'
  | 'invalidTarget'
  | 'alreadyAtWar'
  | 'allied'
  | WeaponsError;

export type CommandResult = { ok: true; state: GameState } | { ok: false; error: CommandError };

/** Applies a command to a copy of the state; the input state is never changed. */
export function applyCommand(
  previous: GameState,
  command: Command,
  ctx: SimContext,
): CommandResult {
  const economy = previous.economy.countries[command.countryId];
  if (!economy) return { ok: false, error: 'unknownCountry' };
  const limits = ctx.economy.limits;

  switch (command.type) {
    case 'setTax': {
      if (!(command.rate >= limits.taxRateMin && command.rate <= limits.taxRateMax))
        return { ok: false, error: 'outOfRange' };
      const state = structuredClone(previous);
      state.economy.countries[command.countryId]!.taxRate = command.rate;
      return { ok: true, state };
    }
    case 'setServices': {
      if (!(command.share >= limits.servicesShareMin && command.share <= limits.servicesShareMax)) {
        return { ok: false, error: 'outOfRange' };
      }
      const state = structuredClone(previous);
      state.economy.countries[command.countryId]!.servicesShare = command.share;
      return { ok: true, state };
    }
    case 'printMoney': {
      const state = structuredClone(previous);
      const e = state.economy.countries[command.countryId]!;
      const amount = printAmount(previous, command.countryId, ctx.economy);
      e.treasury += amount;
      e.printed += amount;
      return { ok: true, state };
    }
    case 'invest': {
      if (command.cityIds.length === 0) return { ok: false, error: 'noCities' };
      const quote = investmentQuote(
        previous,
        ctx,
        command.countryId,
        command.cityIds,
        command.category,
      );
      if (!quote) return { ok: false, error: 'unknownCategory' };
      if (quote.cities.length === 0) return { ok: false, error: 'noCities' };
      if (quote.buildable.length === 0) return { ok: false, error: 'allRefused' };
      if (!quote.affordable) return { ok: false, error: 'notEnoughMoney' };
      const state = structuredClone(previous);
      const e = state.economy.countries[command.countryId]!;
      e.treasury -= quote.totalCost;
      for (const city of quote.cities) {
        if (city.consent === 'refuses') continue;
        state.economy.buildings.push({
          id: state.economy.nextBuildingId++,
          category: quote.category.id,
          cityId: city.cityId,
          owner: command.countryId,
          host: city.host,
          costUsd: quote.category.costUsd,
          startedTurn: state.turn,
          completeTurn: state.turn + quote.category.buildTurns,
          completed: false,
        });
      }
      return { ok: true, state };
    }
    case 'assimilate': {
      const quote = assimilationQuote(previous, ctx, command.countryId, command.provinceIds);
      if (quote.provinceIds.length === 0) return { ok: false, error: 'nothingToAssimilate' };
      if (!quote.affordable) return { ok: false, error: 'notEnoughMoney' };
      const state = structuredClone(previous);
      state.economy.countries[command.countryId]!.treasury -= quote.totalCost;
      for (const p of quote.provinceIds)
        state.population.assimilateUntil[p] = state.turn + quote.turns;
      return { ok: true, state };
    }
    case 'moveArmies': {
      const state = structuredClone(previous);
      const armies = state.military.armies.filter(
        (a) =>
          command.armyIds.includes(a.id) &&
          a.owner === command.countryId &&
          a.arriveTurn === undefined,
      );
      if (armies.length === 0) return { ok: false, error: 'unknownArmy' };
      let moved = 0;
      for (const army of armies) {
        const path = findPath(state, ctx, army.owner, army.provinceId, command.targetProvinceId);
        if (!path) continue;
        army.path = path;
        moved++;
      }
      if (moved === 0) return { ok: false, error: 'noPath' };
      return { ok: true, state };
    }
    case 'splitArmy': {
      const state = structuredClone(previous);
      const army = state.military.armies.find(
        (a) => a.id === command.armyId && a.owner === command.countryId,
      );
      if (!army) return { ok: false, error: 'unknownArmy' };
      const regulars = Math.floor(army.regulars / 2);
      const special = Math.floor(army.special / 2);
      if (regulars + special < 1 || army.regulars + army.special - regulars - special < 1)
        return { ok: false, error: 'tooSmall' };
      army.regulars -= regulars;
      army.special -= special;
      state.military.armies.push({
        ...army,
        id: state.military.nextArmyId++,
        regulars,
        special,
        path: [...army.path],
      });
      return { ok: true, state };
    }
    case 'recruit': {
      if (command.cityIds.length === 0) return { ok: false, error: 'noCities' };
      if (!(command.amount > 0)) return { ok: false, error: 'outOfRange' };
      const quote = recruitQuote(
        previous,
        ctx,
        command.countryId,
        command.cityIds,
        command.kind,
        command.mode,
        command.amount,
      );
      if (quote.cities.length === 0)
        return { ok: false, error: command.kind === 'special' ? 'needsBase' : 'noCities' };
      if (quote.total === 0) return { ok: false, error: 'nothingToRecruit' };
      if (!quote.affordable) return { ok: false, error: 'notEnoughMoney' };
      const state = structuredClone(previous);
      startRecruitment(state, command.countryId, ctx, quote);
      return { ok: true, state };
    }
    case 'setService': {
      const m = previous.military.countries[command.countryId];
      if (!m) return { ok: false, error: 'unknownCountry' };
      const state = structuredClone(previous);
      const next = state.military.countries[command.countryId]!;
      if (command.enabled && !next.service) {
        // Introducing service is unpopular (GDD section 8).
        const penalty = militaryRules(ctx).reserves.introduceSupportPenalty;
        const country = state.world.countries.find((c) => c.id === command.countryId)!;
        for (const p of country.provinceIds)
          state.population.support[p] = Math.max(0, state.population.support[p]! - penalty);
      }
      next.service = command.enabled;
      return { ok: true, state };
    }
    case 'launchMissiles':
    case 'launchDrones':
    case 'launchNuclear':
    case 'produceWeapons': {
      const state = structuredClone(previous);
      const c = command;
      const error =
        c.type === 'launchMissiles'
          ? launchMissiles(state, ctx, c.countryId, c.targetCityId, c.tier, c.count)
          : c.type === 'launchDrones'
            ? launchDrones(state, ctx, c.countryId, c.targetProvinceId, c.tier, c.count)
            : c.type === 'launchNuclear'
              ? launchNuclear(state, ctx, c.countryId, c.targetCityId)
              : startProduction(state, ctx, c.countryId, c.weapon, c.tier, c.count);
      return error ? { ok: false, error } : { ok: true, state };
    }
    case 'buildAirDefense': {
      const quote = airDefenseQuote(previous, ctx, command.countryId, command.cityId);
      if (quote.allowed || !quote.level) return { ok: false, error: quote.allowed ?? 'maxLevel' };
      const state = structuredClone(previous);
      state.economy.countries[command.countryId]!.treasury -= quote.level.costUsd;
      state.weapons.airDefenseBuilds.push({
        owner: command.countryId,
        cityId: command.cityId,
        level: quote.level.level,
        readyTurn: state.turn + quote.level.buildTurns,
      });
      return { ok: true, state };
    }
    case 'startNuclearProgram': {
      const n = weaponsRules(ctx).nuclear;
      const a = previous.weapons.countries[command.countryId];
      if (!a) return { ok: false, error: 'unknownCountry' };
      if (a.warheads > 0) return { ok: false, error: 'hasNuclear' };
      if (a.nuclearProgramUntil >= 0) return { ok: false, error: 'programRunning' };
      if (economy.treasury < n.programCostUsd) return { ok: false, error: 'notEnoughMoney' };
      const state = structuredClone(previous);
      state.economy.countries[command.countryId]!.treasury -= n.programCostUsd;
      state.weapons.countries[command.countryId]!.nuclearProgramUntil = state.turn + n.programTurns;
      return { ok: true, state };
    }
    case 'declareWar': {
      const { countryId, targetId } = command;
      const target = previous.world.countries.find((c) => c.id === targetId);
      if (
        targetId === countryId ||
        !target ||
        target.provinceIds.length === 0 ||
        target.status === 'uninhabited'
      )
        return { ok: false, error: 'invalidTarget' };
      if (enemiesAtWar(previous.world, countryId).includes(targetId))
        return { ok: false, error: 'alreadyAtWar' };
      if (alliesOf(previous.world, countryId).includes(targetId))
        return { ok: false, error: 'allied' };
      const state = structuredClone(previous);
      state.world.wars.push({
        id: `war-${state.turn}-${countryId}-${targetId}`,
        sides: [[countryId], [targetId]],
      });
      return { ok: true, state };
    }
  }
}
