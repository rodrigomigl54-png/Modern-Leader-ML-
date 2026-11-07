import { describe, expect, it } from 'vitest';
import diplomacyRules from '../../data/modern/diplomacy-rules.json';
import economyRules from '../../data/modern/economy.json';
import militaryRules from '../../data/modern/military.json';
import populationRules from '../../data/modern/population.json';
import weaponsRules from '../../data/modern/weapons.json';
import en from '../i18n/en.json';
import sr from '../i18n/sr.json';
import type { DiplomacyRules } from '../sim/diplomacy';
import type { EconomyRules, SimContext } from '../sim/economy';
import type { MilitaryRules } from '../sim/military';
import type { PopulationRules } from '../sim/population';
import type { WeaponsRules } from '../sim/weapons';
import { ACADEMY_CHAPTERS, ACADEMY_SECTIONS, academyVars } from './academy';
import { LESSON_STEPS, LESSONS } from './coach';

const sim = {
  economy: economyRules as unknown as EconomyRules,
  population: populationRules as unknown as PopulationRules,
  military: militaryRules as unknown as MilitaryRules,
  diplomacy: diplomacyRules as unknown as DiplomacyRules,
  weapons: weaponsRules as unknown as WeaponsRules,
} as SimContext;

describe('Academy', () => {
  const vars = academyVars(sim);
  const fill = (text: string): string =>
    text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));

  it('has every chapter and section in both languages, with all numbers filled in', () => {
    for (const dict of [en, sr] as Record<string, string>[]) {
      for (const c of ACADEMY_CHAPTERS) {
        expect(dict[`academy.${c}.title`]).toBeTruthy();
        for (let s = 1; s <= ACADEMY_SECTIONS[c]; s++) {
          for (const part of ['title', 'body']) {
            const text = dict[`academy.${c}.${s}.${part}`];
            expect(text, `academy.${c}.${s}.${part}`).toBeTruthy();
            expect(fill(text!), `academy.${c}.${s}.${part}`).not.toMatch(/\{\w+\}/);
          }
        }
        // No section beyond the declared count (it would never be shown).
        expect(dict[`academy.${c}.${ACADEMY_SECTIONS[c] + 1}.title`]).toBeUndefined();
      }
    }
  });

  it('quotes the real rules', () => {
    expect(vars.regularTrain).toBe(militaryRules.recruitment.regularTrainTurns);
    expect(vars.specialTrain).toBe(militaryRules.recruitment.specialTrainTurns);
    const factory = economyRules.investment.categories.find((c) => c.id === 'factory')!;
    expect(vars.weeks_factory).toBe(factory.buildTurns);
    expect(vars.riotThreshold).toBe(populationRules.riots.threshold);
    expect(vars.costUltimatum).toBe(diplomacyRules.costs.ultimatum);
  });

  it('has a title and a text for every step of every lesson in both languages', () => {
    for (const dict of [en, sr] as Record<string, string>[])
      for (const id of LESSONS) {
        expect(dict[`lesson.${id}.title`], id).toBeTruthy();
        LESSON_STEPS[id].forEach((_, i) =>
          expect(dict[`lesson.${id}.${i + 1}`], `${id} ${i + 1}`).toBeTruthy(),
        );
        expect(dict[`lesson.${id}.${LESSON_STEPS[id].length + 1}`]).toBeUndefined();
      }
  });
});
