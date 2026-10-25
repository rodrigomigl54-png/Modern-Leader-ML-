import { formatPercent, formatUsd } from '../app/present';
import { t } from '../i18n';
import type { ReportData } from '../sim/chronicle';
import { button, el } from './dom';

const signed = (value: number, text: string): string => (value > 0 ? `+${text}` : text);

/** The general report every 10 turns (GDD section 12). */
export function reportDialog(
  root: HTMLElement,
  report: ReportData,
  countryName: (id: string) => string,
): Promise<void> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const dialog = el('div', 'modal modal-wide modal-telegram');
    dialog.setAttribute('role', 'dialog');
    const facts = el('dl', 'dossier-facts report-facts');
    const fact = (label: string, value: string, cls = 'mono'): void => {
      facts.append(el('dt', '', label), el('dd', cls, value));
    };
    const growth = report.gdpBefore > 0 ? report.gdp / report.gdpBefore - 1 : 0;
    fact(t('econ.gdp'), `${formatUsd(report.gdp)} (${signed(growth, formatPercent(growth, 2))}%)`);
    fact(t('econ.treasury'), formatUsd(report.treasury));
    fact(
      t('report.balance'),
      signed(report.balance, formatUsd(report.balance)),
      report.balance < 0 ? 'mono danger' : 'mono',
    );
    fact(t('econ.debt'), formatUsd(report.debt));
    const supportDelta = report.support - report.supportBefore;
    fact(
      t('interior.supportShort'),
      `${report.support.toFixed(0)}% (${signed(supportDelta, supportDelta.toFixed(1))})`,
      supportDelta < 0 ? 'mono danger' : 'mono',
    );
    fact(
      t('report.wars'),
      t('report.warsValue', { started: report.warsStarted, ended: report.warsEnded }),
    );
    fact(t('report.sanctions'), String(report.sanctions));
    fact(t('report.alliances'), String(report.alliances));
    const changes = el('ul', 'report-changes');
    for (const c of report.relationChanges) {
      const delta = c.after - c.before;
      changes.append(
        el(
          'li',
          delta < 0 ? 'danger' : 'good',
          t('report.relation', {
            country: countryName(c.id),
            before: c.before.toFixed(0),
            after: c.after.toFixed(0),
          }),
        ),
      );
    }
    if (!report.relationChanges.length) changes.append(el('li', '', t('report.noRelationChanges')));
    const actions = el('div', 'modal-actions');
    actions.append(
      button('btn btn-primary', t('minister.understood'), () => {
        backdrop.remove();
        resolve();
      }),
    );
    dialog.append(
      el('div', 'telegram-from mono', t('report.from', { weeks: report.turn - report.sinceTurn })),
      el('h2', 'modal-title', t('report.title')),
      facts,
      el('h3', 'report-subtitle', t('report.relations')),
      changes,
      actions,
    );
    backdrop.append(dialog);
    root.append(backdrop);
  });
}
