import { t, type TranslationKey } from '../i18n';
import { formatUsd } from '../app/present';
import { investmentQuote, type SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import { button, el } from './dom';

export interface InvestDialogOptions {
  parent: HTMLElement;
  sim: SimContext;
  countryName: (id: string) => string;
  onConfirm: (category: string) => void;
}

/**
 * Investment in the selected cities (GDD section 6): choose a category, see the total cost, build
 * time and expected effect, then confirm.
 */
export class InvestDialog {
  private readonly backdrop = el('div', 'modal-backdrop');

  constructor(private readonly options: InvestDialogOptions) {
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    options.parent.append(this.backdrop);
  }

  open(game: GameState, cityIds: number[]): void {
    this.render(game, cityIds, null);
    this.backdrop.hidden = false;
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  private render(game: GameState, cityIds: number[], chosen: string | null): void {
    const { sim } = this.options;
    const investor = game.player.countryId;
    const dialog = el('div', 'modal modal-wide');
    dialog.setAttribute('role', 'dialog');
    dialog.append(
      el('h2', 'modal-title', t('invest.title')),
      el('p', 'modal-text', t('invest.selectedCount', { count: cityIds.length })),
    );

    const list = el('div', 'option-list');
    for (const cat of sim.economy.investment.categories) {
      const option = button(`option${cat.id === chosen ? ' option-selected' : ''}`, '', () =>
        this.render(game, cityIds, cat.id),
      );
      option.append(
        el('span', 'option-title', t(`building.${cat.id}` as TranslationKey)),
        el(
          'span',
          'option-hint',
          t('invest.perCity', { cost: formatUsd(cat.costUsd), weeks: cat.buildTurns }),
        ),
      );
      list.append(option);
    }
    dialog.append(el('h3', 'setup-subtitle', t('invest.choose')), list);

    // Quote and confirm stay visible at the bottom while the list scrolls.
    const footer = el('div', 'modal-footer');
    const actions = el('div', 'modal-actions');
    actions.append(button('btn btn-secondary', t('saves.cancel'), () => this.close()));
    const quote = chosen ? investmentQuote(game, sim, investor, cityIds, chosen) : null;
    if (quote) {
      const facts = el('dl', 'facts');
      const fact = (label: string, value: string, cls = 'mono'): void => {
        facts.append(el('dt', '', label), el('dd', cls, value));
      };
      fact(t('invest.totalCost'), formatUsd(quote.totalCost));
      fact(t('invest.buildTime'), t('invest.weeks', { weeks: quote.buildTurns }));
      if (quote.ownGdpPerYear > 0)
        fact(t('invest.ownGdp'), t('invest.perYear', { value: formatUsd(quote.ownGdpPerYear) }));
      if (quote.foreignGdpPerYear > 0) {
        fact(
          t('invest.foreignGdp'),
          t('invest.perYear', { value: formatUsd(quote.foreignGdpPerYear) }),
        );
        fact(t('invest.returns'), t('invest.perYear', { value: formatUsd(quote.returnPerYear) }));
      }
      const refused = [
        ...new Set(quote.cities.filter((c) => c.consent === 'refuses').map((c) => c.host)),
      ];
      if (refused.length)
        fact(t('invest.refused'), refused.map(this.options.countryName).join(', '), 'danger');
      footer.append(facts);
      if (quote.buildable.length > 0 && !quote.affordable)
        footer.append(el('p', 'setup-warning', t('invest.notEnough')));
      if (quote.buildable.length === 0)
        footer.append(el('p', 'setup-warning', t('invest.allRefused')));
      const confirm = button(
        'btn btn-primary',
        t('invest.confirm', { cost: formatUsd(quote.totalCost) }),
        () => {
          this.close();
          this.options.onConfirm(quote.category.id);
        },
      );
      confirm.disabled = !quote.affordable;
      actions.append(confirm);
    }
    footer.append(actions);
    dialog.append(footer);
    this.backdrop.replaceChildren(dialog);
  }
}
