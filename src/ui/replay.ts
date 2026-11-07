import { t } from '../i18n';
import type { BorderFrame } from '../sim/borderLog';
import { button, el } from './dom';

// The border timelapse (Dario, idea 8): the map replays how the borders moved during the game,
// in about twenty seconds, with the date in a small bar at the bottom. Pause, scrub or close at
// any time; the map returns to the present when it closes.

export interface ReplayOptions {
  frames: BorderFrame[];
  /** The date of a turn, as shown to the player. */
  dateOf: (turn: number) => string;
  /** Draws one frame's owners on the map. */
  show: (owners: string[]) => void;
}

const TOTAL_MS = 20000;
const MIN_FRAME_MS = 120;

/** Plays the replay; resolves once the player closes it. */
export function playReplay(root: HTMLElement, options: ReplayOptions): Promise<void> {
  return new Promise((resolve) => {
    const { frames } = options;
    const frameMs = Math.max(MIN_FRAME_MS, TOTAL_MS / Math.max(1, frames.length));
    let index = 0;
    let playing = true;
    let timer = 0;
    const bar = el('div', 'replay-bar');
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', t('replay.title'));
    const date = el('span', 'replay-date mono');
    const scrub = document.createElement('input');
    scrub.type = 'range';
    scrub.className = 'replay-scrub';
    scrub.min = '0';
    scrub.max = String(frames.length - 1);
    scrub.setAttribute('aria-label', t('replay.title'));
    const toggle = button('btn btn-small replay-toggle', '', () => {
      // At the end, play again from the start.
      if (!playing && index >= frames.length - 1) index = 0;
      playing = !playing;
      draw();
      schedule();
    });
    const close = button('btn btn-small replay-close', '×', () => {
      window.clearTimeout(timer);
      bar.remove();
      document.body.classList.remove('replaying');
      resolve();
    });
    close.setAttribute('aria-label', t('panel.close'));
    const draw = (): void => {
      const frame = frames[index]!;
      options.show(frame.owners);
      date.textContent = options.dateOf(frame.turn);
      scrub.value = String(index);
      toggle.textContent = playing ? '❚❚' : '▶';
      toggle.setAttribute('aria-label', t(playing ? 'replay.pause' : 'replay.play'));
    };
    const schedule = (): void => {
      window.clearTimeout(timer);
      if (!playing) return;
      timer = window.setTimeout(() => {
        if (index >= frames.length - 1) {
          playing = false;
          draw();
          return;
        }
        index++;
        draw();
        schedule();
      }, frameMs);
    };
    scrub.addEventListener('input', () => {
      index = Number(scrub.value);
      playing = false;
      draw();
      schedule();
    });
    bar.append(el('span', 'replay-title', t('replay.title')), date, toggle, scrub, close);
    document.body.classList.add('replaying');
    root.append(bar);
    draw();
    schedule();
  });
}
