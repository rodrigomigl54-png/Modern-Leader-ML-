import { t, type TranslationKey } from '../i18n';
import type { EventCategory, EventDefinition, EventEffects } from '../sim/randomEvents';
import { button, el } from './dom';

// A random event as a compact card (master plan, sections 5 and 7): a small illustration, a
// title, one or two sentences and the answers with their effects. No dimmed screen: the map
// stays visible around it. Illustrations are simple line drawings made for this game.

const ART: Record<EventCategory, string> = {
  // A rising and falling line over a baseline.
  economic:
    '<path d="M6 40h52"/><path d="M8 34l12-10 9 6 12-16 9 8 6-4"/><circle cx="56" cy="18" r="2.5"/>',
  // A crowd of heads with a raised sign.
  social:
    '<circle cx="18" cy="30" r="5"/><circle cx="32" cy="27" r="5"/><circle cx="46" cy="30" r="5"/>' +
    '<path d="M10 46c0-6 4-9 8-9s8 3 8 9M24 46c0-7 4-11 8-11s8 4 8 11M38 46c0-6 4-9 8-9s8 3 8 9"/>' +
    '<path d="M32 21V8M24 8h16v8H24z"/>',
  // A government building with columns.
  political:
    '<path d="M10 22L32 10l22 12z"/><path d="M14 22v18M24 22v18M40 22v18M50 22v18"/>' +
    '<path d="M8 44h48M10 40h44"/>',
  // Waves under a cloud.
  disaster:
    '<path d="M18 22a8 8 0 0 1 15-4 7 7 0 0 1 13 5 6 6 0 0 1-2 12H20a7 7 0 0 1-2-13z"/>' +
    '<path d="M8 44c4-3 8-3 12 0s8 3 12 0 8-3 12 0 8 3 12 0"/>',
  // A shield with a line across: an incident at the border.
  military:
    '<path d="M32 8l16 6v11c0 10-7 17-16 21-9-4-16-11-16-21V14z"/><path d="M8 30h48" stroke-dasharray="3 3"/>',
  // Two speech bubbles facing each other.
  diplomatic: '<path d="M8 14h22v14H17l-5 5v-5H8z"/><path d="M56 24H34v14h13l5 5v-5h4z"/>',
  // A light bulb with rays.
  technology:
    '<path d="M24 30a10 10 0 1 1 16 0c-2 3-3 5-3 8H27c0-3-1-5-3-8z"/><path d="M27 42h10M28 46h8"/>' +
    '<path d="M32 6v4M16 12l3 3M48 12l-3 3M10 26h4M50 26h4"/>',
};

export interface EventPanelOptions {
  root: HTMLElement;
  def: EventDefinition;
  /** Name of the other country of the event, if any. */
  other?: string;
  gdp: number;
  formatUsd: (value: number) => string;
}

const signed = (v: number, digits = 0): string =>
  `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(digits).replace(/\.0+$/, '')}`;

/** The effects of an answer, in short words. */
export function effectsText(o: EventPanelOptions, e: EventEffects): string {
  const parts: string[] = [];
  if (e.gdp) parts.push(t('event.fx.gdp', { value: signed(e.gdp * 100, 1) }));
  if (e.treasury)
    parts.push(
      t('event.fx.treasury', {
        value: `${e.treasury > 0 ? '+' : '−'}${o.formatUsd(Math.abs(e.treasury * o.gdp))}`,
      }),
    );
  if (e.support) parts.push(t('event.fx.support', { value: signed(e.support) }));
  if (e.inflation) parts.push(t('event.fx.inflation', { value: signed(e.inflation * 100, 1) }));
  if (e.relation)
    parts.push(t('event.fx.relation', { value: signed(e.relation), country: o.other ?? '' }));
  if (e.techPoints) parts.push(t('event.fx.tech', { value: signed(e.techPoints) }));
  if (e.diplomacyPoints) parts.push(t('event.fx.points', { value: signed(e.diplomacyPoints) }));
  return parts.join(' · ');
}

/** Shows the event and resolves with the index of the chosen answer. */
export function eventPanel(o: EventPanelOptions): Promise<number> {
  return new Promise((resolve) => {
    const card = el('section', `event-card event-${o.def.category}`);
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-live', 'polite');
    const art = el('div', 'event-art');
    art.innerHTML =
      '<svg viewBox="0 0 64 52" fill="none" stroke="currentColor" stroke-width="2" ' +
      `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ART[o.def.category]}</svg>`;
    const body = el('div', 'event-body');
    const vars = { country: o.other ?? '' };
    body.append(
      el('div', 'event-kicker', t(`event.cat.${o.def.category}` as TranslationKey)),
      el('h2', 'event-title', t(`event.${o.def.id}.title` as TranslationKey, vars)),
      el('p', 'event-text', t(`event.${o.def.id}.text` as TranslationKey, vars)),
    );
    const answers = el('div', 'event-answers');
    o.def.options.forEach((option, i) => {
      const b = button(`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'} event-answer`, '', () => {
        card.classList.add('event-out');
        window.setTimeout(() => card.remove(), 180);
        resolve(i);
      });
      b.append(
        el('span', 'event-answer-label', t(`event.${o.def.id}.option${i}` as TranslationKey, vars)),
        el('span', 'event-answer-fx', effectsText(o, option.effects)),
      );
      answers.append(b);
    });
    body.append(answers);
    card.append(art, body);
    o.root.append(card);
  });
}
