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
