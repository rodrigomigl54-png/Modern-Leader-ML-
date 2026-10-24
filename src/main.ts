import './ui/style.css';
import { onLanguageChange, t, type TranslationKey } from './i18n';
import { countryName, formatPercent, formatUsd, setProvinceNames } from './app/present';
import { AUTOSAVE_SLOT, exportSave, importSave, openSaveStore, type SlotId } from './app/saveStore';
import { loadWorld } from './app/worldData';
import { createMapView } from './map/mapView';
import { applyCommand, type Command, type CommandError } from './sim/commands';
import { ensureEconomy } from './sim/economy';
import { createNewGame, type GameState } from './sim/newGame';
import {
  assimilationQuote,
  ensurePopulation,
  isAssimilated,
  nationalSupport,
} from './sim/population';
import { createSave, type SaveError, type SaveFile } from './sim/save';
import { advanceTurn, type TurnEvent } from './sim/turn';
import { applyDisputedSetting } from './sim/world';
import { confirmDialog, noticeDialog } from './ui/confirmDialog';
import { EconomyPanel } from './ui/economyPanel';
import { FpsCounter } from './ui/fpsCounter';
import { GameHud } from './ui/gameHud';
import { GameMenu } from './ui/gameMenu';
import { InteriorPanel } from './ui/interiorPanel';
import { InvestDialog } from './ui/investDialog';
import { showLoadingScreen } from './ui/loadingScreen';
import { MainMenu } from './ui/mainMenu';
import { MapModeBar } from './ui/mapModeBar';
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
  nothingToAssimilate: 'interior.nothingToAssimilate',
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
    setProvinceNames(map.data.provinces.map((p) => p.name));
    const population = sim.population!;
    // Under the panels, so an open panel covers it.
    const modeBar = new MapModeBar(uiRoot, (id) => map.setMapMode(id));

    let game: GameState | null = null;
    /** Cities picked for a multi-city order. */
    const selection = new Set<number>();
    const nameOf = (id: string): string =>
      countryName(game?.world ?? world, id, game?.settings.disputedMode ?? defaultDisputedMode());
    const cityName = (cityId: number): string => map.data.cities[cityId]?.name ?? String(cityId);
    const provinceName = (id: number): string => map.data.provinces[id]?.name ?? String(id);

    /** Asks before assimilating, with the total cost and the risk (GDD section 7). */
    const assimilate = async (provinceIds: number[]): Promise<void> => {
      if (!game) return;
      const quote = assimilationQuote(game, sim, game.player.countryId, provinceIds);
      if (quote.provinceIds.length === 0) return;
      const ok = await confirmDialog(
        uiRoot,
        t('interior.assimilateTitle'),
        t('interior.assimilateText', {
          count: quote.provinceIds.length,
          cost: formatUsd(quote.totalCost),
          weeks: quote.turns,
        }),
        t('interior.assimilateConfirm'),
        t('saves.cancel'),
      );
      if (
        ok &&
        issue({
          type: 'assimilate',
          countryId: game.player.countryId,
          provinceIds: quote.provinceIds,
        })
      )
        toasts.show(t('interior.assimilationStarted', { count: quote.provinceIds.length }));
    };

    const showMenuMap = (): void => {
      const mode = defaultDisputedMode();
      map.setPolitics(politicsFor(applyDisputedSetting(world, mode), mode));
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
      statusOf: (provinceId) => {
        if (!game) return null;
        const pop = game.population;
        const owner = game.world.provinceOwners[provinceId]!;
        const rebels = game.world.countries.find((c) => c.id === owner)?.status === 'rebels';
        const quote =
          owner === game.player.countryId
            ? assimilationQuote(game, sim, owner, [provinceId])
            : null;
        return {
          support: pop.support[provinceId]!,
          rioting: pop.riotTurns[provinceId]! > 0,
          rebels,
          foreignCulture: isAssimilated(game, provinceId) ? null : nameOf(pop.culture[provinceId]!),
          assimilatingWeeks:
            pop.assimilateUntil[provinceId]! >= 0
              ? pop.assimilateUntil[provinceId]! - game.turn
              : null,
          assimilationCost: quote?.provinceIds.length ? formatUsd(quote.totalCost) : null,
          riotThreshold: population.riots.threshold,
        };
      },
      onAssimilate: (provinceId) => void assimilate([provinceId]),
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

    let shownOwners = '';
    /** Shows ownership on the map when it changed (revolutions, secessions). */
    const showPolitics = (state: GameState): void => {
      const owners = state.world.provinceOwners.join();
      if (owners === shownOwners) return;
      shownOwners = owners;
      map.setPolitics(politicsFor(state.world, state.settings.disputedMode));
    };

    /** Refreshes everything that shows the game state. */
    const showState = (): void => {
      if (!game) return;
      showPolitics(game);
      map.setSupport(game.population.support);
      hud.show(game);
      panel.refresh();
      economyPanel.update(game);
      interiorPanel.update(game);
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
      const state = ensurePopulation(ensureEconomy(loaded, sim.economy), population);
      game = state;
      wizard.close();
      menu.hide();
      slots.hide();
      panel.hide();
      economyPanel.close();
      interiorPanel.close();
      clearSelection();
      map.clearSelection();
      shownOwners = '';
      showPolitics(state);
      map.setSupport(state.population.support);
      map.setFocusCountry(state.player.countryId);
      map.lookAtCountry(state.player.countryId);
      hud.show(state);
      modeBar.show();
      if (state.gameOver) void showGameOver();
    };

    /** The rebels took the whole country (GDD section 7). */
    const showGameOver = async (): Promise<void> => {
      if (!game?.gameOver) return;
      hud.setBusy(true);
      await noticeDialog(
        uiRoot,
        t('gameOver.title'),
        t('gameOver.revolution', {
          leader: game.player.leaderName,
          country: nameOf(game.player.countryId),
          weeks: game.gameOver.turn + 1,
        }),
        t('game.mainMenu'),
      );
      leaveGame();
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
      const interior = (text: string): Promise<void> =>
        noticeDialog(uiRoot, t('minister.interior'), text, t('minister.understood'));
      for (const e of events) {
        if (e.type === 'revolution' && e.countryId !== player)
          toasts.show(t('interior.revolutionAbroad', { country: nameOf(e.countryId) }));
        if (e.type === 'secession' && e.countryId !== player)
          toasts.show(
            t('interior.secessionAbroad', {
              country: nameOf(e.countryId),
              state: nameOf(e.newCountryId),
            }),
          );
        if (!('countryId' in e) || e.countryId !== player) continue;
        if (e.type === 'riotsStarted') await interior(t('minister.riots', { count: e.provinces }));
        if (e.type === 'revolution') await interior(t('minister.revolution'));
        if (e.type === 'revolutionCrushed') await interior(t('minister.crushed'));
        if (e.type === 'secession')
          await interior(t('minister.secession', { state: nameOf(e.newCountryId) }));
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
      if (game.gameOver) return void showGameOver();
      hud.setBusy(false);
    };

    const leaveGame = (): void => {
      game = null;
      hud.hide();
      hud.setBusy(false);
      panel.hide();
      economyPanel.close();
      interiorPanel.close();
      modeBar.hide();
      modeBar.set('political');
      map.setMapMode('political');
      map.setSupport(null);
      clearSelection();
      showMenuMap();
      menu.show();
    };

    const exitToMenu = (): void => {
      void confirmDialog(
        uiRoot,
        t('game.leaveTitle'),
        t('game.leaveText'),
        t('game.leave'),
        t('game.stay'),
      ).then((leave) => {
        if (leave) leaveGame();
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

    const interiorPanel = new InteriorPanel({
      parent: uiRoot,
      sim,
      provinceName,
      countryName: nameOf,
      showProvince: (id) => {
        interiorPanel.close();
        map.highlightProvince(id);
        panel.show(id);
      },
      issue: (command) => void issue(command),
      assimilate: (provinceIds) => void assimilate(provinceIds),
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
        interiorPanel.close();
        economyPanel.open(game);
      },
      onInterior: () => {
        if (!game) return;
        if (interiorPanel.isOpen) return interiorPanel.close();
        panel.hide();
        economyPanel.close();
        interiorPanel.open(game);
      },
      supportOf: (state) => nationalSupport(state, sim, state.player.countryId),
      riotThreshold: population.riots.threshold,
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
        const state = createNewGame(world, options, sim);
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
          interiorPanel.close();
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
      if (game) interiorPanel.update(game);
      modeBar.refresh();
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
