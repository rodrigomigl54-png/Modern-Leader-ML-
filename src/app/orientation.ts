// Phones play in landscape (the map and panels need the width). On the first tap the game goes
// full screen and locks the screen to landscape where the browser allows it (Android); elsewhere
// (iPhone Safari) a "rotate your phone" screen covers the game while the phone is upright.
import { onLanguageChange, t } from '../i18n';

const isPhone = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

async function lockLandscape(): Promise<void> {
  const root = document.documentElement;
  try {
    if (!document.fullscreenElement && root.requestFullscreen)
      await root.requestFullscreen({ navigationUI: 'hide' });
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: 'landscape') => Promise<void>;
    };
    await orientation.lock?.('landscape');
  } catch {
    // Not supported (iPhone) or refused: the rotate screen still asks for landscape.
  }
}

export function setupLandscape(parent: HTMLElement): void {
  const overlay = document.createElement('div');
  overlay.className = 'rotate-overlay';
  overlay.setAttribute('role', 'alert');
  const icon = document.createElement('div');
  icon.className = 'rotate-icon';
  const text = document.createElement('p');
  text.className = 'rotate-text';
  const fill = (): void => {
    text.textContent = t('rotate.text');
  };
  fill();
  onLanguageChange(fill);
  overlay.append(icon, text);
  parent.append(overlay);
  if (!isPhone()) return;
  const first = (): void => {
    document.removeEventListener('pointerup', first, true);
    void lockLandscape();
  };
  // Full screen needs a user gesture.
  document.addEventListener('pointerup', first, true);
}
