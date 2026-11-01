/** A clean line chart in SVG for a series over time (the player's history, Phase 26). */
export interface ChartOptions {
  /** Labels the latest, lowest and highest values. */
  format: (value: number) => string;
  /** Lower is better (world rank): the line is drawn upside down. */
  invert?: boolean;
  /** Label under the start of the line. */
  startLabel: string;
}

const W = 320;
const H = 120;
const PAD = { left: 4, right: 4, top: 14, bottom: 18 };

export function lineChart(values: readonly number[], o: ChartOptions): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'line-chart');
  svg.setAttribute('role', 'img');
  const add = (tag: string, attrs: Record<string, string | number>, text?: string): void => {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    svg.append(node);
  };
  if (values.length < 2) {
    add('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-empty' }, '—');
    return svg;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number): number =>
    PAD.left + (i / (values.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number): number => {
    const share = (v - min) / span;
    const h = H - PAD.top - PAD.bottom;
    return PAD.top + (o.invert ? share : 1 - share) * h;
  };
  // Light grid: top, middle, bottom.
  for (const g of [0, 0.5, 1])
    add('line', {
      x1: PAD.left,
      x2: W - PAD.right,
      y1: PAD.top + g * (H - PAD.top - PAD.bottom),
      y2: PAD.top + g * (H - PAD.top - PAD.bottom),
      class: 'chart-grid',
    });
  const line = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0)},${H - PAD.bottom} ${line} ${x(values.length - 1)},${H - PAD.bottom}`;
  add('polygon', { points: area, class: 'chart-area' });
  add('polyline', { points: line, class: 'chart-line' });
  const last = values.at(-1)!;
  add('circle', { cx: x(values.length - 1), cy: y(last), r: 3.5, class: 'chart-dot' });
  const best = o.invert ? min : max;
  const worst = o.invert ? max : min;
  add(
    'text',
    { x: W - PAD.right, y: 10, 'text-anchor': 'end', class: 'chart-label' },
    o.format(best),
  );
  add(
    'text',
    { x: W - PAD.right, y: H - 4, 'text-anchor': 'end', class: 'chart-label' },
    o.format(worst),
  );
  add('text', { x: PAD.left, y: H - 4, class: 'chart-label' }, o.startLabel);
  return svg;
}
