import { t, type TranslationKey } from '../i18n';
import { formatSignedUsd, formatUsd, signClass } from '../app/present';
import { investmentQuote, type SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import { button, el } from './dom';

export interface InvestDialogOptions {
  parent: HTMLElement;
  sim: SimContext;
  countryName: (id: string) => string;
  onConfirm: (category: string, count: number) => void;
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

  private count = 1;

  open(game: GameState, cityIds: number[], category: string | null = null): void {
    this.count = 1;
    this.render(game, cityIds, category);
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
    // How many of the building go into each selected city.
    const max = sim.economy.investment.maxPerCity ?? 1;
    if (max > 1) {
      const stepper = el('div', 'stepper');
      const step = (delta: number): HTMLButtonElement => {
        const b = button('btn btn-secondary stepper-button', delta < 0 ? '−' : '+', () => {
          this.count = Math.max(1, Math.min(max, this.count + delta));
          this.render(game, cityIds, chosen);
        });
        b.disabled = delta < 0 ? this.count <= 1 : this.count >= max;
        b.setAttribute('aria-label', t(delta < 0 ? 'invest.fewer' : 'invest.more'));
        return b;
      };
      stepper.append(
        el('span', 'stepper-label', t('invest.perCityCount')),
        step(-1),
        el('span', 'stepper-value mono', String(this.count)),
        step(1),
      );
      footer.append(stepper);
    }

    const actions = el('div', 'modal-actions');
    actions.append(button('btn btn-secondary', t('saves.cancel'), () => this.close()));
    const quote = chosen ? investmentQuote(game, sim, investor, cityIds, chosen, this.count) : null;
    if (quote) {
      const facts = el('dl', 'facts');
      const fact = (label: string, value: string, cls = 'mono'): void => {
        facts.append(el('dt', '', label), el('dd', cls, value));
      };
      fact(t('invest.totalCost'), formatUsd(quote.totalCost));
      fact(t('invest.buildTime'), t('invest.weeks', { weeks: quote.buildTurns }));
      // Building levels: each level in a city costs more than the one before.
      const built = quote.cities.filter((c) => c.consent !== 'refuses');
      if (built.length) {
        const from = Math.min(...built.map((c) => c.level));
        const to = Math.max(...built.map((c) => c.level)) + quote.count;
        fact(
          t('invest.level'),
          from + 1 === to
            ? t('invest.levelOne', { level: to })
            : t('invest.levels', { from: from + 1, to }),
        );
      }
      fact(
        t('invest.budget'),
        t('econ.perWeek', { value: formatSignedUsd(quote.budgetPerWeek) }),
        `mono ${signClass(quote.budgetPerWeek)}`,
      );
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
          this.options.onConfirm(quote.category.id, quote.count);
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
