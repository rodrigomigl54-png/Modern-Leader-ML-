import { t, type TranslationKey } from '../i18n';
import type { SimContext } from '../sim/economy';
import { button, el } from './dom';

// The Academy (Dario's request): a tutorial reachable from the main menu at any time, one
// chapter per system of the game. Every number in the text comes from the game data through
// academyVars, so the lessons always match the rules. Small "?" buttons in the ministries
// open the matching chapter. Read chapters are remembered in this browser (localStorage).

export const ACADEMY_CHAPTERS = [
  'start',
  'economy',
  'taxes',
  'population',
  'construction',
  'military',
  'warfare',
  'diplomacy',
  'politics',
  'advanced',
  'winning',
] as const;
export type AcademyChapter = (typeof ACADEMY_CHAPTERS)[number];

/** Sections per chapter: text keys academy.<chapter>.<n>.title and academy.<chapter>.<n>.body. */
export const ACADEMY_SECTIONS: Record<AcademyChapter, number> = {
  start: 5,
  economy: 6,
  taxes: 4,
  population: 4,
  construction: 5,
  military: 6,
  warfare: 6,
  diplomacy: 7,
  politics: 5,
  advanced: 4,
  winning: 4,
};

const STORAGE_KEY = 'ml.academy';

function readDone(): Set<AcademyChapter> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (Array.isArray(saved))
      return new Set(saved.filter((c) => (ACADEMY_CHAPTERS as readonly unknown[]).includes(c)));
  } catch {
    // Storage blocked or damaged: start with nothing read.
  }
  return new Set();
}

function writeDone(done: Set<AcademyChapter>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...done]));
  } catch {
    // Ignore: progress still shows for this visit.
  }
}

const pct = (x: number, digits = 0): string =>
  (x * 100)
    .toFixed(digits)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
const usdM = (x: number): string => `$${Math.round(x / 1e6)} m`;

/** The numbers the lessons quote, read from the game data. */
export function academyVars(sim: SimContext): Record<string, string | number> {
  const e = sim.economy;
  const vars: Record<string, string | number> = {
    taxMin: pct(e.limits.taxRateMin),
    taxMax: pct(e.limits.taxRateMax),
    servicesMin: pct(e.limits.servicesShareMin),
    servicesMax: pct(e.limits.servicesShareMax),
    startTax: pct(e.start.taxRate),
    baseGrowth: pct(e.growth.base),
    taxThreshold: pct(e.growth.taxThreshold),
    servicesNeutral: pct(e.growth.servicesNeutral),
    inflationThreshold: pct(e.growth.inflationThreshold),
    debtThreshold: pct(e.growth.debtThreshold),
    minGrowth: pct(e.growth.minGrowth),
    maxGrowth: pct(e.growth.maxGrowth),
    interestRate: pct(e.debt.interestRate),
    inflationBase: pct(e.inflation.base),
    deficitThreshold: pct(e.inflation.deficitThreshold),
    spendingThreshold: pct(e.inflation.spendingThreshold),
    inflationAlert: pct(e.inflation.alertThreshold),
    printShare: pct(e.printing.shareOfGdp),
    maxPerCity: e.investment.maxPerCity ?? 1,
    levelCostGrowth: pct(e.investment.levelCostGrowth ?? 0),
    foreignReturn: pct(e.investment.foreignReturnShare, 1),
    researchMax: pct(e.technology?.maxResearch ?? 0),
    researchStart: pct(e.technology?.startResearch ?? 0, 1),
    pointsPerLevel: e.technology?.pointsPerLevel ?? 0,
  };
  for (const c of e.investment.categories) {
    vars[`cost_${c.id}`] = usdM(c.costUsd);
    vars[`weeks_${c.id}`] = c.buildTurns;
    vars[`gdp_${c.id}`] = pct(c.gdpPerYearShare);
  }
  const p = sim.population;
  if (p) {
    Object.assign(vars, {
      supportStart: p.support.start,
      riotThreshold: p.riots.threshold,
      riotEnd: p.riots.endThreshold,
      riotPenalty: pct(p.riots.productionPenalty),
      nationalThreshold: p.revolution.nationalThreshold,
      minRiotTurns: p.revolution.minRiotTurns,
      riotPopShare: pct(p.revolution.minRiotPopulationShare),
      calmTurns: p.revolution.calmTurns,
      secessionTurns: p.revolution.secessionTurns,
      crushedGdpLoss: pct(p.revolution.crushedGdpLoss),
      assimilationTurns: p.assimilation.turns,
      assimilationPerPerson: `$${p.assimilation.costPerPersonUsd}`,
      assimilationMin: usdM(p.assimilation.minCostUsd),
      unassimilatedPenalty: pct(p.assimilation.unassimilatedProductionPenalty),
      buildingSupport: p.support.buildingEffect,
      buildingSupportMax: p.support.buildingEffectMax,
      defenderRally: p.support.war?.defenderRally ?? 0,
    });
  }
  const m = sim.military;
  if (m) {
    Object.assign(vars, {
      regularTrain: m.recruitment.regularTrainTurns,
      specialTrain: m.recruitment.specialTrainTurns,
      regularCostWeeks: m.recruitment.regularCostWeeks,
      specialCostWeeks: m.recruitment.specialCostWeeks,
      specialMinBase: m.recruitment.specialMinBase,
      caps: m.recruitment.capPerTurnByBase.join(' / '),
      manpowerShare: pct(m.recruitment.manpowerShare),
      manpowerService: pct(m.recruitment.manpowerShareWithService),
      specialStrength: m.units.specialStrength,
      traineeStrength: m.units.traineeStrength,
      specialUpkeep: m.upkeep.specialMultiplier,
      reservistUpkeep: pct(m.upkeep.reservistShare),
      serviceSupport: m.reserves.introduceSupportPenalty,
      maxBase: m.bases.maxLevel,
      baseDefense: pct(m.bases.defenseBonusPerLevel),
      defenderBonus: pct(m.combat.defenderBonus),
      supplied: pct(m.combat.supplyInEnemyLand),
      cutOff: pct(m.combat.supplyCutOff),
      randomness: pct(m.combat.randomness),
      routRatio: pct(m.combat.routRatio),
      kmPerTurn: m.naval.kmPerTurn,
      transportPerPort: m.naval.transportPerPort,
    });
  }
  const d = sim.diplomacy;
  if (d) {
    const c = d.costs;
    Object.assign(vars, {
      costUltimatum: c.ultimatum,
      costSanction: c.sanction,
      costAlliance: c.alliance,
      costBase: c.base,
      costVassal: c.vassal,
      costAid: c.aid,
      costImprove: c.improve,
      costInsult: c.insult,
      costAccess: c.access ?? 0,
      costDeal: c.deal ?? 0,
      pointsCap: d.points.capTurns,
      ultimatumDeadline: d.ultimatum.deadlineTurns,
      improveTurns: d.improve?.turns ?? 0,
      improvePerTurn: d.improve?.perTurn ?? 0,
      improveMax: d.improve?.maxActive ?? 0,
      credibilityStart: d.credibility.start,
      pactMinRelation: d.alliance.pactMinRelation,
      nonAggressionYears: Math.round((d.deals?.nonAggressionTurns ?? 0) / 52),
      vassalTribute: pct(d.vassal.tributeShare),
      maxReparations: pct(d.peace.maxReparationsShare),
    });
  }
  const w = sim.weapons;
  if (w) {
    Object.assign(vars, {
      adWeeks: w.airDefense.levels.map((l) => l.buildTurns).join(' / '),
      adIntercept: w.airDefense.levels.map((l) => pct(l.intercept)).join(' / '),
      nuclearYears: Math.round(w.nuclear.programTurns / 52),
      nuclearCost: `$${Math.round(w.nuclear.programCostUsd / 1e9)} bn`,
    });
  }
  return vars;
}

// ---- Contextual help ----

let helpHandler: ((chapter: AcademyChapter) => void) | null = null;

/** Where the "?" buttons send the player (set once the Academy exists). */
export function setAcademyHelp(handler: (chapter: AcademyChapter) => void): void {
  helpHandler = handler;
}

/** A small "?" button that opens one Academy chapter. */
export function helpButton(chapter: AcademyChapter): HTMLButtonElement {
  const b = button('help-btn', '?', () => helpHandler?.(chapter));
  // Do not let the tap reach the panel behind (some close on outside taps).
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  b.setAttribute('aria-label', t('academy.help', { chapter: t(chapterTitle(chapter)) }));
  b.title = t('academy.help', { chapter: t(chapterTitle(chapter)) });
  return b;
}

/** A dialog title with a "?" button beside it. */
export function titleWithHelp(text: string, chapter: AcademyChapter): HTMLElement {
  const row = el('div', 'title-help');
  row.append(el('h2', 'modal-title', text), helpButton(chapter));
  return row;
}

const chapterTitle = (c: AcademyChapter): TranslationKey => `academy.${c}.title` as TranslationKey;

export interface AcademyOptions {
  parent: HTMLElement;
  sim: SimContext;
}

/** The Academy: chapter list, chapter pages with Previous / Next, and reading progress. */
export class Academy {
  private readonly backdrop = el('div', 'modal-backdrop academy-backdrop');
  private chapter: AcademyChapter | null = null;
  private done = readDone();
  private vars: Record<string, string | number>;

  constructor(options: AcademyOptions) {
    this.vars = academyVars(options.sim);
    this.backdrop.hidden = true;
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) this.close();
    });
    options.parent.append(this.backdrop);
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  /** Opens the chapter list, or one chapter. */
  open(chapter: AcademyChapter | null = null): void {
    this.chapter = chapter;
    // Above any panel or dialog that asked for help.
    this.backdrop.parentElement?.append(this.backdrop);
    this.render();
    this.backdrop.hidden = false;
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  private go(chapter: AcademyChapter | null): void {
    this.chapter = chapter;
    this.render();
    this.backdrop.scrollTop = 0;
  }

  private markDone(chapter: AcademyChapter): void {
    this.done.add(chapter);
    writeDone(this.done);
  }

  private render(): void {
    const dialog = el('div', 'modal modal-wide academy');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', t('academy.title'));
    if (this.chapter) this.renderChapter(dialog, this.chapter);
    else this.renderIndex(dialog);
    this.backdrop.replaceChildren(dialog);
  }

  private progress(): HTMLElement {
    const count = ACADEMY_CHAPTERS.filter((c) => this.done.has(c)).length;
    const box = el('div', 'academy-progress');
    const bar = el('span', 'academy-progress-bar');
    const fill = el('span', 'academy-progress-fill');
    fill.style.width = `${(count / ACADEMY_CHAPTERS.length) * 100}%`;
    bar.append(fill);
    box.append(
      el(
        'span',
        'academy-progress-text',
        t('academy.progress', { done: count, total: ACADEMY_CHAPTERS.length }),
      ),
      bar,
    );
    return box;
  }

  private renderIndex(dialog: HTMLElement): void {
    dialog.append(
      el('p', 'academy-kicker', t('academy.kicker')),
      el('h2', 'modal-title', t('academy.title')),
      el('p', 'setup-hint', t('academy.intro')),
      this.progress(),
    );
    const list = el('ol', 'academy-chapters');
    ACADEMY_CHAPTERS.forEach((c, i) => {
      const read = this.done.has(c);
      const item = el('li');
      const b = button(`academy-chapter${read ? ' academy-chapter-done' : ''}`, '', () =>
        this.go(c),
      );
      b.append(
        el('span', 'academy-chapter-num mono', String(i + 1)),
        el('span', 'academy-chapter-name', t(chapterTitle(c))),
        el('span', 'academy-chapter-state', read ? '✓' : ''),
      );
      if (read) b.setAttribute('aria-label', `${t(chapterTitle(c))} · ${t('academy.read')}`);
      item.append(b);
      list.append(item);
    });
    dialog.append(list);
    const footer = el('div', 'modal-footer');
    const actions = el('div', 'modal-actions');
    const first = ACADEMY_CHAPTERS.find((c) => !this.done.has(c)) ?? ACADEMY_CHAPTERS[0];
    actions.append(
      button('btn btn-secondary', t('academy.back'), () => this.close()),
      button('btn btn-primary', this.done.size ? t('academy.continue') : t('academy.start'), () =>
        this.go(first),
      ),
    );
    footer.append(actions);
    dialog.append(footer);
  }

  private renderChapter(dialog: HTMLElement, chapter: AcademyChapter): void {
    const index = ACADEMY_CHAPTERS.indexOf(chapter);
    const head = el('div', 'title-help');
    const close = button('dossier-close', '×', () => this.close());
    close.setAttribute('aria-label', t('academy.back'));
    head.append(el('h2', 'modal-title', t(chapterTitle(chapter))), close);
    dialog.append(
      el(
        'p',
        'academy-kicker',
        t('academy.chapterOf', { n: index + 1, total: ACADEMY_CHAPTERS.length }),
      ),
      head,
    );
    for (let s = 1; s <= ACADEMY_SECTIONS[chapter]; s++) {
      const section = el('section', 'academy-section');
      section.append(
        el(
          'h3',
          'academy-section-title',
          t(`academy.${chapter}.${s}.title` as TranslationKey, this.vars),
        ),
      );
      section.append(...paragraphs(t(`academy.${chapter}.${s}.body` as TranslationKey, this.vars)));
      dialog.append(section);
    }
    const footer = el('div', 'modal-footer');
    const nav = el('div', 'modal-actions academy-nav');
    const prev = button('btn btn-secondary', `‹ ${t('academy.previous')}`, () =>
      this.go(ACADEMY_CHAPTERS[index - 1]!),
    );
    prev.disabled = index === 0;
    const last = index === ACADEMY_CHAPTERS.length - 1;
    const next = button(
      'btn btn-primary',
      last ? t('academy.finish') : `${t('academy.next')} ›`,
      () => {
        this.markDone(chapter);
        this.go(last ? null : ACADEMY_CHAPTERS[index + 1]!);
      },
    );
    const skip = button('btn btn-secondary', t('academy.skip'), () =>
      this.go(last ? null : ACADEMY_CHAPTERS[index + 1]!),
    );
    // One row, so the text keeps most of a phone screen; Close is the × at the top.
    nav.append(
      prev,
      button('btn btn-secondary', t('academy.chapters'), () => this.go(null)),
      skip,
      next,
    );
    footer.append(nav);
    dialog.append(footer);
  }
}

/** Splits lesson text into paragraphs and bullet lists ("• " lines); no HTML from the text. */
function paragraphs(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split('\n').filter((l) => l.trim());
    if (lines.length && lines.every((l) => l.startsWith('• '))) {
      const list = el('ul', 'academy-list');
      for (const l of lines) list.append(el('li', '', l.slice(2)));
      out.push(list);
    } else {
      out.push(el('p', 'academy-text', lines.join(' ')));
    }
  }
  return out;
}
