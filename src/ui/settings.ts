import { getLanguage, isLanguage, LANGUAGES, onLanguageChange, setLanguage, t } from '../i18n';

const STORAGE_KEY = 'ml.language';

/** Restores the language the player chose last time, if the browser allows storage. */
export function restoreLanguage(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) setLanguage(saved);
  } catch {
    // Storage can be blocked (private mode); English stays active.
  }
}

/** Temporary settings stub: a corner button that opens a panel with the language switch. */
export function mountSettingsStub(root: HTMLElement): void {
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
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';

  label.append(labelText, select);
  panel.append(heading, label, close);
  root.append(button, panel);

  const render = (): void => {
    button.title = t('settings.open');
    button.setAttribute('aria-label', t('settings.open'));
    heading.textContent = t('settings.title');
    labelText.textContent = t('settings.language');
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

  onLanguageChange(render);
  render();
}
