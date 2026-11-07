import { BitmapFont, BitmapText, Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { MapData } from './mapData';
import { FONT_FAMILY } from '../app/fonts';
import { shortCount } from './armyLayer';

// War on the map (AoH-style, own look): every battle of the week shows crossed swords over the
// province, and the losses of both sides rise and fade above it; a captured province flashes in
// its new owner's color. Screen space, a few seconds, then gone. With fewer animations the
// markers appear and fade without moving.

/** One battle of this week. */
export interface BattleFx {
  provinceId: number;
  /** Losses of the player's side and of the other side (or attacker/defender for others). */
  ourLosses: number;
  theirLosses: number;
  /** 'won'/'lost' for the player's battles, 'other' for battles between other countries. */
  tone: 'won' | 'lost' | 'other';
}

/** A province that changed hands this week. */
export interface CaptureFx {
  provinceId: number;
  /** 'gain' when the player's side took it, 'loss' when the player lost it, else 'other'. */
  tone: 'gain' | 'loss' | 'other';
}

const FONT = 'ml-battle';
const DURATION = 3200;
const CAPTURE_MS = 1400;
const TONE = { won: 0x4e9a5e, lost: 0xc0483e, other: 0x5d6f82 };
const CAPTURE = { gain: 0xf2a93b, loss: 0xc0483e, other: 0x8798ab };
/** More than this many battles at once: the rest are shown without numbers. */
const MAX_NUMBERS = 24;

interface Live {
  start: number;
  battle?: BattleFx;
  capture?: CaptureFx;
  texts: BitmapText[];
}

export class BattleLayer {
  readonly container = new Container();
  private readonly g = new Graphics();
  private readonly texts = new Container();
  private live: Live[] = [];
  private reduced = false;
  private readonly anchor: [number, number][];

  constructor(data: MapData, resolution: number) {
    BitmapFont.install({
      name: FONT,
      style: { fontFamily: FONT_FAMILY, fontSize: 26, fontWeight: 'bold', fill: 0xffffff },
      resolution,
      chars: [['0', '9'], 'kM.−+'],
    });
    this.container.addChild(this.g, this.texts);
    const seat = new Map<number, [number, number]>();
    const best = new Map<number, number>();
    for (const c of data.cities) {
      const score = (c.isCapital ? 1e12 : 0) + c.population;
      if ((best.get(c.provinceId) ?? -1) < score) {
        best.set(c.provinceId, score);
        seat.set(c.provinceId, c.position);
      }
    }
    // Next to the army counter, not on top of it.
    this.anchor = data.provinces.map((p) => seat.get(p.id) ?? p.centroid);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  get animating(): boolean {
    return this.live.length > 0;
  }

  show(battles: readonly BattleFx[], captures: readonly CaptureFx[]): void {
    const now = performance.now();
    // The player's battles first, so they always get their numbers.
    const sorted = [...battles].sort(
      (a, b) => Number(a.tone === 'other') - Number(b.tone === 'other'),
    );
    sorted.forEach((battle, i) => {
      const texts: BitmapText[] = [];
      if (i < MAX_NUMBERS) {
        const make = (n: number, color: number): void => {
          if (n <= 0) return;
          const t = new BitmapText({
            text: `−${shortCount(n)}`,
            style: { fontFamily: FONT, fontSize: 13 },
          });
          t.tint = color;
          this.texts.addChild(t);
          texts.push(t);
        };
        make(battle.ourLosses, battle.tone === 'other' ? 0xdbe4ee : 0xff6b5e);
        make(battle.theirLosses, 0xdbe4ee);
      }
      this.live.push({ start: now, battle, texts });
    });
    for (const capture of captures) this.live.push({ start: now, capture, texts: [] });
  }

  update(camera: Camera, now: number): void {
    const g = this.g;
    g.clear();
    const keep: Live[] = [];
    for (const fx of this.live) {
      const t = now - fx.start;
      const length = fx.capture ? CAPTURE_MS : DURATION;
      if (t >= length) {
        for (const text of fx.texts) text.destroy();
        continue;
      }
      keep.push(fx);
      const p = fx.battle?.provinceId ?? fx.capture!.provinceId;
      const [x, y] = camera.worldToScreen(...this.anchor[p]!);
      if (fx.capture) {
        // A ring that opens out over the province, in the new owner's tone.
        const k = t / CAPTURE_MS;
        const color = CAPTURE[fx.capture.tone];
        const r = this.reduced ? 18 : 8 + k * 34;
        g.circle(x, y, r).stroke({ color, width: 3 * (1 - k) + 1, alpha: 1 - k });
        g.circle(x, y, 6).fill({ color, alpha: 0.6 * (1 - k) });
        continue;
      }
      const b = fx.battle!;
      // Pop in, hold, fade out.
      const appear = this.reduced ? 1 : Math.min(1, t / 180);
      const fade = t > DURATION - 700 ? (DURATION - t) / 700 : 1;
      const s = (0.6 + 0.4 * appear) * (b.tone === 'other' ? 0.75 : 1);
      const cx = x + 16 * s;
      const cy = y - 16 * s;
      const color = TONE[b.tone];
      g.circle(cx, cy, 11 * s)
        .fill({ color, alpha: 0.92 * fade })
        .stroke({ color: 0x0b1522, width: 1.5, alpha: fade });
      // Crossed swords: two blades with guards.
      const blade = 6.5 * s;
      for (const dir of [1, -1]) {
        g.moveTo(cx - blade * dir, cy + blade)
          .lineTo(cx + blade * dir, cy - blade)
          .stroke({ color: 0xffffff, width: 1.8 * s, alpha: fade });
        const gx = cx - blade * dir * 0.45;
        const gy = cy + blade * 0.45;
        g.moveTo(gx - 2.5 * s, gy - 2.5 * s * dir)
          .lineTo(gx + 2.5 * s, gy + 2.5 * s * dir)
          .stroke({ color: 0xffffff, width: 1.5 * s, alpha: fade });
      }
      // Losses rise above the swords: ours on the left (red), theirs on the right.
      const rise = this.reduced ? 0 : Math.min(1, t / 1400) * 18;
      fx.texts.forEach((text, i) => {
        text.alpha = fade * Math.min(1, t / 250);
        text.x = cx + (i === 0 && fx.texts.length > 1 ? -text.width - 4 : 4);
        text.y = cy - 16 * s - 14 - rise;
      });
    }
    this.live = keep;
  }
}
