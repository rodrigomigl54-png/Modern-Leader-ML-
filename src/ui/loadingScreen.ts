import { t } from '../i18n';

export interface LoadingScreen {
  setProgress(fraction: number): void;
  fail(): void;
  close(): void;
}

export function showLoadingScreen(root: HTMLElement): LoadingScreen {
  const overlay = document.createElement('div');
  overlay.className = 'loading';
  const title = document.createElement('div');
  title.className = 'loading-title';
  title.textContent = t('app.title');
  const message = document.createElement('div');
  message.className = 'loading-message';
  message.textContent = t('loading.map');
  const bar = document.createElement('div');
  bar.className = 'loading-bar';
  const fill = document.createElement('div');
  bar.append(fill);
  overlay.append(title, bar, message);
  root.append(overlay);

  return {
    setProgress: (fraction) => {
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    },
    fail: () => {
      message.textContent = t('loading.error');
      overlay.classList.add('loading-failed');
    },
    close: () => overlay.remove(),
  };
}
