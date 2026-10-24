import { getLanguage, t, type TranslationKey } from '../i18n';
import type { MapData } from '../map/mapData';
import { button, el } from './dom';

export interface CityBuilding {
  category: string;
  /** Weeks until finished, or null when finished. */
  weeksLeft: number | null;
}

/** Population of a province in a running game (GDD section 7). */
export interface ProvinceStatus {
  support: number;
  rioting: boolean;
  /** Owner is a rebel faction. */
  rebels: boolean;
  /** Name of the people living there when not assimilated, else null. */
  foreignCulture: string | null;
  /** Weeks until an assimilation in progress completes, else null. */
  assimilatingWeeks: number | null;
  /** Assimilation cost when the player can order it, else null. */
  assimilationCost: string | null;
  riotThreshold: number;
}

export interface ProvincePanelOptions {
  parent: HTMLElement;
  data: MapData;
  onClose: () => void;
  /** Current owner of a province: id and display name (ownership comes from the game). */
  ownerOf: (provinceId: number) => { id: string; name: string };
  buildingsIn: (cityId: number) => CityBuilding[];
  /** City selection for multi-city orders (investment now, military orders later). */
  isSelected: (cityId: number) => boolean;
  toggleSelected: (cityId: number) => void;
  /** Population status, or null outside a game. */
  statusOf: (provinceId: number) => ProvinceStatus | null;
  onAssimilate: (provinceId: number) => void;
}

/** Dossier-style info panel for the selected province. Closes with one tap. */
export class ProvincePanel {
  private readonly panel = el('section', 'dossier');
  private provinceId: number | null = null;

  constructor(private readonly options: ProvincePanelOptions) {
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    options.parent.append(this.panel);
  }

  show(provinceId: number): void {
    this.provinceId = provinceId;
    this.render();
    this.panel.hidden = false;
  }

  hide(): void {
    this.provinceId = null;
    this.panel.hidden = true;
  }

  /** Re-renders (language change, new turn, changed selection). */
  refresh(): void {
    if (this.provinceId !== null) this.render();
  }

  private render(): void {
    const { data } = this.options;
    const province = data.provinces[this.provinceId!]!;
    const country = this.options.ownerOf(province.id);
    const cities = data.cities
      .filter((c) => c.provinceId === province.id)
      .sort((a, b) => Number(b.isCapital) - Number(a.isCapital) || b.population - a.population);
    const number = new Intl.NumberFormat(getLanguage() === 'sr' ? 'sr-Latn' : 'en');

    const header = el('header', 'dossier-strip');
    header.append(
      el('span', 'dossier-code', country.id),
      el('span', 'dossier-label', t('panel.province')),
    );
    const close = button('dossier-close', '×', () => {
      this.hide();
      this.options.onClose();
    });
    close.setAttribute('aria-label', t('panel.close'));
    header.append(close);

    const facts = el('dl', 'dossier-facts');
    facts.append(
      el('dt', '', t('panel.owner')),
      el('dd', '', country.name),
      el('dt', '', t('panel.area')),
      el('dd', 'mono', t('units.km2', { value: number.format(Math.round(province.areaKm2)) })),
    );
    const status = this.options.statusOf(province.id);
    const extra: HTMLElement[] = [];
    if (status && !status.rebels) {
      facts.append(
        el('dt', '', t('interior.support')),
        el(
          'dd',
          status.support < status.riotThreshold ? 'mono danger' : 'mono',
          `${Math.round(status.support)}%${status.rioting ? ` · ${t('interior.rioting')}` : ''}`,
        ),
      );
      if (status.foreignCulture) {
        facts.append(
          el('dt', '', t('interior.culture')),
          el(
            'dd',
            '',
            status.assimilatingWeeks !== null
              ? `${status.foreignCulture} · ${t('interior.assimilating', { weeks: status.assimilatingWeeks })}`
              : status.foreignCulture,
          ),
        );
      }
      if (status.assimilationCost) {
        extra.push(
          button(
            'btn btn-secondary',
            t('interior.assimilate', { cost: status.assimilationCost }),
            () => this.options.onAssimilate(province.id),
          ),
        );
      }
    } else if (status?.rebels) {
      facts.append(
        el('dt', '', t('interior.status')),
        el('dd', 'danger', t('interior.heldByRebels')),
      );
    }

    const list = el('ul', 'dossier-cities');
    for (const city of cities) {
      const item = el('li');
      const selected = this.options.isSelected(city.id);
      const toggle = button(
        `select-toggle${selected ? ' select-toggle-on' : ''}`,
        selected ? '✓' : '+',
        () => {
          this.options.toggleSelected(city.id);
          this.render();
        },
      );
      toggle.setAttribute('aria-pressed', String(selected));
      toggle.setAttribute('aria-label', t(selected ? 'invest.selected' : 'invest.select'));
      item.append(toggle, el('span', 'city-name', city.name));
      if (city.isCapital) item.append(el('span', 'badge badge-capital', t('panel.capital')));
      if (city.isPort) item.append(el('span', 'badge', t('panel.port')));
      if (city.population > 0) {
        item.append(
          el(
            'span',
            'city-pop mono',
            t('units.population', { value: number.format(city.population) }),
          ),
        );
      }
      const buildings = this.options.buildingsIn(city.id);
      if (buildings.length) {
        const row = el('span', 'city-buildings');
        for (const b of buildings) {
          const name = t(`building.${b.category}` as TranslationKey);
          row.append(
            el(
              'span',
              b.weeksLeft === null ? 'chip' : 'chip chip-rival',
              b.weeksLeft === null
                ? name
                : `${name} · ${t('econ.weeksLeft', { weeks: b.weeksLeft })}`,
            ),
          );
        }
        item.append(row);
      }
      list.append(item);
    }

    this.panel.replaceChildren(
      header,
      el('h2', 'dossier-title', province.name),
      facts,
      ...extra,
      el('h3', 'dossier-subtitle', t('panel.cities')),
      list,
    );
  }
}
