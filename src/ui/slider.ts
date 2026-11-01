import { el } from './dom';

export interface AmountSliderOptions {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  format: (value: number) => string;
  /** Called when the player lets go (the dialog recomputes its quote). */
  onChange: (value: number) => void;
}

/**
 * A slider for amounts (money, soldiers, weapons) instead of typed numbers (Dario, Phase 26):
 * the value shows live while dragging, with the limits at both ends.
 */
export function amountSlider(o: AmountSliderOptions): HTMLElement {
  const box = el('div', 'amount-slider');
  const head = el('div', 'amount-head');
  const value = el('span', 'amount-value mono', o.format(o.value));
  head.append(el('span', 'amount-label', o.label), value);
  const input = el('input');
  input.type = 'range';
  const max = Math.max(o.min, o.max);
  const step = o.step ?? Math.max(1, (max - o.min) / 100);
  input.min = String(o.min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(Math.min(max, Math.max(o.min, o.value)));
  input.disabled = max <= o.min;
  input.setAttribute('aria-label', o.label);
  const read = (): number => Math.min(max, Math.max(o.min, Number(input.value)));
  input.addEventListener('input', () => (value.textContent = o.format(read())));
  input.addEventListener('change', () => o.onChange(read()));
  const ends = el('div', 'amount-ends mono');
  ends.append(el('span', '', o.format(o.min)), el('span', '', o.format(max)));
  box.append(head, input, ends);
  return box;
}
