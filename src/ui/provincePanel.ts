import { getLanguage, t } from '../i18n';
import type { MapData } from '../map/mapData';

/** Dossier-style info panel for the selected province. Closes with one tap. */
export class ProvincePanel {
  private readonly panel = document.createElement('section');
  private provinceId: number | null = null;

  constructor(
    root: HTMLElement,
    private readonly data: MapData,
    private readonly onClose: () => void,
    /** Current owner of a province: id and display name (ownership comes from the game). */
    private readonly ownerOf: (provinceId: number) => { id: string; name: string },
  ) {
    this.panel.className = 'dossier';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    root.append(this.panel);
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

  /** Re-renders in the current language. */
  refresh(): void {
    if (this.provinceId !== null) this.render();
  }

  private render(): void {
    const province = this.data.provinces[this.provinceId!]!;
    const country = this.ownerOf(province.id);
    const cities = this.data.cities
      .filter((c) => c.provinceId === province.id)
      .sort((a, b) => Number(b.isCapital) - Number(a.isCapital) || b.population - a.population);
    const number = new Intl.NumberFormat(getLanguage() === 'sr' ? 'sr-Latn' : 'en');

    const header = el('header', 'dossier-strip');
    header.append(
      el('span', 'dossier-code', country.id),
      el('span', 'dossier-label', t('panel.province')),
    );
    const close = el('button', 'dossier-close', '×') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', t('panel.close'));
    close.addEventListener('click', () => {
      this.hide();
      this.onClose();
    });
    header.append(close);

    const title = el('h2', 'dossier-title', province.name);
    const facts = el('dl', 'dossier-facts');
    facts.append(
      el('dt', '', t('panel.owner')),
      el('dd', '', country.name),
      el('dt', '', t('panel.area')),
      el('dd', 'mono', t('units.km2', { value: number.format(Math.round(province.areaKm2)) })),
    );

    const list = el('ul', 'dossier-cities');
    for (const city of cities) {
      const item = el('li');
      item.append(el('span', 'city-name', city.name));
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
      list.append(item);
    }

    this.panel.replaceChildren(
      header,
      title,
      facts,
      el('h3', 'dossier-subtitle', t('panel.cities')),
      list,
    );
  }
}

function el(tag: string, className = '', text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
