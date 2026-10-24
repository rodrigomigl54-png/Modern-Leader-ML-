import { getLanguage } from '../i18n';

const locale = (): string => (getLanguage() === 'sr' ? 'sr-Latn' : 'en');

/** Game date (YYYY-MM-DD) in the current language, e.g. "8 January 2027". */
export function formatGameDate(isoDate: string): string {
  return new Intl.DateTimeFormat(locale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** Real-world timestamp of a save, in the device's time zone. */
export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}
