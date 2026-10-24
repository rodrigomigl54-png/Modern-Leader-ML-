import { t, type TranslationKey } from '../i18n';
import { formatPercent, formatUsd } from '../app/present';
import type { Command } from '../sim/commands';
import { growthRate, printAmount, weeklyBudget, type SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import { button, el } from './dom';

export interface EconomyPanelOptions {
  parent: HTMLElement;
  sim: SimContext;
  cityName: (cityId: number) => string;
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
    line(t('econ.taxes'), b.taxes);
    if (b.investmentReturns > 0) line(t('econ.returns'), b.investmentReturns);
    line(t('econ.military'), -b.military);
    line(t('econ.services'), -b.services);
    if (b.interest > 0) line(t('econ.interest'), -b.interest);
    if (b.upkeep > 0) line(t('econ.upkeep'), -b.upkeep);
    line(t('econ.balance'), b.balance, b.balance < 0 ? 'budget-total danger' : 'budget-total');

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

    this.root.replaceChildren(
      header,
      el('h2', 'dossier-title', t('econ.title')),
      key,
      el('h3', 'dossier-subtitle', t('econ.budget')),
      budget,
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
      el('h3', 'dossier-subtitle', t('econ.projects')),
      projects,
    );
  }
}
