import { Application, Container } from 'pixi.js';
import type { CountryStatus } from '../sim/world';
import { ArmyLayer, type ArmyMarker } from './armyLayer';
import { Camera } from './camera';
import { StrikeLayer, type StrikeOverlay } from './strikeLayer';
import { MapControls } from './controls';
import { loadMapData, type MapData } from './mapData';
import { countryAnchors } from './labelLayout';
import { MapLabels, type LabelCountry } from './mapLabels';
import { MAP_MODES, type MapMode } from './mapModes';
import { hexToRgb, PaletteData } from './palette';
import { ProvincePicker } from './picker';
import { ProvinceShaderShared } from './provinceShader';
import { TileLayer } from './tileLayer';

const WATER = hexToRgb('#0b1522');

/** Political state shown on the map; it comes from the game (the simulation), not from the map data. */
export interface MapPolitics {
  /** Owner country id per province id. */
  owners: string[];
  countries: { id: string; status: CountryStatus; provinceIds: number[] }[];
  /** Display name per country, or null for no label. */
  nameOf: (countryId: string) => string | null;
}

export interface MapView {
  readonly data: MapData;
  /** Re-renders texts after a language change. */
  refreshLabels(): void;
  /** Highlights one province (or none with -1). */
  highlightProvince(provinceId: number): void;
  /** Clears the province highlight. */
  clearSelection(): void;
  setMapMode(id: string): void;
  readonly mapMode: string;
  /** Public support per province for the support map mode (null outside a game). */
  setSupport(support: readonly number[] | null): void;
  setPolitics(politics: MapPolitics): void;
  /** Draws a country in the signature amber with a glowing border (null for none). */
  setFocusCountry(countryId: string | null): void;
  /**
   * Moves the camera to show a country inside the part of the screen not covered by panels
   * (insets in CSS pixels).
   */
  lookAtCountry(countryId: string, insets?: { left?: number; bottom?: number }): void;
  /** Army counters and routes. */
  setArmies(markers: ArmyMarker[]): void;
  /** Missiles, drones, nuclear bases and air-defense rings. */
  setStrikes(overlay: StrikeOverlay): void;
  /** Impact ripples at cities. */
  pulseCities(cityIds: readonly number[], nuclear?: boolean): void;
  /** Air-defense coverage per province for the air-defense map mode (null outside a game). */
  setAirDefense(coverage: Uint8Array | null): void;
  /** Relations toward the player and alliance blocs, for the diplomacy map modes. */
  setDiplomacy(
    relations: ReadonlyMap<string, number> | null,
    blocs: ReadonlyMap<string, number> | null,
  ): void;
  /** Centers the camera on a province (zooming in if needed). */
  lookAtProvince(provinceId: number): void;
  /** Current owner of a province. */
  ownerOf(provinceId: number): string;
  /** Called after every rendered frame with the frame time in ms. */
  onFrame: ((dtMs: number) => void) | null;
}

export interface MapViewOptions {
  onProgress: (fraction: number) => void;
  /** Province id, or null when the selection was cleared (tap on water). */
  onSelect: (provinceId: number | null) => void;
}

export async function createMapView(root: HTMLElement, options: MapViewOptions): Promise<MapView> {
  const data = await loadMapData((f) => options.onProgress(f * 0.5));
  const { map, provinces, countries } = data;

  const deviceRatio = (): number => Math.min(window.devicePixelRatio || 1, 3);
  const app = new Application();
  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    resolution: deviceRatio(),
    autoDensity: true,
    antialias: false,
    background: WATER,
    preference: 'webgl',
    autoStart: false,
  });
  root.appendChild(app.canvas);

  // Palette: colors from the map mode, owners as indices for the border shader. Owner indices
  // are fixed per country id in the map data, so they survive any change of ownership.
  const palette = new PaletteData();
  palette.setColor(0, WATER);
  const ownerIndex = new Map(countries.map((c, i) => [c.id, i + 1]));
  let politics: MapPolitics = {
    owners: provinces.map((p) => p.owner),
    countries: countries.map((c) => ({ id: c.id, status: c.status, provinceIds: c.provinceIds })),
    nameOf: () => null,
  };
  let focusCountry: string | null = null;
  let support: readonly number[] | null = null;
  let airDefense: Uint8Array | null = null;
  let relations: ReadonlyMap<string, number> | null = null;
  let blocs: ReadonlyMap<string, number> | null = null;
  let mode: MapMode = MAP_MODES[0]!;
  const writeOwners = (): void => {
    politics.owners.forEach((owner, id) => {
      // Countries born during the game (rebels, seceded states) get the next free index.
      if (!ownerIndex.has(owner)) ownerIndex.set(owner, ownerIndex.size + 1);
      palette.setOwner(id + 1, ownerIndex.get(owner)!);
    });
  };
  writeOwners();
  const shared = new ProvinceShaderShared(palette, {
    unowned: hexToRgb('#3d434c'),
    countryBorder: hexToRgb('#0f1b2a'),
    provinceBorder: hexToRgb('#1d2b3b'),
    highlight: hexToRgb('#f2a93b'),
    countryWidth: 1.6,
    provinceWidth: 0.9,
  });
  const applyMode = (): void => {
    mode
      .colors({
        provinces,
        countries: politics.countries,
        owners: politics.owners,
        focusCountry,
        support,
        airDefense,
        relations,
        blocs,
      })
      .forEach((c, id) => palette.setColor(id + 1, c));
    shared.paletteChanged();
  };
  applyMode();

  let dirty = true;
  const requestRender = (): void => {
    dirty = true;
  };

  const world = new Container();
  const tiles = new TileLayer(map.levels, data.tileUrl, shared, requestRender);
  world.addChild(tiles.container);
  const labelCountries = (): LabelCountry[] =>
    politics.countries.map((c) => ({
      id: c.id,
      provinceIds: c.provinceIds,
      name: politics.nameOf(c.id),
    }));
  const labels = new MapLabels(data, deviceRatio(), labelCountries());
  const armies = new ArmyLayer(data, Math.min(2, deviceRatio()));
  const strikes = new StrikeLayer(data);
  app.stage.addChild(world, labels.container, strikes.container, armies.container);
  await tiles.loadBase((f) => options.onProgress(0.5 + f * 0.5));

  const camera = new Camera(map.width, map.height);
  const resize = (): void => {
    app.renderer.resize(window.innerWidth, window.innerHeight, deviceRatio());
    camera.setViewport(window.innerWidth, window.innerHeight);
    requestRender();
  };
  resize();
  // Start over Europe and the Middle East, about 60° of longitude across the screen.
  camera.lookAt(map.width * (195 / 360), map.height * 0.3, camera.viewportWidth / (map.width / 6));
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);

  const picker = new ProvincePicker(map.levels[0]!, data.tileUrl);
  let selectionRequest = 0;
  const select = (id: number): void => {
    shared.setSelected(id);
    requestRender();
  };
  const controls = new MapControls(app.canvas, camera, requestRender, (sx, sy) => {
    const request = ++selectionRequest;
    const [wx, wy] = camera.screenToWorld(sx, sy);
    void picker.pick(wx, wy).then((id) => {
      if (request !== selectionRequest) return;
      options.onSelect(id >= 0 ? id : null);
    });
  });

  const view: MapView = {
    data,
    refreshLabels: () => {
      labels.setCountries(labelCountries());
      requestRender();
    },
    highlightProvince: (id) => select(id),
    clearSelection: () => select(-1),
    setMapMode: (id) => {
      const next = MAP_MODES.find((m) => m.id === id);
      if (next) {
        mode = next;
        strikes.setRingsVisible(next.id === 'airDefense');
        applyMode();
        requestRender();
      }
    },
    get mapMode() {
      return mode.id;
    },
    setSupport: (values) => {
      support = values;
      if (mode.id === 'support') {
        applyMode();
        requestRender();
      }
    },
    setPolitics: (next) => {
      politics = next;
      writeOwners();
      applyMode();
      labels.setCountries(labelCountries());
      shared.setFocusOwner(focusCountry ? (ownerIndex.get(focusCountry) ?? 0) : 0);
      requestRender();
    },
    setFocusCountry: (id) => {
      focusCountry = id;
      applyMode();
      shared.setFocusOwner(id ? (ownerIndex.get(id) ?? 0) : 0);
      requestRender();
    },
    lookAtCountry: (id, insets = {}) => {
      const country = politics.countries.find((c) => c.id === id);
      if (!country) return;
      const [anchor] = countryAnchors(
        [{ id, provinceIds: country.provinceIds }],
        provinces,
        map.width,
      );
      if (!anchor) return;
      // Show the country's main land area at about a third of the free screen area.
      const left = insets.left ?? 0;
      const bottom = insets.bottom ?? 0;
      const freeW = Math.max(100, camera.viewportWidth - left);
      const freeH = Math.max(100, camera.viewportHeight - bottom);
      const target = Math.min(freeW, freeH) * 0.4;
      camera.lookAt(anchor.wx, anchor.wy, target / Math.sqrt(anchor.pixels));
      // Shift so the country sits in the middle of the free area, not under the panel.
      camera.panBy(left / 2, -bottom / 2);
      requestRender();
    },
    setStrikes: (overlay) => {
      strikes.set(overlay);
      requestRender();
    },
    pulseCities: (cityIds, nuclear) => {
      strikes.pulse(cityIds, nuclear);
      requestRender();
    },
    setAirDefense: (coverage) => {
      airDefense = coverage;
      if (mode.id === 'airDefense') {
        applyMode();
        requestRender();
      }
    },
    setDiplomacy: (nextRelations, nextBlocs) => {
      relations = nextRelations;
      blocs = nextBlocs;
      if (mode.id === 'relations' || mode.id === 'alliances') {
        applyMode();
        requestRender();
      }
    },
    setArmies: (markers) => {
      armies.setMarkers(markers);
      requestRender();
    },
    lookAtProvince: (id) => {
      const p = provinces[id];
      if (!p) return;
      camera.lookAt(p.centroid[0], p.centroid[1], Math.max(camera.scale, 0.6));
      requestRender();
    },
    ownerOf: (id) => politics.owners[id]!,
    onFrame: null,
  };

  // Render only when something changed, so an idle map costs no battery.
  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(100, now - last);
    last = now;
    if (controls.update(dt)) dirty = true;
    if (dirty) {
      dirty = false;
      const s = camera.scale;
      world.scale.set(s);
      world.position.set(
        camera.viewportWidth / 2 - camera.centerX * s,
        camera.viewportHeight / 2 - camera.centerY * s,
      );
      const deviceScale = s * deviceRatio();
      // Province borders fade in between these zoom levels.
      const provinceAlpha = Math.min(1, Math.max(0, (s - 0.12) / 0.25));
      shared.setView(deviceScale, provinceAlpha);
      tiles.update(camera.visibleRect(), Math.min(deviceScale, s * 2));
      labels.update(camera);
      strikes.update(camera);
      armies.update(camera);
      // Impact ripples need frames until they fade.
      if (strikes.animating) dirty = true;
      app.render();
      view.onFrame?.(dt);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return view;
}
