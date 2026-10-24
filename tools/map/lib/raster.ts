import type { MultiPolygon } from './geo.ts';

/**
 * Scanline fill of a multipolygon in pixel coordinates (even-odd rule, pixel centers).
 * Calls span(y, x0, x1) for every filled run of pixels x0..x1 inclusive on row y.
 */
export function fillMultiPolygon(
  mp: MultiPolygon,
  width: number,
  height: number,
  span: (y: number, x0: number, x1: number) => void,
): void {
  const ex0: number[] = [];
  const ey0: number[] = [];
  const ex1: number[] = [];
  const ey1: number[] = [];
  let minRow = Infinity;
  let maxRow = -Infinity;

  for (const polygon of mp) {
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        let [xa, ya] = ring[i]!;
        let [xb, yb] = ring[i + 1]!;
        if (ya === yb) continue;
        if (ya > yb) [xa, ya, xb, yb] = [xb, yb, xa, ya];
        const first = Math.max(0, Math.ceil(ya - 0.5));
        const last = Math.min(height - 1, Math.ceil(yb - 0.5) - 1);
        if (first > last) continue;
        ex0.push(xa);
        ey0.push(ya);
        ex1.push(xb);
        ey1.push(yb);
        if (first < minRow) minRow = first;
        if (last > maxRow) maxRow = last;
      }
    }
  }
  if (ex0.length === 0) return;

  const order = ex0.map((_, i) => i).sort((a, b) => ey0[a]! - ey0[b]!);
  let next = 0;
  let active: number[] = [];
  const xs: number[] = [];

  for (let row = minRow; row <= maxRow; row++) {
    const yc = row + 0.5;
    while (next < order.length && ey0[order[next]!]! <= yc) active.push(order[next++]!);
    active = active.filter((e) => ey1[e]! > yc);
    xs.length = 0;
    for (const e of active) {
      if (ey0[e]! > yc) continue;
      const t = (yc - ey0[e]!) / (ey1[e]! - ey0[e]!);
      xs.push(ex0[e]! + t * (ex1[e]! - ex0[e]!));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.max(0, Math.ceil(xs[i]! - 0.5));
      const x1 = Math.min(width - 1, Math.ceil(xs[i + 1]! - 0.5) - 1);
      if (x0 <= x1) span(row, x0, x1);
    }
  }
}

/** Draws a line of cells (Bresenham) on a grid, calling plot(x, y) for each cell. */
export function drawLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void,
): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const xe = Math.round(x1);
  const ye = Math.round(y1);
  const dx = Math.abs(xe - x);
  const dy = -Math.abs(ye - y);
  const sx = x < xe ? 1 : -1;
  const sy = y < ye ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(x, y);
    if (x === xe && y === ye) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
