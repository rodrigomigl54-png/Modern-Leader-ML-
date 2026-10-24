import './ui/style.css';
import { onLanguageChange, t, type TranslationKey } from './i18n';
import {
  countryName,
  formatCount,
  formatPercent,
  formatUsd,
  setProvinceNames,
} from './app/present';
import { AUTOSAVE_SLOT, exportSave, importSave, openSaveStore, type SlotId } from './app/saveStore';
import { loadWorld } from './app/worldData';
import { shortCount, type ArmyMarker } from './map/armyLayer';
import { createMapView } from './map/mapView';
import { applyCommand, type Command, type CommandError } from './sim/commands';
import { ensureEconomy } from './sim/economy';
import {
  armySize,
  ensureMilitary,
  militaryTotals,
  pathTurns,
  provinceBaseLevel,
} from './sim/military';
import { createNewGame, type GameState } from './sim/newGame';
import {
  assimilationQuote,
  ensurePopulation,
  isAssimilated,
  nationalSupport,
} from './sim/population';
import { createSave, type SaveError, type SaveFile } from './sim/save';
import { advanceTurn, type TurnEvent } from './sim/turn';
import { alliesOf, applyDisputedSetting, enemiesAtWar } from './sim/world';
import { confirmDialog, noticeDialog } from './ui/confirmDialog';
import { DefencePanel } from './ui/defencePanel';
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
import { RecruitDialog } from './ui/recruitDialog';
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
  noPath: 'army.noPath',
  unknownArmy: 'army.noPath',
  tooSmall: 'army.tooSmall',
  nothingToRecruit: 'recruit.nothing',
  needsBase: 'recruit.noBase',
  alreadyAtWar: 'war.alreadyAtWar',
  allied: 'war.allied',
  invalidTarget: 'war.invalid',
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
    /** The player's armies picked to receive a move order. */
    const armySelection = new Set<number>();
    const nameOf = (id: string): string =>
      countryName(game?.world ?? world, id, game?.settings.disputedMode ?? defaultDisputedMode());
    const cityName = (cityId: number): string => map.data.cities[cityId]?.name ?? String(cityId);
    const provinceName = (id: number): string => map.data.provinces[id]?.name ?? String(id);

    /** "Novi Sad, Niš, Subotica +2" */
    const placeList = (ids: number[]): string =>
      ids.slice(0, 3).map(provinceName).join(', ') + (ids.length > 3 ? ` +${ids.length - 3}` : '');

    /** Asks before declaring war (simple until diplomacy, Phase 9). */
    const declareWar = async (countryId: string): Promise<void> => {
      if (!game) return;
      const ok = await confirmDialog(
        uiRoot,
        t('war.declareTitle', { country: nameOf(countryId) }),
        t('war.declareText', { country: nameOf(countryId) }),
        t('war.declare'),
        t('saves.cancel'),
      );
      if (
        ok &&
        issue({ type: 'declareWar', countryId: game.player.countryId, targetId: countryId })
      )
        toasts.show(t('war.declared', { country: nameOf(countryId) }), 'error');
    };

    /** Army counters on the map, colored by their relation to the player. */
    const showArmies = (): void => {
      if (!game) return map.setArmies([]);
      const player = game.player.countryId;
      const enemies = new Set(enemiesAtWar(game.world, player));
      const allies = new Set(alliesOf(game.world, player));
      const markers: ArmyMarker[] = game.military.armies.map((a) => ({
        id: a.id,
        provinceId: a.provinceId,
        size: armySize(a),
        relation:
          a.owner === player
            ? 'own'
            : enemies.has(a.owner)
              ? 'enemy'
              : allies.has(a.owner)
                ? 'ally'
                : 'other',
        selected: armySelection.has(a.id),
        path: a.path,
        atSea: a.arriveTurn !== undefined && a.arriveTurn > game!.turn,
      }));
      map.setArmies(markers);
    };

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
      militaryOf: (provinceId) => {
        if (!game) return null;
        const player = game.player.countryId;
        const owner = game.world.provinceOwners[provinceId]!;
        const enemies = new Set(enemiesAtWar(game.world, player));
        const armies = game.military.armies
          .filter((a) => a.provinceId === provinceId)
          .map((a) => ({
            id: a.id,
            owner: nameOf(a.owner),
            size: formatCount(armySize(a)),
            mine: a.owner === player,
            enemy: enemies.has(a.owner),
            selected: armySelection.has(a.id),
            status:
              a.arriveTurn !== undefined && a.arriveTurn > game!.turn
                ? t('army.atSea', { weeks: a.arriveTurn - game!.turn })
                : a.path.length
                  ? t('army.goingTo', {
                      place: provinceName(a.path.at(-1)!),
                      weeks: pathTurns(sim, a.provinceId, a.path),
                    })
                  : null,
          }));
        const movable = [...armySelection].filter((id) =>
          game!.military.armies.some((a) => a.id === id && a.provinceId !== provinceId),
        ).length;
        const target = game.world.countries.find((c) => c.id === owner);
        const canDeclare =
          owner !== player &&
          !enemies.has(owner) &&
          !alliesOf(game.world, player).includes(owner) &&
          target !== undefined &&
          target.status !== 'uninhabited';
        return {
          armies,
          baseLevel: provinceBaseLevel(game, sim, provinceId),
          reservists: owner === player ? formatCount(game.military.reservists[provinceId]!) : null,
          movable,
          attack: enemies.has(owner),
          declareWar: canDeclare ? { countryId: owner, name: nameOf(owner) } : null,
        };
      },
      onToggleArmy: (armyId) => {
        if (armySelection.has(armyId)) armySelection.delete(armyId);
        else armySelection.add(armyId);
        selectionBar.update(selection.size, armySelection.size);
        panel.refresh();
        showArmies();
      },
      onSplitArmy: (armyId) => {
        if (!game) return;
        issue({ type: 'splitArmy', countryId: game.player.countryId, armyId });
      },
      onMoveHere: (provinceId) => {
        if (!game) return;
        const armyIds = [...armySelection];
        if (
          issue({
            type: 'moveArmies',
            countryId: game.player.countryId,
            armyIds,
            targetProvinceId: provinceId,
          })
        ) {
          toasts.show(
            t('army.ordered', { count: armyIds.length, place: provinceName(provinceId) }),
          );
          armySelection.clear();
          selectionBar.update(selection.size, 0);
          showState();
        }
      },
      onDeclareWar: (countryId) => void declareWar(countryId),
      isSelected: (cityId) => selection.has(cityId),
      toggleSelected: (cityId) => {
        if (selection.has(cityId)) selection.delete(cityId);
        else selection.add(cityId);
        selectionBar.update(selection.size, armySelection.size);
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
      // Armies that no longer exist (merged, destroyed) drop out of the selection.
      for (const id of armySelection)
        if (!game.military.armies.some((a) => a.id === id && a.owner === game!.player.countryId))
          armySelection.delete(id);
      selectionBar.update(selection.size, armySelection.size);
      showArmies();
      hud.show(game);
      panel.refresh();
      economyPanel.update(game);
      interiorPanel.update(game);
      defencePanel.update(game);
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
      armySelection.clear();
      selectionBar.update(0, 0);
      showArmies();
      panel.refresh();
    };

    /** Shows a game (new or loaded) on the map. */
    const playGame = (loaded: GameState): void => {
      const state = ensureMilitary(
        ensurePopulation(ensureEconomy(loaded, sim.economy), population),
        sim,
      );
      game = state;
      wizard.close();
      menu.hide();
      slots.hide();
      panel.hide();
      economyPanel.close();
      interiorPanel.close();
      defencePanel.close();
      clearSelection();
      map.clearSelection();
      shownOwners = '';
      showPolitics(state);
      map.setSupport(state.population.support);
      showArmies();
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
        t(game.gameOver.reason === 'conquered' ? 'gameOver.conquered' : 'gameOver.revolution', {
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
      // War news: one summary per turn instead of a toast per battle.
      let won = 0;
      let lost = 0;
      const taken: number[] = [];
      const lostProvinces: number[] = [];
      let trained = 0;
      for (const e of events) {
        if (e.type === 'battle' && (e.attacker === player || e.defender === player)) {
          const attackerWon = e.winner === 'attacker';
          if ((e.attacker === player) === attackerWon) won++;
          else lost++;
        }
        if (e.type === 'provinceCaptured' && e.to === player) taken.push(e.provinceId);
        if (e.type === 'provinceCaptured' && e.from === player) lostProvinces.push(e.provinceId);
        if (e.type === 'trainingDone' && e.owner === player) trained += e.count;
        if (e.type === 'countryConquered' && e.countryId !== player)
          toasts.show(t('war.conquered', { country: nameOf(e.countryId), by: nameOf(e.by) }));
      }
      if (won || lost)
        toasts.show(t('war.battles', { won, lost }), lost > won ? 'error' : undefined);
      if (taken.length) toasts.show(t('war.taken', { places: placeList(taken) }));
      if (trained) toasts.show(t('recruit.done', { count: formatCount(trained) }));
      if (lostProvinces.length && !game.gameOver) {
        await noticeDialog(
          uiRoot,
          t('minister.defence'),
          t('minister.provincesLost', {
            places: placeList(lostProvinces),
          }),
          t('minister.understood'),
        );
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
      defencePanel.close();
      modeBar.hide();
      modeBar.set('political');
      map.setMapMode('political');
      map.setSupport(null);
      map.setArmies([]);
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
        defencePanel.close();
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

    const recruitDialog = new RecruitDialog({
      parent: uiRoot,
      sim,
      cityName,
      formatCount,
      onConfirm: (kind, mode, amount) => {
        if (!game) return;
        const cityIds = [...selection];
        if (
          issue({ type: 'recruit', countryId: game.player.countryId, cityIds, kind, mode, amount })
        ) {
          toasts.show(t('recruit.started'));
          clearSelection();
        }
      },
    });

    const defencePanel = new DefencePanel({
      parent: uiRoot,
      sim,
      provinceName,
      countryName: nameOf,
      formatCount,
      showProvince: (id) => {
        defencePanel.close();
        map.lookAtProvince(id);
        map.highlightProvince(id);
        panel.show(id);
      },
      setService: (enabled) => {
        if (!game) return;
        const id = game.player.countryId;
        const change = (): void => void issue({ type: 'setService', countryId: id, enabled });
        if (!enabled) return change();
        void confirmDialog(
          uiRoot,
          t('defence.introduceTitle'),
          t('defence.introduceText', { points: sim.military!.reserves.introduceSupportPenalty }),
          t('defence.introduce'),
          t('saves.cancel'),
        ).then((ok) => ok && change());
      },
    });

    const selectionBar = new SelectionBar(uiRoot, {
      onInvest: () => game && investDialog.open(game, [...selection]),
      onRecruit: () => game && recruitDialog.open(game, [...selection]),
      onClear: clearSelection,
    });

    const hud = new GameHud(uiRoot, world, {
      onMenu: () => gameMenu.show(),
      onNextTurn: () => void endTurn(),
      onEconomy: () => {
        if (!game) return;
        if (economyPanel.isOpen) return economyPanel.close();
        panel.hide();
        defencePanel.close();
        interiorPanel.close();
        defencePanel.close();
        economyPanel.open(game);
      },
      onInterior: () => {
        if (!game) return;
        if (interiorPanel.isOpen) return interiorPanel.close();
        panel.hide();
        economyPanel.close();
        defencePanel.close();
        interiorPanel.open(game);
      },
      onDefence: () => {
        if (!game) return;
        if (defencePanel.isOpen) return defencePanel.close();
        panel.hide();
        economyPanel.close();
        interiorPanel.close();
        defencePanel.open(game);
      },
      armyOf: (state) => {
        const totals = militaryTotals(state, state.player.countryId);
        return shortCount(totals.regulars + totals.special);
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
          defencePanel.close();
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
      if (game) defencePanel.update(game);
      modeBar.refresh();
      selectionBar.update(selection.size, armySelection.size);
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
