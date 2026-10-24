import { el } from './dom';

/** Short message that slides in at the top, like an incoming telegram (GDD section 13). */
export class Toasts {
  private readonly root = el('div', 'toasts');

  constructor(parent: HTMLElement) {
    this.root.setAttribute('aria-live', 'polite');
    parent.append(this.root);
  }

  show(text: string, kind: 'info' | 'error' = 'info'): void {
    const toast = el('div', `toast toast-${kind}`, text);
    this.root.append(toast);
    setTimeout(() => toast.classList.add('toast-out'), 2600);
    setTimeout(() => toast.remove(), 3000);
  }
}
