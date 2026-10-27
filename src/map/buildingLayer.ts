import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { MapData } from './mapData';

/** Buildings in one city: each kind with its level. */
export interface CityBuildings {
  cityId: number;
  kinds: { category: string; level: number }[];
}

/** Icons appear from this zoom on (with the city names), so the world map stays clean. */
const MIN_SCALE = 0.45;
const SIZE = 14;
const MAX_ICONS = 4;

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
 * Small building icons next to the cities that really have them (GDD section 13): one badge per
 * kind, a dot per extra level (up to three). Drawn in screen space like the labels.
 */
export class BuildingLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  private items: CityBuildings[] = [];

  constructor(private readonly data: MapData) {
    this.container.addChild(this.g);
  }

  set(items: CityBuildings[]): void {
    this.items = items;
  }

  update(camera: Camera): void {
    const g = this.g;
    g.clear();
    if (camera.scale < MIN_SCALE) return;
    const [x0, y0, x1, y1] = camera.visibleRect();
    for (const item of this.items) {
      const city = this.data.cities[item.cityId];
      if (!city) continue;
      const [wx, wy] = city.position;
      if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
      const [sx, sy] = camera.worldToScreen(wx, wy);
      item.kinds.slice(0, MAX_ICONS).forEach((k, i) => {
        const x = Math.round(sx + 8 + i * (SIZE + 3));
        const y = Math.round(sy + 6);
        g.roundRect(x, y, SIZE, SIZE, 3)
          .fill({ color: 0x0b1522, alpha: 0.85 })
          .stroke({ color: COLORS[k.category] ?? 0xdddddd, width: 1.2 });
        glyph(g, k.category, x, y, COLORS[k.category] ?? 0xdddddd);
        for (let d = 1; d < Math.min(4, k.level); d++)
          g.circle(x + 2 + (d - 1) * 4, y + SIZE + 3, 1.4).fill({ color: 0xffffff });
      });
    }
  }
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
