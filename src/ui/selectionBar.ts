import { t } from '../i18n';
import { button, el } from './dom';

export interface SelectionActions {
  onInvest: () => void;
  onRecruit: () => void;
  onClear: () => void;
}

/**
 * Shows the multi-select (GDD section 13: one action for many): cities for investment and
 * recruitment, armies to send to a province.
 */
export class SelectionBar {
  private readonly root = el('div', 'selection-bar');

  constructor(
    parent: HTMLElement,
    private readonly actions: SelectionActions,
  ) {
    this.root.hidden = true;
    parent.append(this.root);
  }

  update(cities: number, armies = 0): void {
    this.root.hidden = cities === 0 && armies === 0;
    if (this.root.hidden) return;
    const children: HTMLElement[] = [];
    if (cities > 0) {
      children.push(
        el('span', 'selection-count', t('invest.selectedCount', { count: cities })),
        button('btn btn-primary', t('invest.invest'), this.actions.onInvest),
        button('btn btn-primary', t('recruit.recruit'), this.actions.onRecruit),
      );
    }
    if (armies > 0) {
      children.push(el('span', 'selection-count', t('army.selectedCount', { count: armies })));
    }
    children.push(button('btn btn-secondary', t('invest.clear'), this.actions.onClear));
    this.root.replaceChildren(...children);
  }
}
