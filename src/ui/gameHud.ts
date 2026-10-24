import { t, type TranslationKey } from '../i18n';
import { countryFlag, countryName } from '../app/present';
import type { GameState } from '../sim/newGame';
import type { World } from '../sim/world';
import { button, el, flagImage } from './dom';
import { formatGameDate } from './format';

export interface GameHudActions {
  onMenu: () => void;
  onNextTurn: () => void;
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
      el('span', 'hud-country', countryName(this.baseWorld, id, mode)),
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
    this.bar.replaceChildren(
      flagImage(countryFlag(this.baseWorld, id, mode), 'flag hud-flag'),
      who,
      when,
      button('btn btn-secondary hud-menu', t('menu.gameMenu'), this.actions.onMenu),
    );
    this.next.textContent = t('turn.next');
  }
}
