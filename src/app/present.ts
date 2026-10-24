// Presentation helpers for countries: names, flags and numbers in the current language.
import { getLanguage, t, type TranslationKey } from '../i18n';
import type { DisputedMode, World } from '../sim/world';

const flags = import.meta.glob<string>('../../data/modern/flags/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
});

export function flagUrl(countryId: string): string | null {
  return flags[`../../data/modern/flags/${countryId}.svg`] ?? null;
}

/**
 * Display name of a country. Disputed territories use the name they use for themselves while
 * neutral, and their own short name as states (GDD section 4).
 */
export function countryName(world: World, countryId: string, mode: DisputedMode): string {
  const disputed = world.disputed.some((d) => d.id === countryId);
  if (disputed && mode === 'neutral') return t(`countrySelf.${countryId}` as TranslationKey);
  return t(`country.${countryId}` as TranslationKey);
}

/** Flag of a country; neutral disputed territories show a black flag. */
export function countryFlag(world: World, countryId: string, mode: DisputedMode): string | null {
  const disputed = world.disputed.some((d) => d.id === countryId);
  if (disputed && mode === 'neutral') return flagUrl('neutral');
  return flagUrl(countryId);
}

function numberFormat(digits: number): Intl.NumberFormat {
  return new Intl.NumberFormat(getLanguage() === 'sr' ? 'sr-Latn' : 'en', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

export function formatUsd(value: number | null): string {
  if (value === null) return t('units.unknown');
  if (value >= 1e12) return t('units.trillionUsd', { value: numberFormat(2).format(value / 1e12) });
  return t('units.billionUsd', { value: numberFormat(value >= 1e10 ? 0 : 1).format(value / 1e9) });
}

export function formatPeople(value: number | null): string {
  if (value === null) return t('units.unknown');
  if (value >= 1e6)
    return t('units.millionPeople', {
      value: numberFormat(value >= 1e8 ? 0 : 1).format(value / 1e6),
    });
  return t('units.thousandPeople', {
    value: numberFormat(value >= 1e4 ? 0 : 1).format(value / 1e3),
  });
}

export function starsText(stars: number): string {
  return '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

/** Lowercase, accent-free text for search ("Côte" matches "cote"). */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
