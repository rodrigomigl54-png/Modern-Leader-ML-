// The game's typeface (GDD section 13): Inter, a clean open-license sans-serif (SIL OFL 1.1),
// bundled with the game so it looks the same on every device. Numbers use its tabular figures.
import '@fontsource-variable/inter/wght.css';

export const FONT_FAMILY = '"Inter Variable", system-ui, -apple-system, "Segoe UI", sans-serif';

/** Waits for the font so the map's bitmap labels are drawn with it, not with a fallback. */
export async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all(
      ['400', '600', '700'].map((w) => document.fonts.load(`${w} 24px "Inter Variable"`)),
    );
  } catch {
    // The fallback font still works.
  }
}
