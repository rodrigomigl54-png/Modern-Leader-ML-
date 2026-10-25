// Distances between cities on the globe, shared by weapons, trade and diplomacy.
import type { SimContext } from './economy';

/** Great-circle distance between two cities in km. */
export function cityDistanceKm(ctx: SimContext, a: number, b: number): number {
  const p = ctx.cityLonLat?.[a];
  const q = ctx.cityLonLat?.[b];
  if (!p || !q) return Infinity;
  const rad = Math.PI / 180;
  const dLat = (q[1] - p[1]) * rad;
  const dLon = (q[0] - p[0]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(p[1] * rad) * Math.cos(q[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const cache = new WeakMap<SimContext, Map<number, number>>();

/** cityDistanceKm, remembered per simulation context (capitals are asked again every turn). */
export function cachedDistanceKm(ctx: SimContext, a: number, b: number): number {
  let map = cache.get(ctx);
  if (!map) {
    map = new Map();
    cache.set(ctx, map);
  }
  const [x, y] = a < b ? [a, b] : [b, a];
  const key = x * 1_000_000 + y;
  let km = map.get(key);
  if (km === undefined) {
    km = cityDistanceKm(ctx, x, y);
    map.set(key, km);
  }
  return km;
}
