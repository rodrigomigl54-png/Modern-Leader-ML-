import { t, type TranslationKey } from '../i18n';
import type { GameState } from '../sim/newGame';
import { enemiesAtWar } from '../sim/world';
import { button, el } from './dom';

// Interactive lessons (master plan, phase 4): a short instruction, the control to use lit up,
// and the game checks that the player did it before the next step. Lessons run in a practice
// game that is never saved, so they never touch the player's campaign. Steps read the real game
// state and the real interface: no fake buttons.

export const LESSONS = [
  'basics',
  'economy',
  'construction',
  'technology',
  'recruitment',
  'movement',
  'war',
  'peace',
  'diplomacy',
  'objectives',
] as const;
export type LessonId = (typeof LESSONS)[number];

export interface CoachContext {
  game: GameState;
  /** The game when the lesson started. */
  start: GameState;
  /** A visible element matching the selector, if any. */
  visible: (selector: string) => HTMLElement | null;
}

export interface LessonStep {
  /** Controls to light up, the first visible one wins. */
  targets?: string[];
  done: (c: CoachContext) => boolean;
}

const me = (g: GameState): string => g.player.countryId;
const myBuildings = (g: GameState): number =>
  g.economy.buildings.filter((b) => b.owner === me(g)).length;
const myTraining = (g: GameState): number =>
  g.military.training.filter((x) => x.owner === me(g)).reduce((s, x) => s + x.count, 0);
const spentTech = (g: GameState): number =>
  Object.values(g.economy.countries[me(g)]?.tech?.spent ?? {}).reduce((s, v) => s + (v ?? 0), 0);
const atWar = (g: GameState): number => enemiesAtWar(g.world, me(g)).length;
const armiesMoving = (g: GameState): boolean =>
  g.military.armies.some((a) => a.owner === me(g) && a.path.length > 0);

const openFinance: LessonStep = {
  targets: ['.hud-finance'],
  done: (c) => !!c.visible('.dossier.economy'),
};

/** The steps of every lesson; their texts are lesson.<id>.<n> (and lesson.<id>.title). */
export const LESSON_STEPS: Record<LessonId, LessonStep[]> = {
  basics: [
    openFinance,
    { targets: ['.dossier.economy .dossier-close'], done: (c) => !c.visible('.dossier.economy') },
    { targets: ['.hud-support'], done: (c) => !!c.visible('.dossier.interior') },
    { targets: ['.next-turn'], done: (c) => c.game.turn > c.start.turn },
  ],
  economy: [
    openFinance,
    {
      targets: ['.dossier.economy label.slider input[type=range]'],
      done: (c) => {
        const now = c.game.economy.countries[me(c.game)]!;
        const was = c.start.economy.countries[me(c.start)]!;
        return (
          now.taxRate !== was.taxRate ||
          now.servicesShare !== was.servicesShare ||
          now.research !== was.research
        );
      },
    },
    { targets: ['.next-turn'], done: (c) => c.game.turn > c.start.turn },
  ],
  construction: [
    { done: (c) => !!c.visible('.city-list .select-toggle') },
    {
      targets: ['.city-list .select-toggle:not(.select-toggle-on)'],
      done: (c) => !!c.visible('.selection-bar .btn-primary'),
    },
    { targets: ['.selection-bar .btn-primary'], done: (c) => !!c.visible('.modal .option-list') },
    {
      targets: ['.modal-actions .btn-primary:not([disabled])', '.modal .option'],
      done: (c) => myBuildings(c.game) > myBuildings(c.start),
    },
  ],
  technology: [
    { targets: ['.hud-tech'], done: (c) => !!c.visible('.tech-row') },
    {
      targets: ['.tech-row button:not([disabled])'],
      done: (c) => spentTech(c.game) > spentTech(c.start),
    },
  ],
  recruitment: [
    {
      targets: ['.city-list .select-toggle:not(.select-toggle-on)'],
      done: (c) => !!c.visible('.selection-bar .btn-primary'),
    },
    {
      targets: ['.selection-bar .btn-primary + .btn-primary'],
      done: (c) => !!c.visible('.modal .amount-slider'),
    },
    {
      targets: ['.modal-actions .btn-primary'],
      done: (c) => myTraining(c.game) > myTraining(c.start),
    },
  ],
  movement: [
    {
      targets: ['.move-here', '.army-list .select-toggle:not(.select-toggle-on)'],
      done: (c) => armiesMoving(c.game),
    },
    { targets: ['.next-turn'], done: (c) => c.game.turn > c.start.turn },
  ],
  war: [
    { done: (c) => !!c.visible('.country-dialog') },
    {
      targets: ['.country-dialog .btn-danger'],
      done: (c) => atWar(c.game) > atWar(c.start),
    },
  ],
  peace: [
    { done: (c) => atWar(c.game) > 0 },
    { done: (c) => !!c.visible('.country-dialog') },
    {
      targets: ['.country-dialog .btn-primary.dip-action'],
      done: (c) => !!c.visible('.peace-remaining'),
    },
  ],
  diplomacy: [
    {
      targets: ['.hud-dipl'],
      // Opening a country from the map is fine too.
      done: (c) => !!(c.visible('.dossier.foreign') || c.visible('.country-dialog')),
    },
    { done: (c) => !!c.visible('.country-dialog') },
    {
      targets: ['.country-dialog .dip-icon-improve'],
      done: (c) =>
        (c.game.diplomacy.points[me(c.game)] ?? 0) <
        (c.start.diplomacy.points[me(c.start)] ?? 0) - 0.5,
    },
  ],
  objectives: [
    { targets: ['.hud-menu:not(.hud-ranks)'], done: (c) => !!c.visible('.game-menu') },
    {
      targets: ['.menu-list .btn:nth-child(2)'],
      done: (c) => !!c.visible('.dossier.goals'),
    },
    {
      targets: ['.menu-list .btn:nth-child(3)', '.hud-menu:not(.hud-ranks)'],
      done: (c) => !!c.visible('.dossier.history'),
    },
  ],
};

const DONE_KEY = 'ml.academy.lessons';

export function lessonsDone(): Set<LessonId> {
  try {
    const saved = JSON.parse(localStorage.getItem(DONE_KEY) ?? '[]') as unknown;
    if (Array.isArray(saved))
      return new Set(saved.filter((x) => (LESSONS as readonly unknown[]).includes(x)));
  } catch {
    // Storage blocked: nothing finished yet.
  }
  return new Set();
}

function markLesson(id: LessonId): void {
  const done = lessonsDone();
  done.add(id);
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    // Ignore: the lesson still counts for this visit.
  }
}

function visibleElement(selector: string): HTMLElement | null {
  for (const node of document.querySelectorAll<HTMLElement>(selector)) {
    if (node.closest('[hidden]')) continue;
    if (node.getClientRects().length === 0) continue;
    return node;
  }
  return null;
}

export interface CoachOptions {
  parent: HTMLElement;
  game: () => GameState | null;
  /** Leaves the practice game (back to the Academy). */
  onExit: () => void;
  /** Starts the next lesson in the same practice game. */
  onNext: (id: LessonId) => void;
}

/** The floating coach that runs one lesson. */
export class Coach {
  private readonly root = el('aside', 'coach');
  private lesson: LessonId | null = null;
  private step = 0;
  private start: GameState | null = null;
  private timer = 0;
  private lit: HTMLElement | null = null;
  private collapsed = false;
  private finished = false;

  constructor(private readonly options: CoachOptions) {
    this.root.hidden = true;
    this.root.setAttribute('aria-live', 'polite');
    options.parent.append(this.root);
  }

  get active(): boolean {
    return this.lesson !== null;
  }

  begin(id: LessonId): void {
    this.lesson = id;
    this.step = 0;
    this.finished = false;
    this.collapsed = false;
    this.start = this.options.game();
    this.root.hidden = false;
    this.render();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 400);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.light(null);
    this.lesson = null;
    this.root.hidden = true;
  }

  private light(node: HTMLElement | null): void {
    if (this.lit === node) return;
    this.lit?.classList.remove('coach-target');
    this.lit = node;
    node?.classList.add('coach-target');
  }

  private tick(): void {
    const game = this.options.game();
    if (!this.lesson || !game || !this.start || this.finished) return;
    const steps = LESSON_STEPS[this.lesson];
    const step = steps[this.step];
    if (!step) return;
    const ctx: CoachContext = { game, start: this.start, visible: visibleElement };
    if (step.done(ctx)) {
      this.next();
      return;
    }
    let target: HTMLElement | null = null;
    for (const s of step.targets ?? []) {
      target = visibleElement(s);
      if (target) break;
    }
    this.light(this.collapsed ? null : target);
  }

  private next(): void {
    if (!this.lesson) return;
    this.light(null);
    this.step++;
    // Later steps compare with the game as it is now (e.g. one more Next Turn).
    this.start = this.options.game() ?? this.start;
    if (this.step >= LESSON_STEPS[this.lesson].length) {
      this.finished = true;
      markLesson(this.lesson);
    }
    this.render();
  }

  private render(): void {
    const id = this.lesson;
    if (!id) return;
    const steps = LESSON_STEPS[id];
    const head = el('div', 'coach-head');
    head.append(
      el(
        'span',
        'coach-kicker',
        t('lesson.kicker', { n: Math.min(this.step + 1, steps.length), total: steps.length }),
      ),
      el('strong', 'coach-title', t(`lesson.${id}.title` as TranslationKey)),
    );
    const toggle = button('coach-toggle', this.collapsed ? '▸' : '▾', () => {
      this.collapsed = !this.collapsed;
      this.render();
    });
    toggle.setAttribute('aria-label', t(this.collapsed ? 'lesson.resume' : 'lesson.pause'));
    head.append(toggle);
    const children: HTMLElement[] = [head];
    if (!this.collapsed) {
      if (this.finished) {
        children.push(el('p', 'coach-text coach-done', t('lesson.finished')));
        const actions = el('div', 'coach-actions');
        const next = LESSONS[LESSONS.indexOf(id) + 1];
        if (next)
          actions.append(
            button('btn btn-primary btn-small', t('lesson.nextLesson'), () =>
              this.options.onNext(next),
            ),
          );
        actions.append(
          button('btn btn-secondary btn-small', t('lesson.exit'), () => this.options.onExit()),
        );
        children.push(actions);
      } else {
        const dots = el('div', 'coach-dots');
        steps.forEach((_, i) =>
          dots.append(
            el('span', `coach-dot${i < this.step ? ' on' : i === this.step ? ' now' : ''}`),
          ),
        );
        children.push(
          dots,
          el('p', 'coach-text', t(`lesson.${id}.${this.step + 1}` as TranslationKey)),
        );
        const actions = el('div', 'coach-actions');
        actions.append(
          button('btn btn-secondary btn-small', t('lesson.skipStep'), () => this.next()),
          button('btn btn-secondary btn-small', t('lesson.exit'), () => this.options.onExit()),
        );
        children.push(actions);
      }
    }
    this.root.classList.toggle('coach-collapsed', this.collapsed);
    this.root.replaceChildren(...children);
  }
}
