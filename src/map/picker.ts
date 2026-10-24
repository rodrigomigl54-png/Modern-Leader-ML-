import { loadTileBitmap } from './tileLayer';
import { decodeProvince, type TileInfo, type TileLevel } from './tileMath';

/**
 * Finds the province under a world point by reading the full-resolution ID tile on the CPU.
 * Decoded tiles are cached (a few MB each), so repeated taps in one area are instant.
 */
export class ProvincePicker {
  private readonly cache = new Map<string, Promise<ImageData>>();

  constructor(
    private readonly level0: TileLevel,
    private readonly tileUrl: (file: string) => string,
    private readonly maxCached = 4,
  ) {}

  /** Province id at a level-0 world point, -1 for water, -2 for unowned land. */
  async pick(wx: number, wy: number): Promise<number> {
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    const tile = this.level0.tiles.find(
      (t) => x >= t.x && x < t.x + t.width && y >= t.y && y < t.y + t.height,
    );
    if (!tile) return -1;
    const data = await this.pixels(tile);
    const o = ((y - tile.y) * data.width + (x - tile.x)) * 4;
    return decodeProvince(data.data[o]!, data.data[o + 1]!, data.data[o + 2]!);
  }

  private pixels(tile: TileInfo): Promise<ImageData> {
    let entry = this.cache.get(tile.file);
    if (entry) {
      // Refresh its position in the LRU order.
      this.cache.delete(tile.file);
      this.cache.set(tile.file, entry);
      return entry;
    }
    entry = (async () => {
      const bitmap = await loadTileBitmap(this.tileUrl(tile.file));
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('2D canvas is not available');
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    })();
    this.cache.set(tile.file, entry);
    entry.catch(() => this.cache.delete(tile.file));
    while (this.cache.size > this.maxCached) this.cache.delete(this.cache.keys().next().value!);
    return entry;
  }
}
