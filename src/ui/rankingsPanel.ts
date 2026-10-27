import { t, type TranslationKey } from '../i18n';
import { formatCount, formatPeople, formatUsd } from '../app/present';
import type { SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import { RANKING_METRICS, rankings, type RankingMetric } from '../sim/rankings';
import { button, el } from './dom';

export interface RankingsPanelOptions {
  parent: HTMLElement;
  sim: SimContext;
  countryName: (id: string) => string;
  flag: (id: string) => HTMLElement;
  openCountry: (id: string) => void;
}

const TOP = 20;

/**
 * World rankings (GDD section 13): the leading countries by power, economy, people, army, land
 * or support, as bars with flags; the player's row is highlighted, also when outside the top.
 */
export class RankingsPanel {
  private readonly backdrop = el('div', 'modal-backdrop');
  private metric: RankingMetric = 'power';
  private game: GameState | null = null;

  constructor(private readonly options: RankingsPanelOptions) {
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    options.parent.append(this.backdrop);
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  open(game: GameState): void {
    this.game = game;
    this.render();
    this.backdrop.hidden = false;
  }

  update(game: GameState): void {
    this.game = game;
    if (this.isOpen) this.render();
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  private format(value: number): string {
    switch (this.metric) {
      case 'gdp':
        return formatUsd(value);
      case 'gdpPerCapita':
        return t('rank.perPerson', { value: formatCount(value) });
      case 'population':
        return formatPeople(value);
      case 'army':
        return formatCount(value);
      case 'provinces':
        return formatCount(value);
      case 'support':
        return `${value.toFixed(0)}%`;
      case 'power':
        return value.toFixed(1);
    }
  }

  private render(): void {
    const game = this.game!;
    const me = game.player.countryId;
    const dialog = el('div', 'modal modal-wide rankings');
    dialog.setAttribute('role', 'dialog');

    const tabs = el('div', 'rank-tabs');
    for (const m of RANKING_METRICS) {
      const b = button(`rank-tab${m === this.metric ? ' rank-tab-on' : ''}`, t(`rank.${m}`), () => {
        this.metric = m;
        this.render();
      });
      b.setAttribute('aria-pressed', String(m === this.metric));
      tabs.append(b);
    }

    const rows = rankings(game, this.options.sim, this.metric);
    const mine = rows.find((r) => r.countryId === me);
    const best = Math.max(1e-9, rows[0]?.value ?? 1);
    const list = el('ol', 'rank-list');
    const shown = rows.slice(0, TOP);
    if (mine && mine.rank > TOP) shown.push(mine);
    for (const r of shown) {
      const item = el('li');
      const row = button(
        `rank-row${r.countryId === me ? ' rank-row-me' : ''}${r.rank > TOP ? ' rank-row-gap' : ''}`,
        '',
        () => {
          this.close();
          this.options.openCountry(r.countryId);
        },
      );
      const bar = el('span', 'rank-bar');
      const fill = el('span', 'rank-fill');
      fill.style.width = `${Math.max(1, (r.value / best) * 100)}%`;
      bar.append(fill);
      row.append(
        el('span', 'rank-place mono', `${r.rank}.`),
        this.options.flag(r.countryId),
        el('span', 'rank-name', this.options.countryName(r.countryId)),
        bar,
        el('span', 'rank-value mono', this.format(r.value)),
      );
      item.append(row);
      list.append(item);
    }

    const actions = el('div', 'modal-actions');
    actions.append(button('btn btn-secondary', t('panel.close'), () => this.close()));
    dialog.append(
      el('h2', 'modal-title', t('rank.title')),
      el(
        'p',
        'modal-text',
        mine
          ? t('rank.yourPlace', {
              rank: mine.rank,
              total: rows.length,
              metric: t(`rank.${this.metric}` as TranslationKey),
            })
          : '',
      ),
      tabs,
      list,
      actions,
    );
    this.backdrop.replaceChildren(dialog);
  }
}
