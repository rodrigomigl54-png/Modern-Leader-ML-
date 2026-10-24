/** Small FPS readout of rendered frames (hidden by default, toggled in the settings). */
export class FpsCounter {
  private readonly label = document.createElement('div');
  private frames: number[] = [];
  private timer = 0;

  constructor(root: HTMLElement) {
    this.label.className = 'fps-counter';
    this.label.hidden = true;
    root.append(this.label);
  }

  setVisible(visible: boolean): void {
    this.label.hidden = !visible;
    window.clearInterval(this.timer);
    if (visible) {
      this.render();
      this.timer = window.setInterval(() => this.render(), 500);
    }
  }

  frame(): void {
    this.frames.push(performance.now());
  }

  private render(): void {
    const now = performance.now();
    this.frames = this.frames.filter((t) => now - t < 1000);
    // An idle map renders nothing, so show a dash instead of 0.
    this.label.textContent = this.frames.length ? `${this.frames.length} fps` : '– fps';
  }
}
