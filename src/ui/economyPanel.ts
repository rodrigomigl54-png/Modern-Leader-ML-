import { t, type TranslationKey } from '../i18n';
import { formatPercent, formatSignedUsd, formatUsd, signClass } from '../app/present';
import type { Command } from '../sim/commands';
import { growthRate, printAmount, weeklyBudget, type SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import { consumptionOf, productionOf, RESOURCES } from '../sim/resources';
import { button, el } from './dom';

export interface EconomyPanelOptions {
  parent: HTMLElement;
  sim: SimContext;
  cityName: (cityId: number) => string;
  countryName: (countryId: string) => string;
  issue: (command: Command) => void;
  confirmPrint: (amount: string) => Promise<boolean>;
}

/** Budget, taxes, public services, money printing and investment projects (GDD section 6). */
export class EconomyPanel {
  private readonly root = el('section', 'dossier economy');
  private game: GameState | null = null;

  constructor(private readonly options: EconomyPanelOptions) {
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    options.parent.append(this.root);
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

  /** Re-renders with a new state (after a command or a turn) if open. */
  update(game: GameState): void {
    this.game = game;
    if (this.isOpen) this.render();
  }

  private render(): void {
    const game = this.game!;
    const { sim } = this.options;
    const id = game.player.countryId;
    const e = game.economy.countries[id]!;
    const b = weeklyBudget(game, id, sim);
    const limits = sim.economy.limits;

    const header = el('header', 'dossier-strip');
    header.append(el('span', 'dossier-code', id), el('span', 'dossier-label', t('econ.ministry')));
    header.append(button('dossier-close', '×', () => this.close()));
    header.lastElementChild!.setAttribute('aria-label', t('econ.close'));

    const key = el('dl', 'dossier-facts');
    const fact = (label: string, value: string, cls = 'mono'): void => {
      key.append(el('dt', '', label), el('dd', cls, value));
    };
    fact(
      t('econ.gdp'),
      `${formatUsd(e.gdp)} · ${t('econ.growth', { value: formatPercent(growthRate(e, sim.economy)) })}`,
    );
    fact(t('econ.treasury'), formatUsd(e.treasury));
    fact(
      t('econ.debt'),
      `${formatUsd(e.debt)} · ${t('econ.debtShare', { value: formatPercent(e.debt / e.gdp, 0) })}`,
    );
    fact(
      t('econ.inflation'),
      t('econ.percent', { value: formatPercent(e.inflation) }),
      e.inflation >= sim.economy.inflation.alertThreshold ? 'mono danger' : 'mono',
    );

    const budget = el('dl', 'budget');
    const line = (label: string, value: number, cls = ''): void => {
      budget.append(el('dt', cls, label), el('dd', `mono ${cls}`, formatUsd(value)));
    };
    // Income, expenses and the net change per week, from the same budget the turn applies.
    const aid = e.aid ?? 0;
    const section = (label: string): void => {
      budget.append(el('dt', 'budget-head', label), el('dd', 'budget-head', ''));
    };
    section(t('econ.income'));
    line(t('econ.taxes'), b.taxes);
    if (b.investmentReturns > 0) line(t('econ.returns'), b.investmentReturns);
    if (b.trade > 0) line(t('econ.trade'), b.trade);
    if (aid > 0) line(t('econ.aid'), aid);
    line(t('econ.totalIncome'), b.income + aid, 'budget-sum gain');
    section(t('econ.expenses'));
    line(t('econ.military'), -b.military);
    line(t('econ.services'), -b.services);
    if (b.interest > 0) line(t('econ.interest'), -b.interest);
    if (b.upkeep > 0) line(t('econ.upkeep'), -b.upkeep);
    line(t('econ.totalExpenses'), -b.spending, 'budget-sum loss');
    const net = b.balance + aid;
    budget.append(
      el('dt', 'budget-total', t('econ.net')),
      el(
        'dd',
        `mono budget-total ${signClass(net)}`,
        t('econ.perWeek', { value: formatSignedUsd(net) }),
      ),
    );

    const slider = (
      label: string,
      value: number,
      min: number,
      max: number,
      onChange: (v: number) => Command,
    ): HTMLElement => {
      const row = el('label', 'slider');
      const text = el('span', 'slider-label', label);
      const out = el('span', 'slider-value mono', `${formatPercent(value, 0)}%`);
      const input = el('input');
      input.type = 'range';
      input.min = String(Math.round(min * 100));
      input.max = String(Math.round(max * 100));
      input.step = '1';
      input.value = String(Math.round(value * 100));
      input.addEventListener('input', () => (out.textContent = `${input.value}%`));
      input.addEventListener('change', () =>
        this.options.issue(onChange(Number(input.value) / 100)),
      );
      row.append(text, out, input);
      return row;
    };

    const amount = formatUsd(printAmount(game, id, sim.economy));
    const print = button('btn btn-danger-outline', t('econ.print'), () => {
      void this.options
        .confirmPrint(amount)
        .then((ok) => ok && this.options.issue({ type: 'printMoney', countryId: id }));
    });

    const projects = el('ul', 'dossier-cities');
    const mine = game.economy.buildings
      .filter((x) => x.owner === id)
      .slice(-30)
      .reverse();
    for (const p of mine) {
      const item = el('li');
      item.append(
        el(
          'span',
          'city-name',
          `${t(`building.${p.category}` as TranslationKey)} · ${this.options.cityName(p.cityId)}`,
        ),
        el(
          'span',
          p.completed ? 'badge' : 'badge badge-capital',
          p.completed ? t('econ.done') : t('econ.weeksLeft', { weeks: p.completeTurn - game.turn }),
        ),
      );
      if (p.host !== id) item.append(el('span', 'badge', p.host));
      projects.append(item);
    }
    if (mine.length === 0) projects.append(el('li', 'muted', t('econ.noProjects')));

    // Resources (GDD section 6): production, needs, how much of it we get, exports.
    const resources = el('table', 'resource-table');
    const head = el('tr');
    for (const h of ['', t('res.production'), t('res.needs'), t('res.supply')])
      head.append(el('th', '', h));
    resources.append(head);
    const trade = game.resources?.trade[id];
    RESOURCES.forEach((r, ri) => {
      const row = el('tr');
      const supply = trade?.supply[ri] ?? 1;
      const share = (v: number): string => formatPercent(v / 1000, 1);
      row.append(
        el('td', '', t(`res.${r}`)),
        el('td', 'mono', `${share(productionOf(game, id, ri))}%`),
        el('td', 'mono', `${share(consumptionOf(game, id, ri))}%`),
        el('td', supply < 0.85 ? 'mono danger' : 'mono', `${formatPercent(supply, 0)}%`),
      );
      resources.append(row);
      // Where our imports come from (GDD section 6: trade with partner countries).
      const sources = trade?.sources?.[ri] ?? [];
      if (sources.length) {
        const from = el('tr', 'resource-sources');
        const cell = el(
          'td',
          'setup-hint',
          t('res.from', {
            list: sources
              .map(([c, sh]) => `${this.options.countryName(c)} ${formatPercent(sh, 0)}%`)
              .join(', '),
          }),
        );
        cell.colSpan = 4;
        from.append(cell);
        resources.append(from);
      }
    });
    const partners = (trade?.partners ?? []).slice(0, 5);
    // World prices against the start (they follow shortages and gluts).
    const base = game.resources?.basePrice;
    const prices = RESOURCES.map((r, ri) => {
      const change = base?.[ri] ? (game.resources.price[ri] ?? 0) / base[ri]! - 1 : 0;
      const sign = change > 0.005 ? '+' : change < -0.005 ? '−' : '±';
      return `${t(`res.${r}`)} ${sign}${formatPercent(Math.abs(change), 0)}%`;
    }).join(', ');

    // Policy: accept or refuse foreign investment in our cities.
    const policy = el('div', 'segmented');
    for (const reject of [false, true]) {
      const on = !!e.rejectForeignInvestment === reject;
      const b = button(
        on ? 'segment segment-selected' : 'segment',
        t(reject ? 'econ.rejectForeign' : 'econ.acceptForeign'),
        () => this.options.issue({ type: 'setForeignInvestment', countryId: id, reject }),
      );
      b.setAttribute('aria-pressed', String(on));
      policy.append(b);
    }
    const policyRow = el('div', 'setup-row');
    policyRow.append(el('span', 'setup-row-label', t('econ.foreignInvestment')), policy);

    this.root.replaceChildren(
      header,
      el('h2', 'dossier-title', t('econ.title')),
      key,
      el('h3', 'dossier-subtitle', t('econ.budget')),
      budget,
      policyRow,
      el('p', 'setup-hint', t('econ.foreignHint')),
      slider(t('econ.taxRate'), e.taxRate, limits.taxRateMin, limits.taxRateMax, (rate) => ({
        type: 'setTax',
        countryId: id,
        rate,
      })),
      slider(
        t('econ.servicesShare'),
        e.servicesShare,
        limits.servicesShareMin,
        limits.servicesShareMax,
        (share) => ({
          type: 'setServices',
          countryId: id,
          share,
        }),
      ),
      el('p', 'setup-hint', t('econ.printHint', { amount })),
      print,
      el('h3', 'dossier-subtitle', t('res.title')),
      resources,
      el('p', 'setup-hint', t('res.hint', { exports: formatUsd(trade?.exportValue ?? 0) })),
      el('p', 'setup-hint', t('res.prices', { list: prices })),
      el(
        'p',
        'setup-hint',
        partners.length
          ? t('res.partners', {
              list: partners
                .map(([c, usd]) => `${this.options.countryName(c)} ${formatUsd(usd)}`)
                .join(', '),
            })
          : t('res.noPartners'),
      ),
      el('h3', 'dossier-subtitle', t('econ.projects')),
      projects,
    );
  }
}
