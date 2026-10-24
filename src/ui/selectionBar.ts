import { t } from '../i18n';
import { button, el } from './dom';

/** Shows the multi-city selection with its actions (GDD section 13: one action for all). */
export class SelectionBar {
  private readonly root = el('div', 'selection-bar');

  constructor(
    parent: HTMLElement,
    private readonly actions: { onInvest: () => void; onClear: () => void },
  ) {
    this.root.hidden = true;
    parent.append(this.root);
  }

  update(count: number): void {
    this.root.hidden = count === 0;
    if (count === 0) return;
    this.root.replaceChildren(
      el('span', 'selection-count', t('invest.selectedCount', { count })),
      button('btn btn-primary', t('invest.invest'), this.actions.onInvest),
      button('btn btn-secondary', t('invest.clear'), this.actions.onClear),
    );
  }
}
