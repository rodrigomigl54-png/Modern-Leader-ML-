// Palette texture read by the map shader. A province's ID-map color (r, g) addresses its palette
// texel directly: column r, row g holds the display color, and row 256 + g holds its owner.
// Recoloring the whole map is therefore just rewriting this small texture.

export type RGB = [number, number, number];

export const PALETTE_WIDTH = 256;
export const PALETTE_HEIGHT = 512;

export class PaletteData {
  readonly data = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);

  /** Label 0 is water; province id p has label p + 1. */
  private offset(label: number, ownerRows: boolean): number {
    const col = label & 255;
    const row = (label >> 8) + (ownerRows ? 256 : 0);
    return (row * PALETTE_WIDTH + col) * 4;
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
    this.data[o + 3] = 255;
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
