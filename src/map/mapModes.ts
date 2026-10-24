// Map modes decide the color of every province. Each mode is a pure function of the map data
// (later: of the simulation state), and the renderer writes its result into the palette texture.
import type { TranslationKey } from '../i18n';
import type { CountryStatus } from '../sim/world';
import type { ProvinceData } from './mapData';
import type { RGB } from './palette';
import { hexToRgb } from './palette';

export interface MapModeContext {
  provinces: ProvinceData[];
  /** Countries that exist in the current game (after the disputed-territories setting). */
  countries: { id: string; status: CountryStatus }[];
  /** Current owner per province id. */
  owners: string[];
  /** The player's country (or the one being chosen), drawn in the signature amber. */
  focusCountry: string | null;
  /** Public support per province id (0-100), or null outside a game. */
  support: readonly number[] | null;
  /** Air-defense coverage per province: 0 none, 1 own, 2 ally, 3 enemy, 4 other. */
  airDefense?: Uint8Array | null;
  /** Relation of every country toward the player (-100..100). */
  relations?: ReadonlyMap<string, number> | null;
  /** Alliance (index) each country belongs to, for the alliances map mode. */
  blocs?: ReadonlyMap<string, number> | null;
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
export const FOCUS_COLOR = hexToRgb('#f2a93b');
/** Red is reserved for danger (GDD section 13): rebels are drawn in a dark red. */
export const REBEL_COLOR = hexToRgb('#7a2e2e');

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
    const owner = context.owners[p.id]!;
    size.set(owner, (size.get(owner) ?? 0) + p.pixels);
    for (const n of p.neighbors) {
      const other = context.owners[n]!;
      if (other !== owner) neighbors.get(owner)!.add(other);
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
    else if (c.status === 'rebels') result.set(c.id, REBEL_COLOR);
    else result.set(c.id, COUNTRY_PALETTE[colorIndex.get(c.id)!]!);
  }
  return result;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as RGB;
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
    const focus = mix(
      countryColors.get(context.focusCountry ?? '') ?? FOCUS_COLOR,
      FOCUS_COLOR,
      0.55,
    );
    return context.provinces.map((p) => {
      const owner = context.owners[p.id]!;
      return vary(owner === context.focusCountry ? focus : countryColors.get(owner)!, p.id);
    });
  },
};

const SUPPORT_LOW = hexToRgb('#b4453c');
const SUPPORT_MID = hexToRgb('#5d636b');
const SUPPORT_HIGH = hexToRgb('#4e9a5e');

/** Color of a support value: red (0) through grey (50) to green (100). */
export function supportColor(support: number): RGB {
  const v = Math.max(0, Math.min(100, support)) / 50;
  return v < 1 ? mix(SUPPORT_LOW, SUPPORT_MID, v) : mix(SUPPORT_MID, SUPPORT_HIGH, v - 1);
}

/** Public support per province (GDD section 7); rebel land in dark red. */
export const supportMode: MapMode = {
  id: 'support',
  nameKey: 'mapMode.support',
  colors(context) {
    const status = new Map(context.countries.map((c) => [c.id, c.status]));
    return context.provinces.map((p) => {
      const s = status.get(context.owners[p.id]!);
      if (s === 'rebels') return REBEL_COLOR;
      if (s === 'uninhabited') return UNINHABITED_COLOR;
      const value = context.support?.[p.id];
      return value === undefined ? SUPPORT_MID : supportColor(value);
    });
  },
};

const COVER_NONE = hexToRgb('#3a414b');
const COVER = [
  COVER_NONE,
  hexToRgb('#3f8f84'),
  hexToRgb('#4d7fa0'),
  hexToRgb('#a04a42'),
  hexToRgb('#6b7480'),
];

/** Air-defense coverage (GDD section 9): who protects each province. */
export const airDefenseMode: MapMode = {
  id: 'airDefense',
  nameKey: 'mapMode.airDefense',
  colors(context) {
    return context.provinces.map((p) => vary(COVER[context.airDefense?.[p.id] ?? 0]!, p.id));
  },
};

const RELATION_BAD = hexToRgb('#b4453c');
const RELATION_GOOD = hexToRgb('#4e9a5e');

/** Relations toward the player (GDD section 13): green friends, red enemies. */
export const relationsMode: MapMode = {
  id: 'relations',
  nameKey: 'mapMode.relations',
  colors(context) {
    return context.provinces.map((p) => {
      const owner = context.owners[p.id]!;
      if (owner === context.focusCountry) return FOCUS_COLOR;
      const r = context.relations?.get(owner);
      if (r === undefined) return SUPPORT_MID;
      const v = Math.max(-100, Math.min(100, r)) / 100;
      return vary(
        v < 0 ? mix(SUPPORT_MID, RELATION_BAD, -v) : mix(SUPPORT_MID, RELATION_GOOD, v),
        p.id,
      );
    });
  },
};

const BLOC_COLORS = [
  '#4d7fa0',
  '#a04a42',
  '#7a6aa0',
  '#3f8f84',
  '#a08a42',
  '#8c5f6e',
  '#5d8a80',
  '#868a5f',
].map(hexToRgb);

/** Alliances (GDD section 13): each alliance or pact in its own color. */
export const alliancesMode: MapMode = {
  id: 'alliances',
  nameKey: 'mapMode.alliances',
  colors(context) {
    return context.provinces.map((p) => {
      const bloc = context.blocs?.get(context.owners[p.id]!);
      return vary(bloc === undefined ? COVER_NONE : BLOC_COLORS[bloc % BLOC_COLORS.length]!, p.id);
    });
  },
};

export const MAP_MODES: readonly MapMode[] = [
  politicalMode,
  supportMode,
  relationsMode,
  alliancesMode,
  airDefenseMode,
];
