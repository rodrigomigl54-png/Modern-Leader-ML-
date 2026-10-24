import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { MapData } from './mapData';

export type StrikeRelation = 'own' | 'enemy';

export interface StrikeOverlay {
  /** Missiles in flight: launch and target city, hitting next turn. */
  missiles: { fromCityId: number; toCityId: number; relation: StrikeRelation; nuclear: boolean }[];
  /** Drone groups: where they are and the provinces still ahead. */
  drones: { provinceId: number; path: readonly number[]; relation: StrikeRelation }[];
  /** Nuclear bases, visible to everyone (GDD section 9). */
  nuclearBases: { cityId: number; mine: boolean }[];
  /** Air-defense sites with their radius (drawn in the air-defense map mode). */
  airDefense: { cityId: number; radiusKm: number; relation: 'own' | 'ally' | 'enemy' | 'other' }[];
}

const EMPTY: StrikeOverlay = { missiles: [], drones: [], nuclearBases: [], airDefense: [] };
const RING_COLORS = { own: 0x4fb3a5, ally: 0x6aa5c8, enemy: 0xc0483e, other: 0x8798ab };
const RIPPLE_MS = 1600;

/**
 * Missiles as thin arcs with a badge until impact, drones as small chevrons along their route,
 * nuclear bases, air-defense rings and short impact ripples (GDD section 13). Screen space.
 */
export class StrikeLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  private overlay: StrikeOverlay = EMPTY;
  private showRings = false;
  private ripples: { cityId: number; start: number; nuclear: boolean }[] = [];
  private readonly provinceAnchor: [number, number][];

  constructor(private readonly data: MapData) {
    this.container.addChild(this.g);
    const best = new Map<number, number>();
    const seat = new Map<number, [number, number]>();
    for (const c of data.cities) {
      const score = (c.isCapital ? 1e12 : 0) + c.population;
      if ((best.get(c.provinceId) ?? -1) < score) {
        best.set(c.provinceId, score);
        seat.set(c.provinceId, c.position);
      }
    }
    this.provinceAnchor = data.provinces.map((p) => seat.get(p.id) ?? p.centroid);
  }

  set(overlay: StrikeOverlay): void {
    this.overlay = overlay;
  }

  setRingsVisible(visible: boolean): void {
    this.showRings = visible;
  }

  /** Starts impact ripples at cities. */
  pulse(cityIds: readonly number[], nuclear = false): void {
    const now = performance.now();
    for (const cityId of cityIds) this.ripples.push({ cityId, start: now, nuclear });
  }

  /** True while an animation needs more frames. */
  get animating(): boolean {
    return this.ripples.length > 0;
  }

  update(camera: Camera): void {
    const g = this.g;
    g.clear();
    const city = (id: number): [number, number] =>
      camera.worldToScreen(...(this.data.cities[id]?.position ?? [0, 0]));
    const pxPerKm = (cityId: number): number => {
      const lat = this.data.cities[cityId]?.lonLat[1] ?? 0;
      const kmPerDegree = 111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      return ((this.data.map.width / 360) * camera.scale) / kmPerDegree;
    };

    if (this.showRings) {
      for (const ad of this.overlay.airDefense) {
        const [x, y] = city(ad.cityId);
        const r = ad.radiusKm * pxPerKm(ad.cityId);
        if (r < 2) continue;
        const color = RING_COLORS[ad.relation];
        g.circle(x, y, r).fill({ color, alpha: 0.08 }).stroke({ color, width: 1.5, alpha: 0.6 });
      }
    }

    for (const b of this.overlay.nuclearBases) {
      const [x, y] = city(b.cityId);
      g.circle(x, y, 7)
        .fill({ color: 0xf2d13b })
        .stroke({ color: b.mine ? 0xf2a93b : 0x0b1522, width: 2 });
      // Three blades of the radiation sign.
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        g.moveTo(x, y)
          .arc(x, y, 5.5, a - 0.5, a + 0.5)
          .lineTo(x, y)
          .fill({ color: 0x0b1522 });
      }
      g.circle(x, y, 1.6).fill({ color: 0xf2d13b });
    }

    for (const m of this.overlay.missiles) {
      const [ax, ay] = city(m.fromCityId);
      const [bx, by] = city(m.toCityId);
      const lift = Math.min(160, Math.hypot(bx - ax, by - ay) * 0.3);
      const cx = (ax + bx) / 2;
      const cy = (ay + by) / 2 - lift;
      const color = m.nuclear ? 0xf2d13b : m.relation === 'own' ? 0xf2a93b : 0xc0483e;
      g.moveTo(ax, ay)
        .quadraticCurveTo(cx, cy, bx, by)
        .stroke({ color, width: m.nuclear ? 2.5 : 1.5, alpha: 0.9 });
      g.circle(bx, by, 4).stroke({ color, width: 2 });
      // Timer badge: every missile hits next turn.
      g.roundRect(bx + 6, by - 18, 16, 14, 3)
        .fill({ color })
        .stroke({ color: 0x0b1522, width: 1 });
      g.moveTo(bx + 11, by - 14)
        .lineTo(bx + 14, by - 14)
        .lineTo(bx + 14, by - 8)
        .stroke({ color: 0x0b1522, width: 1.5 });
    }

    for (const d of this.overlay.drones) {
      const [x, y] = camera.worldToScreen(...this.provinceAnchor[d.provinceId]!);
      const color = d.relation === 'own' ? 0xf2a93b : 0xc0483e;
      let px = x;
      let py = y;
      for (const p of d.path) {
        const [qx, qy] = camera.worldToScreen(...this.provinceAnchor[p]!);
        g.moveTo(px, py).lineTo(qx, qy);
        px = qx;
        py = qy;
      }
      if (d.path.length) g.stroke({ color, width: 1, alpha: 0.6 });
      // Chevron pointing to the next province.
      const next = d.path[0];
      const [tx, ty] =
        next !== undefined ? camera.worldToScreen(...this.provinceAnchor[next]!) : [x + 1, y];
      const angle = Math.atan2(ty - y, tx - x);
      const tip = (r: number, a: number): [number, number] => [
        x + Math.cos(angle + a) * r,
        y + Math.sin(angle + a) * r,
      ];
      g.poly([...tip(8, 0), ...tip(6, 2.4), ...tip(2, Math.PI), ...tip(6, -2.4)])
        .fill({ color })
        .stroke({ color: 0x0b1522, width: 1 });
    }

    const now = performance.now();
    this.ripples = this.ripples.filter((r) => now - r.start < RIPPLE_MS);
    for (const r of this.ripples) {
      const t = (now - r.start) / RIPPLE_MS;
      const [x, y] = city(r.cityId);
      const radius = (r.nuclear ? 80 : 30) * t + 4;
      g.circle(x, y, radius).stroke({
        color: r.nuclear ? 0xf2d13b : 0xc0483e,
        width: r.nuclear ? 4 : 2.5,
        alpha: 1 - t,
      });
    }
  }
}
