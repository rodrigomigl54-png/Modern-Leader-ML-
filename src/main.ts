import './ui/style.css';
import { onLanguageChange, t, type TranslationKey } from './i18n';
import { countryName, formatPercent } from './app/present';
import { AUTOSAVE_SLOT, exportSave, importSave, openSaveStore, type SlotId } from './app/saveStore';
import { loadWorld } from './app/worldData';
import { createMapView } from './map/mapView';
import { applyCommand, type Command, type CommandError } from './sim/commands';
import { ensureEconomy } from './sim/economy';
import { createNewGame, type GameState } from './sim/newGame';
import { createSave, type SaveError, type SaveFile } from './sim/save';
import { advanceTurn, type TurnEvent } from './sim/turn';
import { applyDisputedSetting } from './sim/world';
import { confirmDialog, noticeDialog } from './ui/confirmDialog';
import { EconomyPanel } from './ui/economyPanel';
import { FpsCounter } from './ui/fpsCounter';
import { GameHud } from './ui/gameHud';
import { GameMenu } from './ui/gameMenu';
import { InvestDialog } from './ui/investDialog';
import { showLoadingScreen } from './ui/loadingScreen';
import { MainMenu } from './ui/mainMenu';
import { ProvincePanel } from './ui/provincePanel';
import { SaveSlots, slotName } from './ui/saveSlots';
import { SelectionBar } from './ui/selectionBar';
import { defaultDisputedMode, mountSettingsStub, restoreLanguage } from './ui/settings';
import { politicsFor, SetupWizard } from './ui/setupWizard';
import { Toasts } from './ui/toast';
import { mountVersionLabel } from './ui/versionLabel';

const COMMAND_ERRORS: Partial<Record<CommandError, TranslationKey>> = {
  notEnoughMoney: 'invest.notEnough',
  allRefused: 'invest.allRefused',
};

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
    const sim = bundle.sim;
    const toasts = new Toasts(uiRoot);

    let game: GameState | null = null;
    /** Cities picked for a multi-city order. */
    const selection = new Set<number>();
    const nameOf = (id: string): string =>
      countryName(world, id, game?.settings.disputedMode ?? defaultDisputedMode());
    const cityName = (cityId: number): string => map.data.cities[cityId]?.name ?? String(cityId);

    const showMenuMap = (): void => {
      const mode = defaultDisputedMode();
      map.setPolitics(politicsFor(world, applyDisputedSetting(world, mode), mode));
      map.setFocusCountry(null);
      map.clearSelection();
    };

    const panel = new ProvincePanel({
      parent: uiRoot,
      data: map.data,
      onClose: () => map.clearSelection(),
      ownerOf: (provinceId) => {
        const id = map.ownerOf(provinceId);
        return { id, name: nameOf(id) };
      },
      buildingsIn: (cityId) =>
        (game?.economy.buildings ?? [])
          .filter((b) => b.cityId === cityId)
          .map((b) => ({
            category: b.category,
            weeksLeft: b.completed ? null : b.completeTurn - game!.turn,
          })),
      isSelected: (cityId) => selection.has(cityId),
      toggleSelected: (cityId) => {
        if (selection.has(cityId)) selection.delete(cityId);
        else selection.add(cityId);
        selectionBar.update(selection.size);
      },
    });
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

    /** Refreshes everything that shows the game state. */
    const showState = (): void => {
      if (!game) return;
      hud.show(game);
      panel.refresh();
      economyPanel.update(game);
    };

    /** The only way the UI changes the game (GDD section 2). */
    const issue = (command: Command): boolean => {
      if (!game) return false;
      const result = applyCommand(game, command, sim);
      if (!result.ok) {
        toasts.show(t(COMMAND_ERRORS[result.error] ?? 'saves.failed'), 'error');
        return false;
      }
      game = result.state;
      showState();
      return true;
    };

    const clearSelection = (): void => {
      selection.clear();
      selectionBar.update(0);
      panel.refresh();
    };

    /** Shows a game (new or loaded) on the map. */
    const playGame = (loaded: GameState): void => {
      const state = ensureEconomy(loaded, sim.economy);
      game = state;
      wizard.close();
      menu.hide();
      slots.hide();
      panel.hide();
      economyPanel.close();
      clearSelection();
      map.clearSelection();
      const mode = state.settings.disputedMode;
      map.setPolitics(politicsFor(world, state.world, mode));
      map.setFocusCountry(state.player.countryId);
      map.lookAtCountry(state.player.countryId);
      hud.show(state);
    };

    const announce = async (events: TurnEvent[]): Promise<void> => {
      if (!game) return;
      const player = game.player.countryId;
      for (const e of events) {
        if (e.type === 'buildingCompleted' && e.owner === player) {
          const b = game.economy.buildings.find((x) => x.id === e.buildingId);
          if (b) {
            toasts.show(
              t('invest.completed', {
                building: t(`building.${b.category}` as TranslationKey),
                city: cityName(b.cityId),
              }),
            );
          }
        }
      }
      for (const e of events) {
        if (e.type === 'inflationAlert' && e.countryId === player) {
          await noticeDialog(
            uiRoot,
            t('minister.finance'),
            t('minister.inflationAlert', { value: formatPercent(e.inflation) }),
            t('minister.understood'),
          );
        }
      }
    };

    const endTurn = async (): Promise<void> => {
      if (!game) return;
      hud.setBusy(true);
      const result = advanceTurn(game, sim);
      game = result.state;
      showState();
      // Step 10 of the turn: autosave (GDD section 5).
      await save(AUTOSAVE_SLOT, game);
      await announce(result.events);
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
        economyPanel.close();
        clearSelection();
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
      if (game) await save(AUTOSAVE_SLOT, game);
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

    const economyPanel = new EconomyPanel({
      parent: uiRoot,
      sim,
      cityName,
      issue: (command) => void issue(command),
      confirmPrint: (amount) =>
        confirmDialog(
          uiRoot,
          t('econ.printConfirmTitle'),
          t('econ.printConfirmText', { amount }),
          t('econ.printConfirm'),
          t('saves.cancel'),
        ),
    });

    const investDialog = new InvestDialog({
      parent: uiRoot,
      sim,
      countryName: nameOf,
      onConfirm: (category) => {
        if (!game) return;
        const cityIds = [...selection];
        if (issue({ type: 'invest', countryId: game.player.countryId, cityIds, category })) {
          toasts.show(t('invest.started', { count: cityIds.length }));
          clearSelection();
        }
      },
    });

    const selectionBar = new SelectionBar(uiRoot, {
      onInvest: () => game && investDialog.open(game, [...selection]),
      onClear: clearSelection,
    });

    const hud = new GameHud(uiRoot, world, {
      onMenu: () => gameMenu.show(),
      onNextTurn: () => void endTurn(),
      onEconomy: () => {
        if (!game) return;
        if (economyPanel.isOpen) return economyPanel.close();
        panel.hide();
        economyPanel.open(game);
      },
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
        const state = createNewGame(world, options, sim.economy);
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
          economyPanel.close();
          panel.show(id);
        }
      }
    };

    onLanguageChange(() => {
      menu.refresh();
      wizard.refresh();
      hud.refresh();
      panel.refresh();
      if (game) economyPanel.update(game);
      selectionBar.update(selection.size);
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
