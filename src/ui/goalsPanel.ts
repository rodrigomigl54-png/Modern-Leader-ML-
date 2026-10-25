import { t, type TranslationKey } from '../i18n';
import { dateOfTurn } from '../sim/calendar';
import type { SimContext } from '../sim/economy';
import { goalProgress, type Goal } from '../sim/goals';
import type { GameState } from '../sim/newGame';
import { button, el } from './dom';
import { formatGameDate } from './format';

/** The player's goals with progress and deadlines (GDD section 13). */
export class GoalsPanel {
  private readonly root = el('section', 'dossier goals');
  private game: GameState | null = null;

  constructor(
    parent: HTMLElement,
    private readonly sim: SimContext,
    private readonly describe: (goal: Goal) => string,
  ) {
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(game: GameState): void {
    this.game = game;
    this.render();
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  update(game: GameState): void {
    this.game = game;
    if (this.isOpen) this.render();
  }

  private render(): void {
    const game = this.game!;
    const header = el('header', 'dossier-strip');
    header.append(
      el('span', 'dossier-code', game.player.countryId),
      el('span', 'dossier-label', t('goals.title')),
      button('dossier-close', '×', () => this.close()),
    );
    header.lastElementChild!.setAttribute('aria-label', t('panel.close'));
    const list = el('ul', 'goal-list');
    for (const g of game.goals) {
      const item = el('li', `goal goal-${g.status}`);
      const progress = goalProgress(game, this.sim, g);
      const bar = el('div', 'goal-bar');
      const fill = el('div', 'goal-fill');
      fill.style.width = `${Math.round(progress * 100)}%`;
      bar.append(fill);
      item.append(
        el('span', 'goal-name', this.describe(g)),
        el(
          'span',
          'goal-status mono',
          g.status === 'active'
            ? t('goals.until', {
                date: formatGameDate(dateOfTurn(game.world.startDate, g.deadline)),
              })
            : t(`goals.${g.status}` as TranslationKey),
        ),
        bar,
      );
      list.append(item);
    }
    if (!game.goals.length) list.append(el('li', 'goal', t('goals.none')));
    this.root.replaceChildren(header, el('h2', 'dossier-title', t('goals.title')), list);
  }
}
