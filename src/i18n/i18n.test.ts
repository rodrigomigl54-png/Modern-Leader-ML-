import { afterEach, describe, expect, it, vi } from 'vitest';
import countriesEn from './countries.en.json';
import countriesSr from './countries.sr.json';
import en from './en.json';
import sr from './sr.json';
import { DEFAULT_LANGUAGE, getLanguage, onLanguageChange, setLanguage, t } from './index';

afterEach(() => setLanguage(DEFAULT_LANGUAGE));

describe('i18n', () => {
  it('defaults to English', () => {
    expect(getLanguage()).toBe('en');
    expect(t('settings.title')).toBe('Settings');
  });

  it('switches language and notifies listeners', () => {
    const listener = vi.fn();
    const unsubscribe = onLanguageChange(listener);
    setLanguage('sr');
    expect(t('settings.title')).toBe('Podešavanja');
    expect(listener).toHaveBeenCalledWith('sr');
    unsubscribe();
  });

  it('fills placeholders and leaves unknown ones untouched', () => {
    expect(t('app.versionLabel', { version: '1.2.3', date: '2027-01-01' })).toBe(
      'v1.2.3 · build 2027-01-01',
    );
    expect(t('app.versionLabel', { version: '1.2.3' })).toBe('v1.2.3 · build {date}');
  });

  it('has the same keys in every language', () => {
    expect(Object.keys(sr).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(countriesSr).sort()).toEqual(Object.keys(countriesEn).sort());
  });

  it('translates country names', () => {
    expect(t('country.SRB')).toBe('Serbia');
    setLanguage('sr');
    expect(t('country.SRB')).toBe('Srbija');
  });
});
