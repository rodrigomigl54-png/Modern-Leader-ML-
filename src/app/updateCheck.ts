// A browser can keep showing an old build of the game (a cached page or a tab left open). The game
// asks the server for version.json, bypassing every cache, at start, every few minutes and when
// the tab comes back; when the server has a newer build, a bar offers to load it.
import { onLanguageChange, t } from '../i18n';

const EVERY_MS = 5 * 60 * 1000;

async function serverBuild(): Promise<string | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { build?: string };
    return typeof data.build === 'string' ? data.build : null;
  } catch {
    return null; // Offline or blocked: keep playing the build we have.
  }
}

/** Loads the newest build, with a query that no cached copy of the page can match. */
export function reloadToBuild(build: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set('v', build.replace(/\D/g, ''));
  window.location.replace(url.toString());
}

export function watchForUpdates(parent: HTMLElement): void {
  if (import.meta.env.DEV) return;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.hidden = true;
  bar.setAttribute('role', 'status');
  parent.append(bar);
  let newer: string | null = null;

  const render = (): void => {
    if (!newer) return;
    const text = document.createElement('span');
    text.textContent = t('update.available');
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn btn-primary btn-small';
    reload.textContent = t('update.reload');
    const build = newer;
    reload.addEventListener('click', () => reloadToBuild(build));
    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'btn btn-secondary btn-small';
    later.textContent = t('update.later');
    later.addEventListener('click', () => (bar.hidden = true));
    bar.replaceChildren(text, reload, later);
    bar.hidden = false;
  };
  onLanguageChange(render);

  const check = async (): Promise<void> => {
    const build = await serverBuild();
    if (!build || build === __BUILD_ID__ || build === newer) return;
    // Only a build made after this one counts (ISO dates compare as text).
    if (build < __BUILD_ID__) return;
    newer = build;
    render();
  };
  void check();
  setInterval(() => void check(), EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
