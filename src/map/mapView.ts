import { Application, Container } from 'pixi.js';
import { Camera } from './camera';
import { MapControls } from './controls';
import { loadMapData, type MapData } from './mapData';
import { MapLabels } from './mapLabels';
import { MAP_MODES, type MapMode } from './mapModes';
import { hexToRgb, PaletteData } from './palette';
import { ProvincePicker } from './picker';
import { ProvinceShaderShared } from './provinceShader';
import { TileLayer } from './tileLayer';

const WATER = hexToRgb('#0b1522');

export interface MapView {
  readonly data: MapData;
  /** Re-renders texts after a language change. */
  refreshLabels(): void;
  /** Clears the selection highlight. */
  clearSelection(): void;
  setMapMode(id: string): void;
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

  // Palette: colors from the map mode, owners as indices for the border shader.
  const palette = new PaletteData();
  palette.setColor(0, WATER);
  const ownerIndex = new Map(countries.map((c, i) => [c.id, i + 1]));
  for (const p of provinces) palette.setOwner(p.id + 1, ownerIndex.get(p.owner)!);
  const shared = new ProvinceShaderShared(palette, {
    unowned: hexToRgb('#3d434c'),
    countryBorder: hexToRgb('#0f1b2a'),
    provinceBorder: hexToRgb('#1d2b3b'),
    highlight: hexToRgb('#f2a93b'),
    countryWidth: 1.6,
    provinceWidth: 0.9,
  });
  const applyMode = (mode: MapMode): void => {
    mode.colors({ provinces, countries }).forEach((c, id) => palette.setColor(id + 1, c));
    shared.paletteChanged();
  };
  applyMode(MAP_MODES[0]!);

  let dirty = true;
  const requestRender = (): void => {
    dirty = true;
  };

  const world = new Container();
  const tiles = new TileLayer(map.levels, data.tileUrl, shared, requestRender);
  world.addChild(tiles.container);
  const labels = new MapLabels(data, deviceRatio());
  app.stage.addChild(world, labels.container);
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
      if (id >= 0) {
        select(id);
        options.onSelect(id);
      } else {
        select(-1);
        options.onSelect(null);
      }
    });
  });

  const view: MapView = {
    data,
    refreshLabels: () => {
      labels.reset();
      requestRender();
    },
    clearSelection: () => select(-1),
    setMapMode: (id) => {
      const mode = MAP_MODES.find((m) => m.id === id);
      if (mode) {
        applyMode(mode);
        requestRender();
      }
    },
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
      app.render();
      view.onFrame?.(dt);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return view;
}
