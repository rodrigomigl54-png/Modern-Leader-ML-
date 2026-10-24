import en from './en.json';
import sr from './sr.json';

export type Language = 'en' | 'sr';
export type TranslationKey = keyof typeof en;
export type TranslationParams = Record<string, string | number>;

/** Languages in the order they appear in the settings. English is the default. */
export const LANGUAGES: readonly Language[] = ['en', 'sr'];
export const DEFAULT_LANGUAGE: Language = 'en';

const dictionaries: Record<Language, Partial<Record<string, string>>> = { en, sr };

let current: Language = DEFAULT_LANGUAGE;
const listeners = new Set<(language: Language) => void>();

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener(language);
}

/** Registers a callback for language changes; returns a function that unregisters it. */
export function onLanguageChange(listener: (language: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Translates a key into the current language and fills `{name}` placeholders from params.
 * Falls back to English, then to the key itself, so a missing string is visible but never fatal.
 */
export function t(key: TranslationKey, params: TranslationParams = {}): string {
  const template = dictionaries[current][key] ?? dictionaries[DEFAULT_LANGUAGE][key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
