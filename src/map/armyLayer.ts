import { BitmapFont, BitmapText, Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { MapData } from './mapData';
import { FONT_FAMILY } from '../app/fonts';

/** How an army relates to the player: drawn in different colors. */
export type ArmyRelation = 'own' | 'ally' | 'enemy' | 'other';

export interface ArmyMarker {
  id: number;
  provinceId: number;
  size: number;
  relation: ArmyRelation;
  selected: boolean;
  /** Provinces still to cross (drawn for the player's armies). */
  path: readonly number[];
  atSea: boolean;
}

const COLORS: Record<ArmyRelation, { fill: number; text: number }> = {
  own: { fill: 0xf2a93b, text: 0x0b1522 },
  ally: { fill: 0x6aa5c8, text: 0x0b1522 },
  enemy: { fill: 0xc0483e, text: 0xffffff },
  other: { fill: 0x3a4a5e, text: 0xdbe4ee },
};
const FONT = 'ml-army';
const FONT_SIZE = 12;
/** Armies of countries not involved with the player appear only when zoomed in. */
const OTHERS_MIN_SCALE = 0.35;

/** Short soldier count: 950, 12k, 1.4M. */
export function shortCount(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/**
 * Army counters on the map (GDD section 13: small markers with the soldier count), in screen
 * space so they stay readable at every zoom, plus dashed routes for the player's moving armies.
 */
export class ArmyLayer {
  readonly container = new Container();
  private readonly shapes = new Graphics();
  private readonly texts = new Container();
  private readonly pool: BitmapText[] = [];
  private markers: ArmyMarker[] = [];
  private readonly anchor: [number, number][];

  constructor(data: MapData, resolution: number) {
    BitmapFont.install({
      name: FONT,
      style: {
        fontFamily: FONT_FAMILY,
        fontSize: 24,
        fontWeight: 'bold',
        fill: 0xffffff,
      },
      resolution,
      chars: [['0', '9'], 'kM.'],
    });
    this.container.addChild(this.shapes, this.texts);
    // Armies stand at the province's main city (or its center when it has none).
    const seat = new Map<number, [number, number]>();
    const best = new Map<number, number>();
    for (const c of data.cities) {
      const score = (c.isCapital ? 1e12 : 0) + c.population;
      if ((best.get(c.provinceId) ?? -1) < score) {
        best.set(c.provinceId, score);
        seat.set(c.provinceId, c.position);
      }
    }
    this.anchor = data.provinces.map((p) => seat.get(p.id) ?? p.centroid);
  }

  setMarkers(markers: ArmyMarker[]): void {
    this.markers = markers;
  }

  /** True while an army on screen is moving (its icon and route are animated). */
  animating = false;

  update(camera: Camera, now = performance.now()): void {
    const g = this.shapes;
    g.clear();
    this.animating = false;
    // Phase of the marching animation, 0..1 every second.
    const phase = (now % 1000) / 1000;
    for (const t of this.pool) t.visible = false;
    const [x0, y0, x1, y1] = camera.visibleRect();
    const margin = 40 / camera.scale;
    const inView = ([x, y]: [number, number]): boolean =>
      x >= x0 - margin && x <= x1 + margin && y >= y0 - margin && y <= y1 + margin;

    // Routes first, under the counters.
    for (const m of this.markers) {
      if (m.relation !== 'own' || m.path.length === 0) continue;
      let [px, py] = camera.worldToScreen(...this.anchor[m.provinceId]!);
      this.animating = true;
      for (const p of m.path) {
        const [qx, qy] = camera.worldToScreen(...this.anchor[p]!);
        // The dashes flow toward the destination.
        dashed(g, px, py, qx, qy, phase);
        px = qx;
        py = qy;
      }
      g.stroke({ color: m.selected ? 0xffd27a : 0xf2a93b, width: 2, alpha: 0.9 });
      g.circle(px, py, 4).fill({ color: 0xf2a93b });
    }

    // Counters, side by side when several armies share a province.
    const stacks = new Map<number, number>();
    let used = 0;
    const sorted = [...this.markers].sort((a, b) => order(a) - order(b) || a.id - b.id);
    for (const m of sorted) {
      if (m.relation === 'other' && camera.scale < OTHERS_MIN_SCALE) continue;
      const world = this.anchor[m.provinceId]!;
      if (!inView(world)) continue;
      const slot = stacks.get(m.provinceId) ?? 0;
      stacks.set(m.provinceId, slot + 1);
      const label = shortCount(m.size);
      const icon = 12;
      const w = 10 + icon + label.length * 7.5;
      const h = 18;
      const [sx, sy] = camera.worldToScreen(...world);
      const x = Math.round(sx - w / 2 + slot * (w + 3));
      const y = Math.round(sy - h - 8);
      const color = COLORS[m.relation];
      g.roundRect(x, y, w, h, 4)
        .fill({ color: color.fill, alpha: m.atSea ? 0.6 : 1 })
        .stroke({ color: m.selected ? 0xffffff : 0x0b1522, width: m.selected ? 2 : 1 });
      // The unit icon: rank chevrons at rest, marching chevrons on the move, a boat at sea.
      const moving = m.path.length > 0 || m.atSea;
      if (moving) this.animating = true;
      const ix = x + 4;
      const iy = y + 4;
      if (m.atSea) {
        const bob = Math.sin(phase * Math.PI * 2) * 1.2;
        g.poly([
          ix,
          iy + 6 + bob,
          ix + 10,
          iy + 6 + bob,
          ix + 8,
          iy + 10 + bob,
          ix + 2,
          iy + 10 + bob,
        ]).fill({ color: color.text });
        g.rect(ix + 4.5, iy + bob, 1.2, 6).fill({ color: color.text });
        g.poly([ix + 5.7, iy + bob, ix + 9, iy + 4 + bob, ix + 5.7, iy + 4 + bob]).fill({
          color: color.text,
        });
      } else {
        const next = m.path[0];
        const dir = next === undefined ? 0 : Math.sign(this.anchor[next]![0] - world[0]) || 1;
        const shift = moving ? Math.sin(phase * Math.PI * 2) * 1.5 * dir : 0;
        for (const dy of [0, 4]) {
          if (dir === 0)
            g.moveTo(ix + 1, iy + 6 + dy)
              .lineTo(ix + 5, iy + 2 + dy)
              .lineTo(ix + 9, iy + 6 + dy);
          else
            g.moveTo(ix + 3 + shift - dir * 2, iy + dy)
              .lineTo(ix + 3 + shift + dir * 2, iy + 3 + dy)
              .lineTo(ix + 3 + shift - dir * 2, iy + 6 + dy);
        }
        if (dir === 0) g.stroke({ color: color.text, width: 1.6 });
        else {
          g.stroke({ color: color.text, width: 1.6 });
        }
      }
      // A small chevron pointing at the city.
      g.poly([
        sx - 4 + slot * (w + 3),
        y + h,
        sx + 4 + slot * (w + 3),
        y + h,
        sx + slot * (w + 3),
        y + h + 5,
      ]).fill({
        color: color.fill,
      });
      let text = this.pool[used];
      if (!text) {
        text = new BitmapText({ text: '', style: { fontFamily: FONT, fontSize: FONT_SIZE } });
        text.anchor.set(0.5);
        this.pool.push(text);
        this.texts.addChild(text);
      }
      used++;
      text.text = label;
      text.tint = color.text;
      text.visible = true;
      text.position.set(x + icon + (w - icon) / 2, y + h / 2 + 1);
    }
  }
}

const order = (m: ArmyMarker): number =>
  m.relation === 'own' ? 0 : m.relation === 'enemy' ? 1 : m.relation === 'ally' ? 2 : 3;

function dashed(g: Graphics, ax: number, ay: number, bx: number, by: number, phase = 0): void {
  const len = Math.hypot(bx - ax, by - ay);
  const dash = 6;
  const steps = Math.max(1, Math.floor(len / dash));
  // The pattern shifts by up to two dashes per second, so the route seems to flow.
  const offset = (phase * 2) % 2;
  for (let i = -2; i < steps; i += 2) {
    const t0 = Math.max(0, (i + offset) / steps);
    const t1 = Math.min(1, (i + offset + 1) / steps);
    if (t1 <= t0) continue;
    g.moveTo(ax + (bx - ax) * t0, ay + (by - ay) * t0).lineTo(
      ax + (bx - ax) * t1,
      ay + (by - ay) * t1,
    );
  }
}
