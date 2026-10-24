// Save slots in the browser's IndexedDB (works offline), plus export/import as a file so a save
// can move between devices (GDD section 2). Falls back to memory if IndexedDB is blocked.
import { parseSave, serializeSave, type ParsedSave, type SaveFile } from '../sim/save';

export const AUTOSAVE_SLOT = 'autosave';
export const MANUAL_SLOTS = ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5'] as const;
export type SlotId = typeof AUTOSAVE_SLOT | (typeof MANUAL_SLOTS)[number];

const DB_NAME = 'modern-leader';
const STORE = 'saves';

export interface SaveStore {
  /** True when saves only live in memory (storage blocked, e.g. some private modes). */
  readonly memoryOnly: boolean;
  get(slot: SlotId): Promise<SaveFile | null>;
  put(slot: SlotId, save: SaveFile): Promise<void>;
  remove(slot: SlotId): Promise<void>;
  /** All filled slots, newest first. */
  list(): Promise<{ slot: SlotId; save: SaveFile }[]>;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function openDb(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore(STORE);
  return request(open);
}

function memoryStore(): SaveStore {
  const saves = new Map<SlotId, string>();
  const read = (slot: SlotId): SaveFile | null => {
    const text = saves.get(slot);
    if (!text) return null;
    const parsed = parseSave(text);
    return parsed.ok ? parsed.save : null;
  };
  return {
    memoryOnly: true,
    get: async (slot) => read(slot),
    put: async (slot, save) => void saves.set(slot, serializeSave(save)),
    remove: async (slot) => void saves.delete(slot),
    list: async () => sortNewest([...saves.keys()].map((slot) => ({ slot, save: read(slot) }))),
  };
}

function sortNewest(
  entries: { slot: SlotId; save: SaveFile | null }[],
): { slot: SlotId; save: SaveFile }[] {
  return entries
    .filter((e): e is { slot: SlotId; save: SaveFile } => e.save !== null)
    .sort((a, b) => (a.save.savedAt < b.save.savedAt ? 1 : -1));
}

export async function openSaveStore(): Promise<SaveStore> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch {
    return memoryStore();
  }
  const tx = (mode: IDBTransactionMode): IDBObjectStore =>
    db.transaction(STORE, mode).objectStore(STORE);
  const read = async (slot: SlotId): Promise<SaveFile | null> => {
    const text = (await request(tx('readonly').get(slot))) as string | undefined;
    if (!text) return null;
    const parsed = parseSave(text);
    return parsed.ok ? parsed.save : null;
  };
  return {
    memoryOnly: false,
    get: read,
    put: async (slot, save) => void (await request(tx('readwrite').put(serializeSave(save), slot))),
    remove: async (slot) => void (await request(tx('readwrite').delete(slot))),
    list: async () => {
      const slots: SlotId[] = [AUTOSAVE_SLOT, ...MANUAL_SLOTS];
      return sortNewest(
        await Promise.all(slots.map(async (slot) => ({ slot, save: await read(slot) }))),
      );
    },
  };
}

/** Offers the save as a file download. */
export function exportSave(save: SaveFile, fileName: string): void {
  const blob = new Blob([serializeSave(save)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lets the player pick a save file; resolves null when cancelled. */
export function importSave(): Promise<ParsedSave | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    // Some mobile browsers only open the picker for inputs that are in the page.
    input.hidden = true;
    document.body.append(input);
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? parseSave(await file.text()) : null);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}
