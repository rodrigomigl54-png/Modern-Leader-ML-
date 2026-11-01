import { t, type TranslationKey } from '../i18n';
import { formatPercent, formatUsd } from '../app/present';
import type { Command } from '../sim/commands';
import type { SimContext } from '../sim/economy';
import type { GameState } from '../sim/newGame';
import { levelCostUsd, TECH_CATEGORIES, techIndex, type TechCategory } from '../sim/technology';
import { button, el } from './dom';

export interface TechPanelOptions {
  parent: HTMLElement;
  sim: SimContext;
  issue: (command: Command) => void;
}

/** One line drawing per bonus, in the style of the diplomacy icons. */
const ICONS: Record<TechCategory, string> = {
  gdpGrowth: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  taxes: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
  militaryUpkeep: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12h6"/>',
  investmentCost: '<path d="M4 20V10l5-4v14M9 20V8l6 4v8M15 20v-6l5 2v4M2 20h20"/>',
  research: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
  stability:
    '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.5 3-6 6-6s6 2.5 6 6M14 20c0-2.5 1.5-4.5 4-4.5s3.5 2 3.5 4.5"/>',
  administration: '<path d="M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2 10h20L12 3z"/>',
};

/**
 * Technology (Dario, Phase 26): the level, progress toward the next one and the points to
 * assign to lasting bonuses, each with its effect so far and its limit.
 */
export class TechPanel {
  private readonly backdrop = el('div', 'modal-backdrop');
  private game: GameState | null = null;

  constructor(private readonly options: TechPanelOptions) {
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    options.parent.append(this.backdrop);
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  open(game: GameState): void {
    this.game = game;
    this.render();
    this.backdrop.hidden = false;
  }

  update(game: GameState): void {
    this.game = game;
    if (this.isOpen) this.render();
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  /** What a bonus does now, in words. */
  private effect(category: TechCategory, points: number, perPoint: number): string {
    const v = points * perPoint;
    switch (category) {
      case 'gdpGrowth':
        return t('tech.effect.gdpGrowth', { value: formatPercent(v, 2) });
      case 'stability':
        return t('tech.effect.stability', { value: v.toFixed(1) });
      default:
        return t(`tech.effect.${category}` as TranslationKey, { value: formatPercent(v, 0) });
    }
  }

  private render(): void {
    const game = this.game!;
    const rules = this.options.sim.economy.technology;
    const id = game.player.countryId;
    const e = game.economy.countries[id];
    const tech = e?.tech;
    const dialog = el('div', 'modal modal-wide tech');
    dialog.setAttribute('role', 'dialog');
    if (!rules || !tech || !e) {
      this.backdrop.replaceChildren(dialog);
      return;
    }
    const cost = levelCostUsd(rules, tech, e.gdp);
    const share = Math.min(1, tech.progress / Math.max(1, cost));
    const head = el('div', 'tech-head');
    const level = el('div', 'tech-level');
    level.append(
      el('span', 'tech-level-label', t('tech.level')),
      el('span', 'tech-level-value mono', techIndex(rules, tech).toFixed(2)),
    );
    const points = el('div', `tech-points${tech.points > 0 ? ' tech-points-on' : ''}`);
    points.append(
      el('span', 'tech-points-value mono', String(tech.points)),
      el('span', '', t('tech.points')),
    );
    head.append(level, points);
    const bar = el('div', 'tech-bar');
    const fill = el('div', 'tech-fill');
    fill.style.width = `${Math.round(share * 100)}%`;
    bar.append(fill);
    const weeks =
      e.research && e.research > 0
        ? Math.ceil((cost - tech.progress) / ((e.gdp * e.research) / 52))
        : null;
    const list = el('ul', 'tech-list');
    for (const category of TECH_CATEGORIES) {
      const c = rules.categories[category];
      const have = tech.spent[category] ?? 0;
      const item = el('li', 'tech-row');
      const icon = el('span', 'tech-icon');
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
        `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICONS[category]}</svg>`;
      const text = el('span', 'tech-text');
      text.append(
        el('span', 'tech-name', t(`tech.cat.${category}` as TranslationKey)),
        el('span', 'tech-effect', this.effect(category, have, c.perPoint)),
      );
      const meter = el('span', 'tech-meter');
      const meterFill = el('span', 'tech-meter-fill');
      meterFill.style.width = `${(have / c.max) * 100}%`;
      meter.append(meterFill);
      const count = el('span', 'tech-count mono', `${have}/${c.max}`);
      const plus = button('btn btn-primary tech-plus', '+', () =>
        this.options.issue({ type: 'assignTech', countryId: id, category }),
      );
      plus.disabled = tech.points < 1 || have >= c.max;
      plus.setAttribute(
        'aria-label',
        t('tech.assign', { name: t(`tech.cat.${category}` as TranslationKey) }),
      );
      item.append(icon, text, meter, count, plus);
      list.append(item);
    }
    const actions = el('div', 'modal-actions');
    actions.append(button('btn btn-secondary', t('panel.close'), () => this.close()));
    dialog.append(
      el('h2', 'modal-title', t('tech.title')),
      head,
      bar,
      el(
        'p',
        'setup-hint',
        weeks !== null
          ? t('tech.next', { cost: formatUsd(cost - tech.progress), weeks })
          : t('tech.noResearch'),
      ),
      list,
      actions,
    );
    this.backdrop.replaceChildren(dialog);
  }
}
