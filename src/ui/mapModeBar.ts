import { t } from '../i18n';
import { MAP_MODES } from '../map/mapModes';
import { button, el } from './dom';

/** Switches between map modes (GDD section 13); bottom left during a game. */
export class MapModeBar {
  private readonly root = el('div', 'map-mode-bar');
  private current = MAP_MODES[0]!.id;

  constructor(
    parent: HTMLElement,
    private readonly onChange: (modeId: string) => void,
  ) {
    this.root.hidden = true;
    this.root.setAttribute('role', 'group');
    parent.append(this.root);
  }

  show(): void {
    this.render();
    this.root.hidden = false;
  }

  hide(): void {
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
    this.root.setAttribute('aria-label', t('mapMode.title'));
    this.root.replaceChildren(
      ...MAP_MODES.map((mode) => {
        const active = mode.id === this.current;
        const b = button(`map-mode${active ? ' map-mode-on' : ''}`, t(mode.nameKey), () => {
          this.set(mode.id);
          this.onChange(mode.id);
        });
        b.setAttribute('aria-pressed', String(active));
        return b;
      }),
    );
  }
}
