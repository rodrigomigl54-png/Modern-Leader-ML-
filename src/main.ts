import './ui/style.css';
import { loadFonts } from './app/fonts';
import { setupLandscape } from './app/orientation';
import { onLanguageChange, t, type TranslationKey } from './i18n';
import {
  countryFlag,
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
import { ensureChronicle, type NewsItem } from './sim/chronicle';
import { ensureEconomy } from './sim/economy';
import { ensureGoals, type Goal } from './sim/goals';
import { ensureSummits, summitRules, type SummitQuestion } from './sim/summits';
import { dateOfTurn } from './sim/calendar';
import {
  armySize,
  citiesOfProvince,
  ensureMilitary,
  militaryTotals,
  pathTurns,
  provinceBaseLevel,
  provinceSeat,
} from './sim/military';
import { ensureDiplomacy, relation, type Demand, type PlayerRequest } from './sim/diplomacy';
import { ensureResources, RESOURCES, type ResourceId } from './sim/resources';
import { createNewGame, type GameState } from './sim/newGame';
import { airDefenseMap, airDefenseQuote, ensureWeapons, weaponsRules } from './sim/weapons';
import {
  assimilationQuote,
  ensurePopulation,
  isAssimilated,
  nationalSupport,
} from './sim/population';
import { createSave, type SaveError, type SaveFile } from './sim/save';
import { advanceTurn, type TurnEvent } from './sim/turn';
import { alliesOf, applyDisputedSetting, enemiesAtWar } from './sim/world';
import { confirmDialog, noticeDialog, onTelegram } from './ui/confirmDialog';
import { flagImage } from './ui/dom';
import { CountryDialog } from './ui/countryDialog';
import { endScreen } from './ui/endScreen';
import { DefencePanel } from './ui/defencePanel';
import { EconomyPanel } from './ui/economyPanel';
import { ForeignPanel } from './ui/foreignPanel';
import { FpsCounter } from './ui/fpsCounter';
import { GameHud } from './ui/gameHud';
import { GameMenu } from './ui/gameMenu';
import { GoalsPanel } from './ui/goalsPanel';
import { NewsTicker, newsDialog } from './ui/newsTicker';
import { reportDialog } from './ui/reportDialog';
import { summitDialog } from './ui/summitDialog';
import { formatGameDate } from './ui/format';
import { InteriorPanel } from './ui/interiorPanel';
import { InvestDialog } from './ui/investDialog';
import { showLoadingScreen } from './ui/loadingScreen';
import { MainMenu } from './ui/mainMenu';
import { MapModeBar } from './ui/mapModeBar';
import { ProduceDialog } from './ui/produceDialog';
import { ProvincePanel } from './ui/provincePanel';
import { RecruitDialog } from './ui/recruitDialog';
import { SaveSlots, slotName } from './ui/saveSlots';
import { SelectionBar } from './ui/selectionBar';
import {
  applyAppearance,
  defaultDisputedMode,
  FEEDBACK_URL,
  mountSettings,
  restoreLanguage,
  savedTheme,
  savedUiScale,
} from './ui/settings';
import { Sound } from './app/sound';
import { politicsFor, SetupWizard } from './ui/setupWizard';
import { StrikeDialog } from './ui/strikeDialog';
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
  noSummit: 'summit.gone',
  invalidTarget: 'war.invalid',
  notAtWar: 'strike.notAtWar',
  outOfRange: 'strike.outOfRange',
  outOfRangeOrBlocked: 'strike.outOfRange',
  noStock: 'strike.nothing',
  noLaunchSite: 'strike.noLaunchSite',
  noFactory: 'produce.noFactory',
  tierLocked: 'produce.locked',
  maxLevel: 'arsenal.maxLevel',
  programRunning: 'arsenal.programRunning',
  hasNuclear: 'arsenal.hasNuclear',
  notOwnCity: 'arsenal.notOwnCity',
  notEnoughPoints: 'dip.notEnoughPoints',
  refused: 'dip.refused',
  alreadyAllied: 'dip.alreadyAllied',
  sanctioned: 'dip.sanctionedError',
  notSanctioned: 'dip.notSanctioned',
  atWar: 'dip.atWarError',
  unknownRequest: 'dip.unknownRequest',
  tooEarly: 'dip.peaceTooEarly',
  noChips: 'produce.noChips',
};

async function start(): Promise<void> {
  const mapRoot = document.getElementById('map-root');
  const uiRoot = document.getElementById('ui-root');
  if (!mapRoot || !uiRoot) throw new Error('Missing #map-root or #ui-root in index.html');

  restoreLanguage();
  setupLandscape(document.body);
  applyAppearance(savedTheme(), savedUiScale());
  const sound = new Sound();
  onTelegram(() => sound.play('alert'));
  // Every button click gets the UI click sound.
  document.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('button')) sound.play('click');
    },
    true,
  );
  // iOS Safari ignores user-scalable=no; stop its page pinch-zoom so pinch zooms the map.
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  const loading = showLoadingScreen(uiRoot);
  let onMapTap: (provinceId: number | null) => void = () => undefined;
  let onShiftSelect: (provinceId: number) => void = () => undefined;
  let onBoxSelect: (provinceIds: number[]) => void = () => undefined;
  try {
    await loadFonts();
    const map = await createMapView(mapRoot, {
      onProgress: (f) => loading.setProgress(f * 0.9),
      onSelect: (id) => onMapTap(id),
      onShiftSelect: (id) => onShiftSelect(id),
      onBoxSelect: (ids) => onBoxSelect(ids),
    });
    const [bundle, store] = await Promise.all([loadWorld(map.data), openSaveStore()]);
    loading.setProgress(1);
    const world = bundle.world;
    const sim = bundle.sim;
    const toasts = new Toasts(uiRoot);
    setProvinceNames(map.data.provinces.map((p) => p.name));
    const population = sim.population!;
    // Under the panels, so an open panel covers it.
    const modeBar = new MapModeBar(uiRoot, (id) => {
      map.setMapMode(id);
      if (id === 'airDefense' && game)
        map.setAirDefense(airDefenseMap(game, sim, game.player.countryId));
    });

    const ticker = new NewsTicker(uiRoot, () => void openNews());

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
      const allies = alliesOf(game.world, countryId).filter((a) => a !== game!.player.countryId);
      const text = t('war.declareText', { country: nameOf(countryId) });
      const ok = await confirmDialog(
        uiRoot,
        t('war.declareTitle', { country: nameOf(countryId) }),
        allies.length
          ? `${text}\n\n${t('war.alliesWarning', {
              allies:
                allies.slice(0, 5).map(nameOf).join(', ') +
                (allies.length > 5 ? ` +${allies.length - 5}` : ''),
            })}`
          : text,
        t('war.declare'),
        t('saves.cancel'),
      );
      if (!ok || !game) return;
      const player = game.player.countryId;
      const before = new Set(enemiesAtWar(game.world, player));
      if (!issue({ type: 'declareWar', countryId: player, targetId: countryId })) return;
      toasts.show(t('war.declared', { country: nameOf(countryId) }), 'error');
      // Allies of the target that answered its call.
      const joined = enemiesAtWar(game.world, player).filter(
        (e) => e !== countryId && !before.has(e),
      );
      if (joined.length)
        await noticeDialog(
          uiRoot,
          t('minister.foreign'),
          t('minister.warJoined', {
            countries:
              joined.slice(0, 6).map(nameOf).join(', ') +
              (joined.length > 6 ? ` +${joined.length - 6}` : ''),
          }),
          t('minister.understood'),
        );
    };

    /** Missiles, drones, nuclear bases and air defense on the map. */
    const showStrikes = (): void => {
      if (!game) {
        map.setStrikes({ missiles: [], drones: [], nuclearBases: [], airDefense: [] });
        map.setAirDefense(null);
        return;
      }
      const player = game.player.countryId;
      const owners = game.world.provinceOwners;
      const cityOwner = (c: number): string | undefined => owners[sim.cityProvince[c]!];
      const allies = new Set(alliesOf(game.world, player));
      const enemies = new Set(enemiesAtWar(game.world, player));
      const levels = weaponsRules(sim).airDefense.levels;
      map.setStrikes({
        missiles: game.weapons.missiles
          .filter((m) => m.owner === player || cityOwner(m.targetCityId) === player)
          .map((m) => ({
            fromCityId: m.fromCityId,
            toCityId: m.targetCityId,
            relation: m.owner === player ? 'own' : 'enemy',
            nuclear: m.tier === 0,
          })),
        drones: game.weapons.drones
          .filter((d) => d.owner === player || owners[d.targetProvinceId] === player)
          .map((d) => ({
            provinceId: d.provinceId,
            path: d.path,
            relation: d.owner === player ? 'own' : 'enemy',
          })),
        nuclearBases: game.weapons.nuclearBases
          .filter((b) => cityOwner(b.cityId) === b.country)
          .map((b) => ({ cityId: b.cityId, mine: b.country === player })),
        airDefense: game.weapons.airDefense.flatMap((lvl, cityId) => {
          if (lvl <= 0) return [];
          const owner = cityOwner(cityId) ?? '';
          const relation =
            owner === player
              ? 'own'
              : allies.has(owner)
                ? 'ally'
                : enemies.has(owner)
                  ? 'enemy'
                  : 'other';
          return [{ cityId, radiusKm: levels[lvl - 1]!.radiusKm, relation } as const];
        }),
      });
      if (map.mapMode === 'airDefense') map.setAirDefense(airDefenseMap(game, sim, player));
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
        const seat = provinceSeat(sim, provinceId);
        const canDeal =
          owner !== player &&
          target !== undefined &&
          target.status !== 'uninhabited' &&
          target.provinceIds.length > 0;
        return {
          armies,
          baseLevel: provinceBaseLevel(game, sim, provinceId),
          reservists: owner === player ? formatCount(game.military.reservists[provinceId]!) : null,
          movable,
          attack: enemies.has(owner),
          diplomacy: canDeal ? { countryId: owner, name: nameOf(owner) } : null,
          airDefense: seat >= 0 ? (game.weapons.airDefense[seat] ?? 0) : 0,
          nuclearBase: game.weapons.nuclearBases.some(
            (b) => sim.cityProvince[b.cityId] === provinceId,
          ),
          strike: enemies.has(owner) && seat >= 0,
          airDefenseCost:
            owner === player && seat >= 0 && airDefenseQuote(game, sim, player, seat).level
              ? formatUsd(airDefenseQuote(game, sim, player, seat).level!.costUsd)
              : null,
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
      onDiplomacy: (countryId, provinceId) => {
        if (!game) return;
        panel.hide();
        countryDialog.open(game, countryId, provinceId);
      },
      onStrike: (provinceId) => game && strikeDialog.open(game, provinceId),
      onBuildAirDefense: (provinceId) => {
        if (!game) return;
        const cityId = provinceSeat(sim, provinceId);
        if (issue({ type: 'buildAirDefense', countryId: game.player.countryId, cityId }))
          toasts.show(t('arsenal.airDefenseStarted', { city: cityName(cityId) }));
      },
      isSelected: (cityId) => selection.has(cityId),
      toggleSelected: (cityId) => {
        if (selection.has(cityId)) selection.delete(cityId);
        else selection.add(cityId);
        selectionBar.update(selection.size, armySelection.size);
      },
    });
    const fps = new FpsCounter(uiRoot);
    map.setTheme(savedTheme());
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
      // Vassals change the colors too.
      const owners =
        state.world.provinceOwners.join() +
        state.world.alliances
          .filter((a) => a.type === 'vassal')
          .map((a) => a.members.join('>'))
          .join();
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
      showStrikes();
      showDiplomacy();
      hud.show(game);
      panel.refresh();
      economyPanel.update(game);
      interiorPanel.update(game);
      defencePanel.update(game);
      foreignPanel.update(game);
      goalsPanel.update(game);
      ticker.update(headlines(game));
      countryDialog.update(game);
    };

    /** The only way the UI changes the game (GDD section 2). Null when it was refused. */
    const issueResult = (command: Command): { accepted?: boolean } | null => {
      if (!game) return null;
      const result = applyCommand(game, command, sim);
      if (!result.ok) {
        toasts.show(t(COMMAND_ERRORS[result.error] ?? 'saves.failed'), 'error');
        return null;
      }
      game = result.state;
      showState();
      if (command.type.startsWith('launch')) sound.play('launch');
      return { accepted: result.accepted };
    };
    const issue = (command: Command): boolean => issueResult(command) !== null;

    const allianceName = (id: string): string => {
      const key = bundle.allianceNames.get(id);
      if (key) return t(key as TranslationKey);
      const al = game?.world.alliances.find((a) => a.id === id);
      return t('alliance.pactOf', { members: (al?.members ?? []).map(nameOf).join(' – ') });
    };
    const describeDemand = (d: Demand): string => {
      switch (d.type) {
        case 'province':
          return t('dip.demandProvince', { place: provinceName(d.provinceId) });
        case 'leaveAlliance':
          return t('dip.demandLeave', { alliance: allianceName(d.allianceId) });
        case 'liftSanctions':
          return t('dip.demandLift');
        case 'tribute':
          return t('dip.demandTribute', { amount: formatUsd(d.amountUsd) });
        case 'vassal':
          return t('dip.demandVassal');
        case 'base':
          return t('dip.demandBase', { city: cityName(d.cityId) });
      }
    };
    const describeRequest = (state: GameState, r: PlayerRequest): string => {
      if (r.type === 'joinWar')
        return t('foreign.joinWarRequest', { ally: nameOf(r.from), enemy: nameOf(r.enemy) });
      if (r.type === 'peace') return t('foreign.peaceRequest', { country: nameOf(r.from) });
      if (r.type === 'investment')
        return t('foreign.investmentRequest', {
          country: nameOf(r.from),
          building: t(`building.${r.category}` as TranslationKey),
          city: cityName(r.cityId),
        });
      const u = state.diplomacy.ultimatums.find((x) => x.id === r.ultimatumId);
      return u
        ? t('foreign.ultimatumRequest', {
            country: nameOf(u.from),
            demand: describeDemand(u.demand),
            threat: t(`dip.threat.${u.threat}`),
            weeks: Math.max(0, u.deadline - state.turn),
          })
        : '';
    };

    /** Relations toward the player and alliance blocs for the diplomacy map modes. */
    const showDiplomacy = (): void => {
      if (!game) return map.setDiplomacy(null, null);
      const player = game.player.countryId;
      const relations = new Map(
        game.world.countries.map((c) => [c.id, relation(game!, sim, player, c.id)] as const),
      );
      const blocs = new Map<string, number>();
      const alliances = game.world.alliances
        .filter((a) => a.type !== 'vassal')
        .sort((a, b) => b.members.length - a.members.length || (a.id < b.id ? -1 : 1));
      alliances.forEach((a, i) => {
        for (const m of a.members) if (!blocs.has(m)) blocs.set(m, i);
      });
      map.setDiplomacy(relations, blocs);
      // Main export of each country (by value) for the resources map mode.
      const exports = new Map<string, number>();
      for (const [id, trade] of Object.entries(game.resources?.trade ?? {})) {
        let best = -1;
        let bestValue = 0;
        trade.exports.forEach((units, ri) => {
          const value = units * (game!.resources.price[ri] ?? 0);
          if (value > bestValue) {
            best = ri;
            bestValue = value;
          }
        });
        exports.set(id, best);
      }
      map.setExports(exports);
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
      const state = ensureGoals(
        ensureSummits(
          ensureChronicle(
            ensureResources(
              ensureDiplomacy(
                ensureWeapons(
                  ensureMilitary(
                    ensurePopulation(ensureEconomy(loaded, sim.economy), population),
                    sim,
                  ),
                  sim,
                ),
                sim,
              ),
              sim,
            ),
          ),
        ),
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
      foreignPanel.close();
      goalsPanel.close();
      clearSelection();
      map.clearSelection();
      shownOwners = '';
      showPolitics(state);
      map.setSupport(state.population.support);
      showArmies();
      showStrikes();
      showDiplomacy();
      map.setFocusCountry(state.player.countryId);
      map.lookAtCountry(state.player.countryId);
      hud.show(state);
      modeBar.show();
      sound.startMusic();
      ticker.show();
      ticker.update(headlines(state));
      if (state.gameOver) void showGameOver();
      else if (state.turn === 0) void advisorTip(0).then(startShortages);
      else if (state.summits.pending) void openSummit();
    };

    /** The end of the game: a defeat (conquered, revolution) or the victory over the whole world. */
    const showGameOver = async (): Promise<void> => {
      if (!game?.gameOver) return;
      hud.setBusy(true);
      const { reason, turn } = game.gameOver;
      const victory = reason === 'victory';
      const vars = {
        leader: game.player.leaderName,
        country: nameOf(game.player.countryId),
        weeks: turn + 1,
        date: formatGameDate(game.date),
      };
      sound.play(victory ? 'launch' : 'impact');
      await endScreen(uiRoot, {
        victory,
        title: t(victory ? 'gameOver.victoryTitle' : 'gameOver.defeatTitle'),
        text: t(`gameOver.${reason}`, vars),
        details: t('gameOver.details', vars),
        buttonLabel: t('game.mainMenu'),
      });
      leaveGame();
    };

    /** A headline in the player's language. */
    const headline = (n: NewsItem): string =>
      t(`news.${n.kind}` as TranslationKey, {
        a: nameOf(n.a),
        b: n.b ? nameOf(n.b) : '',
        city: n.kind === 'nuclear' ? cityName(Number(n.extra)) : '',
        summit: n.kind === 'summit' ? t(`summit.kind.${n.extra}` as TranslationKey) : '',
      });
    const headlines = (state: GameState): string[] =>
      [...state.chronicle.news].reverse().map(headline);
    const openNews = async (): Promise<void> => {
      if (!game) return;
      const start = game.world.startDate;
      await newsDialog(
        uiRoot,
        [...game.chronicle.news]
          .reverse()
          .map((n) => ({ date: formatGameDate(dateOfTurn(start, n.turn)), text: headline(n) })),
      );
    };
    const describeGoal = (g: Goal): string =>
      t(`goals.${g.kind}` as TranslationKey, {
        gdp: formatUsd(g.target ?? 0),
        alliance: g.allianceId ? allianceName(g.allianceId) : '',
        max: formatPercent(sim.goals?.lowInflation.max ?? 0, 0),
        weeks: sim.goals?.lowInflation.streak ?? 0,
        debt: formatPercent(sim.goals?.lowDebt.maxShare ?? 0, 0),
        years: Math.round((sim.goals?.noRiots.turns ?? 0) / 52),
      });
    const summitParams = (q: SummitQuestion): Record<string, string | number> => ({
      country: q.country ? nameOf(q.country) : '',
      rival: q.rival ? nameOf(q.rival) : '',
      side: q.side ? nameOf(q.side) : '',
      value: q.value ?? 0,
      resource: q.resource ? t(`res.${q.resource}` as TranslationKey) : '',
    });
    const summitQuestion = (q: SummitQuestion): string =>
      t(`summit.q.${q.id}` as TranslationKey, summitParams(q));
    /** The four ministers double as the tutorial in the first turns (GDD section 13). */
    const ADVISOR_TIPS: [TranslationKey, TranslationKey][] = [
      ['minister.finance', 'tip.economy'],
      ['minister.interior', 'tip.interior'],
      ['minister.defence', 'tip.defence'],
      ['minister.foreign', 'tip.foreign'],
      ['minister.foreign', 'tip.goals'],
    ];
    const advisorTip = async (turn: number): Promise<void> => {
      const tip = ADVISOR_TIPS[turn];
      if (!tip || !game) return;
      await noticeDialog(uiRoot, t(tip[0]), t(tip[1]), t('minister.understood'));
    };

    /** Shortages the player's country has from the start (none of them is an event). */
    const startShortages = async (): Promise<void> => {
      if (!game) return;
      const supply = game.resources?.trade[game.player.countryId]?.supply ?? [];
      const alert = sim.resources?.rules.shortageAlert ?? 0;
      const short = RESOURCES.filter((_, i) => (supply[i] ?? 1) < alert);
      if (!short.length) return;
      await noticeDialog(
        uiRoot,
        t('minister.finance'),
        t('minister.shortage', { resources: short.map((r) => t(`res.${r}`)).join(', ') }),
        t('minister.understood'),
      );
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
      // Diplomacy: allies joining, peace, answers to our ultimatums, requests to answer.
      const foreign = (text: string): Promise<void> =>
        noticeDialog(uiRoot, t('minister.foreign'), text, t('minister.understood'));
      const joinedAgainst: string[] = [];
      const joinedFor: string[] = [];
      const playerAllies = new Set(alliesOf(game.world, player));
      for (const e of events) {
        if (e.type === 'warDeclared') {
          if (e.target === player)
            await foreign(t('minister.warDeclared', { country: nameOf(e.attacker) }));
          else if (playerAllies.has(e.target))
            await foreign(
              t('minister.allyAttacked', { country: nameOf(e.attacker), ally: nameOf(e.target) }),
            );
          else
            toasts.show(
              t('news.warDeclared', { attacker: nameOf(e.attacker), target: nameOf(e.target) }),
            );
        }
        if (e.type === 'sanctionsImposed' && e.to === player)
          toasts.show(t('news.sanctionsOnUs', { country: nameOf(e.from) }), 'error');
        if (e.type === 'nuclearThreat' && e.to === player)
          await noticeDialog(
            uiRoot,
            t('minister.defence'),
            t('minister.nuclearThreat', { country: nameOf(e.from) }),
            t('minister.understood'),
          );
        if (e.type === 'warJoined') {
          if (e.enemy === player) joinedAgainst.push(e.countryId);
          else if (e.ally === player) joinedFor.push(e.countryId);
        }
        if (e.type === 'peace' && (e.a === player || e.b === player))
          toasts.show(t('dip.peaceMade', { country: nameOf(e.a === player ? e.b : e.a) }));
        if (e.type === 'ultimatumAnswered' && e.from === player)
          toasts.show(
            t(e.accepted ? 'dip.ultimatumAccepted' : 'dip.ultimatumRefused', {
              country: nameOf(e.to),
            }),
            e.accepted ? undefined : 'error',
          );
        if (e.type === 'credibilityLost' && e.countryId === player)
          toasts.show(t('dip.credibilityLost'), 'error');
        if (e.type === 'globalSanctions' && e.countryId === player)
          await foreign(t('minister.globalSanctions'));
      }
      const names = (ids: string[]): string =>
        ids.slice(0, 6).map(nameOf).join(', ') + (ids.length > 6 ? ` +${ids.length - 6}` : '');
      if (joinedAgainst.length)
        await foreign(t('minister.warJoined', { countries: names(joinedAgainst) }));
      if (joinedFor.length) toasts.show(t('dip.allyJoined', { countries: names(joinedFor) }));
      for (const e of events) {
        if (e.type !== 'request' || !game) continue;
        const r = game.diplomacy.requests.find((x) => x.id === e.requestId);
        if (!r) continue;
        const accept = await confirmDialog(
          uiRoot,
          t('minister.foreign'),
          describeRequest(game, r),
          t('foreign.accept'),
          t('foreign.refuse'),
        );
        issue({ type: 'answerRequest', countryId: player, requestId: r.id, accept });
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
      // Missile and drone strikes: own results as a toast, enemy strikes as a telegram.
      let launched = 0;
      let stopped = 0;
      let killed = 0;
      const hitCities: number[] = [];
      const incoming: {
        cities: number[];
        launched: number;
        stopped: number;
        killed: number;
        buildings: number;
      } = { cities: [], launched: 0, stopped: 0, killed: 0, buildings: 0 };
      for (const e of events) {
        if (e.type === 'strike') {
          if (e.cityId >= 0) hitCities.push(e.cityId);
          if (e.attacker === player) {
            launched += e.launched;
            stopped += e.intercepted;
            killed += e.soldiersKilled;
          } else if (e.defender === player) {
            if (!incoming.cities.includes(e.cityId)) incoming.cities.push(e.cityId);
            incoming.launched += e.launched;
            incoming.stopped += e.intercepted;
            incoming.killed += e.soldiersKilled;
            incoming.buildings += e.buildingsDestroyed;
          }
        }
        if (e.type === 'convoyIntercepted' && (e.owner === player || e.by === player))
          toasts.show(
            t(e.owner === player ? 'war.convoyLost' : 'war.convoyHit', {
              count: formatCount(e.lost),
              place: provinceName(e.provinceId),
              country: nameOf(e.owner === player ? e.by : e.owner),
            }),
            e.owner === player ? 'error' : 'info',
          );
        if (e.type === 'weaponsReady' && e.owner === player)
          toasts.show(t(`arsenal.ready.${e.weapon}`, { count: formatCount(e.count) }));
      }
      if (hitCities.length) {
        map.pulseCities(hitCities.slice(0, 30));
        sound.play('impact');
      }
      if (launched)
        toasts.show(t('strike.result', { launched, stopped, killed: formatCount(killed) }));
      for (const e of events) {
        if (e.type !== 'nuclearStrike') continue;
        map.pulseCities([e.cityId], true);
        await noticeDialog(
          uiRoot,
          t('minister.defence'),
          t(e.attacker === player ? 'minister.nuclearOwn' : 'minister.nuclear', {
            attacker: nameOf(e.attacker),
            city: cityName(e.cityId),
            country: nameOf(e.defender),
          }),
          t('minister.understood'),
        );
      }
      if (incoming.launched) {
        await noticeDialog(
          uiRoot,
          t('minister.defence'),
          t('minister.strikes', {
            places: incoming.cities.slice(0, 3).map(cityName).join(', '),
            launched: incoming.launched,
            stopped: incoming.stopped,
            killed: formatCount(incoming.killed),
            buildings: incoming.buildings,
          }),
          t('minister.understood'),
        );
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
        if (e.type === 'shortage' && e.countryId === player)
          await noticeDialog(
            uiRoot,
            t('minister.finance'),
            t('minister.shortage', {
              resources: e.resources.map((r: ResourceId) => t(`res.${r}`)).join(', '),
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
      for (const e of events) {
        if (e.type === 'goalDone' || e.type === 'goalFailed') {
          const goal = game.goals.find((g) => g.kind === e.kind);
          toasts.show(
            t(e.type === 'goalDone' ? 'goals.doneToast' : 'goals.failedToast', {
              goal: goal ? describeGoal(goal) : '',
            }),
            e.type === 'goalDone' ? 'info' : 'error',
          );
        }
        if (e.type === 'summitHeld' && !e.attended)
          toasts.show(
            t('summit.missed', { summit: t(`summit.kind.${e.kind}` as TranslationKey) }),
            'error',
          );
      }
      for (const e of events) {
        if (e.type === 'report' && game) await reportDialog(uiRoot, e.report, nameOf);
      }
      if (events.some((e) => e.type === 'summitInvitation')) await openSummit();
    };

    /** Asks the player to attend or skip the pending summit. */
    const openSummit = async (): Promise<void> => {
      const s = game?.summits.pending;
      if (!s || !sim.summits) return;
      {
        const answers = await summitDialog(uiRoot, s, summitRules(sim), {
          title: t('summit.title', {
            summit: t(`summit.kind.${s.kind}` as TranslationKey),
            host: nameOf(s.host),
          }),
          question: summitQuestion,
          answer: (q, a) => t(`summit.a.${q.id}.${a}` as TranslationKey, summitParams(q)),
        });
        if (game)
          issue({ type: 'summit', countryId: game.player.countryId, summitId: s.id, answers });
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
      await advisorTip(game.turn);
      hud.setBusy(false);
    };

    const leaveGame = (): void => {
      sound.stopMusic();
      game = null;
      hud.hide();
      hud.setBusy(false);
      panel.hide();
      economyPanel.close();
      interiorPanel.close();
      defencePanel.close();
      foreignPanel.close();
      goalsPanel.close();
      modeBar.hide();
      ticker.hide();
      modeBar.set('political');
      map.setMapMode('political');
      map.setSupport(null);
      map.setArmies([]);
      map.setStrikes({ missiles: [], drones: [], nuclearBases: [], airDefense: [] });
      map.setAirDefense(null);
      map.setDiplomacy(null, null);
      map.setExports(null);
      countryDialog.close();
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
      countryName: nameOf,
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
        foreignPanel.close();
        goalsPanel.close();
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
        foreignPanel.close();
        goalsPanel.close();
        map.lookAtProvince(id);
        map.highlightProvince(id);
        panel.show(id);
      },
      onProduce: () => game && produceDialog.open(game),
      onNuclearProgram: () => {
        if (!game) return;
        const n = weaponsRules(sim).nuclear;
        void confirmDialog(
          uiRoot,
          t('arsenal.programTitle'),
          t('arsenal.programText', {
            cost: formatUsd(n.programCostUsd),
            years: Math.round(n.programTurns / 52),
          }),
          t('arsenal.startProgram'),
          t('saves.cancel'),
        ).then((ok) => {
          if (ok && game) issue({ type: 'startNuclearProgram', countryId: game.player.countryId });
        });
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

    const strikeDialog = new StrikeDialog({
      parent: uiRoot,
      sim,
      provinceName,
      cityName,
      countryName: nameOf,
      formatCount,
      onMissiles: (targetCityId, tier, count) => {
        if (!game) return;
        if (
          issue({
            type: 'launchMissiles',
            countryId: game.player.countryId,
            targetCityId,
            tier,
            count,
          })
        )
          toasts.show(t('strike.launched', { count, city: cityName(targetCityId) }), 'error');
      },
      onDrones: (targetProvinceId, tier, count) => {
        if (!game) return;
        if (
          issue({
            type: 'launchDrones',
            countryId: game.player.countryId,
            targetProvinceId,
            tier,
            count,
          })
        )
          toasts.show(
            t('strike.dronesLaunched', { count, place: provinceName(targetProvinceId) }),
            'error',
          );
      },
      onNuclear: (targetCityId) => {
        if (!game) return;
        void confirmDialog(
          uiRoot,
          t('strike.nuclearTitle'),
          t('strike.nuclearConfirm', { city: cityName(targetCityId) }),
          t('strike.nuclearLaunch'),
          t('saves.cancel'),
        ).then((ok) => {
          if (ok && game)
            issue({ type: 'launchNuclear', countryId: game.player.countryId, targetCityId });
        });
      },
    });

    const produceDialog = new ProduceDialog({
      parent: uiRoot,
      sim,
      formatCount,
      onConfirm: (weapon, tier, count) => {
        if (!game) return;
        if (
          issue({ type: 'produceWeapons', countryId: game.player.countryId, weapon, tier, count })
        )
          toasts.show(t('produce.started'));
      },
    });

    const countryDialog = new CountryDialog({
      parent: uiRoot,
      sim,
      describeGoal: (g) => describeGoal(g),
      countryName: nameOf,
      flag: (id) =>
        flagImage(
          countryFlag(game?.world ?? world, id, game?.settings.disputedMode ?? 'neutral'),
          'flag',
        ),
      provinceName,
      cityName,
      allianceName,
      formatCount,
      issue: issueResult,
      declareWar: (id) => {
        countryDialog.close();
        void declareWar(id);
      },
    });

    const goalsPanel = new GoalsPanel(uiRoot, sim, (g) => describeGoal(g));
    const foreignPanel = new ForeignPanel({
      parent: uiRoot,
      sim,
      countryName: nameOf,
      cityName,
      allianceName,
      describeRequest,
      describeDemand,
      issue: (command) => void issue(command),
      openCountry: (id, view) => game && countryDialog.open(game, id, -1, view),
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
        interiorPanel.close();
        defencePanel.close();
        foreignPanel.close();
        goalsPanel.close();
        economyPanel.open(game);
      },
      onInterior: () => {
        if (!game) return;
        if (interiorPanel.isOpen) return interiorPanel.close();
        panel.hide();
        economyPanel.close();
        defencePanel.close();
        foreignPanel.close();
        goalsPanel.close();
        interiorPanel.open(game);
      },
      onForeign: () => {
        if (!game) return;
        if (foreignPanel.isOpen) return foreignPanel.close();
        goalsPanel.close();
        panel.hide();
        economyPanel.close();
        interiorPanel.close();
        defencePanel.close();
        foreignPanel.open(game);
      },
      pointsOf: (state) => (state.diplomacy.points[state.player.countryId] ?? 0).toFixed(0),
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

    const settings = mountSettings(uiRoot, {
      onShowFps: (show) => fps.setVisible(show),
      onTheme: (theme) => map.setTheme(theme),
      sound: {
        get musicVolume() {
          return sound.musicVolume;
        },
        get effectsVolume() {
          return sound.effectsVolume;
        },
        setMusicVolume: (v) => {
          sound.setMusicVolume(v);
          if (game) sound.startMusic();
        },
        setEffectsVolume: (v) => sound.setEffectsVolume(v),
      },
    });
    const openFeedback = (): void => void window.open(FEEDBACK_URL, '_blank', 'noopener');
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
      onGoals: () => {
        if (!game) return;
        panel.hide();
        economyPanel.close();
        interiorPanel.close();
        defencePanel.close();
        foreignPanel.close();
        goalsPanel.open(game);
      },
      onNews: () => void openNews(),
      onFeedback: openFeedback,
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
      onFeedback: openFeedback,
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
          foreignPanel.close();
          goalsPanel.close();
          panel.show(id);
        }
      }
    };

    // PC multi-select (GDD section 13): Shift-click a province toggles its cities; a Shift-drag
    // box selects our armies inside it, or our cities when there are none.
    onShiftSelect = (id) => {
      if (!game || wizard.isChoosingCountry) return;
      if (game.world.provinceOwners[id] !== game.player.countryId) return onMapTap(id);
      const cities = citiesOfProvince(sim, id);
      const all = cities.every((c) => selection.has(c));
      for (const c of cities) {
        if (all) selection.delete(c);
        else selection.add(c);
      }
      selectionBar.update(selection.size, armySelection.size);
      panel.refresh();
    };
    onBoxSelect = (ids) => {
      if (!game || wizard.isChoosingCountry) return;
      const player = game.player.countryId;
      const inBox = new Set(ids);
      const armies = game.military.armies.filter(
        (a) => a.owner === player && inBox.has(a.provinceId) && a.arriveTurn === undefined,
      );
      if (armies.length) for (const a of armies) armySelection.add(a.id);
      else
        for (const p of ids)
          if (game.world.provinceOwners[p] === player)
            for (const c of citiesOfProvince(sim, p)) selection.add(c);
      selectionBar.update(selection.size, armySelection.size);
      showArmies();
      panel.refresh();
    };

    onLanguageChange(() => {
      menu.refresh();
      wizard.refresh();
      hud.refresh();
      panel.refresh();
      if (game) economyPanel.update(game);
      if (game) interiorPanel.update(game);
      if (game) defencePanel.update(game);
      if (game) foreignPanel.update(game);
      if (game) goalsPanel.update(game);
      if (game) ticker.update(headlines(game));
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
