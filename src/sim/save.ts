// Save files: the whole game state as JSON with a format marker and version, so saves can move
// between devices (export/import) and old saves can be migrated when the format changes.
import type { GameState } from './newGame';

export const SAVE_FORMAT = 'modern-leader-save';
export const SAVE_VERSION = 1;

export interface SaveSummary {
  countryId: string;
  leaderName: string;
  turn: number;
  date: string;
}

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  /** When the save was written (ISO timestamp, from the device clock). */
  savedAt: string;
  summary: SaveSummary;
  game: GameState;
}

export type SaveError = 'notASave' | 'unsupportedVersion' | 'corrupt';
export type ParsedSave = { ok: true; save: SaveFile } | { ok: false; error: SaveError };

/** Upgrades older save versions step by step; empty until the format changes. */
const MIGRATIONS: Record<number, (save: SaveFile) => SaveFile> = {};

export function createSave(game: GameState, savedAt: string): SaveFile {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    savedAt,
    summary: {
      countryId: game.player.countryId,
      leaderName: game.player.leaderName,
      turn: game.turn,
      date: game.date,
    },
    game: structuredClone(game),
  };
}

export function serializeSave(save: SaveFile): string {
  return JSON.stringify(save);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Structural check of a game state; enough to refuse damaged or hand-edited files safely. */
export function isValidGameState(game: unknown): game is GameState {
  if (!isRecord(game)) return false;
  const { turn, date, seed, rngState, player, settings, world } = game;
  if (!Number.isInteger(turn) || (turn as number) < 0) return false;
  if (!isDate(date) || !Number.isInteger(seed) || !Number.isInteger(rngState)) return false;
  if (
    !isRecord(player) ||
    typeof player.countryId !== 'string' ||
    typeof player.leaderName !== 'string'
  ) {
    return false;
  }
  if (
    !isRecord(settings) ||
    typeof settings.aggressiveness !== 'string' ||
    typeof settings.disputedMode !== 'string'
  ) {
    return false;
  }
  if (!isRecord(world) || !isDate(world.startDate)) return false;
  const { countries, provinceOwners, alliances, rivalries, wars } = world;
  if (![countries, provinceOwners, alliances, rivalries, wars].every(Array.isArray)) return false;
  const ids = new Set<string>();
  for (const c of countries as unknown[]) {
    if (!isRecord(c) || typeof c.id !== 'string' || !Array.isArray(c.provinceIds)) return false;
    ids.add(c.id);
  }
  if (!(provinceOwners as unknown[]).every((o) => typeof o === 'string' && ids.has(o)))
    return false;
  const economy = game.economy;
  if (
    economy !== undefined &&
    (!isRecord(economy) || !isRecord(economy.countries) || !Array.isArray(economy.buildings))
  ) {
    return false;
  }
  const population = game.population;
  if (
    population !== undefined &&
    (!isRecord(population) ||
      !Array.isArray(population.support) ||
      population.support.length !== (provinceOwners as unknown[]).length)
  ) {
    return false;
  }
  const military = game.military;
  if (
    military !== undefined &&
    (!isRecord(military) ||
      !Array.isArray(military.armies) ||
      !Array.isArray(military.reservists) ||
      military.reservists.length !== (provinceOwners as unknown[]).length)
  ) {
    return false;
  }
  const playerCountry = (countries as { id: string; status: string }[]).find(
    (c) => c.id === player.countryId,
  );
  return playerCountry?.status === 'full';
}

export function parseSave(text: string): ParsedSave {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'notASave' };
  }
  if (!isRecord(data) || data.format !== SAVE_FORMAT) return { ok: false, error: 'notASave' };
  if (!Number.isInteger(data.version)) return { ok: false, error: 'corrupt' };
  let save = data as unknown as SaveFile;
  if (save.version > SAVE_VERSION) return { ok: false, error: 'unsupportedVersion' };
  while (save.version < SAVE_VERSION) {
    const migrate = MIGRATIONS[save.version];
    if (!migrate) return { ok: false, error: 'unsupportedVersion' };
    save = migrate(save);
  }
  if (!isValidGameState(save.game) || !isRecord(save.summary))
    return { ok: false, error: 'corrupt' };
  return { ok: true, save };
}
