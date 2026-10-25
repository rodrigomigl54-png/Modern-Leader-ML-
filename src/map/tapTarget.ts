// Enlarged tap targets for provinces too small for a finger (GDD section 13: phones first).
import type { Camera } from './camera';
import type { ProvinceData } from './mapData';

/** Screen size (CSS px) below which a province gets an enlarged tap target. */
const SMALL_TAP_PX = 14;
/** How far from its center a small province still takes the tap (CSS px). */
const TAP_RADIUS_PX = 22;

/** The nearest province that is too small to tap at this zoom, within reach of the tap. */
export function smallProvinceNear(
  provinces: readonly ProvinceData[],
  camera: Camera,
  sx: number,
  sy: number,
): number | null {
  const s = camera.scale;
  // Side of a province's square of pixels on screen.
  const maxPixels = (SMALL_TAP_PX / s) ** 2;
  const [wx, wy] = camera.screenToWorld(sx, sy);
  const reach = TAP_RADIUS_PX / s;
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const p of provinces) {
    if (p.pixels > maxPixels) continue;
    const dx = p.centroid[0] - wx;
    const dy = p.centroid[1] - wy;
    if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
    const d = dx * dx + dy * dy;
    if (d <= reach * reach && d < bestDistance) {
      best = p.id;
      bestDistance = d;
    }
  }
  return best;
}
