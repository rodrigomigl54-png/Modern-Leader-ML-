import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { MapData } from './mapData';

/** Buildings in one city: each kind with its level. */
export interface CityBuildings {
  cityId: number;
  kinds: { category: string; level: number }[];
}

/** Icons appear from this zoom on (with the city names), so the world map stays clean. */
const MIN_SCALE = 0.5;
/** Glyphs are drawn in a 14 px box and shown smaller (Dario: less crowded). */
const SIZE = 14;
const SHOWN = 0.72;
/** Capital stars appear from this zoom on. */
const STAR_MIN_SCALE = 0.12;

const COLORS: Record<string, number> = {
  factory: 0xd9a441,
  university: 0x6fa8dc,
  agriculture: 0x7fbf6a,
  infrastructure: 0xa7a7a7,
  energy: 0xf2d04a,
  hospital: 0xe07a7a,
  missileFactory: 0xc0483e,
  droneFactory: 0xc0483e,
  airDefenseFactory: 0x6aa5c8,
};

/**
 * Small building icons (GDD section 13): one badge per kind of building in a province, at its
 * main city, the most valuable kinds first, a dot per extra building (up to three). Plus a star
 * on every country's capital. Drawn in screen space like the labels.
 */
export class BuildingLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  private items: CityBuildings[] = [];
  private capitals: { cityId: number; mine: boolean }[] = [];

  constructor(private readonly data: MapData) {
    this.container.addChild(this.g);
  }

  set(items: CityBuildings[]): void {
    this.items = items;
  }

  /** Capital cities, starred; the player's in amber. */
  setCapitals(capitals: { cityId: number; mine: boolean }[]): void {
    this.capitals = capitals;
  }

  update(camera: Camera): void {
    const g = this.g;
    g.clear();
    const [x0, y0, x1, y1] = camera.visibleRect();
    const inView = (wx: number, wy: number): boolean =>
      wx >= x0 && wx <= x1 && wy >= y0 && wy <= y1;
    if (camera.scale >= STAR_MIN_SCALE) {
      for (const c of this.capitals) {
        const city = this.data.cities[c.cityId];
        if (!city || !inView(...city.position)) continue;
        const [sx, sy] = camera.worldToScreen(...city.position);
        star(g, sx, sy, c.mine ? 6 : 5, c.mine ? 0xf2a93b : 0xf4f1e8);
      }
    }
    if (camera.scale < MIN_SCALE) return;
    const size = SIZE * SHOWN;
    for (const item of this.items) {
      const city = this.data.cities[item.cityId];
      if (!city) continue;
      const [wx, wy] = city.position;
      if (!inView(wx, wy)) continue;
      const [sx, sy] = camera.worldToScreen(wx, wy);
      // One icon per province (Dario: less crowded): the kind it has most of, and the number of
      // buildings when there is more than one.
      const top = item.kinds[0];
      if (!top) continue;
      const total = item.kinds.reduce((n, k) => n + k.level, 0);
      const x = Math.round(sx + 6);
      const y = Math.round(sy + 4);
      const color = COLORS[top.category] ?? 0xdddddd;
      g.save();
      // Scale first, then move: the move is not scaled.
      g.scaleTransform(SHOWN, SHOWN);
      g.translateTransform(x, y);
      g.roundRect(0, 0, SIZE, SIZE, 3)
        .fill({ color: 0x0b1522, alpha: 0.85 })
        .stroke({ color, width: 1.2 });
      glyph(g, top.category, 0, 0, color);
      g.restore();
      // Up to three dots for the other buildings there.
      for (let d = 1; d < Math.min(4, total); d++)
        g.circle(x + size + 2.5, y + 1.5 + (d - 1) * 3, 1).fill({ color: 0xffffff });
    }
  }
}

/** A five-pointed star with a dark outline (capitals). */
function star(g: Graphics, x: number, y: number, r: number, color: number): void {
  const points: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    points.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.poly(points).fill({ color }).stroke({ color: 0x0b1522, width: 1.2 });
}

/** A tiny line drawing per kind of building, inside a 14 px badge. */
function glyph(g: Graphics, kind: string, x: number, y: number, color: number): void {
  const s = (px: number, py: number): [number, number] => [x + px, y + py];
  switch (kind) {
    case 'factory':
      // Sawtooth roof and a chimney.
      g.poly([
        ...s(3, 11),
        ...s(3, 7),
        ...s(6, 5),
        ...s(6, 7),
        ...s(9, 5),
        ...s(9, 7),
        ...s(11, 5),
        ...s(11, 11),
      ]).fill({ color });
      break;
    case 'university':
      g.poly([...s(2, 6), ...s(7, 3), ...s(12, 6)]).fill({ color });
      g.rect(...s(3, 7), 8, 1.2).fill({ color });
      for (const px of [3.5, 6.5, 9.5]) g.rect(...s(px, 8), 1.2, 3).fill({ color });
      break;
    case 'agriculture':
      g.moveTo(...s(7, 12))
        .lineTo(...s(7, 4))
        .stroke({ color, width: 1.2 });
      for (const py of [5, 7.5, 10]) {
        g.ellipse(...s(5.5, py), 1.6, 0.9).fill({ color });
        g.ellipse(...s(8.5, py), 1.6, 0.9).fill({ color });
      }
      break;
    case 'infrastructure':
      g.moveTo(...s(2, 10))
        .quadraticCurveTo(...s(7, 3), ...s(12, 10))
        .stroke({ color, width: 1.4 });
      g.moveTo(...s(2, 11))
        .lineTo(...s(12, 11))
        .stroke({ color, width: 1.2 });
      break;
    case 'energy':
      g.poly([...s(8, 2), ...s(4, 8), ...s(7, 8), ...s(6, 12), ...s(10, 6), ...s(7, 6)]).fill({
        color,
      });
      break;
    case 'hospital':
      g.rect(...s(6, 3), 2, 8).fill({ color });
      g.rect(...s(3, 6), 8, 2).fill({ color });
      break;
    default:
      // Weapons factories: a small rocket.
      g.poly([...s(7, 2), ...s(9, 6), ...s(9, 10), ...s(5, 10), ...s(5, 6)]).fill({ color });
      g.poly([...s(5, 10), ...s(3, 12), ...s(5, 8)]).fill({ color });
      g.poly([...s(9, 10), ...s(11, 12), ...s(9, 8)]).fill({ color });
  }
}
