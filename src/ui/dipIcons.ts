// Small animated line icons for the diplomatic actions (GDD section 13: "motion with purpose").
// Drawn for this game in its Situation Room style: thin strokes in the current color, one
// gentle looping motion each. Motion stops for players who ask for reduced motion (CSS).

export type DipIcon =
  | 'improve'
  | 'insult'
  | 'pact'
  | 'join'
  | 'ultimatum'
  | 'base'
  | 'aid'
  | 'trade'
  | 'vassal'
  | 'release'
  | 'sanction'
  | 'unsanction'
  | 'war'
  | 'peace';

const SHAPES: Record<DipIcon, string> = {
  // Two lines rising toward each other with a small spark: relations getting warmer.
  improve:
    '<path d="M3 17l5-5 4 3 7-8"/><path class="dip-i-rise" d="M15 7h4v4"/>' +
    '<circle class="dip-i-spark" cx="19" cy="4" r="1.2"/>',
  // A speech bubble with a jagged bolt that flickers.
  insult:
    '<path d="M4 5h16v10H10l-4 4v-4H4z"/>' +
    '<path class="dip-i-flicker" d="M13 6.5l-3 4h3l-2 3.5"/>',
  // A shield with a check mark and a light sweep.
  pact:
    '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>' +
    '<path class="dip-i-draw" d="M8.5 12l2.5 2.5 4.5-5"/>',
  // A shield with a plus: joining an alliance.
  join:
    '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>' +
    '<path class="dip-i-pulse" d="M12 8.5v7M8.5 12h7"/>',
  // An hourglass that turns: a deadline.
  ultimatum:
    '<g class="dip-i-turn"><path d="M7 3h10M7 21h10"/>' +
    '<path d="M8 3c0 5 8 5 8 9s-8 4-8 9"/><path d="M16 3c0 5-8 5-8 9s8 4 8 9"/></g>',
  // A flag on a pole, waving.
  base: '<path d="M6 21V3"/><path class="dip-i-wave" d="M6 4h11l-2 3.5 2 3.5H6"/>',
  // A parcel that bobs: aid.
  aid:
    '<g class="dip-i-bob"><rect x="4" y="9" width="16" height="11" rx="1"/>' +
    '<path d="M4 13h16M12 9v11"/><path d="M12 9c-2-4-6-3-4 0m4 0c2-4 6-3 4 0"/></g>',
  // Two arrows passing each other: trade.
  trade:
    '<path class="dip-i-slide-r" d="M4 8h13l-3-3"/><path class="dip-i-slide-l" d="M20 16H7l3 3"/>',
  // A crown that bobs: vassals.
  vassal: '<path class="dip-i-bob" d="M4 17l1-9 4 4 3-6 3 6 4-4 1 9z M5 20h14"/>',
  // A chain link opening: release.
  release:
    '<path d="M10 14l-3 3a3 3 0 0 1-4-4l3-3"/>' +
    '<path class="dip-i-open" d="M14 10l3-3a3 3 0 0 1 4 4l-3 3"/>',
  // A padlock whose shackle snaps shut: sanctions.
  sanction:
    '<rect x="5" y="11" width="14" height="10" rx="1.5"/>' +
    '<path class="dip-i-lock" d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  // An open padlock: lifting sanctions.
  unsanction:
    '<rect x="5" y="11" width="14" height="10" rx="1.5"/>' +
    '<path class="dip-i-unlock" d="M8 11V8a4 4 0 0 1 7.5-2"/>',
  // Crossed blades with a pulsing glow: war.
  war: '<g class="dip-i-clash"><path d="M5 19L17 5l2 0 0 2L5 19"/><path d="M19 19L7 5 5 5 5 7 19 19"/></g>',
  // An olive branch that sways: peace.
  peace:
    '<g class="dip-i-sway"><path d="M5 20C9 15 13 10 19 4"/>' +
    '<ellipse cx="9" cy="13" rx="2.6" ry="1.2" transform="rotate(-50 9 13)"/>' +
    '<ellipse cx="13" cy="9" rx="2.6" ry="1.2" transform="rotate(-50 13 9)"/>' +
    '<ellipse cx="12" cy="15" rx="2.6" ry="1.2" transform="rotate(40 12 15)"/>' +
    '<ellipse cx="16" cy="11" rx="2.6" ry="1.2" transform="rotate(40 16 11)"/></g>',
};

/** An animated icon element for a diplomatic action. */
export function dipIcon(kind: DipIcon): HTMLElement {
  const span = document.createElement('span');
  span.className = `dip-icon dip-icon-${kind}`;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    `stroke-linecap="round" stroke-linejoin="round">${SHAPES[kind]}</svg>`;
  return span;
}
