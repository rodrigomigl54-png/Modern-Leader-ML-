// Coarse water grid used for coastal checks, ports and the draft sea-route graph.

import { drawLine } from './raster.ts';
import { WATER } from './borders.ts';
import type { MillerProjection, Position } from './geo.ts';

export interface ForcedWater {
  name: string;
  path: Position[];
}

export class WaterGrid {
  readonly factor: number;
  readonly width: number;
  readonly height: number;
  /** 1 where the coarse cell contains water. */
  readonly water: Uint8Array;
  /** Component index per cell (-1 for land). */
  readonly component: Int32Array;
  readonly componentAreaKm2: number[] = [];
  readonly navigable: Uint8Array;
  /** Cell width and height in km per coarse row. */
  readonly cellWidthKm: Float64Array;
  readonly cellHeightKm: Float64Array;

  constructor(
    labels: Uint16Array,
    rasterWidth: number,
    rasterHeight: number,
    projection: MillerProjection,
    factor: number,
    forced: ForcedWater[],
    minNavigableKm2: number,
  ) {
    this.factor = factor;
    this.width = Math.ceil(rasterWidth / factor);
    this.height = Math.ceil(rasterHeight / factor);
    const w = this.width;
    const h = this.height;
    this.water = new Uint8Array(w * h);
    for (let y = 0; y < rasterHeight; y++) {
      const cy = Math.floor(y / factor);
      for (let x = 0; x < rasterWidth; x++) {
        if (labels[y * rasterWidth + x] === WATER) this.water[cy * w + Math.floor(x / factor)] = 1;
      }
    }
    for (const line of forced) {
      for (let i = 0; i + 1 < line.path.length; i++) {
        const [ax, ay] = projection.project(...line.path[i]!);
        const [bx, by] = projection.project(...line.path[i + 1]!);
        drawLine(ax / factor, ay / factor, bx / factor, by / factor, (x, y) => {
          if (x >= 0 && x < w && y >= 0 && y < h) this.water[y * w + x] = 1;
        });
      }
    }

    this.cellWidthKm = new Float64Array(h);
    this.cellHeightKm = new Float64Array(h);
    for (let cy = 0; cy < h; cy++) {
      const top = projection.unproject(0, cy * factor)[1];
      const bottom = projection.unproject(0, Math.min(rasterHeight, (cy + 1) * factor))[1];
      this.cellWidthKm[cy] = projection.pixelKm((cy + 0.5) * factor) * factor;
      this.cellHeightKm[cy] = Math.abs(top - bottom) * 111.195;
    }

    this.component = new Int32Array(w * h).fill(-1);
    const queue = new Int32Array(w * h);
    for (let start = 0; start < w * h; start++) {
      if (!this.water[start] || this.component[start] !== -1) continue;
      const id = this.componentAreaKm2.length;
      let area = 0;
      let head = 0;
      let tail = 0;
      queue[tail++] = start;
      this.component[start] = id;
      while (head < tail) {
        const c = queue[head++]!;
        const cy = Math.floor(c / w);
        area += this.cellWidthKm[cy]! * this.cellHeightKm[cy]!;
        for (const n of this.neighbors(c)) {
          if (this.water[n] && this.component[n] === -1) {
            this.component[n] = id;
            queue[tail++] = n;
          }
        }
      }
      this.componentAreaKm2.push(area);
    }
    this.navigable = new Uint8Array(w * h);
    for (let c = 0; c < w * h; c++) {
      const comp = this.component[c]!;
      if (comp >= 0 && this.componentAreaKm2[comp]! >= minNavigableKm2) this.navigable[c] = 1;
    }
  }

  /** 4-neighbors with horizontal wrap-around at the date line. */
  neighbors(c: number): number[] {
    const w = this.width;
    const x = c % w;
    const y = Math.floor(c / w);
    const out = [y * w + ((x + 1) % w), y * w + ((x - 1 + w) % w)];
    if (y > 0) out.push(c - w);
    if (y < this.height - 1) out.push(c + w);
    return out;
  }

  cellOf(px: number, py: number): number {
    return Math.floor(py / this.factor) * this.width + Math.floor(px / this.factor);
  }

  stepKm(a: number, b: number): number {
    const ya = Math.floor(a / this.width);
    const yb = Math.floor(b / this.width);
    return ya === yb
      ? this.cellWidthKm[ya]!
      : (this.cellHeightKm[ya]! + this.cellHeightKm[yb]!) / 2;
  }

  /** Nearest navigable cell to a raster pixel within maxCells, or -1. */
  nearestNavigable(px: number, py: number, maxCells: number): number {
    const cx = Math.floor(px / this.factor);
    const cy = Math.floor(py / this.factor);
    let best = -1;
    let bestD = Infinity;
    for (let dy = -maxCells; dy <= maxCells; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= this.height) continue;
      for (let dx = -maxCells; dx <= maxCells; dx++) {
        const x = (cx + dx + this.width) % this.width;
        const c = y * this.width + x;
        const d = dx * dx + dy * dy;
        if (this.navigable[c] && d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }
}

export interface SeaRoute {
  a: number;
  b: number;
  km: number;
}

/**
 * Connects ports whose sea catchments touch: a multi-source Dijkstra over navigable cells
 * assigns every sea cell to its nearest port; neighboring catchments become routes.
 */
export function buildSeaRoutes(
  grid: WaterGrid,
  ports: { id: number; cell: number; lonLat: Position }[],
  distance: (a: Position, b: Position) => number,
): SeaRoute[] {
  const n = grid.width * grid.height;
  const dist = new Float64Array(n).fill(Infinity);
  const owner = new Int32Array(n).fill(-1);
  const best = new Map<number, number>();
  const addRoute = (a: number, b: number, km: number): void => {
    const key = Math.min(a, b) * 1_000_000 + Math.max(a, b);
    const old = best.get(key);
    if (old === undefined || km < old) best.set(key, km);
  };

  const heap = new MinHeap();
  const primary = new Map<number, (typeof ports)[number]>();
  for (const port of ports) {
    const first = primary.get(port.cell);
    if (first) {
      addRoute(first.id, port.id, distance(first.lonLat, port.lonLat));
      continue;
    }
    primary.set(port.cell, port);
    dist[port.cell] = 0;
    owner[port.cell] = port.id;
    heap.push(port.cell, 0);
  }
  while (heap.size) {
    const [c, d] = heap.pop();
    if (d > dist[c]!) continue;
    for (const nb of grid.neighbors(c)) {
      if (!grid.navigable[nb]) continue;
      const nd = d + grid.stepKm(c, nb);
      if (nd < dist[nb]!) {
        dist[nb] = nd;
        owner[nb] = owner[c]!;
        heap.push(nb, nd);
      }
    }
  }
  for (let c = 0; c < n; c++) {
    if (owner[c]! < 0) continue;
    for (const nb of grid.neighbors(c)) {
      if (owner[nb]! >= 0 && owner[nb] !== owner[c]) {
        addRoute(owner[c]!, owner[nb]!, dist[c]! + dist[nb]! + grid.stepKm(c, nb));
      }
    }
  }
  return [...best.entries()]
    .sort((p, q) => p[0] - q[0])
    .map(([key, km]) => ({
      a: Math.floor(key / 1_000_000),
      b: key % 1_000_000,
      km: Math.round(km),
    }));
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, key: number): void {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= key) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.items[0]!, this.keys[0]!];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l]! < this.keys[m]!) m = l;
        if (r < this.keys.length && this.keys[r]! < this.keys[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
  }
}
