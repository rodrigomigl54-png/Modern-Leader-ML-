import { describe, expect, it } from 'vitest';
import { simplify } from './borders.ts';
import { containsPoint, MillerProjection, ringAreaKm2 } from './geo.ts';
import { fillMultiPolygon } from './raster.ts';

describe('MillerProjection', () => {
  const projection = new MillerProjection(1000, 84, -85);

  it('round-trips lon/lat through pixel coordinates', () => {
    const [x, y] = projection.project(20.46, 44.82);
    const [lon, lat] = projection.unproject(x, y);
    expect(lon).toBeCloseTo(20.46, 6);
    expect(lat).toBeCloseTo(44.82, 6);
  });

  it('puts the map edges at the configured latitudes', () => {
    expect(projection.project(-180, 84)).toEqual([0, 0]);
    // The height is rounded up to whole pixels.
    const bottom = projection.project(180, -85)[1];
    expect(bottom).toBeLessThanOrEqual(projection.height);
    expect(bottom).toBeGreaterThan(projection.height - 1);
  });
});

describe('geometry', () => {
  it('computes spherical area', () => {
    // A 1° x 1° cell at the equator is about 12,364 km².
    const ring: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ];
    expect(ringAreaKm2(ring)).toBeGreaterThan(12_300);
    expect(ringAreaKm2(ring)).toBeLessThan(12_400);
  });

  it('respects holes in point-in-polygon tests', () => {
    const outer: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const hole: [number, number][] = [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ];
    expect(containsPoint([[outer, hole]], 2, 2)).toBe(true);
    expect(containsPoint([[outer, hole]], 5, 5)).toBe(false);
  });
});

describe('fillMultiPolygon', () => {
  it('fills the pixels whose centers are inside', () => {
    let filled = 0;
    const square: [number, number][] = [
      [1, 1],
      [4, 1],
      [4, 3],
      [1, 3],
      [1, 1],
    ];
    fillMultiPolygon([[square]], 10, 10, (_y, x0, x1) => (filled += x1 - x0 + 1));
    expect(filled).toBe(6);
  });
});

describe('simplify', () => {
  it('removes staircase points within the tolerance and keeps the ends', () => {
    const stairs: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
      [3, 3],
    ];
    const out = simplify(stairs, 0.75);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([3, 3]);
    expect(out.length).toBeLessThan(stairs.length);
  });
});
