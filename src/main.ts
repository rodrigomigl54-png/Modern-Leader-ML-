import './ui/style.css';
import { onLanguageChange } from './i18n';
import { createPlaceholderMap } from './map/placeholder';
import { mountSettingsStub, restoreLanguage } from './ui/settings';
import { mountVersionLabel } from './ui/versionLabel';

async function start(): Promise<void> {
  const mapRoot = document.getElementById('map-root');
  const uiRoot = document.getElementById('ui-root');
  if (!mapRoot || !uiRoot) throw new Error('Missing #map-root or #ui-root in index.html');

  restoreLanguage();
  const map = await createPlaceholderMap(mapRoot);
  mountVersionLabel(uiRoot);
  mountSettingsStub(uiRoot);
  onLanguageChange(map.refresh);
}

void start();
