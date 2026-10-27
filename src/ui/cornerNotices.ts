import { t } from '../i18n';
import type { PlayerRequest } from '../sim/diplomacy';
import type { GameState } from '../sim/newGame';
import { button, el } from './dom';

export interface CornerNoticesOptions {
  parent: HTMLElement;
  describe: (game: GameState, request: PlayerRequest) => string;
  /** The country a request comes from (for its flag and the diplomacy dialog). */
  senderOf: (game: GameState, request: PlayerRequest) => string;
  flag: (countryId: string) => HTMLElement;
  answer: (request: PlayerRequest, accept: boolean) => void;
  open: (game: GameState, request: PlayerRequest) => void;
}

/** Cards shown at once; the rest wait behind a "+N more" button. */
const SHOWN = 3;

/**
 * Incoming proposals and requests in a corner of the screen (GDD section 12), like dispatches on
 * a desk: they never block the game. Each stays until answered, dismissed or expired.
 */
export class CornerNotices {
  private readonly root = el('aside', 'corner-notices');
  private readonly dismissed = new Set<number>();
  private expanded = false;
  private game: GameState | null = null;

  constructor(private readonly options: CornerNoticesOptions) {
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-label', t('notice.title'));
    options.parent.append(this.root);
  }

  /** Shows the pending requests of a game (null hides everything). */
  update(game: GameState | null): void {
    this.game = game;
    this.render();
  }

  private render(): void {
    const game = this.game;
    const pending = game ? game.diplomacy.requests.filter((r) => !this.dismissed.has(r.id)) : [];
    this.root.hidden = pending.length === 0;
    if (!game || pending.length === 0) return this.root.replaceChildren();
    const shown = this.expanded ? pending : pending.slice(0, SHOWN);
    const cards: HTMLElement[] = shown.map((r) => {
      const card = el('div', `notice notice-${r.type}`);
      const head = el('div', 'notice-head');
      const text = button('notice-text', this.options.describe(game, r), () =>
        this.options.open(game, r),
      );
      text.title = t('notice.open');
      const close = button('notice-close', '×', () => {
        this.dismissed.add(r.id);
        this.render();
      });
      close.setAttribute('aria-label', t('notice.dismiss'));
      head.append(this.options.flag(this.options.senderOf(game, r)), text, close);
      const actions = el('div', 'notice-actions');
      actions.append(
        button('btn btn-primary btn-small', t('foreign.accept'), () =>
          this.options.answer(r, true),
        ),
        button('btn btn-secondary btn-small', t('foreign.refuse'), () =>
          this.options.answer(r, false),
        ),
        button('btn btn-secondary btn-small', t('notice.open'), () => this.options.open(game, r)),
      );
      card.append(head, actions);
      return card;
    });
    const more = pending.length - shown.length;
    if (more > 0)
      cards.push(
        button('btn btn-secondary btn-small notice-more', t('notice.more', { count: more }), () => {
          this.expanded = true;
          this.render();
        }),
      );
    else if (this.expanded && pending.length > SHOWN)
      cards.push(
        button('btn btn-secondary btn-small notice-more', t('notice.less'), () => {
          this.expanded = false;
          this.render();
        }),
      );
    this.root.replaceChildren(...cards);
  }
}
