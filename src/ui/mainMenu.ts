import { t, type TranslationKey } from '../i18n';
import { button, el } from './dom';

const HISTORICAL_MODES: { key: TranslationKey; years: string }[] = [
  { key: 'mode.peloponnesian', years: '431–404 BC' },
  { key: 'mode.punic', years: '264–146 BC' },
  { key: 'mode.thirtyYears', years: '1618–1648' },
  { key: 'mode.spanishSuccession', years: '1701–1714' },
  { key: 'mode.sevenYears', years: '1756–1763' },
  { key: 'mode.napoleonic', years: '1803–1815' },
  { key: 'mode.ww1', years: '1914–1918' },
  { key: 'mode.ww2', years: '1939–1945' },
  { key: 'mode.coldWar', years: '1947–1991' },
];

export interface MainMenuActions {
  onNewGame: () => void;
  onLoadGame: () => void;
  onSettings: () => void;
}

/** Main menu (GDD section 13) over the dimmed world map. */
export class MainMenu {
  private readonly root = el('div', 'screen menu');

  constructor(
    parent: HTMLElement,
    private readonly actions: MainMenuActions,
  ) {
    this.root.hidden = true;
    parent.append(this.root);
  }

  show(): void {
    this.render();
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  refresh(): void {
    if (!this.root.hidden) this.render();
  }

  private render(): void {
    const card = el('div', 'menu-card');
    card.append(el('h1', 'menu-title', t('app.title')));

    const modern = button('mode-card mode-card-main', '', this.actions.onNewGame);
    modern.append(
      el('span', 'mode-card-label', t('menu.newGame')),
      el('span', 'mode-card-name', t('menu.modern')),
      el('span', 'badge badge-capital', t('menu.recommended')),
    );

    const historical = el('div', 'mode-grid');
    for (const mode of HISTORICAL_MODES) {
      const item = el('div', 'mode-card mode-card-locked');
      item.setAttribute('aria-disabled', 'true');
      item.append(
        el('span', 'mode-card-name', t(mode.key)),
        el('span', 'mode-card-years mono', mode.years),
        el('span', 'badge', t('menu.comingSoon')),
      );
      historical.append(item);
    }

    const load = button('btn btn-secondary', t('menu.loadGame'), this.actions.onLoadGame);

    card.append(
      modern,
      el('h2', 'menu-subtitle', t('menu.historical')),
      historical,
      el('div', 'menu-actions'),
    );
    card.lastElementChild!.append(
      load,
      button('btn btn-secondary', t('menu.settings'), this.actions.onSettings),
    );
    this.root.replaceChildren(card);
  }
}
