/**
 * 2D map camera: which world point is at the screen center and how many screen (CSS) pixels one
 * world pixel takes. World pixels are level-0 province-map pixels.
 */
export class Camera {
  readonly worldWidth: number;
  readonly worldHeight: number;
  centerX: number;
  centerY: number;
  scale = 1;
  minScale = 0.01;
  maxScale = 3;
  viewportWidth = 1;
  viewportHeight = 1;

  constructor(worldWidth: number, worldHeight: number) {
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    this.centerX = worldWidth / 2;
    this.centerY = worldHeight / 2;
  }

  setViewport(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    // Fully zoomed out, the whole map fits on screen.
    this.minScale = Math.min(
      this.viewportWidth / this.worldWidth,
      this.viewportHeight / this.worldHeight,
    );
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale));
    this.clamp();
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [
      (wx - this.centerX) * this.scale + this.viewportWidth / 2,
      (wy - this.centerY) * this.scale + this.viewportHeight / 2,
    ];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [
      (sx - this.viewportWidth / 2) / this.scale + this.centerX,
      (sy - this.viewportHeight / 2) / this.scale + this.centerY,
    ];
  }

  /** Moves the map with the finger: a positive dx drags the map to the right. */
  panBy(dx: number, dy: number): void {
    this.centerX -= dx / this.scale;
    this.centerY -= dy / this.scale;
    this.clamp();
  }

  /** Zooms by a factor while keeping the world point under (sx, sy) in place. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    this.centerX = wx - (sx - this.viewportWidth / 2) / this.scale;
    this.centerY = wy - (sy - this.viewportHeight / 2) / this.scale;
    this.clamp();
  }

  lookAt(wx: number, wy: number, scale: number): void {
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, scale));
    this.centerX = wx;
    this.centerY = wy;
    this.clamp();
  }

  /** Visible world rectangle [x0, y0, x1, y1]. */
  visibleRect(): [number, number, number, number] {
    const [x0, y0] = this.screenToWorld(0, 0);
    const [x1, y1] = this.screenToWorld(this.viewportWidth, this.viewportHeight);
    return [x0, y0, x1, y1];
  }

  /** Keeps the map on screen: centered when smaller than the screen, edge-bound otherwise. */
  private clamp(): void {
    const halfW = this.viewportWidth / 2 / this.scale;
    const halfH = this.viewportHeight / 2 / this.scale;
    this.centerX =
      halfW * 2 >= this.worldWidth
        ? this.worldWidth / 2
        : Math.min(this.worldWidth - halfW, Math.max(halfW, this.centerX));
    this.centerY =
      halfH * 2 >= this.worldHeight
        ? this.worldHeight / 2
        : Math.min(this.worldHeight - halfH, Math.max(halfH, this.centerY));
  }
}
