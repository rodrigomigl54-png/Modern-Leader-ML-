import { onLanguageChange, t } from '../i18n';

/** Small corner label with the version and build date. */
export function mountVersionLabel(root: HTMLElement): void {
  const label = document.createElement('div');
  label.className = 'version-label';
  root.append(label);

  const render = (): void => {
    label.textContent = t('app.versionLabel', { version: __APP_VERSION__, date: __BUILD_DATE__ });
  };
  onLanguageChange(render);
  render();
}
