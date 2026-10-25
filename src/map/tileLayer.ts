import { Container, ImageSource, Mesh, MeshGeometry, type Shader } from 'pixi.js';
import type { ProvinceShaderShared } from './provinceShader';
import { chooseLevel, visibleTiles, type TileInfo, type TileLevel } from './tileMath';

interface LoadedTile {
  level: TileLevel;
  tile: TileInfo;
  mesh: Mesh<MeshGeometry, Shader>;
  source: ImageSource;
  lastUsed: number;
}

/** Decodes a tile PNG exactly (no color management, no premultiplication). */
export async function loadTileBitmap(url: string): Promise<ImageBitmap> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
  return createImageBitmap(await response.blob(), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
}

/**
 * Shows the province map as tiles from the pyramid. The coarsest level is always loaded as a
 * base; finer tiles are loaded for the visible area only and evicted when the cache is full,
 * so a phone never holds the full-resolution map in GPU memory.
 */
export class TileLayer {
  readonly container = new Container();
  private readonly baseLayer = new Container();
  private readonly detailLayer = new Container();
  private readonly loaded = new Map<string, LoadedTile>();
  private readonly loading = new Set<string>();
  private frame = 0;
  currentLevel: number;

  constructor(
    private readonly levels: TileLevel[],
    private readonly tileUrl: (file: string) => string,
    private readonly shared: ProvinceShaderShared,
    private readonly onTileLoaded: () => void,
    private readonly maxDetailTiles = 24,
    private readonly maxParallelLoads = 4,
  ) {
    this.currentLevel = levels.length - 1;
    this.detailLayer.sortableChildren = true;
    this.container.addChild(this.baseLayer, this.detailLayer);
  }

  async loadBase(onProgress: (fraction: number) => void): Promise<void> {
    const level = this.levels[this.levels.length - 1]!;
    let done = 0;
    await Promise.all(
      level.tiles.map(async (tile) => {
        await this.load(level, tile, this.baseLayer);
        onProgress(++done / level.tiles.length);
      }),
    );
  }

  /** rect: visible world rectangle; deviceScale: device pixels per level-0 map pixel. */
  update(rect: [number, number, number, number], deviceScale: number): void {
    this.frame++;
    const coarsest = this.levels.length - 1;
    this.currentLevel = chooseLevel(deviceScale, this.levels.length);

    const wanted = new Set<string>();
    if (this.currentLevel < coarsest) {
      const level = this.levels[this.currentLevel]!;
      for (const tile of visibleTiles(level, rect, 0.25)) {
        wanted.add(tile.file);
        if (!this.loaded.has(tile.file) && !this.loading.has(tile.file)) {
          if (this.loading.size < this.maxParallelLoads) void this.loadDetail(level, tile);
        }
      }
    }

    // Show the wanted tiles plus any loaded coarser detail tiles in view as a fallback while the
    // finer ones load; finer tiles than needed are hidden.
    const inView = (t: LoadedTile): boolean =>
      visibleTiles({ ...t.level, tiles: [t.tile] }, rect).length > 0;
    for (const [file, t] of this.loaded) {
      if (t.mesh.parent !== this.detailLayer) continue;
      const show = wanted.has(file) || (t.level.level > this.currentLevel && inView(t));
      t.mesh.visible = show;
      if (show) t.lastUsed = this.frame;
    }
    this.evict(wanted);
  }

  private async loadDetail(level: TileLevel, tile: TileInfo): Promise<void> {
    try {
      await this.load(level, tile, this.detailLayer);
    } catch (error) {
      console.warn(error);
    }
  }

  private async load(level: TileLevel, tile: TileInfo, parent: Container): Promise<void> {
    this.loading.add(tile.file);
    try {
      const bitmap = await loadTileBitmap(this.tileUrl(tile.file));
      const source = new ImageSource({
        resource: bitmap,
        scaleMode: 'nearest',
        alphaMode: 'no-premultiply-alpha',
        autoGenerateMipmaps: false,
      });
      const s = level.scale;
      const x0 = tile.x * s;
      const y0 = tile.y * s;
      const x1 = (tile.x + tile.width) * s;
      const y1 = (tile.y + tile.height) * s;
      const geometry = new MeshGeometry({
        positions: new Float32Array([x0, y0, x1, y0, x1, y1, x0, y1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });
      const mesh = new Mesh({ geometry, shader: this.shared.createTileShader(source, s) });
      // Finer levels draw on top of coarser ones.
      mesh.zIndex = this.levels.length - level.level;
      parent.addChild(mesh);
      this.loaded.set(tile.file, { level, tile, mesh, source, lastUsed: this.frame });
      this.onTileLoaded();
    } finally {
      this.loading.delete(tile.file);
    }
  }

  private evict(wanted: Set<string>): void {
    const detail = [...this.loaded.entries()].filter(([, t]) => t.mesh.parent === this.detailLayer);
    if (detail.length <= this.maxDetailTiles) return;
    detail.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [file, t] of detail.slice(0, detail.length - this.maxDetailTiles)) {
      if (wanted.has(file)) continue;
      // Take the bitmap before destroying its texture (that clears the reference), and destroy
      // the tile's own shader so no shader keeps the destroyed texture bound.
      const bitmap = t.source.resource as ImageBitmap | null;
      const shader = t.mesh.shader;
      const geometry = t.mesh.geometry;
      t.mesh.destroy({ children: true });
      shader?.destroy();
      geometry.destroy();
      t.source.destroy();
      bitmap?.close?.();
      this.loaded.delete(file);
    }
  }
}
