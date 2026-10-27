import { t, type TranslationKey } from '../i18n';
import { countryFlag, countryName, formatPercent, formatUsd } from '../app/present';
import type { GameState } from '../sim/newGame';
import type { World } from '../sim/world';
import { button, el, flagImage } from './dom';
import { formatGameDate } from './format';
import { leaderSeal } from './leaderSeal';

export interface GameHudActions {
  onMenu: () => void;
  onRankings: () => void;
  onNextTurn: () => void;
  onEconomy: () => void;
  onInterior: () => void;
  onDefence: () => void;
  onForeign: () => void;
  /** Diplomatic points of the player, formatted. */
  pointsOf: (game: GameState) => string;
  /** Soldiers of the player's country (regulars and special forces), formatted. */
  armyOf: (game: GameState) => string;
  /** National public support of the player's country (0-100). */
  supportOf: (game: GameState) => number;
  /** Support below which provinces riot: shown in red. */
  riotThreshold: number;
}

/** Top bar of a running game (country, leader, date) and the Next Turn button (bottom right). */
export class GameHud {
  private readonly bar = el('header', 'hud');
  private readonly next: HTMLButtonElement;
  private game: GameState | null = null;

  constructor(
    parent: HTMLElement,
    private readonly baseWorld: World,
    private readonly actions: GameHudActions,
  ) {
    this.bar.hidden = true;
    this.next = button('btn btn-primary next-turn', '', actions.onNextTurn);
    this.next.hidden = true;
    parent.append(this.bar, this.next);
    // Enter ends the turn on a PC, unless the player is typing somewhere.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !this.game || this.next.disabled) return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest('input, textarea, select, button, [role="dialog"], .screen:not([hidden])')
      )
        return;
      actions.onNextTurn();
    });
  }

  show(game: GameState): void {
    this.game = game;
    this.render();
    this.bar.hidden = false;
    this.next.hidden = false;
  }

  hide(): void {
    this.game = null;
    this.bar.hidden = true;
    this.next.hidden = true;
  }

  /** Disables the Next Turn button while a turn resolves. */
  setBusy(busy: boolean): void {
    this.next.disabled = busy;
  }

  refresh(): void {
    if (this.game) this.render();
  }

  private render(): void {
    const game = this.game!;
    const id = game.player.countryId;
    const mode = game.settings.disputedMode;
    const country = game.world.countries.find((c) => c.id === id)!;

    const who = el('div', 'hud-who');
    who.append(
      el('span', 'hud-country', countryName(game.world, id, mode)),
      el(
        'span',
        'hud-leader',
        `${t(`leaderTitle.${country.leader.title}` as TranslationKey)} ${game.player.leaderName}`,
      ),
    );
    const when = el('div', 'hud-when');
    when.append(
      el('span', 'hud-date mono', formatGameDate(game.date)),
      el('span', 'hud-week mono', t('turn.week', { turn: game.turn + 1 })),
    );
    const e = game.economy.countries[id]!;
    const stats = button('hud-stats', '', this.actions.onEconomy);
    stats.setAttribute('aria-label', t('econ.title'));
    const stat = (label: string, value: string, cls = ''): HTMLElement => {
      const s = el('span', `hud-stat ${cls}`);
      s.append(el('span', 'hud-stat-label', label), el('span', 'hud-stat-value mono', value));
      return s;
    };
    stats.append(
      stat(t('econ.treasury'), formatUsd(e.treasury)),
      stat(t('econ.gdp'), formatUsd(e.gdp)),
      stat(
        t('econ.inflation'),
        `${formatPercent(e.inflation)}%`,
        e.inflation >= 0.1 ? 'danger' : '',
      ),
    );
    const support = this.actions.supportOf(game);
    const people = button('hud-stats hud-people', '', this.actions.onInterior);
    people.setAttribute('aria-label', t('interior.title'));
    people.append(
      stat(
        t('interior.supportShort'),
        `${formatPercent(support / 100, 0)}%`,
        support < this.actions.riotThreshold ? 'danger' : '',
      ),
    );
    const army = button('hud-stats hud-people', '', this.actions.onDefence);
    army.setAttribute('aria-label', t('defence.title'));
    army.append(stat(t('defence.armyShort'), this.actions.armyOf(game)));
    const diplomacy = button('hud-stats hud-people', '', this.actions.onForeign);
    diplomacy.setAttribute('aria-label', t('foreign.title'));
    diplomacy.append(stat(t('foreign.pointsShort'), this.actions.pointsOf(game)));
    // World rankings: a small podium.
    const ranks = button('btn btn-secondary hud-menu hud-ranks', '', this.actions.onRankings);
    ranks.setAttribute('aria-label', t('rank.title'));
    ranks.title = t('rank.title');
    ranks.innerHTML =
      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linejoin="round"><path d="M3 20h18M9 20V9h6v11M3 20v-6h6M15 20v-8h6v8"/>' +
      '<path d="M12 3.5l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 5.6l2-.3z" fill="currentColor"/></svg>';
    this.bar.replaceChildren(
      flagImage(countryFlag(this.baseWorld, id, mode), 'flag hud-flag'),
      leaderSeal(game.player.leaderName, id, 34),
      who,
      el('span', 'hud-break'),
      stats,
      people,
      army,
      diplomacy,
      when,
      ranks,
      button('btn btn-secondary hud-menu', t('menu.gameMenu'), this.actions.onMenu),
    );
    this.next.textContent = t('turn.next');
  }
}
