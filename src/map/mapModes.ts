// Map modes decide the color of every province. Each mode is a pure function of the map data
// (later: of the simulation state), and the renderer writes its result into the palette texture.
import type { TranslationKey } from '../i18n';
import type { CountryData, ProvinceData } from './mapData';
import type { RGB } from './palette';
import { hexToRgb } from './palette';

export interface MapModeContext {
  provinces: ProvinceData[];
  countries: CountryData[];
}

export interface MapMode {
  id: string;
  nameKey: TranslationKey;
  /** Returns one color per province id. */
  colors(context: MapModeContext): RGB[];
}

/** Calm, slightly desaturated colors for the Night theme. Amber, red and green are reserved. */
export const COUNTRY_PALETTE = [
  '#5b7a8c',
  '#8c7f6a',
  '#6f6a8c',
  '#8c5f6e',
  '#5d8a80',
  '#868a5f',
  '#7a6f63',
  '#5f748f',
  '#8c705d',
  '#6d7f5c',
  '#856c86',
  '#6a8796',
].map(hexToRgb);
export const DISPUTED_COLOR = hexToRgb('#4a4f57');
export const UNINHABITED_COLOR = hexToRgb('#3b4552');

/**
 * Gives every country a palette color that differs from its land neighbors (greedy graph
 * coloring, largest countries first so they get the most distinct colors). Deterministic.
 */
export function assignCountryColors(context: MapModeContext): Map<string, RGB> {
  const neighbors = new Map<string, Set<string>>();
  const size = new Map<string, number>();
  for (const c of context.countries) {
    neighbors.set(c.id, new Set());
    size.set(c.id, 0);
  }
  for (const p of context.provinces) {
    size.set(p.owner, (size.get(p.owner) ?? 0) + p.pixels);
    for (const n of p.neighbors) {
      const other = context.provinces[n]!.owner;
      if (other !== p.owner) neighbors.get(p.owner)!.add(other);
    }
  }
  const order = [...context.countries].sort(
    (a, b) => size.get(b.id)! - size.get(a.id)! || (a.id < b.id ? -1 : 1),
  );
  const colorIndex = new Map<string, number>();
  for (const country of order) {
    const used = new Set<number>();
    for (const n of neighbors.get(country.id)!) {
      const i = colorIndex.get(n);
      if (i !== undefined) used.add(i);
    }
    let pick = 0;
    while (used.has(pick) && pick < COUNTRY_PALETTE.length - 1) pick++;
    colorIndex.set(country.id, pick);
  }

  const result = new Map<string, RGB>();
  for (const c of context.countries) {
    if (c.status === 'disputed') result.set(c.id, DISPUTED_COLOR);
    else if (c.status === 'uninhabited') result.set(c.id, UNINHABITED_COLOR);
    else result.set(c.id, COUNTRY_PALETTE[colorIndex.get(c.id)!]!);
  }
  return result;
}

/** Small, stable brightness variation so neighboring provinces of one country stay distinguishable. */
function vary([r, g, b]: RGB, id: number): RGB {
  const h = Math.imul(id + 1, 2654435761) >>> 0;
  const f = 1 + (((h >>> 8) % 1000) / 1000 - 0.5) * 0.08;
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return [c(r), c(g), c(b)];
}

export const politicalMode: MapMode = {
  id: 'political',
  nameKey: 'mapMode.political',
  colors(context) {
    const countryColors = assignCountryColors(context);
    return context.provinces.map((p) => vary(countryColors.get(p.owner)!, p.id));
  },
};

export const MAP_MODES: readonly MapMode[] = [politicalMode];
