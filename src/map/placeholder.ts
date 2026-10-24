import { Application, Text } from 'pixi.js';
import { t } from '../i18n';

const BACKGROUND = 0x0b1522;
const TITLE_COLOR = 0xdbe4ee;

/** Phase 0 placeholder: a full-screen canvas with the game title centered. */
export async function createPlaceholderMap(
  container: HTMLElement,
): Promise<{ refresh: () => void }> {
  const app = new Application();
  await app.init({
    width: window.innerWidth,
    height: window.innerHeight,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    antialias: true,
    background: BACKGROUND,
  });
  container.appendChild(app.canvas);

  const title = new Text({
    text: t('app.title'),
    style: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      fontWeight: '600',
      fill: TITLE_COLOR,
      letterSpacing: 2,
    },
  });
  title.anchor.set(0.5);
  app.stage.addChild(title);

  const layout = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Passing the resolution keeps the canvas sharp when the device pixel ratio changes
    // (zooming the browser or moving the window to another screen).
    app.renderer.resize(width, height, window.devicePixelRatio || 1);
    title.style.fontSize = Math.round(Math.min(width / 10, 64));
    title.position.set(width / 2, height / 2);
  };

  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
  layout();

  return {
    refresh: () => {
      title.text = t('app.title');
    },
  };
}
