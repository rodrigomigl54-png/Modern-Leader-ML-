import { t } from '../i18n';
import { button, el } from './dom';

/** Wire-service strip at the bottom of the screen (GDD section 13); tap opens all the news. */
export class NewsTicker {
  private readonly root: HTMLButtonElement;
  private readonly line = el('span', 'ticker-line mono');
  private shown = '';

  constructor(parent: HTMLElement, onOpen: () => void) {
    this.root = button('ticker', '', onOpen);
    this.root.setAttribute('aria-label', t('news.title'));
    this.root.hidden = true;
    const track = el('span', 'ticker-track');
    track.append(this.line);
    this.root.append(el('span', 'ticker-label mono', t('news.wire')), track);
    parent.append(this.root);
  }

  /** Latest headlines, newest first. */
  update(headlines: readonly string[]): void {
    const text = headlines.length ? headlines.slice(0, 6).join('  ◆  ') : t('news.quiet');
    if (text === this.shown) return;
    this.shown = text;
    this.line.textContent = text;
    // Restart the scroll for new headlines; long lines scroll slower.
    this.line.style.animation = 'none';
    void this.line.offsetWidth;
    this.line.style.animation = '';
    this.line.style.animationDuration = `${Math.max(14, text.length / 7)}s`;
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
    this.shown = '';
  }
}

/** All recent headlines, newest first, with their dates. */
export function newsDialog(
  root: HTMLElement,
  items: readonly { date: string; text: string }[],
): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const dialog = el('div', 'modal modal-wide modal-telegram');
    dialog.setAttribute('role', 'dialog');
    const close = (): void => {
      backdrop.remove();
      resolve();
    };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    const list = el('ol', 'news-list');
    for (const item of items) {
      const li = el('li', 'news-item');
      li.append(el('span', 'news-date mono', item.date), el('span', 'news-text', item.text));
      list.append(li);
    }
    if (!items.length) list.append(el('li', 'news-item', t('news.quiet')));
    const actions = el('div', 'modal-actions');
    actions.append(button('btn btn-primary', t('minister.understood'), close));
    dialog.append(el('h2', 'modal-title', t('news.title')), list, actions);
    backdrop.append(dialog);
    root.append(backdrop);
  });
}
