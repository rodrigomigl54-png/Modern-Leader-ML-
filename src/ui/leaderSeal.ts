import { COUNTRY_PALETTE } from '../map/mapModes';

const SVG = 'http://www.w3.org/2000/svg';

/** First letters of the first and last word: "Aleksandar Vučić" → "AV". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0] ?? '';
  const last = words.length > 1 ? ([...words.at(-1)!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

const hash = (text: string): number => {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return h >>> 0;
};

/** Points of a regular polygon around (50, 50). */
const polygon = (sides: number, radius: number, turn: number): string =>
  Array.from({ length: sides }, (_, i) => {
    const a = ((i + turn) / sides) * Math.PI * 2 - Math.PI / 2;
    return `${(50 + radius * Math.cos(a)).toFixed(1)},${(50 + radius * Math.sin(a)).toFixed(1)}`;
  }).join(' ');

/**
 * Typographic seal of a leader (GDD section 13: leaders without images): the initials inside a
 * geometric emblem in a color of the country. The shape and color are stable per country.
 */
export function leaderSeal(name: string, countryId: string, size = 44): SVGSVGElement {
  const h = hash(countryId);
  const [r, g, b] = COUNTRY_PALETTE[h % COUNTRY_PALETTE.length]!;
  const color = `rgb(${r}, ${g}, ${b})`;
  const sides = [0, 6, 8, 4][(h >>> 8) % 4]!;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'leader-seal');
  svg.setAttribute('aria-hidden', 'true');
  const shape = (radius: number, attrs: Record<string, string>): void => {
    const node =
      sides === 0
        ? document.createElementNS(SVG, 'circle')
        : document.createElementNS(SVG, 'polygon');
    if (sides === 0) {
      node.setAttribute('cx', '50');
      node.setAttribute('cy', '50');
      node.setAttribute('r', String(radius));
    } else node.setAttribute('points', polygon(sides, radius, sides === 4 ? 0 : 0.5));
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
  };
  shape(47, { fill: color });
  shape(39, { fill: 'none', stroke: 'rgba(255,255,255,0.75)', 'stroke-width': '3' });
  const text = document.createElementNS(SVG, 'text');
  text.setAttribute('x', '50');
  text.setAttribute('y', '51');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'central');
  text.setAttribute('class', 'leader-seal-text');
  text.textContent = initials(name);
  svg.append(text);
  return svg;
}
