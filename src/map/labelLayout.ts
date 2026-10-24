// Pure label selection and placement; the Pixi side only draws the result.
import type { CountryData, ProvinceData } from './mapData';

export type LabelKind = 'country' | 'province' | 'city';

export interface LabelCandidate {
  key: string;
  text: string;
  kind: LabelKind;
  /** World (level-0 map) position of the label center. */
  wx: number;
  wy: number;
  fontSize: number;
  /** Draw a city dot under the label. */
  dot: boolean;
}

export interface PlacedLabel extends LabelCandidate {
  sx: number;
  sy: number;
  width: number;
  height: number;
}

export function estimateLabelWidth(text: string, fontSize: number, kind: LabelKind): number {
  const perChar = kind === 'country' ? 0.68 : 0.56;
  return text.length * fontSize * perChar;
}

/**
 * Greedy placement in priority order: a label is shown if it is on screen and does not overlap a
 * label placed before it.
 */
export function placeLabels(
  candidates: Iterable<LabelCandidate>,
  toScreen: (wx: number, wy: number) => [number, number],
  viewportWidth: number,
  viewportHeight: number,
  maxLabels: number,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const pad = 4;
  for (const c of candidates) {
    if (placed.length >= maxLabels) break;
    const [sx, sy] = toScreen(c.wx, c.wy);
    const width = estimateLabelWidth(c.text, c.fontSize, c.kind);
    const height = c.fontSize * 1.2;
    const cy = c.dot ? sy - height * 0.8 : sy;
    if (sx + width / 2 < 0 || sx - width / 2 > viewportWidth) continue;
    if (cy + height / 2 < 0 || cy - height / 2 > viewportHeight) continue;
    const overlaps = placed.some(
      (p) =>
        Math.abs(p.sx - sx) * 2 < p.width + width + pad * 2 &&
        Math.abs(p.sy - cy) * 2 < p.height + height + pad * 2,
    );
    if (overlaps) continue;
    placed.push({ ...c, sx, sy: cy, width, height });
  }
  return placed;
}

export interface CountryAnchor {
  countryId: string;
  wx: number;
  wy: number;
  /** Size of the country's largest connected land area in level-0 pixels. */
  pixels: number;
}

/**
 * Label anchor for each country: the pixel-weighted center of its largest connected group of
 * provinces, so overseas territories do not pull the label into the sea.
 */
export function countryAnchors(
  countries: CountryData[],
  provinces: ProvinceData[],
  mapWidth: number,
): CountryAnchor[] {
  const anchors: CountryAnchor[] = [];
  for (const country of countries) {
    const own = new Set(country.provinceIds);
    const seen = new Set<number>();
    let best: number[] = [];
    let bestPixels = -1;
    for (const start of country.provinceIds) {
      if (seen.has(start)) continue;
      const group: number[] = [];
      const queue = [start];
      seen.add(start);
      while (queue.length) {
        const id = queue.pop()!;
        group.push(id);
        for (const n of provinces[id]!.neighbors) {
          if (own.has(n) && !seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      const px = group.reduce((t, id) => t + provinces[id]!.pixels, 0);
      if (px > bestPixels) {
        bestPixels = px;
        best = group;
      }
    }
    // Average x relative to the first province so groups across the date line stay together.
    const ref = provinces[best[0]!]!.centroid[0];
    let sx = 0;
    let sy = 0;
    for (const id of best) {
      const p = provinces[id]!;
      let dx = p.centroid[0] - ref;
      if (dx > mapWidth / 2) dx -= mapWidth;
      if (dx < -mapWidth / 2) dx += mapWidth;
      sx += dx * p.pixels;
      sy += p.centroid[1] * p.pixels;
    }
    const wx = (((ref + sx / bestPixels) % mapWidth) + mapWidth) % mapWidth;
    anchors.push({ countryId: country.id, wx, wy: sy / bestPixels, pixels: bestPixels });
  }
  return anchors;
}
