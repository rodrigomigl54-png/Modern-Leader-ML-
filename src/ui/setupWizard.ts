import { getLanguage, t, type TranslationKey } from '../i18n';
import {
  countryFlag,
  countryName,
  formatPeople,
  formatUsd,
  searchKey,
  starsText,
} from '../app/present';
import type { WorldBundle } from '../app/worldData';
import type { MapPolitics, MapView } from '../map/mapView';
import { computeDifficulty, type DifficultyResult } from '../sim/difficulty';
import { LEADER_NAME_MAX, normalizeLeaderName, type NewGameOptions } from '../sim/newGame';
import {
  AGGRESSIVENESS_LEVELS,
  applyDisputedSetting,
  DISPUTED_MODES,
  enemiesAtWar,
  rivalsOf,
  type Aggressiveness,
  type DisputedMode,
  type World,
} from '../sim/world';
import { button, el, flagImage } from './dom';

type Sort = 'name' | 'gdp' | 'difficulty';

/** Map view of a world after the disputed-territories setting. */
export function politicsFor(effective: World, mode: DisputedMode): MapPolitics {
  return {
    owners: effective.provinceOwners,
    countries: effective.countries.map((c) => ({
      id: c.id,
      status: c.status,
      provinceIds: c.provinceIds,
    })),
    nameOf: (id) => countryName(effective, id, mode),
  };
}

export interface SetupWizardOptions {
  parent: HTMLElement;
  bundle: WorldBundle;
  map: MapView;
  defaultDisputedMode: () => DisputedMode;
  onCancel: () => void;
  onStart: (options: NewGameOptions) => void;
}

/** New game setup (GDD section 3): AI aggressiveness, country, leader name. */
export class SetupWizard {
  private readonly root = el('div', 'screen setup');
  private step: 1 | 2 | 3 = 1;
  private aggressiveness: Aggressiveness = 'realistic';
  private disputedMode: DisputedMode = 'neutral';
  private countryId: string | null = null;
  private leaderName = '';
  private search = '';
  private sort: Sort = 'difficulty';
  private effective!: World;
  private difficulty = new Map<string, DifficultyResult>();

  constructor(private readonly options: SetupWizardOptions) {
    this.root.hidden = true;
    options.parent.append(this.root);
  }

  private get world(): World {
    return this.options.bundle.world;
  }

  open(): void {
    this.step = 1;
    this.aggressiveness = 'realistic';
    this.countryId = null;
    this.leaderName = '';
    this.search = '';
    this.setDisputedMode(this.options.defaultDisputedMode());
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
    this.options.map.setFocusCountry(null);
  }

  get isChoosingCountry(): boolean {
    return !this.root.hidden && this.step === 2;
  }

  /** A tap on the map while choosing a country selects its owner. */
  selectProvince(provinceId: number | null): void {
    if (!this.isChoosingCountry || provinceId === null) return;
    this.selectCountry(this.options.map.ownerOf(provinceId), false);
  }

  refresh(): void {
    if (this.root.hidden) return;
    this.options.map.setPolitics(politicsFor(this.effective, this.disputedMode));
    this.render();
  }

  private setDisputedMode(mode: DisputedMode): void {
    this.disputedMode = mode;
    this.effective = applyDisputedSetting(this.world, mode);
    this.difficulty = computeDifficulty(this.effective);
    this.options.map.setPolitics(politicsFor(this.effective, mode));
    if (this.countryId && !this.effective.countries.some((c) => c.id === this.countryId)) {
      this.countryId = null;
    }
    this.options.map.setFocusCountry(this.step >= 2 ? this.countryId : null);
  }

  private isPlayable(id: string | null): boolean {
    return !!id && this.effective.countries.find((c) => c.id === id)?.status === 'full';
  }

  private selectCountry(id: string, fromList: boolean): void {
    this.countryId = id;
    this.options.map.setFocusCountry(id);
    this.render();
    if (fromList) this.lookAt(id);
  }

  private goTo(step: 1 | 2 | 3): void {
    this.step = step;
    this.options.map.setFocusCountry(step >= 2 ? this.countryId : null);
    this.render();
    if (step === 2 && this.countryId) this.lookAt(this.countryId);
  }

  /** Centers the map on a country in the area the setup sheet leaves free. */
  private lookAt(id: string): void {
    const sheet = this.root.querySelector('.setup-sheet');
    const rect = sheet?.getBoundingClientRect();
    const docked = rect && rect.width < window.innerWidth * 0.8;
    this.options.map.lookAtCountry(id, {
      left: docked ? rect.right : 0,
      bottom: !docked && rect ? window.innerHeight - rect.top : 0,
    });
  }

  private render(): void {
    this.root.classList.toggle('setup-map', this.step === 2);
    const card = el('div', this.step === 2 ? 'setup-sheet' : 'setup-card');
    card.append(
      el('div', 'setup-step mono', t('setup.step', { step: this.step, total: 3 })),
      ...(this.step === 1
        ? this.renderAggressiveness()
        : this.step === 2
          ? this.renderCountry()
          : this.renderLeader()),
    );
    this.root.replaceChildren(card);
  }

  private footer(
    back: () => void,
    nextLabel: string,
    next: () => void,
    enabled: boolean,
  ): HTMLElement {
    const footer = el('div', 'setup-footer');
    const nextButton = button('btn btn-primary', nextLabel, next);
    nextButton.disabled = !enabled;
    footer.append(button('btn btn-secondary', t('setup.back'), back), nextButton);
    return footer;
  }

  private renderAggressiveness(): HTMLElement[] {
    const list = el('div', 'option-list');
    list.setAttribute('role', 'radiogroup');
    for (const level of AGGRESSIVENESS_LEVELS) {
      const option = button(
        `option${level === this.aggressiveness ? ' option-selected' : ''}`,
        '',
        () => {
          this.aggressiveness = level;
          this.render();
        },
      );
      option.setAttribute('role', 'radio');
      option.setAttribute('aria-checked', String(level === this.aggressiveness));
      const title = el('span', 'option-title', t(`aggr.${level}` as TranslationKey));
      if (level === 'realistic') title.append(el('span', 'badge', t('setup.default')));
      option.append(title, el('span', 'option-hint', t(`aggr.${level}Hint` as TranslationKey)));
      list.append(option);
    }
    return [
      el('h2', 'setup-title', t('setup.aggressiveness')),
      el('p', 'setup-hint', t('setup.aggressivenessHint')),
      list,
      this.footer(this.options.onCancel, t('setup.next'), () => this.goTo(2), true),
    ];
  }

  private renderCountry(): HTMLElement[] {
    const header = el('div', 'setup-sheet-header');
    header.append(el('h2', 'setup-title', t('setup.country')));

    const disputed = el('div', 'segmented');
    disputed.setAttribute('aria-label', t('setup.disputed'));
    for (const mode of DISPUTED_MODES) {
      const b = button(
        mode === this.disputedMode ? 'segment segment-selected' : 'segment',
        t(`disputed.${mode}`),
        () => {
          this.setDisputedMode(mode);
          this.render();
        },
      );
      b.title = t(`disputed.${mode}Hint`);
      disputed.append(b);
    }
    const disputedRow = el('div', 'setup-row');
    disputedRow.append(el('span', 'setup-row-label', t('setup.disputed')), disputed);

    const details = this.countryId
      ? this.renderDetails(this.countryId)
      : el('p', 'setup-hint', t('setup.countryHint'));

    const tools = el('div', 'setup-tools');
    const search = el('input', 'input');
    search.type = 'search';
    search.placeholder = t('setup.search');
    search.value = this.search;
    search.setAttribute('aria-label', t('setup.search'));
    const sort = el('select', 'input input-sort');
    sort.setAttribute('aria-label', t('setup.sort'));
    for (const s of ['difficulty', 'name', 'gdp'] as Sort[]) {
      const option = el('option', '', t(`sort.${s}`));
      option.value = s;
      option.selected = s === this.sort;
      sort.append(option);
    }
    tools.append(search, sort);
    const list = el('div', 'country-list');
    const fillList = (): void => list.replaceChildren(...this.countryRows());
    search.addEventListener('input', () => {
      this.search = search.value;
      fillList();
    });
    sort.addEventListener('change', () => {
      this.sort = sort.value as Sort;
      fillList();
    });
    fillList();

    return [
      header,
      disputedRow,
      details,
      tools,
      list,
      this.footer(
        () => this.goTo(1),
        t('setup.next'),
        () => this.goTo(3),
        this.isPlayable(this.countryId),
      ),
    ];
  }

  private countryRows(): HTMLElement[] {
    const key = searchKey(this.search.trim());
    const collator = new Intl.Collator(getLanguage() === 'sr' ? 'sr-Latn' : 'en');
    const rows = this.effective.countries
      .filter((c) => c.status === 'full')
      .map((c) => ({ c, name: countryName(this.world, c.id, this.disputedMode) }))
      .filter(
        ({ name, c }) => !key || searchKey(name).includes(key) || c.id.toLowerCase().includes(key),
      );
    rows.sort((a, b) => {
      if (this.sort === 'gdp')
        return (
          (b.c.stats.gdpUsd ?? -1) - (a.c.stats.gdpUsd ?? -1) || collator.compare(a.name, b.name)
        );
      if (this.sort === 'difficulty') {
        const da = this.difficulty.get(a.c.id)?.score ?? 0;
        const db = this.difficulty.get(b.c.id)?.score ?? 0;
        if (da !== db) return db - da;
      }
      return collator.compare(a.name, b.name);
    });
    return rows.map(({ c, name }) => {
      const row = button(
        `country-row${c.id === this.countryId ? ' country-row-selected' : ''}`,
        '',
        () => this.selectCountry(c.id, true),
      );
      const stars = this.difficulty.get(c.id)?.stars ?? 3;
      const starsEl = el('span', 'stars', starsText(stars));
      starsEl.setAttribute('aria-label', `${t('setup.difficulty')}: ${stars}/5`);
      row.append(
        flagImage(countryFlag(this.world, c.id, this.disputedMode)),
        el('span', 'country-row-name', name),
        starsEl,
        el('span', 'country-row-gdp mono', formatUsd(c.stats.gdpUsd)),
      );
      return row;
    });
  }

  private renderDetails(id: string): HTMLElement {
    const country = this.effective.countries.find((c) => c.id === id);
    const box = el('div', 'country-details');
    if (!country) return box;
    const name = countryName(this.world, id, this.disputedMode);
    const head = el('div', 'country-details-head');
    head.append(
      flagImage(countryFlag(this.world, id, this.disputedMode), 'flag flag-large'),
      el('h3', 'country-details-name', name),
    );
    box.append(head);

    if (country.status !== 'full') {
      box.append(el('p', 'setup-warning', t('setup.notPlayable')));
      return box;
    }
    const stars = this.difficulty.get(id)?.stars ?? 3;
    const nameOf = (other: string): string => countryName(this.world, other, this.disputedMode);
    const facts = el('dl', 'facts');
    const fact = (label: string, value: string | HTMLElement, cls = ''): void => {
      const dd = el('dd', cls);
      dd.append(value);
      facts.append(el('dt', '', label), dd);
    };
    fact(t('setup.difficulty'), starsText(stars), 'stars');
    fact(t('setup.gdp'), formatUsd(country.stats.gdpUsd), 'mono');
    fact(t('setup.population'), formatPeople(country.stats.population), 'mono');
    fact(t('setup.army'), formatPeople(country.stats.militaryPersonnel), 'mono');

    const allianceIds = this.effective.alliances.filter((a) => a.members.includes(id));
    const allies = allianceIds.map((a) =>
      a.members.length === 2
        ? nameOf(a.members.find((m) => m !== id)!)
        : t(
            (this.options.bundle.allianceNames.get(a.id) ?? 'alliance.bilateral') as TranslationKey,
          ),
    );
    fact(t('setup.allies'), chips(allies, 'chip'));
    fact(t('setup.rivals'), chips(rivalsOf(this.effective, id).map(nameOf), 'chip chip-rival'));
    const enemies = enemiesAtWar(this.effective, id);
    if (enemies.length) fact(t('setup.atWar'), chips(enemies.map(nameOf), 'chip chip-war'));
    box.append(facts);
    return box;
  }

  private renderLeader(): HTMLElement[] {
    const id = this.countryId!;
    const country = this.effective.countries.find((c) => c.id === id)!;
    const name = countryName(this.world, id, this.disputedMode);
    const leader = country.leader;
    const hint = leader.name
      ? t('setup.leaderHint', {
          title: t(`leaderTitle.${leader.title}` as TranslationKey),
          name: leader.name,
          country: name,
        })
      : t('setup.leaderHintNoName', { country: name });

    const input = el('input', 'input input-large');
    input.type = 'text';
    input.maxLength = LEADER_NAME_MAX;
    input.placeholder = t('setup.leaderPlaceholder');
    input.value = this.leaderName;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', t('setup.leader'));

    const summary = el('dl', 'facts');
    const row = (label: string, value: string | HTMLElement): void => {
      const dd = el('dd');
      dd.append(value);
      summary.append(el('dt', '', label), dd);
    };
    const countryCell = el('span', 'summary-country');
    countryCell.append(
      flagImage(countryFlag(this.world, id, this.disputedMode)),
      el('span', '', `${name}  ${starsText(this.difficulty.get(id)?.stars ?? 3)}`),
    );
    row(t('setup.country'), countryCell);
    row(t('setup.aggressiveness'), t(`aggr.${this.aggressiveness}` as TranslationKey));
    row(t('setup.disputed'), t(`disputed.${this.disputedMode}` as TranslationKey));

    const footer = this.footer(
      () => this.goTo(2),
      t('setup.start'),
      () =>
        this.options.onStart({
          aggressiveness: this.aggressiveness,
          disputedMode: this.disputedMode,
          countryId: id,
          leaderName: this.leaderName,
          seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
        }),
      normalizeLeaderName(this.leaderName).length > 0,
    );
    const start = footer.querySelector<HTMLButtonElement>('.btn-primary')!;
    input.addEventListener('input', () => {
      this.leaderName = input.value;
      start.disabled = normalizeLeaderName(input.value).length === 0;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !start.disabled) start.click();
    });
    queueMicrotask(() => input.focus());

    return [
      el('h2', 'setup-title', t('setup.leader')),
      el('p', 'setup-hint', hint),
      input,
      el('h3', 'setup-subtitle', t('setup.summary')),
      summary,
      footer,
    ];
  }
}

function chips(items: string[], className: string): HTMLElement {
  const box = el('span', 'chips');
  if (items.length === 0) box.append(el('span', 'muted', t('setup.none')));
  for (const item of items) box.append(el('span', className, item));
  return box;
}
