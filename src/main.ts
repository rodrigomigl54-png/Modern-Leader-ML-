import './ui/style.css';
import { onLanguageChange, t } from './i18n';
import { countryName } from './app/present';
import { loadWorld } from './app/worldData';
import { createMapView } from './map/mapView';
import { createNewGame, type GameState } from './sim/newGame';
import { applyDisputedSetting } from './sim/world';
import { confirmDialog } from './ui/confirmDialog';
import { FpsCounter } from './ui/fpsCounter';
import { GameHud } from './ui/gameHud';
import { showLoadingScreen } from './ui/loadingScreen';
import { MainMenu } from './ui/mainMenu';
import { ProvincePanel } from './ui/provincePanel';
import { defaultDisputedMode, mountSettingsStub, restoreLanguage } from './ui/settings';
import { politicsFor, SetupWizard } from './ui/setupWizard';
import { mountVersionLabel } from './ui/versionLabel';

async function start(): Promise<void> {
  const mapRoot = document.getElementById('map-root');
  const uiRoot = document.getElementById('ui-root');
  if (!mapRoot || !uiRoot) throw new Error('Missing #map-root or #ui-root in index.html');

  restoreLanguage();
  // iOS Safari ignores user-scalable=no; stop its page pinch-zoom so pinch zooms the map.
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  const loading = showLoadingScreen(uiRoot);
  let onMapTap: (provinceId: number | null) => void = () => undefined;
  try {
    const map = await createMapView(mapRoot, {
      onProgress: (f) => loading.setProgress(f * 0.9),
      onSelect: (id) => onMapTap(id),
    });
    const bundle = await loadWorld(map.data);
    loading.setProgress(1);
    const world = bundle.world;

    let game: GameState | null = null;
    const showMenuMap = (): void => {
      const mode = defaultDisputedMode();
      map.setPolitics(politicsFor(world, applyDisputedSetting(world, mode), mode));
      map.setFocusCountry(null);
      map.clearSelection();
    };

    const panel = new ProvincePanel(
      uiRoot,
      map.data,
      () => map.clearSelection(),
      (provinceId) => {
        const id = map.ownerOf(provinceId);
        return {
          id,
          name: countryName(world, id, game?.settings.disputedMode ?? defaultDisputedMode()),
        };
      },
    );
    const fps = new FpsCounter(uiRoot);
    map.onFrame = () => fps.frame();
    mountVersionLabel(uiRoot);

    const hud = new GameHud(uiRoot, world, () => {
      void confirmDialog(
        uiRoot,
        t('game.leaveTitle'),
        t('game.leaveText'),
        t('game.leave'),
        t('game.stay'),
      ).then((leave) => {
        if (!leave) return;
        game = null;
        hud.hide();
        panel.hide();
        showMenuMap();
        menu.show();
      });
    });

    const wizard = new SetupWizard({
      parent: uiRoot,
      bundle,
      map,
      defaultDisputedMode,
      onCancel: () => {
        wizard.close();
        showMenuMap();
        menu.show();
      },
      onStart: (options) => {
        game = createNewGame(world, options);
        wizard.close();
        map.setPolitics(politicsFor(world, game.world, options.disputedMode));
        map.setFocusCountry(options.countryId);
        map.lookAtCountry(options.countryId);
        hud.show(game);
      },
    });

    const settings = mountSettingsStub(uiRoot, (show) => fps.setVisible(show));
    const menu = new MainMenu(uiRoot, {
      onNewGame: () => {
        menu.hide();
        wizard.open();
      },
      onSettings: () => settings.open(),
    });

    onMapTap = (id) => {
      if (wizard.isChoosingCountry) {
        wizard.selectProvince(id);
      } else if (game) {
        if (id === null) {
          map.clearSelection();
          panel.hide();
        } else {
          map.highlightProvince(id);
          panel.show(id);
        }
      }
    };

    onLanguageChange(() => {
      menu.refresh();
      wizard.refresh();
      hud.refresh();
      panel.refresh();
      map.refreshLabels();
    });

    showMenuMap();
    menu.show();
    loading.close();
  } catch (error) {
    console.error(error);
    loading.fail();
  }
}

void start();
