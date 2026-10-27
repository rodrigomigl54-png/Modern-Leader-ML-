import { t } from '../i18n';
import { countryFlag, countryName } from '../app/present';
import { AUTOSAVE_SLOT, MANUAL_SLOTS, type SaveStore, type SlotId } from '../app/saveStore';
import type { SaveFile } from '../sim/save';
import type { World } from '../sim/world';
import { button, el, flagImage } from './dom';
import { formatGameDate, formatTimestamp } from './format';

export interface SaveSlotsOptions {
  parent: HTMLElement;
  store: SaveStore;
  baseWorld: World;
  /** Save into a slot (mode "save"); the caller asks before overwriting. */
  onSave: (slot: SlotId, existing: SaveFile | null) => void;
  onLoad: (save: SaveFile) => void;
  /** Deletes a saved game; the caller asks first. Resolves true when it was deleted. */
  onDelete: (slot: SlotId, save: SaveFile) => Promise<boolean>;
  onImport: () => void;
  onClose: () => void;
}

/** Lists the autosave and manual save slots, for saving or loading. */
export class SaveSlots {
  private readonly root = el('div', 'screen save-slots');

  constructor(private readonly options: SaveSlotsOptions) {
    this.root.hidden = true;
    options.parent.append(this.root);
  }

  async show(mode: 'save' | 'load'): Promise<void> {
    const saves = new Map((await this.options.store.list()).map((e) => [e.slot, e.save]));
    const card = el('div', 'menu-card');
    card.append(
      el('h2', 'setup-title', t(mode === 'save' ? 'saves.saveTitle' : 'saves.loadTitle')),
    );
    if (this.options.store.memoryOnly) card.append(el('p', 'setup-warning', t('saves.memoryOnly')));

    const list = el('div', 'slot-list');
    // The autosave can be loaded but not overwritten by hand.
    const slots: SlotId[] = mode === 'save' ? [...MANUAL_SLOTS] : [AUTOSAVE_SLOT, ...MANUAL_SLOTS];
    for (const slot of slots) {
      const save = saves.get(slot) ?? null;
      if (mode === 'load' && !save) continue;
      const row = button('slot', '', () => {
        if (mode === 'save') this.options.onSave(slot, save);
        else if (save) this.options.onLoad(save);
      });
      row.append(el('span', 'slot-name', slotName(slot)));
      if (save) row.append(this.summary(save));
      else row.append(el('span', 'muted', t('saves.empty')));
      // A saved game can be deleted by hand (the autosave too).
      const line = el('div', 'slot-row');
      line.append(row);
      if (save) {
        const remove = button('btn btn-danger-outline slot-delete', '', () => {
          void this.options.onDelete(slot, save).then((deleted) => {
            if (deleted) void this.show(mode);
          });
        });
        remove.innerHTML =
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
          'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
        remove.setAttribute('aria-label', t('saves.delete', { slot: slotName(slot) }));
        remove.title = t('saves.delete', { slot: slotName(slot) });
        line.append(remove);
      }
      list.append(line);
    }
    if (list.childElementCount === 0) list.append(el('p', 'setup-hint', t('saves.none')));

    const footer = el('div', 'setup-footer');
    footer.append(button('btn btn-secondary', t('saves.cancel'), () => this.close()));
    if (mode === 'load')
      footer.append(button('btn btn-secondary', t('menu.import'), this.options.onImport));
    card.append(list, footer);
    this.root.replaceChildren(card);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private close(): void {
    this.hide();
    this.options.onClose();
  }

  private summary(save: SaveFile): HTMLElement {
    const { countryId, leaderName, turn, date } = save.summary;
    const mode = save.game.settings.disputedMode;
    const box = el('span', 'slot-summary');
    const head = el('span', 'slot-head');
    head.append(
      flagImage(countryFlag(this.options.baseWorld, countryId, mode)),
      el(
        'span',
        'slot-country',
        `${countryName(this.options.baseWorld, countryId, mode)} · ${leaderName}`,
      ),
    );
    box.append(
      head,
      el('span', 'slot-line mono', t('saves.line', { turn: turn + 1, date: formatGameDate(date) })),
      el('span', 'slot-time muted', formatTimestamp(save.savedAt)),
    );
    return box;
  }
}

export function slotName(slot: SlotId): string {
  return slot === AUTOSAVE_SLOT ? t('saves.autosave') : t('saves.slot', { n: slot.split('-')[1]! });
}
