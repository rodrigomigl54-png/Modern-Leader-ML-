import type { Camera } from './camera';

const TAP_MAX_MOVE = 8;
const TAP_MAX_MS = 500;
const INERTIA_DECAY_PER_MS = 0.004;
const INERTIA_MIN_SPEED = 0.02;

interface PointerState {
  x: number;
  y: number;
}

/**
 * Mouse and touch input for the map: drag to pan, wheel or pinch to zoom, inertia after a
 * flick, and tap detection. Calls onChange whenever the camera moved.
 */
export class MapControls {
  private readonly pointers = new Map<number, PointerState>();
  private tapStart: { x: number; y: number; time: number; id: number } | null = null;
  private moved = false;
  private samples: { t: number; dx: number; dy: number }[] = [];
  private velocity: [number, number] = [0, 0];
  private pinchDistance = 0;
  private pinchMid: [number, number] = [0, 0];
  /** Start of a Shift-drag selection box (PC multi-select, GDD section 13). */
  private boxStart: [number, number] | null = null;
  private shiftTap = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: Camera,
    private readonly onChange: () => void,
    private readonly onTap: (sx: number, sy: number, shift: boolean) => void,
    /** Shift-drag with a mouse: a selection box in screen coordinates (null when it ends). */
    private readonly onBox: (
      box: [number, number, number, number] | null,
      done: boolean,
    ) => void = () => undefined,
  ) {
    element.addEventListener('pointerdown', this.down);
    element.addEventListener('pointermove', this.move);
    element.addEventListener('pointerup', this.up);
    element.addEventListener('pointercancel', this.up);
    element.addEventListener('wheel', this.wheel, { passive: false });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Advances inertia; returns true while the map is still gliding. */
  update(dtMs: number): boolean {
    const [vx, vy] = this.velocity;
    if (this.pointers.size > 0 || Math.hypot(vx, vy) < INERTIA_MIN_SPEED) {
      this.velocity = [0, 0];
      return false;
    }
    this.camera.panBy(vx * dtMs, vy * dtMs);
    const decay = Math.exp(-INERTIA_DECAY_PER_MS * dtMs);
    this.velocity = [vx * decay, vy * decay];
    this.onChange();
    return true;
  }

  private local(e: PointerEvent | WheelEvent): [number, number] {
    const rect = this.element.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  private readonly down = (e: PointerEvent): void => {
    this.element.setPointerCapture?.(e.pointerId);
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, { x, y });
    this.velocity = [0, 0];
    this.samples = [];
    if (this.pointers.size === 1) {
      this.tapStart = { x, y, time: performance.now(), id: e.pointerId };
      this.moved = false;
      this.shiftTap = e.shiftKey;
      this.boxStart = e.shiftKey && e.pointerType === 'mouse' ? [x, y] : null;
    } else {
      this.boxStart = null;
      this.tapStart = null;
      this.startPinch();
    }
  };

  private readonly move = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const [x, y] = this.local(e);
    const dx = x - p.x;
    const dy = y - p.y;
    p.x = x;
    p.y = y;

    if (this.pointers.size === 1) {
      if (this.tapStart && Math.hypot(x - this.tapStart.x, y - this.tapStart.y) > TAP_MAX_MOVE) {
        this.moved = true;
      }
      if (!this.moved) return;
      if (this.boxStart) {
        this.onBox([this.boxStart[0], this.boxStart[1], x, y], false);
        return;
      }
      this.camera.panBy(dx, dy);
      const now = performance.now();
      this.samples.push({ t: now, dx, dy });
      while (this.samples.length && now - this.samples[0]!.t > 100) this.samples.shift();
      this.onChange();
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()] as [PointerState, PointerState];
      const mid: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      this.camera.panBy(mid[0] - this.pinchMid[0], mid[1] - this.pinchMid[1]);
      if (this.pinchDistance > 0) this.camera.zoomAt(mid[0], mid[1], distance / this.pinchDistance);
      this.pinchMid = mid;
      this.pinchDistance = distance;
      this.moved = true;
      this.onChange();
    }
  };

  private readonly up = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const [x, y] = this.local(e);

    if (this.pointers.size === 0) {
      const start = this.tapStart;
      const box = this.boxStart;
      this.boxStart = null;
      if (box && this.moved) {
        this.onBox([box[0], box[1], x, y], true);
      } else if (
        start &&
        start.id === e.pointerId &&
        !this.moved &&
        performance.now() - start.time < TAP_MAX_MS
      ) {
        this.onTap(x, y, this.shiftTap);
      } else if (this.samples.length >= 2 && e.type === 'pointerup') {
        const span = Math.max(16, this.samples[this.samples.length - 1]!.t - this.samples[0]!.t);
        const sx = this.samples.reduce((t, s) => t + s.dx, 0);
        const sy = this.samples.reduce((t, s) => t + s.dy, 0);
        this.velocity = [sx / span, sy / span];
        this.onChange();
      }
      this.tapStart = null;
      this.samples = [];
    } else if (this.pointers.size === 1) {
      // Lifting one finger of a pinch continues as a pan without a jump.
      this.samples = [];
    } else {
      this.startPinch();
    }
  };

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()] as [PointerState, PointerState];
    this.pinchMid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }

  private readonly wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const [x, y] = this.local(e);
    const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    this.camera.zoomAt(x, y, Math.exp(-delta * 0.0015));
    this.velocity = [0, 0];
    this.onChange();
  };
}
