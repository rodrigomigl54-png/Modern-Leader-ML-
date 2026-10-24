import { button, el } from './dom';

/** Asks before a dangerous action (GDD section 13). Resolves true when confirmed. */
export function confirmDialog(
  root: HTMLElement,
  title: string,
  text: string,
  confirmLabel: string,
  cancelLabel: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = el('div', 'modal-backdrop');
    const dialog = el('div', 'modal');
    dialog.setAttribute('role', 'alertdialog');
    const close = (value: boolean): void => {
      backdrop.remove();
      resolve(value);
    };
    const actions = el('div', 'modal-actions');
    actions.append(
      button('btn btn-secondary', cancelLabel, () => close(false)),
      button('btn btn-danger', confirmLabel, () => close(true)),
    );
    dialog.append(el('h2', 'modal-title', title), el('p', 'modal-text', text), actions);
    backdrop.append(dialog);
    root.append(backdrop);
  });
}
