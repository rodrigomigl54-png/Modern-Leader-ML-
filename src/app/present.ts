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

let provinceNames: readonly string[] = [];

/** Province names, used for countries born during the game ("Free Donetsk"). */
export function setProvinceNames(names: readonly string[]): void {
  provinceNames = names;
}

/**
 * Display name of a country. Rebel factions and seceded states are named after their parent
 * country or their capital province (pass the game's world so they can be found). Disputed territories use the name they use for themselves while
 * neutral, and their own short name as states (GDD section 4).
 */
export function countryName(world: World, countryId: string, mode: DisputedMode): string {
  const faction = world.countries.find((c) => c.id === countryId)?.faction;
  if (faction?.kind === 'rebels')
    return t('faction.rebels', { country: countryName(world, faction.parent, mode) });
  if (faction?.kind === 'seceded') {
    const capital = world.countries.find((c) => c.id === countryId)!.capitalProvinceId;
    return t('faction.seceded', { place: provinceNames[capital] ?? countryId });
  }
  const disputed = world.disputed.some((d) => d.id === countryId);
  if (disputed && mode === 'neutral') return t(`countrySelf.${countryId}` as TranslationKey);
  return t(`country.${countryId}` as TranslationKey);
}

/** Flag of a country; neutral disputed territories show a black flag. */
export function countryFlag(world: World, countryId: string, mode: DisputedMode): string | null {
  if (world.countries.find((c) => c.id === countryId)?.faction) return flagUrl('neutral');
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
  const sign = value < 0 ? '−' : '';
  const v = Math.abs(value);
  if (v < 5e4) return t('units.zeroUsd');
  if (v >= 1e12) return sign + t('units.trillionUsd', { value: numberFormat(2).format(v / 1e12) });
  if (v >= 1e9)
    return sign + t('units.billionUsd', { value: numberFormat(v >= 1e10 ? 0 : 1).format(v / 1e9) });
  return sign + t('units.millionUsd', { value: numberFormat(v >= 1e7 ? 0 : 1).format(v / 1e6) });
}

export function formatPercent(share: number, digits = 1): string {
  return numberFormat(digits).format(share * 100);
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
