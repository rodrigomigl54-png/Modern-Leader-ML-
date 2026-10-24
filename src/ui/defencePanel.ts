import { t } from '../i18n';
import { formatUsd } from '../app/present';
import type { SimContext } from '../sim/economy';
import {
  armySize,
  armyUpkeep,
  availableManpower,
  militaryTotals,
  pathTurns,
} from '../sim/military';
import type { GameState } from '../sim/newGame';
import { factories, nuclearBasesOf, weaponsRules } from '../sim/weapons';
import { enemiesAtWar } from '../sim/world';
import { button, el } from './dom';

export interface DefencePanelOptions {
  parent: HTMLElement;
  sim: SimContext;
  provinceName: (provinceId: number) => string;
  countryName: (countryId: string) => string;
  formatCount: (n: number) => string;
  showProvince: (provinceId: number) => void;
  /** Asks first (introducing service costs support), then changes it. */
  setService: (enabled: boolean) => void;
  onProduce: () => void;
  /** Asks first (cost and years), then starts the program. */
  onNuclearProgram: () => void;
}

const LIST_LIMIT = 30;

/** Armies, reserves, manpower, mandatory service and wars (GDD section 8). */
export class DefencePanel {
  private readonly root = el('section', 'dossier defence');
  private game: GameState | null = null;

  constructor(private readonly options: DefencePanelOptions) {
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
    const { sim, formatCount } = this.options;
    const id = game.player.countryId;
    const totals = militaryTotals(game, id);
    const service = game.military.countries[id]?.service ?? false;

    const header = el('header', 'dossier-strip');
    header.append(
      el('span', 'dossier-code', id),
      el('span', 'dossier-label', t('defence.ministry')),
      button('dossier-close', '×', () => this.close()),
    );
    header.lastElementChild!.setAttribute('aria-label', t('panel.close'));

    const facts = el('dl', 'dossier-facts');
    const fact = (label: string, value: string, cls = 'mono'): void => {
      facts.append(el('dt', '', label), el('dd', cls, value));
    };
    fact(t('defence.regulars'), formatCount(totals.regulars));
    if (totals.special > 0) fact(t('defence.special'), formatCount(totals.special));
    if (totals.trainees > 0) fact(t('defence.trainees'), formatCount(totals.trainees));
    fact(t('army.reservists'), formatCount(totals.reservists));
    fact(t('defence.manpower'), formatCount(availableManpower(game, sim, id)));
    fact(
      t('defence.upkeep'),
      t('defence.perYear', { value: formatUsd(armyUpkeep(game, sim, id) * 52) }),
    );

    const children: HTMLElement[] = [
      header,
      el('h2', 'dossier-title', t('defence.title')),
      facts,
      el('h3', 'dossier-subtitle', t('defence.service')),
      el('p', 'setup-hint', t(service ? 'defence.serviceOn' : 'defence.serviceOff')),
      button(
        service ? 'btn btn-secondary' : 'btn btn-danger-outline',
        t(service ? 'defence.abolish' : 'defence.introduce'),
        () => this.options.setService(!service),
      ),
    ];

    // Arsenal: missiles, drones, air defense and nuclear weapons (GDD section 9).
    const rules = weaponsRules(sim);
    const arsenal = game.weapons.countries[id]!;
    children.push(el('h3', 'dossier-subtitle', t('arsenal.title')));
    const stock = el('dl', 'dossier-facts');
    const line = (label: string, value: string): void => {
      stock.append(el('dt', '', label), el('dd', 'mono', value));
    };
    const tiers = (list: number[]): string => list.map((n) => formatCount(n)).join(' / ');
    line(t('arsenal.missiles'), tiers(arsenal.missiles));
    line(t('arsenal.drones'), tiers(arsenal.drones));
    const sites = game.weapons.airDefense.filter(
      (lvl, c) => lvl > 0 && game.world.provinceOwners[sim.cityProvince[c]!] === id,
    ).length;
    line(t('arsenal.airDefense'), String(sites));
    line(
      t('arsenal.factories'),
      `${factories(game, sim, id, 'missile')} / ${factories(game, sim, id, 'drone')} / ${factories(game, sim, id, 'airDefense')}`,
    );
    if (arsenal.warheads > 0)
      line(
        t('arsenal.nuclear'),
        t('arsenal.warheads', {
          count: formatCount(arsenal.warheads),
          bases: nuclearBasesOf(game, sim, id).length,
        }),
      );
    const queued = game.weapons.production.filter((p) => p.owner === id);
    for (const q of queued)
      line(
        t(q.weapon === 'missile' ? 'arsenal.missiles' : 'arsenal.drones'),
        t('arsenal.queued', {
          count: formatCount(q.count),
          tier: q.tier,
          weeks: q.readyTurn - game.turn,
        }),
      );
    children.push(
      stock,
      el('p', 'setup-hint', t('arsenal.hint')),
      button('btn btn-primary', t('arsenal.produce'), () => this.options.onProduce()),
    );
    if (arsenal.warheads === 0) {
      children.push(
        el(
          'p',
          'setup-hint',
          arsenal.nuclearProgramUntil >= 0
            ? t('arsenal.programRunning', { weeks: arsenal.nuclearProgramUntil - game.turn })
            : t('arsenal.programHint', {
                cost: formatUsd(rules.nuclear.programCostUsd),
                years: Math.round(rules.nuclear.programTurns / 52),
              }),
        ),
      );
      if (arsenal.nuclearProgramUntil < 0)
        children.push(
          button('btn btn-danger-outline', t('arsenal.startProgram'), () =>
            this.options.onNuclearProgram(),
          ),
        );
    }

    const enemies = enemiesAtWar(game.world, id);
    children.push(
      el('h3', `dossier-subtitle${enemies.length ? ' danger' : ''}`, t('defence.wars')),
    );
    if (enemies.length) {
      const list = el('ul', 'chip-list');
      for (const e of enemies)
        list.append(el('li', 'chip chip-rival', this.options.countryName(e)));
      children.push(list);
    } else {
      children.push(el('p', 'muted', t('defence.peace')));
    }

    children.push(el('h3', 'dossier-subtitle', t('defence.armies')));
    const armies = game.military.armies
      .filter((a) => a.owner === id)
      .sort((a, b) => armySize(b) - armySize(a) || a.id - b.id);
    const list = el('ul', 'dossier-cities');
    for (const a of armies.slice(0, LIST_LIMIT)) {
      const item = el('li');
      item.append(
        button('link-button city-name', this.options.provinceName(a.provinceId), () =>
          this.options.showProvince(a.provinceId),
        ),
        el('span', 'city-pop mono', formatCount(armySize(a))),
      );
      if (a.path.length) {
        item.append(
          el(
            'span',
            'badge',
            t('army.goingTo', {
              place: this.options.provinceName(a.path.at(-1)!),
              weeks: pathTurns(sim, a.provinceId, a.path),
            }),
          ),
        );
      }
      list.append(item);
    }
    if (armies.length === 0) list.append(el('li', 'muted', t('army.none')));
    if (armies.length > LIST_LIMIT)
      list.append(el('li', 'muted', t('interior.andMore', { count: armies.length - LIST_LIMIT })));
    children.push(list, el('p', 'setup-hint', t('defence.hint')));

    this.root.replaceChildren(...children);
  }
}
