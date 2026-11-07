import { t, type TranslationKey } from '../i18n';
import { dateOfTurn } from '../sim/calendar';
import { LOG_CATEGORIES, type LogCategory, type LogEntry } from '../sim/campaignLog';
import type { GameState } from '../sim/newGame';
import { button, el } from './dom';
import { formatGameDate } from './format';

export interface HistoryPanelOptions {
  parent: HTMLElement;
  countryName: (id: string) => string;
  provinceName: (id: number) => string;
  cityName: (id: number) => string;
  /** Text of one of the player's goals, by kind. */
  goalText: (game: GameState, kind: string) => string;
  /** Text of an entry added by a later system (events, objectives), or null. */
  extraText?: (entry: LogEntry) => string | null;
}

/** The campaign's history (master plan, phase 7): newest first, filtered by category. */
export class HistoryPanel {
  private readonly root = el('section', 'dossier history');
  private game: GameState | null = null;
  private filter: LogCategory | 'all' = 'all';

  constructor(private readonly options: HistoryPanelOptions) {
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
    this.root.scrollTop = 0;
  }

  close(): void {
    this.root.hidden = true;
  }

  update(game: GameState): void {
    this.game = game;
    if (this.isOpen) this.render();
  }

  /** The text of one entry. */
  text(game: GameState, e: LogEntry): string {
    const o = this.options;
    const name = (id?: string): string => (id ? o.countryName(id) : '');
    const custom = o.extraText?.(e);
    if (custom) return custom;
    const vars = {
      a: name(e.a),
      b: name(e.b),
      n: e.n ?? 0,
      m: e.m ?? 0,
      province: e.n !== undefined ? o.provinceName(e.n) : '',
      city: e.n !== undefined ? o.cityName(e.n) : '',
      building: e.extra ? t(`building.${e.extra}` as TranslationKey) : '',
      goal: e.extra ? o.goalText(game, e.extra) : '',
      leader: game.player.leaderName,
    };
    return t(`log.${e.kind}` as TranslationKey, vars);
  }

  private render(): void {
    const game = this.game!;
    const header = el('header', 'dossier-strip');
    header.append(
      el('span', 'dossier-code', game.player.countryId),
      el('span', 'dossier-label', t('log.title')),
      button('dossier-close', '×', () => this.close()),
    );
    header.lastElementChild!.setAttribute('aria-label', t('panel.close'));
    const entries = game.log?.entries ?? [];
    const chips = el('div', 'history-filters');
    for (const c of ['all', ...LOG_CATEGORIES] as const) {
      const count = c === 'all' ? entries.length : entries.filter((e) => e.category === c).length;
      if (c !== 'all' && count === 0) continue;
      const chip = button(
        `history-chip${this.filter === c ? ' history-chip-on' : ''}`,
        `${t(`log.cat.${c}` as TranslationKey)} ${count}`,
        () => {
          this.filter = c;
          this.render();
        },
      );
      chip.setAttribute('aria-pressed', String(this.filter === c));
      chips.append(chip);
    }
    const shown = entries.filter((e) => this.filter === 'all' || e.category === this.filter);
    const list = el('ol', 'history-list');
    // Newest first; entries of one week keep the order they happened in.
    let lastTurn = -1;
    for (let i = shown.length - 1; i >= 0; i--) {
      const e = shown[i]!;
      if (e.turn !== lastTurn) {
        lastTurn = e.turn;
        list.append(
          el('li', 'history-date mono', formatGameDate(dateOfTurn(game.world.startDate, e.turn))),
        );
      }
      const item = el('li', `history-entry history-${e.category}`);
      item.append(
        el('span', 'history-dot'),
        el('span', 'history-text', this.text(game, e)),
        el('span', 'history-cat', t(`log.cat.${e.category}` as TranslationKey)),
      );
      list.append(item);
    }
    if (!shown.length) list.append(el('li', 'history-entry muted', t('log.empty')));
    this.root.replaceChildren(header, el('h2', 'dossier-title', t('log.title')), chips, list);
  }
}
