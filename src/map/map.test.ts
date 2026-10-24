import { describe, expect, it } from 'vitest';
import { Camera } from './camera';
import { countryAnchors, placeLabels, type LabelCandidate } from './labelLayout';
import type { CountryData, ProvinceData } from './mapData';
import { assignCountryColors } from './mapModes';
import { PaletteData } from './palette';
import { chooseLevel, decodeProvince, visibleTiles, type TileLevel } from './tileMath';

describe('Camera', () => {
  const make = (): Camera => {
    const c = new Camera(16000, 10000);
    c.setViewport(800, 600);
    c.lookAt(8000, 5000, 1);
    return c;
  };

  it('keeps the point under the cursor fixed while zooming', () => {
    const c = make();
    const before = c.screenToWorld(200, 150);
    c.zoomAt(200, 150, 2);
    const after = c.screenToWorld(200, 150);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(c.scale).toBe(2);
  });

  it('pans with the finger and converts both ways', () => {
    const c = make();
    c.panBy(100, 50);
    expect(c.centerX).toBeCloseTo(7900);
    expect(c.centerY).toBeCloseTo(4950);
    const [sx, sy] = c.worldToScreen(...c.screenToWorld(123, 456));
    expect(sx).toBeCloseTo(123);
    expect(sy).toBeCloseTo(456);
  });

  it('limits zoom and keeps the map on screen', () => {
    const c = make();
    c.zoomAt(400, 300, 1e-6);
    expect(c.scale).toBeCloseTo(800 / 16000);
    expect(c.centerX).toBe(8000);
    c.zoomAt(400, 300, 1e6);
    expect(c.scale).toBe(c.maxScale);
    c.panBy(1e9, 1e9);
    expect(c.visibleRect()[0]).toBeCloseTo(0);
    expect(c.visibleRect()[1]).toBeCloseTo(0);
  });
});

describe('tile math', () => {
  const level: TileLevel = {
    level: 1,
    scale: 2,
    width: 2048,
    height: 1024,
    tiles: [
      { file: 'a', x: 0, y: 0, width: 1024, height: 1024 },
      { file: 'b', x: 1024, y: 0, width: 1024, height: 1024 },
    ],
  };

  it('chooses the level whose texels match device pixels', () => {
    expect(chooseLevel(2, 4)).toBe(0);
    expect(chooseLevel(1, 4)).toBe(0);
    expect(chooseLevel(0.5, 4)).toBe(1);
    expect(chooseLevel(0.01, 4)).toBe(3);
  });

  it('finds tiles overlapping the view in level-0 coordinates', () => {
    expect(visibleTiles(level, [0, 0, 100, 100]).map((t) => t.file)).toEqual(['a']);
    expect(visibleTiles(level, [2000, 0, 2100, 100]).map((t) => t.file)).toEqual(['a', 'b']);
    expect(visibleTiles(level, [5000, 0, 6000, 100])).toEqual([]);
  });

  it('decodes province map colors', () => {
    expect(decodeProvince(0, 0, 0)).toBe(-1);
    expect(decodeProvince(0, 0, 255)).toBe(-2);
    expect(decodeProvince(1, 0, 0)).toBe(0);
    expect(decodeProvince(4, 18, 0)).toBe(4 + 18 * 256 - 1);
  });
});

describe('PaletteData', () => {
  it('stores color and owner per label', () => {
    const p = new PaletteData();
    p.setColor(4612, [10, 20, 30]);
    p.setOwner(4612, 300);
    expect(p.getColor(4612)).toEqual([10, 20, 30]);
    expect(p.getOwner(4612)).toBe(300);
    expect(p.getColor(4613)).toEqual([0, 0, 0]);
  });
});

const province = (
  id: number,
  owner: string,
  neighbors: number[],
  x = 0,
  pixels = 10,
): ProvinceData => ({
  id,
  key: `k${id}`,
  name: `P${id}`,
  owner,
  centroid: [x, 0],
  areaKm2: 1,
  neighbors,
  isCoastal: false,
  pixels,
  bbox: [0, 0, 1, 1],
});
const country = (id: string, provinceIds: number[]): CountryData => ({
  id,
  nameKey: `country.${id}`,
  status: 'full',
  capitalProvinceId: provinceIds[0]!,
  provinceIds,
});

describe('assignCountryColors', () => {
  it('gives neighboring countries different colors', () => {
    const provinces = [
      province(0, 'AAA', [1, 2]),
      province(1, 'BBB', [0, 2]),
      province(2, 'CCC', [0, 1]),
    ];
    const countries = [country('AAA', [0]), country('BBB', [1]), country('CCC', [2])];
    const colors = assignCountryColors({ provinces, countries });
    const unique = new Set([...colors.values()].map((c) => c.join(',')));
    expect(unique.size).toBe(3);
  });
});

describe('countryAnchors', () => {
  it('uses the largest connected group of provinces', () => {
    const provinces = [
      province(0, 'AAA', [1], 100, 50),
      province(1, 'AAA', [0], 200, 50),
      province(2, 'AAA', [], 5000, 10),
    ];
    const [anchor] = countryAnchors([country('AAA', [0, 1, 2])], provinces, 10000);
    expect(anchor!.wx).toBeCloseTo(150);
    expect(anchor!.pixels).toBe(100);
  });

  it('keeps groups across the date line together', () => {
    const provinces = [province(0, 'AAA', [1], 9990, 10), province(1, 'AAA', [0], 10, 10)];
    const [anchor] = countryAnchors([country('AAA', [0, 1])], provinces, 10000);
    expect(Math.min(anchor!.wx, 10000 - anchor!.wx)).toBeLessThan(1);
  });
});

describe('placeLabels', () => {
  const label = (key: string, wx: number): LabelCandidate => ({
    key,
    text: 'Label',
    kind: 'province',
    wx,
    wy: 50,
    fontSize: 12,
    dot: false,
  });

  it('skips overlapping and off-screen labels in priority order', () => {
    const placed = placeLabels(
      [label('a', 50), label('b', 55), label('c', 300), label('d', -500)],
      (x, y) => [x, y],
      400,
      100,
      10,
    );
    expect(placed.map((p) => p.key)).toEqual(['a', 'c']);
  });
});
