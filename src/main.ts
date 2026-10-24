import './ui/style.css';
import { onLanguageChange } from './i18n';
import { createMapView } from './map/mapView';
import { FpsCounter } from './ui/fpsCounter';
import { showLoadingScreen } from './ui/loadingScreen';
import { ProvincePanel } from './ui/provincePanel';
import { mountSettingsStub, restoreLanguage } from './ui/settings';
import { mountVersionLabel } from './ui/versionLabel';

async function start(): Promise<void> {
  const mapRoot = document.getElementById('map-root');
  const uiRoot = document.getElementById('ui-root');
  if (!mapRoot || !uiRoot) throw new Error('Missing #map-root or #ui-root in index.html');

  restoreLanguage();
  // iOS Safari ignores user-scalable=no; stop its page pinch-zoom so pinch zooms the map.
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  const loading = showLoadingScreen(uiRoot);
  let panel: ProvincePanel | null = null;
  try {
    const map = await createMapView(mapRoot, {
      onProgress: loading.setProgress,
      onSelect: (id) => (id === null ? panel?.hide() : panel?.show(id)),
    });
    panel = new ProvincePanel(uiRoot, map.data, () => map.clearSelection());
    const fps = new FpsCounter(uiRoot);
    map.onFrame = () => fps.frame();
    mountVersionLabel(uiRoot);
    mountSettingsStub(uiRoot, (show) => fps.setVisible(show));
    onLanguageChange(() => {
      map.refreshLabels();
      panel?.refresh();
    });
    loading.close();
  } catch (error) {
    console.error(error);
    loading.fail();
  }
}

void start();
