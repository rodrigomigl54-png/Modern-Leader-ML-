import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG_PATH = join(ROOT, 'tools', 'map', 'config.json');
export const DATA_DIR = join(ROOT, 'data', 'modern');
export const MAP_DIR = join(DATA_DIR, 'map');

export interface PipelineConfig {
  naturalEarth: { version: string; baseUrl: string; files: string[] };
  raster: { width: number; tileSize: number; levels: number; latNorth: number; latSouth: number };
  owners: {
    sovereignCodes: Record<string, string>;
    overrides: Record<string, string>;
    overrideNotes: Record<string, string>;
    unownedLand: string[];
  };
  carve: { country: string; from: string; disputedArea: string }[];
  carveThresholds: { wholeShare: number; ignoreShare: number; ignoreKm2: number };
  statuses: { unMembers: string[]; extraFull: string[]; disputed: string[]; uninhabited: string[] };
  capitals: Record<string, string>;
  cityRenames: Record<string, string>;
  extraCities: { name: string; lonLat: [number, number]; population: number; source: string }[];
  sea: {
    coarseFactor: number;
    minNavigableKm2: number;
    portMaxKm: number;
    portPromoteMaxKm: number;
    forcedWater: { name: string; path: [number, number][] }[];
  };
}

export function loadConfig(): PipelineConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as PipelineConfig;
}

export function cacheDir(config: PipelineConfig): string {
  return join(ROOT, 'tools', '.cache', 'natural-earth', config.naturalEarth.version);
}
