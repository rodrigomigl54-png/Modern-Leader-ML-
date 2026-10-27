import { t } from '../i18n';
import { button, el } from './dom';

export interface GameMenuActions {
  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
  onImport: () => void;
  onSettings: () => void;
  onGoals: () => void;
  onRankings: () => void;
  onNews: () => void;
  onFeedback: () => void;
  onExit: () => void;
}

/** In-game menu: saves, settings and the way back to the main menu. */
export class GameMenu {
  private readonly root = el('div', 'screen game-menu');

  constructor(
    parent: HTMLElement,
    private readonly actions: GameMenuActions,
  ) {
    this.root.hidden = true;
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
    parent.append(this.root);
  }

  show(): void {
    const card = el('div', 'menu-card menu-card-small');
    const item = (
      label: string,
      action: () => void,
      className = 'btn btn-secondary',
    ): HTMLButtonElement =>
      button(className, label, () => {
        this.hide();
        action();
      });
    const list = el('div', 'menu-list');
    list.append(
      item(t('menu.resume'), () => undefined, 'btn btn-primary'),
      item(t('goals.title'), this.actions.onGoals),
      item(t('rank.title'), this.actions.onRankings),
      item(t('news.title'), this.actions.onNews),
      item(t('menu.save'), this.actions.onSave),
      item(t('saves.loadTitle'), this.actions.onLoad),
      item(t('menu.export'), this.actions.onExport),
      item(t('menu.import'), this.actions.onImport),
      item(t('menu.settings'), this.actions.onSettings),
      item(t('settings.feedback'), this.actions.onFeedback),
      item(t('menu.exit'), this.actions.onExit, 'btn btn-danger-outline'),
    );
    card.append(el('h2', 'setup-title', t('menu.gameMenu')), list);
    this.root.replaceChildren(card);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
