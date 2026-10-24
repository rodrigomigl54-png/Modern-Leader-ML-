// Traces province borders from the province ID raster, so borders match the ID map exactly and
// every border knows which two provinces it separates (owners change in play, so country
// borders are drawn wherever the two sides have different owners).

export const WATER = 0;
export const UNOWNED_LAND = 0xffff;

export interface BorderEdge {
  /** Lower raster label of the pair. */
  a: number;
  /** Higher raster label of the pair. */
  b: number;
  /** Polylines as flat [x0, y0, x1, y1, ...] arrays in raster pixel-corner coordinates. */
  paths: number[][];
}

export function traceBorders(
  labels: Uint16Array,
  width: number,
  height: number,
  tolerance: number,
): BorderEdge[] {
  const isProvince = (l: number): boolean => l !== WATER && l !== UNOWNED_LAND;
  const stride = width + 1;

  // Pass 1: count unit edges. Pass 2: store them.
  let count = 0;
  const visit = (store: (key: number, vertex: number, vertical: number) => void): void => {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const l = labels[row + x]!;
        if (y > 0) {
          const up = labels[row - width + x]!;
          if (up !== l && (isProvince(up) || isProvince(l))) {
            store(up < l ? up * 65536 + l : l * 65536 + up, y * stride + x, 0);
          }
        }
        if (x > 0) {
          const left = labels[row + x - 1]!;
          if (left !== l && (isProvince(left) || isProvince(l))) {
            store(left < l ? left * 65536 + l : l * 65536 + left, y * stride + x, 1);
          }
        }
      }
    }
  };
  visit(() => count++);

  const keys = new Uint32Array(count);
  const vertices = new Uint32Array(count);
  const vertical = new Uint8Array(count);
  let n = 0;
  visit((key, vertex, v) => {
    keys[n] = key;
    vertices[n] = vertex;
    vertical[n] = v;
    n++;
  });

  // Bucket edges by province pair.
  const bucketOf = new Map<number, number>();
  const bucketKeys: number[] = [];
  const bucketCounts: number[] = [];
  for (let i = 0; i < count; i++) {
    let b = bucketOf.get(keys[i]!);
    if (b === undefined) {
      b = bucketKeys.length;
      bucketOf.set(keys[i]!, b);
      bucketKeys.push(keys[i]!);
      bucketCounts.push(0);
    }
    bucketCounts[b]!++;
  }
  const starts = new Uint32Array(bucketKeys.length + 1);
  for (let b = 0; b < bucketKeys.length; b++) starts[b + 1] = starts[b]! + bucketCounts[b]!;
  const fill = starts.slice(0, bucketKeys.length);
  const sorted = new Uint32Array(count);
  for (let i = 0; i < count; i++) sorted[fill[bucketOf.get(keys[i]!)!]!++] = i;

  const order = bucketKeys.map((_, b) => b).sort((p, q) => bucketKeys[p]! - bucketKeys[q]!);
  const result: BorderEdge[] = [];
  for (const b of order) {
    const segs = sorted.subarray(starts[b]!, starts[b + 1]!);
    const start = (s: number): number => vertices[s]!;
    const end = (s: number): number => vertices[s]! + (vertical[s] ? stride : 1);
    const incident = new Map<number, number[]>();
    for (const s of segs) {
      for (const v of [start(s), end(s)]) {
        const list = incident.get(v);
        if (list) list.push(s);
        else incident.set(v, [s]);
      }
    }
    const used = new Set<number>();
    const chains: number[][] = [];
    const walk = (from: number, first: number): void => {
      const chain = [from];
      let v = from;
      let s: number | undefined = first;
      while (s !== undefined) {
        used.add(s);
        v = start(s) === v ? end(s) : start(s);
        chain.push(v);
        const around = incident.get(v)!;
        if (around.length !== 2) break;
        s = around.find((t) => !used.has(t));
      }
      chains.push(chain);
    };
    for (const [v, list] of incident) {
      if (list.length === 2) continue;
      for (const s of list) if (!used.has(s)) walk(v, s);
    }
    for (const s of segs) if (!used.has(s)) walk(start(s), s);

    const paths = chains.map((chain) => {
      const pts = chain.map((v) => [v % stride, Math.floor(v / stride)] as [number, number]);
      return simplify(pts, tolerance).flat();
    });
    const key = bucketKeys[b]!;
    result.push({ a: Math.floor(key / 65536), b: key % 65536, paths });
  }
  return result;
}

/** Douglas-Peucker simplification; keeps the first and last point. */
export function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const [ax, ay] = points[i0]!;
    const [bx, by] = points[i1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = i0 + 1; i < i1; i++) {
      const [px, py] = points[i]!;
      let d: number;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
