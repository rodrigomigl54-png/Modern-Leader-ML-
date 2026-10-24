import { getLanguage, t, type TranslationKey } from '../i18n';
import { countryFlag, countryName } from '../app/present';
import type { GameState } from '../sim/newGame';
import type { World } from '../sim/world';
import { button, el, flagImage } from './dom';

/** Top bar of a running game: the player's country, leader and date. */
export class GameHud {
  private readonly root = el('header', 'hud');
  private game: GameState | null = null;

  constructor(
    parent: HTMLElement,
    private readonly baseWorld: World,
    private readonly onMenu: () => void,
  ) {
    this.root.hidden = true;
    parent.append(this.root);
  }

  show(game: GameState): void {
    this.game = game;
    this.render();
    this.root.hidden = false;
  }

  hide(): void {
    this.game = null;
    this.root.hidden = true;
  }

  refresh(): void {
    if (this.game) this.render();
  }

  private render(): void {
    const game = this.game!;
    const id = game.player.countryId;
    const mode = game.settings.disputedMode;
    const country = game.world.countries.find((c) => c.id === id)!;
    const date = new Intl.DateTimeFormat(getLanguage() === 'sr' ? 'sr-Latn' : 'en', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${game.date}T00:00:00Z`));

    const who = el('div', 'hud-who');
    const name = countryName(this.baseWorld, id, mode);
    who.append(
      el('span', 'hud-country', name),
      el(
        'span',
        'hud-leader',
        `${t(`leaderTitle.${country.leader.title}` as TranslationKey)} ${game.player.leaderName}`,
      ),
    );
    this.root.replaceChildren(
      flagImage(countryFlag(this.baseWorld, id, mode), 'flag hud-flag'),
      who,
      el('span', 'hud-date mono', date),
      button('btn btn-secondary hud-menu', t('game.mainMenu'), this.onMenu),
    );
  }
}
