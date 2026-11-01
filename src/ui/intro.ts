import { t } from '../i18n';
import { LOGO_DOT, LOGO_L, LOGO_M, LOGO_RING } from './logo';

// The opening (Phase 26, "Situation Room"): a dark screen, a radar sweeping a globe, borders
// lighting up as it passes, then the lines gather into the "ML" monogram and the game's name.
// About five seconds; a tap, click or key skips it. Players who ask for reduced motion get the
// finished logo for a moment instead.

const LENGTH_MS = 5000;
const REDUCED_MS = 1200;
const FADE_MS = 300;

/** Borders and coastlines on the globe (200 x 200 box), lit one after another by the sweep. */
const BORDERS = [
  '46,82 58,74 70,78 82,70 96,74',
  '104,58 118,52 130,60 146,56',
  '60,118 74,110 86,116 98,108',
  '112,96 124,104 138,98 152,106',
  '70,140 84,132 96,140 110,134',
  '120,130 132,142 146,136 156,146',
  '86,48 96,40 110,44',
  '40,104 52,98 60,104',
  '124,74 136,80 150,76 160,84',
];
/** Capitals that blink as the sweep crosses them. */
const BLIPS: [number, number][] = [
  [70, 78],
  [130, 60],
  [86, 116],
  [138, 98],
  [96, 140],
  [146, 136],
  [110, 44],
];

/** Plays the intro over the page; resolves once it is gone. */
export function playIntro(root: HTMLElement): Promise<void> {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const overlay = document.createElement('div');
  overlay.className = `intro${reduced ? ' intro-reduced' : ''}`;
  overlay.setAttribute('role', 'img');
  overlay.setAttribute('aria-label', t('app.title'));
  // The monogram sits in the globe: its 100-box ring matches the globe's radius.
  const k = 80 / LOGO_RING;
  const shift = 100 - 50 * k;
  const borders = BORDERS.map(
    (pts, i) =>
      `<polyline class="intro-border" pathLength="1" points="${pts}" ` +
      `style="animation-delay:${1000 + i * 150}ms"/>`,
  ).join('');
  const blips = BLIPS.map(
    ([x, y], i) =>
      `<circle class="intro-blip" cx="${x}" cy="${y}" r="2.2" ` +
      `style="animation-delay:${1100 + i * 190}ms"/>`,
  ).join('');
  overlay.innerHTML =
    '<div class="intro-stage">' +
    '<svg class="intro-svg" viewBox="0 0 200 200" fill="none" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<defs>' +
    '<clipPath id="intro-clip"><circle cx="100" cy="100" r="80"/></clipPath>' +
    '<linearGradient id="intro-wedge" x1="0" y1="0" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#f2a93b" stop-opacity="0"/>' +
    '<stop offset="1" stop-color="#f2a93b" stop-opacity="0.45"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<g class="intro-world">' +
    '<g class="intro-grid">' +
    '<ellipse cx="100" cy="100" rx="40" ry="80"/>' +
    '<ellipse cx="100" cy="100" rx="70" ry="80"/>' +
    '<path d="M100 20v160"/>' +
    '<ellipse cx="100" cy="100" rx="80" ry="28"/>' +
    '<path d="M20 100h160"/>' +
    '</g>' +
    `<g clip-path="url(#intro-clip)">${borders}${blips}` +
    '<g class="intro-sweep"><path d="M100 100L100 18A82 82 0 0 1 172 60Z" ' +
    'fill="url(#intro-wedge)"/><path class="intro-sweep-line" d="M100 100L172 60"/></g>' +
    '</g>' +
    '</g>' +
    '<circle class="intro-globe" pathLength="1" cx="100" cy="100" r="80"/>' +
    '<path class="intro-ticks" d="M100 12v8M100 180v8M12 100h8M180 100h8"/>' +
    `<g class="intro-mark" transform="translate(${shift} ${shift}) scale(${k})">` +
    `<polyline class="intro-mono intro-mono-m" pathLength="1" points="${LOGO_M}"/>` +
    `<polyline class="intro-mono intro-mono-l" pathLength="1" points="${LOGO_L}"/>` +
    `<circle class="intro-dot" cx="${LOGO_DOT.x}" cy="${LOGO_DOT.y}" r="${LOGO_DOT.r}"/>` +
    '</g>' +
    '</svg>' +
    `<div class="intro-name">${t('app.title')}</div>` +
    `<div class="intro-tagline">${t('intro.tagline')}</div>` +
    '</div>' +
    `<div class="intro-skip">${t('intro.skip')}</div>`;
  root.append(overlay);

  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener('keydown', finish);
      overlay.classList.add('intro-out');
      window.setTimeout(() => {
        overlay.remove();
        resolve();
      }, FADE_MS);
    };
    const timer = window.setTimeout(finish, reduced ? REDUCED_MS : LENGTH_MS);
    overlay.addEventListener('pointerdown', finish);
    window.addEventListener('keydown', finish);
  });
}
