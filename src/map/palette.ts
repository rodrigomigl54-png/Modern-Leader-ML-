// Palette texture read by the map shader. A province's ID-map color (r, g) addresses its palette
// texel directly: column r, row g holds the display color, row 256 + g its owner (alpha: its
// side in the player's wars) and row 512 + g the stripe color of an occupied province (alpha 255
// when striped). Recoloring the whole map is therefore just rewriting this small texture.

export type RGB = [number, number, number];

export const PALETTE_WIDTH = 256;
export const PALETTE_HEIGHT = 768;

export class PaletteData {
  readonly data = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);

  constructor() {
    // Owner rows start on no side (alpha 255); see setSide.
    for (let i = 256 * PALETTE_WIDTH; i < 512 * PALETTE_WIDTH; i++) this.data[i * 4 + 3] = 255;
  }

  /** Label 0 is water; province id p has label p + 1. */
  private offset(label: number, ownerRows: boolean, stripeRows = false): number {
    const col = label & 255;
    const row = (label >> 8) + (stripeRows ? 512 : ownerRows ? 256 : 0);
    return (row * PALETTE_WIDTH + col) * 4;
  }

  /** Diagonal stripes of this color over an occupied province, or none. */
  setStripe(label: number, color: RGB | null): void {
    const o = this.offset(label, false, true);
    this.data[o] = color?.[0] ?? 0;
    this.data[o + 1] = color?.[1] ?? 0;
    this.data[o + 2] = color?.[2] ?? 0;
    this.data[o + 3] = color ? 255 : 0;
  }

  /**
   * The province owner's side in the player's wars: 0 none, 1 the player's side, 2 the enemy.
   * Borders between sides 1 and 2 are drawn as the front line.
   */
  setSide(label: number, side: 0 | 1 | 2): void {
    this.data[this.offset(label, true) + 3] = side === 1 ? 170 : side === 2 ? 85 : 255;
  }

  setColor(label: number, [r, g, b]: RGB): void {
    const o = this.offset(label, false);
    this.data[o] = r;
    this.data[o + 1] = g;
    this.data[o + 2] = b;
    this.data[o + 3] = 255;
  }

  getColor(label: number): RGB {
    const o = this.offset(label, false);
    return [this.data[o]!, this.data[o + 1]!, this.data[o + 2]!];
  }

  /** Owner index 0 means "no owner" (water); countries use 1..n. */
  setOwner(label: number, ownerIndex: number): void {
    const o = this.offset(label, true);
    this.data[o] = ownerIndex & 255;
    this.data[o + 1] = (ownerIndex >> 8) & 255;
    this.data[o + 2] = 0;
  }

  getOwner(label: number): number {
    const o = this.offset(label, true);
    return this.data[o]! + 256 * this.data[o + 1]!;
  }
}

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
