export interface TileInfo {
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TileLevel {
  level: number;
  scale: number;
  width: number;
  height: number;
  tiles: TileInfo[];
}

/**
 * Picks the pyramid level whose texels are closest to one device pixel.
 * deviceScale = device pixels per level-0 map pixel.
 */
export function chooseLevel(deviceScale: number, levelCount: number): number {
  const ideal = Math.round(Math.log2(1 / Math.max(deviceScale, 1e-6)));
  return Math.min(levelCount - 1, Math.max(0, ideal));
}

/** Tiles of a level that overlap a world (level-0) rectangle, plus a margin in tiles. */
export function visibleTiles(
  level: TileLevel,
  rect: [number, number, number, number],
  margin = 0,
): TileInfo[] {
  const [x0, y0, x1, y1] = rect;
  return level.tiles.filter((t) => {
    const tx0 = t.x * level.scale;
    const ty0 = t.y * level.scale;
    const pad = margin * t.width * level.scale;
    return (
      tx0 + t.width * level.scale + pad > x0 &&
      tx0 - pad < x1 &&
      ty0 + t.height * level.scale + pad > y0 &&
      ty0 - pad < y1
    );
  });
}

/**
 * Decodes a province-map pixel. Returns the province id, or -1 for water and -2 for unowned land.
 */
export function decodeProvince(r: number, g: number, b: number): number {
  if (b > 127) return -2;
  const label = r + 256 * g;
  return label === 0 ? -1 : label - 1;
}
