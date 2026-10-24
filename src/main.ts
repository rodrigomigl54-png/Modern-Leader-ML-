import './ui/style.css';
import { onLanguageChange, t } from './i18n';
import { countryName } from './app/present';
import { AUTOSAVE_SLOT, exportSave, importSave, openSaveStore, type SlotId } from './app/saveStore';
import { loadWorld } from './app/worldData';
import { createMapView } from './map/mapView';
import { createNewGame, type GameState } from './sim/newGame';
import { createSave, type SaveError, type SaveFile } from './sim/save';
import { advanceTurn } from './sim/turn';
import { applyDisputedSetting } from './sim/world';
import { confirmDialog } from './ui/confirmDialog';
import { FpsCounter } from './ui/fpsCounter';
import { GameHud } from './ui/gameHud';
import { GameMenu } from './ui/gameMenu';
import { showLoadingScreen } from './ui/loadingScreen';
import { MainMenu } from './ui/mainMenu';
import { ProvincePanel } from './ui/provincePanel';
import { SaveSlots, slotName } from './ui/saveSlots';
import { defaultDisputedMode, mountSettingsStub, restoreLanguage } from './ui/settings';
import { politicsFor, SetupWizard } from './ui/setupWizard';
import { Toasts } from './ui/toast';
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
    const [bundle, store] = await Promise.all([loadWorld(map.data), openSaveStore()]);
    loading.setProgress(1);
    const world = bundle.world;
    const toasts = new Toasts(uiRoot);

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

    const save = async (slot: SlotId, state: GameState): Promise<boolean> => {
      try {
        await store.put(slot, createSave(state, new Date().toISOString()));
        return true;
      } catch (error) {
        console.error(error);
        toasts.show(t('saves.failed'), 'error');
        return false;
      }
    };

    /** Shows a game (new or loaded) on the map. */
    const playGame = (state: GameState): void => {
      game = state;
      wizard.close();
      menu.hide();
      slots.hide();
      panel.hide();
      map.clearSelection();
      const mode = state.settings.disputedMode;
      map.setPolitics(politicsFor(world, state.world, mode));
      map.setFocusCountry(state.player.countryId);
      map.lookAtCountry(state.player.countryId);
      hud.show(state);
    };

    const endTurn = async (): Promise<void> => {
      if (!game) return;
      hud.setBusy(true);
      const result = advanceTurn(game);
      game = result.state;
      hud.show(game);
      panel.refresh();
      // Step 10 of the turn: autosave (GDD section 5).
      await save(AUTOSAVE_SLOT, game);
      hud.setBusy(false);
    };

    const exitToMenu = (): void => {
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
    };

    const reportImportError = (error: SaveError): void => toasts.show(t(`saves.${error}`), 'error');
    const importFromFile = async (): Promise<void> => {
      const parsed = await importSave();
      if (!parsed) return;
      if (!parsed.ok) return reportImportError(parsed.error);
      playGame(parsed.save.game);
      await save(AUTOSAVE_SLOT, parsed.save.game);
    };

    const slots = new SaveSlots({
      parent: uiRoot,
      store,
      baseWorld: world,
      onSave: (slot, existing) => {
        const state = game;
        if (!state) return;
        const write = async (): Promise<void> => {
          if (await save(slot, state)) {
            toasts.show(t('saves.saved'));
            slots.hide();
          }
        };
        if (!existing) return void write();
        void confirmDialog(
          uiRoot,
          t('saves.overwriteTitle'),
          t('saves.overwriteText', { slot: slotName(slot) }),
          t('saves.overwrite'),
          t('saves.cancel'),
        ).then((ok) => {
          if (ok) void write();
        });
      },
      onLoad: (file: SaveFile) => playGame(file.game),
      onImport: () => void importFromFile(),
      onClose: () => {
        if (!game) menu.show();
      },
    });

    const hud = new GameHud(uiRoot, world, {
      onMenu: () => gameMenu.show(),
      onNextTurn: () => void endTurn(),
    });

    const settings = mountSettingsStub(uiRoot, (show) => fps.setVisible(show));
    const gameMenu = new GameMenu(uiRoot, {
      onSave: () => void slots.show('save'),
      onLoad: () => void slots.show('load'),
      onExport: () => {
        if (!game) return;
        const name = `modern-leader-${game.player.countryId.toLowerCase()}-${game.date}.json`;
        exportSave(createSave(game, new Date().toISOString()), name);
        toasts.show(t('saves.exported'));
      },
      onImport: () => void importFromFile(),
      onSettings: () => settings.open(),
      onExit: exitToMenu,
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
        const state = createNewGame(world, options);
        playGame(state);
        void save(AUTOSAVE_SLOT, state);
      },
    });

    const menu = new MainMenu(uiRoot, {
      onNewGame: () => {
        menu.hide();
        wizard.open();
      },
      onLoadGame: () => {
        menu.hide();
        void slots.show('load');
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
