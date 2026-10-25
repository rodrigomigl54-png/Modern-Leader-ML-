import { t } from '../i18n';
import type { AnswerEffect, Summit, SummitQuestion, SummitRules } from '../sim/summits';
import { button, el } from './dom';

export interface SummitTexts {
  title: string;
  question: (q: SummitQuestion) => string;
  answer: (q: SummitQuestion, answer: string) => string;
}

/** Short description of what an answer does, e.g. "Members +5 · Support −3". */
export function effectText(e: AnswerEffect): string {
  const parts: string[] = [];
  const add = (key: Parameters<typeof t>[0], v: number | undefined): void => {
    if (v) parts.push(`${t(key)} ${v > 0 ? '+' : '−'}${Math.abs(v)}`);
  };
  add('summit.fx.members', e.members);
  add('summit.fx.hosts', e.hosts);
  add('summit.fx.target', e.target);
  add('summit.fx.rival', e.rival);
  add('summit.fx.side', e.side);
  add('summit.fx.support', e.support);
  add('summit.fx.credibility', e.credibility);
  if (e.treasuryGdp)
    parts.push(
      `${t('summit.fx.money')} ${e.treasuryGdp > 0 ? '+' : '−'}${Math.abs(e.treasuryGdp * 100)}% ${t('econ.gdp')}`,
    );
  if (e.debtGdp)
    parts.push(
      `${t('summit.fx.debt')} ${e.debtGdp > 0 ? '+' : '−'}${Math.abs(e.debtGdp * 100)}% ${t('econ.gdp')}`,
    );
  if (e.sanction) parts.push(t('summit.fx.sanction'));
  return parts.join(' · ');
}

/** Summit invitation (GDD section 12): answers to every question, or null to skip. */
export function summitDialog(
  root: HTMLElement,
  summit: Summit,
  rules: SummitRules,
  texts: SummitTexts,
): Promise<string[] | null> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const dialog = el('div', 'modal modal-wide modal-telegram summit');
    dialog.setAttribute('role', 'dialog');
    const answers: (string | null)[] = summit.questions.map(() => null);
    const attend = button('btn btn-primary', t('summit.attend'), () => close(answers as string[]));
    attend.disabled = summit.questions.length > 0;
    const close = (value: string[] | null): void => {
      backdrop.remove();
      resolve(value);
    };
    const body = el('div', 'summit-questions');
    summit.questions.forEach((q, i) => {
      const block = el('section', 'summit-question');
      const list = el('div', 'option-list');
      for (const a of q.answers) {
        const option = button('option', '', () => {
          answers[i] = a;
          for (const o of list.children) o.classList.toggle('option-selected', o === option);
          attend.disabled = answers.some((x) => x === null);
        });
        option.append(el('span', 'option-title', texts.answer(q, a)));
        const fx = rules.templates[q.id]?.[a];
        const hint = fx ? effectText(fx) : '';
        if (hint) option.append(el('span', 'option-hint mono', hint));
        list.append(option);
      }
      block.append(el('p', 'summit-q', `${i + 1}. ${texts.question(q)}`), list);
      body.append(block);
    });
    const footer = el('div', 'modal-footer');
    const actions = el('div', 'modal-actions');
    actions.append(
      button('btn btn-secondary', t('summit.skip'), () => close(null)),
      attend,
    );
    footer.append(
      el(
        'p',
        'option-hint',
        t('summit.skipWarning', {
          members: Math.abs(rules.skip.members),
          credibility: Math.abs(rules.skip.credibility),
        }),
      ),
      actions,
    );
    dialog.append(
      el('div', 'telegram-from mono', t('minister.foreign')),
      el('h2', 'modal-title', texts.title),
      el('p', 'option-hint', t('summit.members', { count: summit.members.length })),
      body,
      footer,
    );
    backdrop.append(dialog);
    root.append(backdrop);
  });
}
