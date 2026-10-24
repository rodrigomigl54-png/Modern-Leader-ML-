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

export interface SettingsStub {
  open(): void;
}

/**
 * Temporary settings stub: a corner button that opens a panel with the language switch, the
 * disputed-territories default and the hidden FPS counter toggle.
 */
export function mountSettingsStub(
  root: HTMLElement,
  onShowFps: (show: boolean) => void,
): SettingsStub {
  const button = document.createElement('button');
  button.className = 'settings-button';
  button.type = 'button';
  button.textContent = '⚙';

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');

  const heading = document.createElement('h2');
  const label = document.createElement('label');
  const labelText = document.createElement('span');
  const select = document.createElement('select');
  const fpsLabel = document.createElement('label');
  const fpsText = document.createElement('span');
  const fpsToggle = document.createElement('input');
  fpsToggle.type = 'checkbox';
  fpsToggle.checked = readFlag(FPS_KEY);
  fpsLabel.append(fpsText, fpsToggle);
  const disputedLabel = document.createElement('label');
  const disputedText = document.createElement('span');
  const disputedSelect = document.createElement('select');
  disputedLabel.append(disputedText, disputedSelect);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';

  label.append(labelText, select);
  panel.append(heading, label, disputedLabel, fpsLabel, close);
  root.append(button, panel);

  const render = (): void => {
    button.title = t('settings.open');
    button.setAttribute('aria-label', t('settings.open'));
    heading.textContent = t('settings.title');
    labelText.textContent = t('settings.language');
    fpsText.textContent = t('settings.showFps');
    disputedText.textContent = t('setup.disputed');
    const current = defaultDisputedMode();
    disputedSelect.replaceChildren(
      ...DISPUTED_MODES.map((mode) => {
        const option = document.createElement('option');
        option.value = mode;
        option.textContent = t(`disputed.${mode}`);
        option.selected = mode === current;
        return option;
      }),
    );
    close.textContent = t('settings.close');
    select.replaceChildren(
      ...LANGUAGES.map((language) => {
        const option = document.createElement('option');
        option.value = language;
        option.textContent = t(`language.${language}`);
        option.selected = language === getLanguage();
        return option;
      }),
    );
  };

  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });
  close.addEventListener('click', () => {
    panel.hidden = true;
  });
  select.addEventListener('change', () => {
    if (!isLanguage(select.value)) return;
    setLanguage(select.value);
    try {
      localStorage.setItem(STORAGE_KEY, select.value);
    } catch {
      // Ignore: the choice still applies for this visit.
    }
  });

  disputedSelect.addEventListener('change', () => {
    try {
      localStorage.setItem(DISPUTED_KEY, disputedSelect.value);
    } catch {
      // Ignore: the choice still applies for this visit.
    }
  });

  fpsToggle.addEventListener('change', () => {
    writeFlag(FPS_KEY, fpsToggle.checked);
    onShowFps(fpsToggle.checked);
  });

  onLanguageChange(render);
  render();
  onShowFps(fpsToggle.checked);
  return {
    open: () => {
      render();
      panel.hidden = false;
    },
  };
}
