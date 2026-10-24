import { t, type TranslationKey } from '../i18n';
import { formatUsd } from '../app/present';
import type { SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import { productionQuote, weaponsRules, type WeaponKind } from '../sim/weapons';
import { button, el } from './dom';

export interface ProduceDialogOptions {
  parent: HTMLElement;
  sim: SimContext;
  formatCount: (n: number) => string;
  onConfirm: (weapon: WeaponKind, tier: number, count: number) => void;
}

/** Orders missiles or drones from the country's own factories (GDD section 6). */
export class ProduceDialog {
  private readonly backdrop = el('div', 'modal-backdrop');
  private weapon: WeaponKind = 'missile';
  private tier = 1;
  private count = 10;

  constructor(private readonly options: ProduceDialogOptions) {
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    options.parent.append(this.backdrop);
  }

  open(game: GameState): void {
    this.render(game);
    this.backdrop.hidden = false;
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  private render(game: GameState): void {
    const { sim } = this.options;
    const rules = weaponsRules(sim);
    const id = game.player.countryId;
    const arsenal = game.weapons.countries[id]!;
    const redraw = (): void => this.render(game);
    const dialog = el('div', 'modal modal-wide');
    dialog.setAttribute('role', 'dialog');
    dialog.append(el('h2', 'modal-title', t('produce.title')));

    const tabs = el('div', 'segmented');
    for (const w of ['missile', 'drone'] as const) {
      const b = button(`segment${w === this.weapon ? ' segment-on' : ''}`, t(`strike.${w}`), () => {
        this.weapon = w;
        this.tier = 1;
        redraw();
      });
      b.setAttribute('aria-pressed', String(w === this.weapon));
      tabs.append(b);
    }
    dialog.append(tabs);

    const missiles = this.weapon === 'missile';
    const tiers = missiles ? rules.missiles : rules.drones;
    const maxTier = arsenal.tech[missiles ? 0 : 1];
    const list = el('div', 'option-list');
    tiers.forEach((tier, i) => {
      const option = button(`option${this.tier === i + 1 ? ' option-selected' : ''}`, '', () => {
        this.tier = i + 1;
        redraw();
      });
      option.disabled = i + 1 > maxTier;
      option.append(
        el(
          'span',
          'option-title',
          t(
            (missiles
              ? `strike.missileTier${i + 1}`
              : `strike.droneTier${i + 1}`) as TranslationKey,
          ),
        ),
        el(
          'span',
          'option-hint',
          i + 1 > maxTier
            ? t('produce.locked')
            : t('produce.each', { cost: formatUsd(tier.costUsd) }),
        ),
      );
      list.append(option);
    });
    dialog.append(list);

    const input = el('input', 'input recruit-amount');
    input.type = 'number';
    input.inputMode = 'numeric';
    input.min = '1';
    input.value = String(this.count);
    input.addEventListener('change', () => {
      this.count = Math.max(1, Math.floor(Number(input.value) || 1));
      redraw();
    });
    const row = el('label', 'recruit-row');
    row.append(el('span', '', t('strike.count')), input);
    dialog.append(row);

    const quote = productionQuote(game, sim, id, this.weapon, this.tier, this.count);
    const footer = el('div', 'modal-footer');
    const facts = el('dl', 'facts');
    const fact = (label: string, value: string): void => {
      facts.append(el('dt', '', label), el('dd', 'mono', value));
    };
    fact(t('produce.factories'), String(quote.factories));
    fact(t('invest.totalCost'), formatUsd(quote.cost));
    if (quote.turns > 0) fact(t('invest.buildTime'), t('invest.weeks', { weeks: quote.turns }));
    footer.append(facts);
    if (quote.allowed === 'noFactory')
      footer.append(el('p', 'setup-warning', t('produce.noFactory')));
    if (quote.allowed === 'notEnoughMoney')
      footer.append(el('p', 'setup-warning', t('invest.notEnough')));
    const actions = el('div', 'modal-actions');
    actions.append(button('btn btn-secondary', t('saves.cancel'), () => this.close()));
    const weapon = this.weapon;
    const tier = this.tier;
    const count = this.count;
    const confirm = button(
      'btn btn-primary',
      t('produce.confirm', { count: this.options.formatCount(count) }),
      () => {
        this.close();
        this.options.onConfirm(weapon, tier, count);
      },
    );
    confirm.disabled = quote.allowed !== null;
    actions.append(confirm);
    footer.append(actions);
    dialog.append(footer);
    this.backdrop.replaceChildren(dialog);
  }
}
