/** Creates an element with an optional class name and text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export function flagImage(url: string | null, className = 'flag'): HTMLElement {
  if (!url) return el('span', `${className} flag-missing`);
  const img = el('img', className);
  img.src = url;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  return img;
}
