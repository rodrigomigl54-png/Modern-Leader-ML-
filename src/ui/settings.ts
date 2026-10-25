import { DISPUTED_MODES, type DisputedMode } from '../sim/world';
import { getLanguage, isLanguage, LANGUAGES, onLanguageChange, setLanguage, t } from '../i18n';

const STORAGE_KEY = 'ml.language';
const FPS_KEY = 'ml.showFps';
const DISPUTED_KEY = 'ml.disputedMode';

/** Default disputed-territories display for new games (GDD sections 4 and 13). */
export function defaultDisputedMode(): DisputedMode {
  try {
    const saved = localStorage.getItem(DISPUTED_KEY);
    if (DISPUTED_MODES.includes(saved as DisputedMode)) return saved as DisputedMode;
  } catch {
    // Storage blocked: use the GDD default.
  }
  return 'neutral';
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // Ignore: the choice still applies for this visit.
  }
}

/** Restores the language the player chose last time, if the browser allows storage. */
export function restoreLanguage(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) setLanguage(saved);
  } catch {
    // Storage can be blocked (private mode); English stays active.
  }
}

export type Theme = 'night' | 'day';
export const THEMES: readonly Theme[] = ['night', 'day'];
export const UI_SCALES = [0.9, 1, 1.15, 1.3] as const;
const THEME_KEY = 'ml.theme';
const SCALE_KEY = 'ml.uiScale';

/** Where "Send feedback" leads: a short form (what was fun, what was confusing, device). */
export const FEEDBACK_URL =
  'https://github.com/rodrigomigl54-png/Modern-Leader-ML-/issues/new?template=feedback.yml';

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore: the choice still applies for this visit.
  }
}

export function savedTheme(): Theme {
  const saved = readString(THEME_KEY);
  return THEMES.includes(saved as Theme) ? (saved as Theme) : 'night';
}

export function savedUiScale(): number {
  const saved = Number(readString(SCALE_KEY));
  return (UI_SCALES as readonly number[]).includes(saved) ? saved : 1;
}

/** Applies the theme and UI scale to the page (the map is told separately). */
export function applyAppearance(theme: Theme, scale: number): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

export interface SettingsOptions {
  onShowFps: (show: boolean) => void;
  onTheme: (theme: Theme) => void;
  sound: {
    musicVolume: number;
    effectsVolume: number;
    setMusicVolume: (value: number) => void;
    setEffectsVolume: (value: number) => void;
  };
}

export interface Settings {
  open(): void;
}

/**
 * Settings (GDD section 13): language, theme, UI scale, music and effects volume, the default
 * for disputed territories, the FPS counter and the feedback link. Opened from the corner
 * button and the menus.
 */
export function mountSettings(root: HTMLElement, options: SettingsOptions): Settings {
  const button = document.createElement('button');
  button.className = 'settings-button';
  button.type = 'button';
  button.textContent = '⚙';

  const panel = document.createElement('div');
  panel.className = 'panel settings-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  root.append(button, panel);

  const row = (label: string, control: HTMLElement): HTMLLabelElement => {
    const l = document.createElement('label');
    const text = document.createElement('span');
    text.textContent = label;
    l.append(text, control);
    return l;
  };
  const select = <T extends string | number>(
    values: readonly T[],
    current: T,
    labelOf: (v: T) => string,
    onChange: (v: T) => void,
  ): HTMLSelectElement => {
    const el = document.createElement('select');
    for (const v of values) {
      const option = document.createElement('option');
      option.value = String(v);
      option.textContent = labelOf(v);
      option.selected = v === current;
      el.append(option);
    }
    el.addEventListener('change', () => {
      const v = values.find((x) => String(x) === el.value);
      if (v !== undefined) onChange(v);
    });
    return el;
  };
  const slider = (value: number, onChange: (v: number) => void): HTMLInputElement => {
    const el = document.createElement('input');
    el.type = 'range';
    el.min = '0';
    el.max = '100';
    el.step = '5';
    el.value = String(Math.round(value * 100));
    el.addEventListener('input', () => onChange(Number(el.value) / 100));
    return el;
  };

  const render = (): void => {
    button.title = t('settings.open');
    button.setAttribute('aria-label', t('settings.open'));
    const heading = document.createElement('h2');
    heading.textContent = t('settings.title');
    const fps = document.createElement('input');
    fps.type = 'checkbox';
    fps.checked = readFlag(FPS_KEY);
    fps.addEventListener('change', () => {
      writeFlag(FPS_KEY, fps.checked);
      options.onShowFps(fps.checked);
    });
    const feedback = document.createElement('a');
    feedback.className = 'btn btn-secondary settings-feedback';
    feedback.href = FEEDBACK_URL;
    feedback.target = '_blank';
    feedback.rel = 'noopener';
    feedback.textContent = t('settings.feedback');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'panel-close';
    close.textContent = t('settings.close');
    close.addEventListener('click', () => {
      panel.hidden = true;
    });
    panel.replaceChildren(
      heading,
      row(
        t('settings.language'),
        select(
          LANGUAGES,
          getLanguage(),
          (l) => t(`language.${l}`),
          (l) => {
            setLanguage(l);
            writeString(STORAGE_KEY, l);
          },
        ),
      ),
      row(
        t('settings.theme'),
        select(
          THEMES,
          savedTheme(),
          (v) => t(`settings.theme.${v}`),
          (v) => {
            writeString(THEME_KEY, v);
            applyAppearance(v, savedUiScale());
            options.onTheme(v);
          },
        ),
      ),
      row(
        t('settings.uiScale'),
        select(
          UI_SCALES,
          savedUiScale(),
          (v) => `${Math.round(v * 100)}%`,
          (v) => {
            writeString(SCALE_KEY, String(v));
            applyAppearance(savedTheme(), v);
          },
        ),
      ),
      row(t('settings.music'), slider(options.sound.musicVolume, options.sound.setMusicVolume)),
      row(
        t('settings.effects'),
        slider(options.sound.effectsVolume, options.sound.setEffectsVolume),
      ),
      row(
        t('setup.disputed'),
        select(
          DISPUTED_MODES,
          defaultDisputedMode(),
          (m) => t(`disputed.${m}`),
          (m) => writeString(DISPUTED_KEY, m),
        ),
      ),
      row(t('settings.showFps'), fps),
      feedback,
      close,
    );
  };

  button.addEventListener('click', () => {
    if (panel.hidden) render();
    panel.hidden = !panel.hidden;
  });
  onLanguageChange(() => {
    button.title = t('settings.open');
    if (!panel.hidden) render();
  });
  render();
  options.onShowFps(readFlag(FPS_KEY));
  return {
    open: () => {
      render();
      panel.hidden = false;
    },
  };
}
