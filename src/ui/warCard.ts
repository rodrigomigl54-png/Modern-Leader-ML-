import { t } from '../i18n';
import { el, flagImage } from './dom';

// War or peace in a glance (Dario, idea 3, after AoH): a compact card with both flags and a
// stamp, near the top of the screen. It never stops the game: it goes away by itself after a
// few seconds, or at a tap.

export interface WarCardSide {
  name: string;
  flag: string | null;
}

const SHOWN_MS = 2600;

export function showWarCard(
  root: HTMLElement,
  kind: 'war' | 'peace',
  a: WarCardSide,
  b: WarCardSide,
): void {
  // One card at a time: a new one replaces the old.
  root.querySelector('.war-card')?.remove();
  const card = el('div', `war-card war-card-${kind}`);
  card.setAttribute('role', 'status');
  const side = (s: WarCardSide): HTMLElement => {
    const box = el('div', 'war-card-side');
    box.append(flagImage(s.flag, 'war-card-flag'), el('span', 'war-card-name', s.name));
    return box;
  };
  card.append(
    side(a),
    el('div', 'war-card-stamp', t(kind === 'war' ? 'warCard.war' : 'warCard.peace')),
    side(b),
  );
  const close = (): void => {
    card.classList.add('war-card-out');
    window.setTimeout(() => card.remove(), 250);
  };
  card.addEventListener('pointerdown', close);
  window.setTimeout(close, SHOWN_MS);
  root.append(card);
}
