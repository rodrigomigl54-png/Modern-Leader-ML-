import { t } from '../i18n';
import { formatUsd } from '../app/present';
import type { SimContext } from '../sim/economy';
import { recruitQuote, type RecruitMode, type UnitKind } from '../sim/military';
import type { GameState } from '../sim/newGame';
import { button, el } from './dom';

export interface RecruitDialogOptions {
  parent: HTMLElement;
  sim: SimContext;
  cityName: (cityId: number) => string;
  formatCount: (n: number) => string;
  onConfirm: (kind: UnitKind, mode: RecruitMode, amount: number) => void;
}

interface Choice {
  kind: UnitKind;
  mode: RecruitMode;
  fixed: number;
  percent: number;
}

/**
 * Recruitment in the selected cities (GDD section 8): a fixed number per city (takes what is
 * available, with a warning where short) or a percentage of each city's available manpower.
 */
export class RecruitDialog {
  private readonly backdrop = el('div', 'modal-backdrop');
  private choice: Choice = { kind: 'regular', mode: 'fixed', fixed: 1000, percent: 25 };

  constructor(private readonly options: RecruitDialogOptions) {
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    options.parent.append(this.backdrop);
  }

  open(game: GameState, cityIds: number[]): void {
    this.render(game, cityIds);
    this.backdrop.hidden = false;
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  private render(game: GameState, cityIds: number[]): void {
    const { sim } = this.options;
    const c = this.choice;
    const redraw = (): void => this.render(game, cityIds);
    const dialog = el('div', 'modal modal-wide');
    dialog.setAttribute('role', 'dialog');
    dialog.append(
      el('h2', 'modal-title', t('recruit.title')),
      el('p', 'modal-text', t('invest.selectedCount', { count: cityIds.length })),
    );

    const segmented = <T extends string>(
      values: readonly T[],
      current: T,
      label: (v: T) => string,
      set: (v: T) => void,
    ): HTMLElement => {
      const group = el('div', 'segmented');
      for (const v of values) {
        const b = button(`segment${v === current ? ' segment-on' : ''}`, label(v), () => {
          set(v);
          redraw();
        });
        b.setAttribute('aria-pressed', String(v === current));
        group.append(b);
      }
      return group;
    };
    dialog.append(
      el('h3', 'setup-subtitle', t('recruit.kind')),
      segmented<UnitKind>(
        ['regular', 'special'],
        c.kind,
        (k) => t(`recruit.${k}`),
        (k) => (c.kind = k),
      ),
      el(
        'p',
        'setup-hint',
        t(c.kind === 'special' ? 'recruit.specialHint' : 'recruit.regularHint'),
      ),
      el('h3', 'setup-subtitle', t('recruit.mode')),
      segmented<RecruitMode>(
        ['fixed', 'percent'],
        c.mode,
        (m) => t(`recruit.${m}`),
        (m) => (c.mode = m),
      ),
    );

    const input = el('input', 'input recruit-amount');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.max = c.mode === 'percent' ? '100' : '1000000';
    input.step = c.mode === 'percent' ? '5' : '100';
    input.value = String(c.mode === 'percent' ? c.percent : c.fixed);
    input.setAttribute(
      'aria-label',
      t(c.mode === 'percent' ? 'recruit.percentLabel' : 'recruit.fixedLabel'),
    );
    input.addEventListener('change', () => {
      const v = Math.max(1, Math.floor(Number(input.value) || 1));
      if (c.mode === 'percent') c.percent = Math.min(100, v);
      else c.fixed = v;
      redraw();
    });
    const row = el('label', 'recruit-row');
    row.append(
      el('span', '', t(c.mode === 'percent' ? 'recruit.percentLabel' : 'recruit.fixedLabel')),
      input,
    );
    dialog.append(row);

    const amount = c.mode === 'percent' ? c.percent : c.fixed;
    const quote = recruitQuote(game, sim, game.player.countryId, cityIds, c.kind, c.mode, amount);
    const footer = el('div', 'modal-footer');
    const facts = el('dl', 'facts');
    const fact = (label: string, value: string, cls = 'mono'): void => {
      facts.append(el('dt', '', label), el('dd', cls, value));
    };
    fact(t('recruit.total'), this.options.formatCount(quote.total));
    fact(t('invest.totalCost'), formatUsd(quote.cost));
    fact(t('recruit.training'), t('invest.weeks', { weeks: quote.turns }));
    const short = quote.cities.filter((x) => x.taken < x.wanted);
    if (c.mode === 'fixed' && short.length) {
      fact(
        t('recruit.short'),
        short
          .slice(0, 6)
          .map((x) => `${this.options.cityName(x.cityId)} ${this.options.formatCount(x.taken)}`)
          .join(', ') + (short.length > 6 ? ' …' : ''),
        'danger',
      );
    }
    if (quote.skipped.length)
      fact(
        t(c.kind === 'special' ? 'recruit.noBase' : 'recruit.skipped'),
        String(quote.skipped.length),
        'danger',
      );
    footer.append(facts);
    if (quote.total > 0 && !quote.affordable)
      footer.append(el('p', 'setup-warning', t('invest.notEnough')));
    const actions = el('div', 'modal-actions');
    actions.append(button('btn btn-secondary', t('saves.cancel'), () => this.close()));
    const confirm = button(
      'btn btn-primary',
      t('recruit.confirm', { count: this.options.formatCount(quote.total) }),
      () => {
        this.close();
        this.options.onConfirm(c.kind, c.mode, amount);
      },
    );
    confirm.disabled = !quote.affordable;
    actions.append(confirm);
    footer.append(actions);
    dialog.append(footer);
    this.backdrop.replaceChildren(dialog);
  }
}
