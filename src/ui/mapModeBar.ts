import { t } from '../i18n';
import { MAP_MODES } from '../map/mapModes';
import { button, el } from './dom';

/** Map mode switch (GDD section 13): one button, bottom left; tap it to choose a mode. */
export class MapModeBar {
  private readonly root = el('div', 'map-mode-bar');
  private current = MAP_MODES[0]!.id;
  private open = false;

  constructor(
    parent: HTMLElement,
    private readonly onChange: (modeId: string) => void,
  ) {
    this.root.hidden = true;
    parent.append(this.root);
  }

  show(): void {
    this.render();
    this.root.hidden = false;
  }

  hide(): void {
    this.open = false;
    this.root.hidden = true;
  }

  /** Sets the active mode without notifying. */
  set(modeId: string): void {
    this.current = modeId;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    const mode = MAP_MODES.find((m) => m.id === this.current) ?? MAP_MODES[0]!;
    const children: HTMLElement[] = [];
    if (this.open) {
      const list = el('div', 'map-mode-list');
      list.setAttribute('role', 'menu');
      for (const m of MAP_MODES) {
        const active = m.id === this.current;
        const b = button(`map-mode${active ? ' map-mode-on' : ''}`, t(m.nameKey), () => {
          this.open = false;
          this.set(m.id);
          this.onChange(m.id);
        });
        b.setAttribute('role', 'menuitemradio');
        b.setAttribute('aria-checked', String(active));
        list.append(b);
      }
      children.push(list);
    }
    const toggle = button('map-mode map-mode-toggle', `${t(mode.nameKey)} ▾`, () => {
      this.open = !this.open;
      this.render();
    });
    toggle.setAttribute('aria-label', `${t('mapMode.title')}: ${t(mode.nameKey)}`);
    toggle.setAttribute('aria-expanded', String(this.open));
    children.push(toggle);
    this.root.replaceChildren(...children);
  }
}
