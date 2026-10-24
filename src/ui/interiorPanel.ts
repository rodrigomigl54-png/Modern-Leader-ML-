import { t } from '../i18n';
import { formatPercent, formatUsd } from '../app/present';
import type { Command } from '../sim/commands';
import type { SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import {
  assimilationQuote,
  nationalSupport,
  productionFactor,
  unassimilatedProvinces,
} from '../sim/population';
import { button, el } from './dom';

export interface InteriorPanelOptions {
  parent: HTMLElement;
  sim: SimContext;
  provinceName: (provinceId: number) => string;
  countryName: (countryId: string) => string;
  /** Opens a province on the map. */
  showProvince: (provinceId: number) => void;
  issue: (command: Command) => void;
  /** Asks for confirmation (cost and risk), then assimilates. */
  assimilate: (provinceIds: number[]) => void;
}

const LIST_LIMIT = 20;

/** Public support, riots, rebels and assimilation (GDD section 7). */
export class InteriorPanel {
  private readonly root = el('section', 'dossier interior');
  private game: GameState | null = null;

  constructor(private readonly options: InteriorPanelOptions) {
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

  update(game: GameState): void {
    this.game = game;
    if (this.isOpen) this.render();
  }

  private render(): void {
    const game = this.game!;
    const { sim } = this.options;
    const rules = sim.population!;
    const id = game.player.countryId;
    const pop = game.population;
    const country = game.world.countries.find((c) => c.id === id)!;
    const support = nationalSupport(game, sim, id);

    const header = el('header', 'dossier-strip');
    header.append(
      el('span', 'dossier-code', id),
      el('span', 'dossier-label', t('interior.ministry')),
      button('dossier-close', '×', () => this.close()),
    );
    header.lastElementChild!.setAttribute('aria-label', t('panel.close'));

    const rioting = country.provinceIds
      .filter((p) => pop.riotTurns[p]! > 0)
      .sort((a, b) => pop.support[a]! - pop.support[b]! || a - b);
    const factions = pop.factions.filter((f) => f.parent === id);

    const facts = el('dl', 'dossier-facts');
    const fact = (label: string, value: string, cls = 'mono'): void => {
      facts.append(el('dt', '', label), el('dd', cls, value));
    };
    fact(
      t('interior.support'),
      `${formatPercent(support / 100, 0)}%`,
      support < rules.riots.threshold ? 'mono danger' : 'mono',
    );
    fact(
      t('interior.riotingProvinces'),
      String(rioting.length),
      rioting.length ? 'mono danger' : 'mono',
    );
    fact(t('interior.production'), `${formatPercent(productionFactor(game, sim, id), 0)}%`);

    const provinceList = (ids: number[], badge: (p: number) => string): HTMLElement => {
      const list = el('ul', 'dossier-cities');
      for (const p of ids.slice(0, LIST_LIMIT)) {
        const item = el('li');
        const open = button('link-button city-name', this.options.provinceName(p), () =>
          this.options.showProvince(p),
        );
        item.append(open, el('span', 'badge', badge(p)));
        list.append(item);
      }
      if (ids.length > LIST_LIMIT)
        list.append(el('li', 'muted', t('interior.andMore', { count: ids.length - LIST_LIMIT })));
      return list;
    };

    const children: HTMLElement[] = [
      header,
      el('h2', 'dossier-title', t('interior.title')),
      facts,
      el('p', 'setup-hint', t('interior.hint')),
    ];

    if (factions.length) {
      children.push(el('h3', 'dossier-subtitle danger', t('interior.rebels')));
      const list = el('ul', 'dossier-cities');
      for (const f of factions) {
        const rebels = game.world.countries.find((c) => c.id === f.id);
        if (!rebels) continue;
        const weeks = Math.max(0, rules.revolution.secessionTurns - (game.turn - f.startedTurn));
        const item = el('li');
        item.append(
          el('span', 'city-name', this.options.countryName(f.id)),
          el('span', 'badge', t('interior.provinces', { count: rebels.provinceIds.length })),
          el('span', 'badge badge-danger', t('interior.secedesIn', { weeks })),
        );
        list.append(item);
      }
      children.push(list, el('p', 'setup-hint', t('interior.rebelsHint')));
    }

    children.push(el('h3', 'dossier-subtitle', t('interior.riots')));
    if (rioting.length)
      children.push(provinceList(rioting, (p) => `${formatPercent(pop.support[p]! / 100, 0)}%`));
    else children.push(el('p', 'muted', t('interior.noRiots')));

    const foreign = unassimilatedProvinces(game, id);
    children.push(el('h3', 'dossier-subtitle', t('interior.conquered')));
    if (foreign.length === 0) {
      children.push(el('p', 'muted', t('interior.noConquered')));
    } else {
      children.push(
        provinceList(foreign, (p) =>
          pop.assimilateUntil[p]! >= 0
            ? t('econ.weeksLeft', { weeks: pop.assimilateUntil[p]! - game.turn })
            : this.options.countryName(pop.culture[p]!),
        ),
      );
      const quote = assimilationQuote(game, sim, id, foreign);
      if (quote.provinceIds.length) {
        const cost = formatUsd(quote.totalCost);
        const all = button('btn btn-primary', t('interior.assimilateAll', { cost }), () =>
          this.options.assimilate(quote.provinceIds),
        );
        all.disabled = !quote.affordable;
        children.push(el('p', 'setup-hint', t('interior.assimilateHint')), all);
        if (!quote.affordable) children.push(el('p', 'setup-warning', t('invest.notEnough')));
      }
    }

    this.root.replaceChildren(...children);
  }
}
