import { t } from '../i18n';
import type { Command } from '../sim/commands';
import {
  overlordOf,
  pointsCap,
  pointsIncome,
  vassalsOf,
  warScore,
  type Demand,
  type PlayerRequest,
} from '../sim/diplomacy';
import type { SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import { button, el } from './dom';

export interface ForeignPanelOptions {
  parent: HTMLElement;
  sim: SimContext;
  countryName: (id: string) => string;
  cityName: (id: number) => string;
  allianceName: (id: string) => string;
  /** Text of a request or ultimatum for the player. */
  describeRequest: (game: GameState, request: PlayerRequest) => string;
  describeDemand: (demand: Demand) => string;
  issue: (command: Command) => void;
  openCountry: (countryId: string, view?: 'main' | 'peace') => void;
}

/** Ministry of Foreign Affairs (GDD section 10): points, credibility and all relations. */
export class ForeignPanel {
  private readonly root = el('section', 'dossier foreign');
  private game: GameState | null = null;

  constructor(private readonly options: ForeignPanelOptions) {
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
    const { sim, countryName } = this.options;
    const me = game.player.countryId;
    const d = game.diplomacy;

    const header = el('header', 'dossier-strip');
    header.append(
      el('span', 'dossier-code', me),
      el('span', 'dossier-label', t('foreign.ministry')),
      button('dossier-close', '×', () => this.close()),
    );
    header.lastElementChild!.setAttribute('aria-label', t('panel.close'));

    const facts = el('dl', 'dossier-facts');
    const fact = (label: string, value: string, cls = 'mono'): void => {
      facts.append(el('dt', '', label), el('dd', cls, value));
    };
    fact(
      t('foreign.points'),
      t('foreign.pointsValue', {
        value: (d.points[me] ?? 0).toFixed(1),
        cap: pointsCap(game, sim, me).toFixed(1),
        income: pointsIncome(game, sim, me).toFixed(1),
      }),
    );
    fact(t('foreign.credibility'), String(Math.round(d.credibility[me] ?? 0)));

    const children: HTMLElement[] = [header, el('h2', 'dossier-title', t('foreign.title')), facts];
    const section = (title: string, items: HTMLElement[], empty?: string): void => {
      if (!items.length && !empty) return;
      children.push(el('h3', 'dossier-subtitle', title));
      const list = el('ul', 'dossier-cities');
      if (items.length) list.append(...items);
      else list.append(el('li', 'muted', empty!));
      children.push(list);
    };
    const row = (text: string, ...actions: HTMLElement[]): HTMLElement => {
      const li = el('li');
      li.append(el('span', 'city-name', text), ...actions);
      return li;
    };
    const link = (id: string): HTMLElement =>
      button('link-button city-name', countryName(id), () => this.options.openCountry(id));

    // Requests the player has to answer.
    section(
      t('foreign.requests'),
      d.requests.map((r) => {
        const li = el('li', 'request');
        li.append(
          el('span', 'request-text', this.options.describeRequest(game, r)),
          button('btn btn-primary btn-small', t('foreign.accept'), () =>
            this.options.issue({
              type: 'answerRequest',
              countryId: me,
              requestId: r.id,
              accept: true,
            }),
          ),
          button('btn btn-secondary btn-small', t('foreign.refuse'), () =>
            this.options.issue({
              type: 'answerRequest',
              countryId: me,
              requestId: r.id,
              accept: false,
            }),
          ),
        );
        return li;
      }),
    );

    // Wars and peace talks.
    section(
      t('defence.wars'),
      game.world.wars
        .filter((w) => w.sides[0].includes(me) || w.sides[1].includes(me))
        .flatMap((w) => {
          const enemies = w.sides[0].includes(me) ? w.sides[1] : w.sides[0];
          return enemies.map((e) => {
            const li = el('li');
            li.append(
              link(e),
              el(
                'span',
                'badge',
                t('dip.warScore', { score: Math.round(warScore(game, w.id, me)) }),
              ),
              button('btn btn-secondary btn-small', t('dip.peaceTalks'), () =>
                this.options.openCountry(e, 'peace'),
              ),
            );
            return li;
          });
        }),
      t('defence.peace'),
    );

    section(
      t('foreign.alliances'),
      game.world.alliances
        .filter((a) => a.members.includes(me) && a.type !== 'vassal')
        .map((a) =>
          row(
            this.options.allianceName(a.id),
            button('btn btn-secondary btn-small', t('foreign.leave'), () =>
              this.options.issue({ type: 'leaveAlliance', countryId: me, allianceId: a.id }),
            ),
          ),
        ),
      t('foreign.noAlliances'),
    );

    const overlord = overlordOf(game.world, me);
    section(t('foreign.vassals'), [
      ...(overlord ? [row(t('foreign.overlord', { country: countryName(overlord) }))] : []),
      ...vassalsOf(game.world, me).map((v) =>
        row(
          countryName(v),
          button('btn btn-secondary btn-small', t('dip.release'), () =>
            this.options.issue({ type: 'vassal', countryId: me, mode: 'release', targetId: v }),
          ),
        ),
      ),
    ]);

    section(t('foreign.sanctions'), [
      ...d.sanctions
        .filter((s) => s.from === me)
        .map((s) =>
          row(
            t('foreign.youSanction', { country: countryName(s.to) }),
            button('btn btn-secondary btn-small', t('dip.liftSanctions'), () =>
              this.options.issue({ type: 'liftSanctions', countryId: me, targetId: s.to }),
            ),
          ),
        ),
      ...d.sanctions
        .filter((s) => s.to === me)
        .map((s) => row(t('foreign.theySanction', { country: countryName(s.from) }))),
    ]);

    section(
      t('foreign.bases'),
      (game.world.foreignBases ?? [])
        .filter((b) => b.owner === me || b.host === me)
        .map((b) =>
          row(
            b.owner === me
              ? t('foreign.ourBase', {
                  city: this.options.cityName(b.cityId),
                  country: countryName(b.host),
                })
              : t('foreign.theirBase', {
                  city: this.options.cityName(b.cityId),
                  country: countryName(b.owner),
                }),
          ),
        ),
    );

    section(
      t('foreign.ultimatums'),
      d.ultimatums
        .filter((u) => u.from === me)
        .map((u) =>
          row(
            t('foreign.ultimatumTo', {
              country: countryName(u.to),
              demand: this.options.describeDemand(u.demand),
            }),
            el(
              'span',
              u.status === 'refused' ? 'badge badge-danger' : 'badge',
              u.status === 'refused'
                ? t('foreign.enforceBy', {
                    weeks: Math.max(0, (u.enforceBy ?? game.turn) - game.turn),
                    threat: t(`dip.threat.${u.threat}`),
                  })
                : t(`foreign.status.${u.status}`),
            ),
          ),
        ),
    );

    children.push(el('p', 'setup-hint', t('foreign.hint')));
    this.root.replaceChildren(...children);
  }
}
