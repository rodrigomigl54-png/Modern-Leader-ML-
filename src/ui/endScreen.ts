import { button, el } from './dom';

export interface EndScreenOptions {
  victory: boolean;
  /** "Victory" or "Defeat" in the player's language. */
  title: string;
  text: string;
  /** Leader, country and how long the game lasted. */
  details: string;
  buttonLabel: string;
}

/** The full-screen end of a game: a victory or a defeat. Resolves when the player leaves. */
export function endScreen(root: HTMLElement, options: EndScreenOptions): Promise<void> {
  return new Promise((resolve) => {
    const screen = el('div', `end-screen ${options.victory ? 'end-victory' : 'end-defeat'}`);
    screen.setAttribute('role', 'alertdialog');
    const card = el('div', 'end-card');
    const title = el('h1', 'end-title', options.title);
    card.append(
      title,
      el('p', 'end-text', options.text),
      el('p', 'end-details', options.details),
      button('btn btn-primary end-button', options.buttonLabel, () => {
        screen.remove();
        resolve();
      }),
    );
    screen.append(card);
    root.append(screen);
  });
}
