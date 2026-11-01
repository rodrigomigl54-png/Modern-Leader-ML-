// The game's mark (Phase 26): a thin globe ring with an "ML" monogram drawn as one set of
// straight lines, like routes on a situation-room screen, and one amber point: the leader.
// Drawn in a 100 x 100 box; the intro animates the same shapes.

/** Monogram strokes in the 100 x 100 box: the M and the L. */
export const LOGO_M = '22,70 22,30 38,52 54,30 54,70';
export const LOGO_L = '66,30 66,70 80,70';
/** The amber point above the foot of the L. */
export const LOGO_DOT = { x: 80, y: 30, r: 4 };
/** The globe ring around the monogram. */
export const LOGO_RING = 46;

/** The logo as SVG markup (ring, monogram, point). */
export function logoSvg(className = 'logo-mark'): string {
  return (
    `<svg class="${className}" viewBox="0 0 100 100" aria-hidden="true" fill="none" ` +
    'stroke-linecap="round" stroke-linejoin="round">' +
    `<circle cx="50" cy="50" r="${LOGO_RING}" stroke="currentColor" stroke-opacity="0.35" ` +
    'stroke-width="1.5"/>' +
    '<path d="M50 4v6M50 90v6M4 50h6M90 50h6" stroke="currentColor" stroke-opacity="0.35" ' +
    'stroke-width="1.5"/>' +
    `<polyline points="${LOGO_M}" stroke="currentColor" stroke-width="5"/>` +
    `<polyline points="${LOGO_L}" stroke="currentColor" stroke-width="5"/>` +
    `<circle cx="${LOGO_DOT.x}" cy="${LOGO_DOT.y}" r="${LOGO_DOT.r}" fill="#f2a93b"/>` +
    '</svg>'
  );
}

/** The logo as an element. */
export function logoMark(className = 'logo-mark'): HTMLElement {
  const span = document.createElement('span');
  span.className = `${className}-box`;
  span.innerHTML = logoSvg(className);
  return span;
}
