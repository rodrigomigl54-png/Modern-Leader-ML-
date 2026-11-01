import { t, type TranslationKey } from '../i18n';
import { formatPercent, formatRelation, formatUsd, signClass } from '../app/present';
import type { Command } from '../sim/commands';
import {
  basePrice,
  dependenceOn,
  diplomacyRules,
  forSale,
  bestPeaceProvinces,
  peaceProvinceOptions,
  hasAccess,
  insultedBetween,
  missionsOf,
  overlordOf,
  peaceCost,
  relation,
  sanctioned,
  vassalsOf,
  warBetween,
  warScore,
  weaponPrice,
  WHITE_PEACE,
  type Demand,
  type PeaceTerms,
  type Threat,
} from '../sim/diplomacy';
import {
  dealError,
  dealLikelihood,
  dealRules,
  dealScore,
  nonAggressionBetween,
  type Deal,
  type DealSide,
} from '../sim/deals';
import type { SimContext } from '../sim/economy';
import { provinceSeat } from '../sim/military';
import type { GameState } from '../sim/newGame';
import type { Goal } from '../sim/goals';
import { TRAITS } from '../sim/profiles';
import { weaponsRules, type WeaponKind } from '../sim/weapons';
import { alliesOf, enemiesAtWar } from '../sim/world';
import { leaderSeal } from './leaderSeal';
import { button, el } from './dom';
import { amountSlider } from './slider';
import { dipIcon, type DipIcon } from './dipIcons';

export interface CountryDialogOptions {
  parent: HTMLElement;
  sim: SimContext;
  countryName: (id: string) => string;
  flag: (id: string) => HTMLElement;
  provinceName: (id: number) => string;
  cityName: (id: number) => string;
  allianceName: (id: string) => string;
  formatCount: (n: number) => string;
  /** Issues a command; resolves with the result (accepted or not), or null on an error. */
  issue: (command: Command) => { accepted?: boolean } | null;
  /** Asks first and declares war. */
  declareWar: (countryId: string) => void;
  /** Text of a country's goal. */
  describeGoal: (goal: Goal, countryId: string) => string;
  /** The country's place in the world power ranking. */
  rankOf: (game: GameState, countryId: string) => { rank: number; great: boolean };
  /** Opens the rankings. */
  openRankings: () => void;
}

type View = 'main' | 'ultimatum' | 'peace' | 'aid' | 'trade' | 'deal';

/** Relations with one country and every diplomatic action toward it (GDD section 10). */
export class CountryDialog {
  private readonly backdrop = el('div', 'modal-backdrop');
  private game: GameState | null = null;
  private target = '';
  /** Province the dialog was opened from (base requests, province demands). */
  private provinceId = -1;
  private view: View = 'main';
  private demand: Demand = { type: 'vassal' };
  private threat: Threat = 'war';
  private terms: PeaceTerms = { ...WHITE_PEACE };
  private aidMoney = 0;
  private aidWeapon: { weapon: WeaponKind; tier: number; count: number } | null = null;
  private tradeCount = 5;
  private deal: Deal = { give: {}, take: {} };

  constructor(private readonly options: CountryDialogOptions) {
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    options.parent.append(this.backdrop);
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  open(game: GameState, countryId: string, provinceId = -1, view: View = 'main'): void {
    this.game = game;
    this.target = countryId;
    this.provinceId = provinceId;
    this.view = view;
    this.terms = { ...WHITE_PEACE };
    this.demand = { type: 'vassal' };
    this.threat = 'war';
    this.aidMoney = Math.round((game.economy.countries[game.player.countryId]?.gdp ?? 0) * 0.001);
    this.aidWeapon = null;
    this.deal = { give: {}, take: {} };
    this.render();
    this.backdrop.hidden = false;
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  /** Re-renders with a new state (after a command). */
  update(game: GameState): void {
    this.game = game;
    if (this.isOpen) this.render();
  }

  private go(view: View): void {
    this.view = view;
    this.render();
  }

  private act(command: Command, done?: () => void): void {
    const result = this.options.issue(command);
    if (result && done) done();
  }

  private render(): void {
    const dialog = el('div', 'modal modal-wide country-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.append(this.header());
    if (this.lastMessage) {
      dialog.append(el('p', 'dip-message', this.lastMessage));
      this.lastMessage = '';
    }
    const body =
      this.view === 'ultimatum'
        ? this.ultimatumView()
        : this.view === 'peace'
          ? this.peaceView()
          : this.view === 'aid'
            ? this.aidView()
            : this.view === 'trade'
              ? this.tradeView()
              : this.view === 'deal'
                ? this.dealView()
                : this.mainView();
    dialog.append(...body);
    const footer = el('div', 'modal-footer');
    const actions = el('div', 'modal-actions');
    if (this.view !== 'main')
      actions.append(button('btn btn-secondary', t('dip.back'), () => this.go('main')));
    actions.append(button('btn btn-secondary', t('panel.close'), () => this.close()));
    footer.append(actions);
    dialog.append(footer);
    this.backdrop.replaceChildren(dialog);
  }

  private header(): HTMLElement {
    const game = this.game!;
    const { sim } = this.options;
    const me = game.player.countryId;
    const id = this.target;
    const r = relation(game, sim, me, id);
    const head = el('div', 'country-head');
    const title = el('div', 'country-title');
    const name = el('div', 'country-name-row');
    name.append(el('h2', 'modal-title', this.options.countryName(id)));
    const { rank, great } = this.options.rankOf(game, id);
    if (rank > 0) {
      const badge = button(
        `rank-chip${great ? ' rank-chip-great' : ''}`,
        great ? `#${rank} · ${t('rank.greatPower')}` : `#${rank}`,
        () => this.options.openRankings(),
      );
      badge.setAttribute('aria-label', t('rank.place', { rank }));
      name.append(badge);
    }
    title.append(name);
    const bar = el('div', 'relation-bar');
    const fill = el('span', 'relation-fill');
    fill.style.left = r >= 0 ? '50%' : `${50 + r / 2}%`;
    fill.style.width = `${Math.abs(r) / 2}%`;
    fill.classList.add(r >= 0 ? 'relation-good' : 'relation-bad');
    bar.append(fill);
    // Relation score with its sign, green when positive and red when negative.
    const score = el('span', 'country-relation', t('dip.relation', { value: '' }));
    score.append(
      el('span', `mono relation-score ${signClass(Math.round(r), 0)}`, formatRelation(r)),
    );
    title.append(score, bar);
    head.append(this.options.flag(id), title);
    const chips = el('ul', 'chip-list');
    const chip = (text: string, cls = 'chip'): void => {
      chips.append(el('li', cls, text));
    };
    if (enemiesAtWar(game.world, me).includes(id)) chip(t('dip.atWar'), 'chip chip-rival');
    if (alliesOf(game.world, me).includes(id)) chip(t('dip.ally'), 'chip chip-ally');
    if (overlordOf(game.world, id) === me) chip(t('dip.yourVassal'), 'chip chip-ally');
    if (overlordOf(game.world, me) === id) chip(t('dip.yourOverlord'));
    if (sanctioned(game, me, id)) chip(t('dip.youSanction'), 'chip chip-rival');
    if (sanctioned(game, id, me)) chip(t('dip.theySanction'), 'chip chip-rival');
    chip(t('dip.credibility', { value: Math.round(game.diplomacy.credibility[id] ?? 0) }));
    for (const al of game.world.alliances)
      if (al.members.includes(id) && al.type !== 'vassal') chip(this.options.allianceName(al.id));
    const country = game.world.countries.find((c) => c.id === id);
    const leader = el('div', 'country-leader');
    if (country?.leader.name) {
      leader.append(
        leaderSeal(country.leader.name, id, 36),
        el(
          'span',
          '',
          `${t(`leaderTitle.${country.leader.title}` as TranslationKey)} ${country.leader.name}`,
        ),
      );
    }
    const wrap = el('div');
    wrap.append(
      head,
      leader,
      chips,
      el(
        'p',
        'setup-hint',
        t('dip.points', { value: (game.diplomacy.points[me] ?? 0).toFixed(1) }),
      ),
    );
    // Economic ties both ways: how much sanctions would hurt (GDD section 6).
    if (id !== me && sim.diplomacy?.sanctions.dependence) {
      const pct = (x: number | undefined): string => formatPercent(x ?? 0, 1);
      wrap.append(
        el(
          'p',
          'setup-hint',
          t('dip.ties', {
            theirs: pct(dependenceOn(game, sim, id).get(me)),
            ours: pct(dependenceOn(game, sim, me).get(id)),
          }),
        ),
      );
      const traded = game.resources?.trade[me]?.partners?.find(([c]) => c === id)?.[1] ?? 0;
      wrap.append(
        el(
          'p',
          'setup-hint',
          traded > 0 ? t('dip.trade', { value: formatUsd(traded) }) : t('dip.noTrade'),
        ),
      );
    }
    const profile = sim.profiles?.[id];
    if (profile && id !== me) {
      // The AI profile behind this country's decisions (GDD section 11), with its sources.
      const details = el('details', 'profile');
      details.append(el('summary', '', t('profile.title')));
      const list = el('dl', 'profile-traits');
      for (const tr of TRAITS) {
        const [value, why] = profile[tr];
        const bar = el('span', 'trait-bar');
        const fill = el('span', 'trait-fill');
        fill.style.width = `${value}%`;
        bar.append(fill);
        const dt = el('dt', '');
        dt.append(
          el('span', '', t(`profile.${tr}` as TranslationKey)),
          bar,
          el('span', 'mono', String(value)),
        );
        list.append(dt, el('dd', 'muted', why));
      }
      details.append(list);
      const names = (ids: string[]): string => ids.map(this.options.countryName).join(', ') || '—';
      details.append(
        el('p', 'setup-hint', `${t('profile.partners')}: ${names(profile.partners)}`),
        el('p', 'setup-hint', `${t('profile.rivals')}: ${names(profile.rivals)}`),
      );
      if (profile.derived) details.append(el('p', 'setup-hint', t('profile.derived')));
      wrap.append(details);
    }
    // The country's own goals (GDD section 13).
    const goals = game.aiGoals?.[id] ?? [];
    if (goals.length && id !== me) {
      const details = el('details', 'profile');
      details.append(el('summary', '', t('goals.title')));
      const list = el('ul', 'goal-list');
      for (const g of goals) {
        const item = el('li', `goal goal-${g.status}`);
        item.append(
          el('span', 'goal-name', this.options.describeGoal(g, id)),
          el(
            'span',
            'goal-status mono',
            g.status === 'active' ? '…' : t(`goals.${g.status}` as TranslationKey),
          ),
        );
        list.append(item);
      }
      details.append(list);
      wrap.append(details);
    }
    wrap.append(this.opinions());
    return wrap;
  }

  /** What this country thinks of others: its warmest and coldest relations (after AoH). */
  private opinions(): HTMLElement {
    const game = this.game!;
    const { sim } = this.options;
    const id = this.target;
    const scores = game.world.countries
      .filter((c) => c.id !== id && c.provinceIds.length > 0 && c.status !== 'uninhabited')
      .map((c) => [c.id, relation(game, sim, id, c.id)] as const)
      .sort((a, b) => b[1] - a[1]);
    const details = el('details', 'profile');
    details.append(el('summary', '', t('opinion.title')));
    const listOf = (rows: (readonly [string, number])[]): HTMLElement => {
      const list = el('ul', 'opinion-list');
      for (const [c, r] of rows) {
        const item = el('li', 'opinion');
        const bar = el('span', 'opinion-bar');
        const fill = el('span', `opinion-fill ${r >= 0 ? 'relation-good' : 'relation-bad'}`);
        fill.style.width = `${Math.min(100, Math.abs(r))}%`;
        bar.append(fill);
        item.append(
          this.options.flag(c),
          el('span', 'opinion-name', this.options.countryName(c)),
          bar,
          el('span', `mono relation-score ${signClass(Math.round(r), 0)}`, formatRelation(r)),
        );
        list.append(item);
      }
      return list;
    };
    const n = 6;
    const best = scores.slice(0, n).filter(([, r]) => r > 0);
    const worst = scores
      .slice(-n)
      .reverse()
      .filter(([, r]) => r < 0);
    if (!best.length && !worst.length) details.append(el('p', 'muted', t('opinion.none')));
    if (best.length) details.append(el('h4', 'opinion-head', t('opinion.best')), listOf(best));
    if (worst.length) details.append(el('h4', 'opinion-head', t('opinion.worst')), listOf(worst));
    return details;
  }

  /** An action button with its point cost; disabled when the player cannot afford it. */
  private action(
    label: string,
    cost: number,
    onTap: () => void,
    cls = 'btn btn-secondary',
    icon?: DipIcon,
  ): HTMLButtonElement {
    const game = this.game!;
    const have = game.diplomacy.points[game.player.countryId] ?? 0;
    const b = button(
      `${cls} dip-action`,
      cost > 0 ? `${label} · ${t('dip.cost', { points: cost })}` : label,
      onTap,
    );
    if (icon) b.prepend(dipIcon(icon));
    b.disabled = cost > have + 1e-9;
    return b;
  }

  /** A plain action button (no point cost) with its animated icon. */
  private plain(label: string, onTap: () => void, icon: DipIcon, cls = 'btn btn-secondary') {
    const b = button(`${cls} dip-action`, label, onTap);
    b.prepend(dipIcon(icon));
    return b;
  }

  private toastResult(
    command: Command,
    acceptedKey: TranslationKey,
    refusedKey: TranslationKey,
  ): void {
    const result = this.options.issue(command);
    if (!result) return;
    this.lastMessage = t(result.accepted === false ? refusedKey : acceptedKey, {
      country: this.options.countryName(this.target),
    });
    this.render();
  }

  private lastMessage = '';

  private mainView(): HTMLElement[] {
    const game = this.game!;
    const { sim } = this.options;
    const rules = diplomacyRules(sim);
    const me = game.player.countryId;
    const id = this.target;
    const atWar = enemiesAtWar(game.world, me).includes(id);
    const allied = alliesOf(game.world, me).includes(id);
    const list = el('div', 'dip-actions');
    const out: HTMLElement[] = [];
    if (atWar) {
      list.append(
        this.plain(t('dip.peaceTalks'), () => this.go('peace'), 'peace', 'btn btn-primary'),
      );
    } else {
      if (!allied)
        list.append(
          this.action(
            t('dip.proposePact'),
            rules.costs.alliance,
            () =>
              this.toastResult(
                { type: 'proposeAlliance', countryId: me, targetId: id },
                'dip.pactAccepted',
                'dip.refused',
              ),
            undefined,
            'pact',
          ),
        );
      for (const al of game.world.alliances) {
        if (al.type === 'vassal' || !al.members.includes(id) || al.members.includes(me)) continue;
        list.append(
          this.action(
            t('dip.joinAlliance', { alliance: this.options.allianceName(al.id) }),
            rules.costs.alliance,
            () =>
              this.toastResult(
                { type: 'proposeAlliance', countryId: me, targetId: id, allianceId: al.id },
                'dip.joinAccepted',
                'dip.refused',
              ),
            undefined,
            'join',
          ),
        );
      }
      list.append(
        this.action(
          t('dip.ultimatum'),
          rules.costs.ultimatum,
          () => this.go('ultimatum'),
          undefined,
          'ultimatum',
        ),
      );
      const city = this.baseCity();
      if (city >= 0) {
        list.append(
          this.action(
            t('dip.askBase', { city: this.options.cityName(city) }),
            rules.costs.base,
            () =>
              this.toastResult(
                { type: 'requestBase', countryId: me, cityId: city, pay: false },
                'dip.baseAccepted',
                'dip.refused',
              ),
            undefined,
            'base',
          ),
          this.action(
            t('dip.payBase', {
              city: this.options.cityName(city),
              price: formatUsd(basePrice(game, sim, id)),
            }),
            rules.costs.base,
            () =>
              this.toastResult(
                { type: 'requestBase', countryId: me, cityId: city, pay: true },
                'dip.baseAccepted',
                'dip.refused',
              ),
            undefined,
            'base',
          ),
        );
      }
      // Military access through their land (and ours).
      if (!allied) {
        if (hasAccess(game, me, id)) {
          const has = this.plain(t('dip.hasAccess'), () => undefined, 'access');
          has.disabled = true;
          list.append(has);
        } else
          list.append(
            this.action(
              t('dip.askAccess'),
              rules.costs.access ?? 0,
              () =>
                this.toastResult(
                  { type: 'requestAccess', countryId: me, targetId: id },
                  'dip.accessAccepted',
                  'dip.refused',
                ),
              undefined,
              'access',
            ),
          );
        if (hasAccess(game, id, me))
          list.append(
            this.plain(
              t('dip.revokeAccess'),
              () =>
                this.toastResult(
                  { type: 'revokeAccess', countryId: me, targetId: id },
                  'dip.done',
                  'dip.refused',
                ),
              'access',
            ),
          );
      }
      list.append(
        this.action(
          t('deal.title'),
          rules.costs.deal ?? 0,
          () => this.go('deal'),
          'btn btn-primary',
          'deal',
        ),
        this.action(t('dip.aid'), rules.costs.aid, () => this.go('aid'), undefined, 'aid'),
        this.plain(t('dip.weaponsTrade'), () => this.go('trade'), 'trade'),
      );
      if (overlordOf(game.world, id) === me) {
        list.append(
          this.plain(
            t('dip.release'),
            () =>
              this.toastResult(
                { type: 'vassal', countryId: me, mode: 'release', targetId: id },
                'dip.released',
                'dip.refused',
              ),
            'release',
          ),
        );
      } else {
        list.append(
          this.action(
            t('dip.askVassal'),
            rules.costs.vassal,
            () =>
              this.toastResult(
                { type: 'vassal', countryId: me, mode: 'ask', targetId: id },
                'dip.vassalAccepted',
                'dip.refused',
              ),
            undefined,
            'vassal',
          ),
          this.action(
            t('dip.offerVassal'),
            rules.costs.vassal,
            () =>
              this.toastResult(
                { type: 'vassal', countryId: me, mode: 'offer', targetId: id },
                'dip.offerAccepted',
                'dip.refused',
              ),
            undefined,
            'vassal',
          ),
        );
        for (const v of vassalsOf(game.world, me)) {
          if (v === id) continue;
          list.append(
            this.action(
              t('dip.transferVassal', { vassal: this.options.countryName(v) }),
              rules.costs.vassal,
              () =>
                this.toastResult(
                  { type: 'vassal', countryId: me, mode: 'transfer', targetId: id, vassalId: v },
                  'dip.transferAccepted',
                  'dip.refused',
                ),
              undefined,
              'vassal',
            ),
          );
        }
      }
    }
    // Improving relations (not at war) and insults, with no money involved.
    const mission = missionsOf(game, me).find((m) => m.to === id);
    if (!atWar) {
      const improve = mission
        ? this.plain(
            t('dip.improving', { weeks: mission.until - game.turn + 1 }),
            () => undefined,
            'improve',
          )
        : this.action(
            t('dip.improve'),
            rules.costs.improve ?? 0,
            () =>
              this.toastResult(
                { type: 'improveRelations', countryId: me, targetId: id },
                'dip.improveStarted',
                'dip.refused',
              ),
            undefined,
            'improve',
          );
      if (mission || insultedBetween(game, me, id)) improve.disabled = true;
      list.prepend(improve);
    }
    const insultButton = this.action(
      t('dip.insult'),
      rules.costs.insult ?? 0,
      () =>
        this.toastResult(
          { type: 'insult', countryId: me, targetId: id },
          'dip.insulted',
          'dip.refused',
        ),
      'btn btn-danger-outline',
      'insult',
    );
    if (insultedBetween(game, me, id)) insultButton.disabled = true;
    list.append(insultButton);

    // Sanctions work in war and peace.
    list.append(
      sanctioned(game, me, id)
        ? this.plain(
            t('dip.liftSanctions'),
            () =>
              this.toastResult(
                { type: 'liftSanctions', countryId: me, targetId: id },
                'dip.sanctionsLifted',
                'dip.refused',
              ),
            'unsanction',
          )
        : this.action(
            t('dip.sanction'),
            rules.costs.sanction,
            () =>
              this.toastResult(
                { type: 'sanction', countryId: me, targetId: id },
                'dip.sanctioned',
                'dip.refused',
              ),
            'btn btn-danger-outline',
            'sanction',
          ),
    );
    if (!atWar && !allied)
      list.append(
        this.plain(t('war.declare'), () => this.options.declareWar(id), 'war', 'btn btn-danger'),
      );
    out.push(list);
    return out;
  }

  /** City for a base request: the province the dialog came from, else the capital. */
  private baseCity(): number {
    const game = this.game!;
    const { sim } = this.options;
    const owner = (p: number): string | undefined => game.world.provinceOwners[p];
    if (this.provinceId >= 0 && owner(this.provinceId) === this.target)
      return provinceSeat(sim, this.provinceId);
    const c = game.world.countries.find((x) => x.id === this.target);
    return c ? provinceSeat(sim, c.capitalProvinceId) : -1;
  }

  private choice<T extends string>(
    values: readonly T[],
    current: T,
    label: (v: T) => string,
    set: (v: T) => void,
  ): HTMLElement {
    const list = el('div', 'option-list');
    for (const v of values) {
      const b = button(`option${v === current ? ' option-selected' : ''}`, '', () => {
        set(v);
        this.render();
      });
      b.append(el('span', 'option-title', label(v)));
      list.append(b);
    }
    return list;
  }

  private ultimatumView(): HTMLElement[] {
    const game = this.game!;
    const { sim } = this.options;
    const me = game.player.countryId;
    const id = this.target;
    const country = game.world.countries.find((c) => c.id === id)!;
    const land = sim.provinceNeighbors ?? [];
    // Provinces next to ours first, then the rest of the country.
    const border = country.provinceIds.filter((p) =>
      land[p]?.some((q) => game.world.provinceOwners[q] === me),
    );
    const provinces = [
      ...new Set([
        ...(this.provinceId >= 0 && game.world.provinceOwners[this.provinceId] === id
          ? [this.provinceId]
          : []),
        ...border,
      ]),
    ].slice(0, 8);
    const options: { key: string; label: string; demand: Demand }[] = [
      ...provinces.map((p) => ({
        key: `p${p}`,
        label: t('dip.demandProvince', { place: this.options.provinceName(p) }),
        demand: { type: 'province', provinceId: p } as Demand,
      })),
      ...game.world.alliances
        .filter((a) => a.type !== 'vassal' && a.members.includes(id))
        .map((a) => ({
          key: `a${a.id}`,
          label: t('dip.demandLeave', { alliance: this.options.allianceName(a.id) }),
          demand: { type: 'leaveAlliance', allianceId: a.id } as Demand,
        })),
      ...(sanctioned(game, id, me)
        ? [{ key: 'lift', label: t('dip.demandLift'), demand: { type: 'liftSanctions' } as Demand }]
        : []),
      {
        key: 'tribute',
        label: t('dip.demandTribute', {
          amount: formatUsd((game.economy.countries[id]?.gdp ?? 0) * 0.01),
        }),
        demand: { type: 'tribute', amountUsd: (game.economy.countries[id]?.gdp ?? 0) * 0.01 },
      },
      { key: 'vassal', label: t('dip.demandVassal'), demand: { type: 'vassal' } },
      ...(this.baseCity() >= 0
        ? [
            {
              key: 'base',
              label: t('dip.demandBase', { city: this.options.cityName(this.baseCity()) }),
              demand: { type: 'base', cityId: this.baseCity() } as Demand,
            },
          ]
        : []),
    ];
    const keyOf = (d: Demand): string =>
      d.type === 'province'
        ? `p${d.provinceId}`
        : d.type === 'leaveAlliance'
          ? `a${d.allianceId}`
          : d.type === 'liftSanctions'
            ? 'lift'
            : d.type;
    const current = keyOf(this.demand);
    if (!options.some((o) => o.key === current)) this.demand = options.at(-1)!.demand;
    const threats: Threat[] = alliesOf(game.world, me).includes(id)
      ? ['war', 'sanctions', 'leaveAlliance']
      : ['war', 'sanctions'];
    if (!threats.includes(this.threat)) this.threat = 'war';
    return [
      el('h3', 'setup-subtitle', t('dip.demand')),
      this.choice(
        options.map((o) => o.key),
        keyOf(this.demand),
        (k) => options.find((o) => o.key === k)!.label,
        (k) => (this.demand = options.find((o) => o.key === k)!.demand),
      ),
      el('h3', 'setup-subtitle', t('dip.threat')),
      this.choice(
        threats,
        this.threat,
        (v) => t(`dip.threat.${v}`),
        (v) => (this.threat = v),
      ),
      el(
        'p',
        'setup-hint',
        t('dip.ultimatumHint', {
          weeks: diplomacyRules(sim).ultimatum.deadlineTurns,
          enforce: diplomacyRules(sim).credibility.enforceTurns,
        }),
      ),
      this.action(
        t('dip.sendUltimatum'),
        diplomacyRules(sim).costs.ultimatum,
        () =>
          this.act(
            {
              type: 'ultimatum',
              countryId: me,
              targetId: id,
              demand: this.demand,
              threat: this.threat,
            },
            () => {
              this.lastMessage = t('dip.ultimatumSent', { country: this.options.countryName(id) });
              this.go('main');
            },
          ),
        'btn btn-danger',
      ),
    ];
  }

  private peaceView(): HTMLElement[] {
    const game = this.game!;
    const { sim } = this.options;
    const me = game.player.countryId;
    const id = this.target;
    const war = warBetween(game.world, me, id);
    if (!war) return [el('p', 'muted', t('dip.noWar'))];
    const rules = diplomacyRules(sim).peace;
    const score = warScore(game, war.id, me);
    const terms = this.terms;
    // Provinces are chosen one by one; at first, the best set the war score allows.
    const options = peaceProvinceOptions(game, sim, me, id);
    terms.keepProvinces = true;
    if (!terms.provinces) terms.provinces = bestPeaceProvinces(game, sim, me, id, terms);
    const cost = peaceCost(game, sim, me, id, terms)!;
    const all = peaceCost(game, sim, me, id, {
      ...terms,
      keepProvinces: true,
      returnProvinces: true,
      provinces: undefined,
    })!;
    const remaining = cost.available - cost.cost;
    const chosen = new Set(terms.provinces);
    const provinceList = el('ul', 'peace-provinces');
    for (const o of options) {
      const on = chosen.has(o.provinceId);
      const item = el('li');
      const b = button(`peace-province${on ? ' peace-province-on' : ''}`, '', () => {
        terms.provinces = on
          ? terms.provinces!.filter((p) => p !== o.provinceId)
          : [...terms.provinces!, o.provinceId];
        this.render();
      });
      // A province that no longer fits in the score cannot be added.
      b.disabled = !on && o.cost > remaining + 1e-9;
      b.setAttribute('aria-pressed', String(on));
      b.append(
        el('span', 'peace-check', on ? '✓' : ''),
        provinceIcon(),
        el('span', 'peace-name', this.options.provinceName(o.provinceId)),
        el('span', 'peace-cost mono', t('peace.points', { points: o.cost.toFixed(1) })),
      );
      item.append(b);
      provinceList.append(item);
    }
    const provinceTools = el('div', 'peace-tools');
    provinceTools.append(
      button('btn btn-secondary btn-small', t('peace.selectAll'), () => {
        terms.provinces = bestPeaceProvinces(game, sim, me, id, terms);
        this.render();
      }),
      button('btn btn-secondary btn-small', t('peace.clear'), () => {
        terms.provinces = [];
        this.render();
      }),
    );
    const toggle = (label: string, on: boolean, set: (v: boolean) => void): HTMLElement => {
      const row = el('label', 'check-row');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = on;
      box.addEventListener('change', () => {
        set(box.checked);
        this.render();
      });
      row.append(box, el('span', '', label));
      return row;
    };
    const slider = el('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = String(Math.round(rules.maxReparationsShare * 100));
    slider.value = String(Math.round(terms.reparationsShare * 100));
    slider.addEventListener('change', () => {
      terms.reparationsShare = Number(slider.value) / 100;
      this.render();
    });
    const reparations = el('label', 'slider');
    reparations.append(
      el('span', 'slider-label', t('dip.reparations')),
      el(
        'span',
        'slider-value mono',
        `${formatPercent(terms.reparationsShare, 0)}% · ${formatUsd(cost.reparations)}`,
      ),
      slider,
    );
    const ok = cost.cost <= cost.available;
    // Demands beyond the war score cannot be sent.
    const propose = button('btn btn-primary dip-action', t('dip.proposePeace'), () =>
      this.toastResult(
        { type: 'proposePeace', countryId: me, targetId: id, terms: { ...terms } },
        'dip.peaceAccepted',
        'dip.peaceRefused',
      ),
    );
    propose.disabled = !ok;
    const meter = el(
      'p',
      ok ? 'setup-hint' : 'setup-warning',
      t('dip.peaceCost', { cost: Math.round(cost.cost), available: Math.round(cost.available) }),
    );
    return [
      el(
        'p',
        `modal-text ${score >= 0 ? '' : 'danger'}`,
        t('dip.warScore', { score: Math.round(score) }),
      ),
      el('p', 'setup-hint', t('dip.peaceHint')),
      ...(war.sides.some((side) => side[0] === id && side.length > 1)
        ? [
            el(
              'p',
              'setup-hint',
              t('peace.alliesFollow', { country: this.options.countryName(id) }),
            ),
          ]
        : []),
      el('h3', 'setup-subtitle', t('peace.provinces', { count: options.length })),
      ...(options.length
        ? [provinceTools, provinceList]
        : [el('p', 'setup-hint', t('peace.noProvinces'))]),
      el(
        'p',
        'mono peace-remaining',
        t('peace.remaining', {
          selected: chosen.size,
          cost: cost.cost.toFixed(1),
          left: remaining.toFixed(1),
        }),
      ),
      el('h3', 'setup-subtitle', t('peace.otherTerms')),
      toggle(
        t('dip.returnProvinces', { count: all.give.length }),
        terms.returnProvinces,
        (v) => (terms.returnProvinces = v),
      ),
      reparations,
      toggle(t('dip.peaceVassal'), terms.vassal, (v) => (terms.vassal = v)),
      toggle(t('dip.demilitarize'), terms.demilitarize, (v) => (terms.demilitarize = v)),
      meter,
      propose,
    ];
  }

  /** Provinces one side could hand over: those near the other side first, never the capital. */
  private dealProvinces(giver: string, other: string): number[] {
    const game = this.game!;
    const { sim } = this.options;
    const country = game.world.countries.find((c) => c.id === giver);
    if (!country) return [];
    const owners = game.world.provinceOwners;
    const land = sim.provinceNeighbors ?? [];
    const pop = (p: number): number => sim.provincePopulation?.[p] ?? 0;
    const own = country.provinceIds.filter((p) => p !== country.capitalProvinceId);
    const near = own.filter((p) => (land[p] ?? []).some((q) => owners[q] === other));
    const list = (near.length ? near : own).sort((a, b) => pop(b) - pop(a)).slice(0, 40);
    if (owners[this.provinceId] === giver && this.provinceId !== country.capitalProvinceId)
      if (!list.includes(this.provinceId)) list.unshift(this.provinceId);
    return list;
  }

  /** Trade request (after Age of History): what we give, what we ask, and mutual treaties. */
  private dealView(): HTMLElement[] {
    const game = this.game!;
    const { sim } = this.options;
    const me = game.player.countryId;
    const id = this.target;
    const deal = this.deal;
    const others = game.world.countries
      .filter((c) => c.id !== me && c.id !== id && c.provinceIds.length > 0)
      .map((c) => c.id)
      .sort((a, b) => this.options.countryName(a).localeCompare(this.options.countryName(b)));
    const toggle = (label: string, on: boolean, set: (v: boolean) => void): HTMLElement => {
      const row = el('label', 'check-row');
      const box = el('input');
      box.type = 'checkbox';
      box.checked = on;
      box.addEventListener('change', () => {
        set(box.checked);
        this.render();
      });
      row.append(box, el('span', '', label));
      return row;
    };
    const pick = (
      label: string,
      value: string | undefined,
      set: (v: string | undefined) => void,
    ): HTMLElement => {
      const row = el('label', 'deal-pick');
      const select = el('select');
      select.append(new Option('—', ''));
      for (const c of others) select.append(new Option(this.options.countryName(c), c));
      select.value = value ?? '';
      select.addEventListener('change', () => {
        set(select.value || undefined);
        this.render();
      });
      row.append(el('span', 'deal-pick-label', label), select);
      return row;
    };
    const column = (title: string, side: DealSide, giver: string, other: string): HTMLElement => {
      const col = el('section', 'deal-column');
      col.append(el('h3', 'deal-column-title', title));
      const treasury = Math.max(0, game.economy.countries[giver]?.treasury ?? 0);
      side.money = Math.min(side.money ?? 0, treasury);
      col.append(
        amountSlider({
          label: t('deal.money'),
          min: 0,
          max: treasury,
          step: Math.max(1e6, Math.round(treasury / 200 / 1e6) * 1e6),
          value: side.money,
          format: (v) => formatUsd(v),
          onChange: (v) => {
            side.money = v;
            this.render();
          },
        }),
      );
      const provinces = this.dealProvinces(giver, other);
      if (provinces.length) {
        const chosen = new Set(side.provinces ?? []);
        const details = el('details', 'deal-provinces');
        details.open = chosen.size > 0;
        details.append(el('summary', '', t('deal.provinces', { count: chosen.size })));
        const list = el('ul', 'peace-provinces');
        for (const p of provinces) {
          const on = chosen.has(p);
          const item = el('li');
          const b = button(`peace-province${on ? ' peace-province-on' : ''}`, '', () => {
            side.provinces = on
              ? (side.provinces ?? []).filter((x) => x !== p)
              : [...(side.provinces ?? []), p];
            this.render();
          });
          b.setAttribute('aria-pressed', String(on));
          b.append(
            el('span', 'peace-check', on ? '✓' : ''),
            provinceIcon(),
            el('span', 'peace-name', this.options.provinceName(p)),
          );
          item.append(b);
          list.append(item);
        }
        details.append(list);
        col.append(details);
      }
      col.append(
        pick(t('deal.declareWar'), side.declareWarOn, (v) => (side.declareWarOn = v)),
        pick(t('deal.coalition'), side.sanctionsOn, (v) => (side.sanctionsOn = v)),
        toggle(t('deal.access'), !!side.militaryAccess, (v) => (side.militaryAccess = v)),
      );
      return col;
    };
    const columns = el('div', 'deal-columns');
    columns.append(
      column(t('deal.give'), deal.give, me, id),
      column(t('deal.take', { country: this.options.countryName(id) }), deal.take, id, me),
    );
    const allied = alliesOf(game.world, me).includes(id);
    const mutual = el('section', 'deal-mutual');
    mutual.append(el('h3', 'deal-column-title', t('deal.mutual')));
    if (!allied)
      mutual.append(
        toggle(t('deal.defensePact'), !!deal.defensePact, (v) => (deal.defensePact = v)),
      );
    if (!nonAggressionBetween(game, me, id))
      mutual.append(
        toggle(
          t('deal.nonAggression', { years: Math.round(dealRules(sim).nonAggressionTurns / 52) }),
          !!deal.nonAggression,
          (v) => (deal.nonAggression = v),
        ),
      );
    const invalid = dealError(game, me, id, deal);
    const score = invalid ? -Infinity : dealScore(game, sim, me, id, deal);
    const chance = invalid ? null : dealLikelihood(score, dealRules(sim));
    const meter = el('div', `deal-chance deal-chance-${chance ?? 'none'}`);
    const bar = el('span', 'deal-chance-bar');
    const level = { veryLow: 1, low: 2, medium: 3, high: 4 };
    for (let i = 1; i <= 4; i++)
      bar.append(el('span', `deal-chance-step${chance && level[chance] >= i ? ' on' : ''}`));
    meter.append(
      el('span', 'deal-chance-label', t('deal.chance')),
      bar,
      el(
        'span',
        'deal-chance-value',
        chance ? t(`deal.chance.${chance}` as TranslationKey) : t('deal.empty'),
      ),
    );
    const send = this.action(
      t('deal.send'),
      diplomacyRules(sim).costs.deal ?? 0,
      () => {
        const result = this.options.issue({
          type: 'proposeDeal',
          countryId: me,
          targetId: id,
          deal: structuredClone(deal),
        });
        if (!result) return;
        this.lastMessage = t(result.accepted === false ? 'deal.refused' : 'deal.accepted', {
          country: this.options.countryName(id),
        });
        if (result.accepted !== false) this.deal = { give: {}, take: {} };
        this.render();
      },
      'btn btn-primary',
      'deal',
    );
    if (invalid) send.disabled = true;
    return [el('p', 'setup-hint', t('deal.hint')), columns, mutual, meter, send];
  }

  private aidView(): HTMLElement[] {
    const game = this.game!;
    const { sim } = this.options;
    const me = game.player.countryId;
    const id = this.target;
    const treasury = Math.max(0, game.economy.countries[me]?.treasury ?? 0);
    this.aidMoney = Math.min(this.aidMoney, treasury);
    const row = amountSlider({
      label: t('dip.aidAmount'),
      min: 0,
      max: treasury,
      step: Math.max(1e6, Math.round(treasury / 200 / 1e6) * 1e6),
      value: this.aidMoney,
      format: (v) => formatUsd(v),
      onChange: (v) => {
        this.aidMoney = v;
        this.render();
      },
    });
    const arsenal = game.weapons.countries[me]!;
    const weaponRows: HTMLElement[] = [];
    for (const weapon of ['missile', 'drone'] as const) {
      const stock = weapon === 'missile' ? arsenal.missiles : arsenal.drones;
      stock.forEach((n, i) => {
        if (n <= 0) return;
        const chosen = this.aidWeapon?.weapon === weapon && this.aidWeapon.tier === i + 1;
        const b = button(`option${chosen ? ' option-selected' : ''}`, '', () => {
          this.aidWeapon = chosen ? null : { weapon, tier: i + 1, count: Math.min(n, 10) };
          this.render();
        });
        b.append(
          el('span', 'option-title', t(`strike.${weapon}Tier${i + 1}` as TranslationKey)),
          el('span', 'option-hint', t('strike.stock', { count: this.options.formatCount(n) })),
        );
        weaponRows.push(b);
      });
    }
    const list = el('div', 'option-list');
    list.append(...weaponRows);
    return [
      row,
      el('h3', 'setup-subtitle', t('dip.aidWeapons')),
      list,
      el('p', 'setup-hint', t('dip.aidHint')),
      this.action(
        t('dip.sendAid'),
        diplomacyRules(sim).costs.aid,
        () =>
          this.toastResult(
            {
              type: 'sendAid',
              countryId: me,
              targetId: id,
              money: this.aidMoney,
              ...(this.aidWeapon ? { weapons: this.aidWeapon } : {}),
            },
            'dip.aidSent',
            'dip.refused',
          ),
        'btn btn-primary',
      ),
    ];
  }

  private tradeView(): HTMLElement[] {
    const game = this.game!;
    const { sim } = this.options;
    const me = game.player.countryId;
    const id = this.target;
    const rules = weaponsRules(sim);
    const row = amountSlider({
      label: t('strike.count'),
      min: 1,
      max: 100,
      step: 1,
      value: this.tradeCount,
      format: (v) => String(v),
      onChange: (v) => {
        this.tradeCount = v;
        this.render();
      },
    });
    const n = this.tradeCount;
    const list = el('ul', 'dossier-cities');
    for (const weapon of ['missile', 'drone'] as const) {
      const tiers = weapon === 'missile' ? rules.missiles : rules.drones;
      tiers.forEach((_, i) => {
        const tier = i + 1;
        const theirs = forSale(game, sim, id, me, weapon, tier);
        const mine =
          (weapon === 'missile'
            ? game.weapons.countries[me]!.missiles
            : game.weapons.countries[me]!.drones)[i] ?? 0;
        if (theirs <= 0 && mine <= 0) return;
        const item = el('li');
        item.append(
          el('span', 'city-name', t(`strike.${weapon}Tier${tier}` as TranslationKey)),
          el('span', 'city-pop mono', formatUsd(weaponPrice(sim, weapon, tier, 1))),
        );
        if (theirs > 0) {
          const buy = button(
            'btn btn-secondary btn-small',
            t('dip.buy', { count: this.options.formatCount(Math.min(n, theirs)) }),
            () =>
              this.toastResult(
                {
                  type: 'tradeWeapons',
                  countryId: me,
                  direction: 'buy',
                  targetId: id,
                  weapon,
                  tier,
                  count: Math.min(n, theirs),
                },
                'dip.bought',
                'dip.refused',
              ),
          );
          item.append(buy);
        }
        if (mine > 0) {
          const sell = button(
            'btn btn-secondary btn-small',
            t('dip.sell', { count: this.options.formatCount(Math.min(n, mine)) }),
            () =>
              this.toastResult(
                {
                  type: 'tradeWeapons',
                  countryId: me,
                  direction: 'sell',
                  targetId: id,
                  weapon,
                  tier,
                  count: Math.min(n, mine),
                },
                'dip.sold',
                'dip.refused',
              ),
          );
          item.append(sell);
        }
        list.append(item);
      });
    }
    if (!list.children.length) list.append(el('li', 'muted', t('dip.noTrade')));
    return [row, el('p', 'setup-hint', t('dip.tradeHint')), list];
  }
}

/** A small map-pin icon for a province demanded in a peace. */
function provinceIcon(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'peace-icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linejoin="round"><path d="M4 7l5-3 6 3 5-3v13l-5 3-6-3-5 3z"/>' +
    '<path d="M9 4v13M15 7v13"/></svg>';
  return span;
}
