// Commands are the only way the presentation layer (and later the AI) changes the game
// (GDD section 2). They take effect immediately when issued (money is spent at once, a building
// starts at once); the turn engine then advances everything they set in motion.
import { investmentQuote, printAmount, type SimContext } from './economy';
import type { GameState } from './newGame';
import { assimilationQuote } from './population';

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

export type Command =
  SetTaxCommand | SetServicesCommand | PrintMoneyCommand | InvestCommand | AssimilateCommand;

export type CommandError =
  | 'unknownCountry'
  | 'outOfRange'
  | 'unknownCategory'
  | 'noCities'
  | 'allRefused'
  | 'notEnoughMoney'
  | 'nothingToAssimilate';

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
  }
}
