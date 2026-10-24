import { BitmapFont, BitmapText, Container, Graphics } from 'pixi.js';
import { t, type TranslationKey } from '../i18n';
import type { Camera } from './camera';
import {
  countryAnchors,
  placeLabels,
  type CountryAnchor,
  type LabelCandidate,
  type LabelKind,
} from './labelLayout';
import type { MapData } from './mapData';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const STYLES: Record<
  LabelKind,
  { fill: number; stroke: number; weight: 'normal' | 'bold'; spacing: number }
> = {
  country: { fill: 0xd7e0ea, stroke: 0x0b1522, weight: 'bold', spacing: 2 },
  province: { fill: 0xe8eef5, stroke: 0x0b1522, weight: 'normal', spacing: 0 },
  city: { fill: 0xffffff, stroke: 0x0b1522, weight: 'normal', spacing: 0 },
};
const COUNTRY_SIZES = [12, 14, 17, 21];
const fontName = (kind: LabelKind): string => `ml-label-${kind}`;

/**
 * One bitmap font per label kind, rendered large and scaled down; glyphs outside the basic set
 * (č, ș, ŏ, ...) are added on demand by Pixi.
 */
function installFonts(resolution: number): void {
  for (const kind of Object.keys(STYLES) as LabelKind[]) {
    const style = STYLES[kind];
    BitmapFont.install({
      name: fontName(kind),
      style: {
        fontFamily: FONT,
        fontSize: 24,
        fontWeight: style.weight,
        fill: style.fill,
        stroke: { color: style.stroke, width: 5, join: 'round' },
      },
      resolution,
      chars: [['a', 'z'], ['A', 'Z'], ['0', '9'], " .,'-()"],
    });
  }
}
const MAX_LABELS = 140;

/**
 * Country names when zoomed out, province and city names when zoomed in. Labels live in screen
 * space so they stay crisp and the same size at every zoom.
 */
export class MapLabels {
  readonly container = new Container();
  private readonly dots = new Graphics();
  private readonly textLayer = new Container();
  private readonly cache = new Map<string, BitmapText>();
  private readonly anchors: CountryAnchor[];
  private readonly provincesBySize: number[];
  private readonly citiesByRank: number[];
  /** Provinces named like one of their cities; their name is shown once the cities appear. */
  private readonly namedLikeCity = new Set<number>();

  constructor(
    private readonly data: MapData,
    resolution: number,
  ) {
    installFonts(Math.min(2, resolution));
    this.container.addChild(this.dots, this.textLayer);
    this.anchors = countryAnchors(data.countries, data.provinces, data.map.width).sort(
      (a, b) => b.pixels - a.pixels,
    );
    this.provincesBySize = data.provinces
      .map((p) => p.id)
      .sort((a, b) => data.provinces[b]!.pixels - data.provinces[a]!.pixels);
    for (const c of data.cities) {
      if (!c.generated && c.name === data.provinces[c.provinceId]!.name)
        this.namedLikeCity.add(c.provinceId);
    }
    this.citiesByRank = data.cities
      .map((c) => c.id)
      .sort((a, b) => {
        const ca = data.cities[a]!;
        const cb = data.cities[b]!;
        return (
          Number(cb.isCapital) - Number(ca.isCapital) || cb.population - ca.population || a - b
        );
      });
  }

  /** Drops cached texts (after a language change). */
  reset(): void {
    for (const text of this.cache.values()) text.destroy();
    this.cache.clear();
  }

  update(camera: Camera): void {
    const placed = placeLabels(
      this.candidates(camera),
      (wx, wy) => camera.worldToScreen(wx, wy),
      camera.viewportWidth,
      camera.viewportHeight,
      MAX_LABELS,
    );

    const used = new Set<string>();
    this.dots.clear();
    for (const label of placed) {
      const id = `${label.kind}|${label.key}|${label.fontSize}|${label.text}`;
      used.add(id);
      let text = this.cache.get(id);
      if (!text) {
        const style = STYLES[label.kind];
        text = new BitmapText({
          text: label.text,
          style: {
            fontFamily: fontName(label.kind),
            fontSize: label.fontSize,
            letterSpacing: style.spacing,
          },
        });
        text.anchor.set(0.5);
        this.cache.set(id, text);
        this.textLayer.addChild(text);
      }
      text.visible = true;
      text.alpha = label.kind === 'country' ? 0.85 : 1;
      text.position.set(Math.round(label.sx), Math.round(label.sy));
      if (label.dot) {
        const [dx, dy] = camera.worldToScreen(label.wx, label.wy);
        this.dots
          .circle(dx, dy, label.fontSize > 11 ? 3.5 : 2.5)
          .fill(0xffffff)
          .stroke({ color: 0x0b1522, width: 1.5 });
      }
    }
    for (const [id, text] of this.cache) {
      if (used.has(id)) continue;
      text.visible = false;
    }
    if (this.cache.size > 600) {
      for (const [id, text] of this.cache) {
        if (used.has(id)) continue;
        text.destroy();
        this.cache.delete(id);
      }
    }
  }

  private *candidates(camera: Camera): Generator<LabelCandidate> {
    const s = camera.scale;
    const [x0, y0, x1, y1] = camera.visibleRect();
    const inView = (x: number, y: number): boolean => x >= x0 && x <= x1 && y >= y0 && y <= y1;

    if (s < 0.9) {
      for (const a of this.anchors) {
        const size = Math.sqrt(a.pixels) * s;
        if (size < 34 || !inView(a.wx, a.wy)) continue;
        const country = this.data.countries.find((c) => c.id === a.countryId)!;
        const fontSize = COUNTRY_SIZES[Math.min(COUNTRY_SIZES.length - 1, Math.floor(size / 70))]!;
        yield {
          key: a.countryId,
          text: t(country.nameKey as TranslationKey).toUpperCase(),
          kind: 'country',
          wx: a.wx,
          wy: a.wy,
          fontSize,
          dot: false,
        };
      }
    }

    const cities = this.data.cities;
    if (s >= 0.45) {
      for (const id of this.citiesByRank) {
        const c = cities[id]!;
        if (!c.isCapital) break;
        if (inView(...c.position)) yield cityLabel(c.id, c.name, c.position, 12);
      }
    }
    if (s >= 0.3) {
      for (const id of this.provincesBySize) {
        const p = this.data.provinces[id]!;
        if (Math.sqrt(p.pixels) * s < 55) break;
        if (s >= 0.7 && this.namedLikeCity.has(p.id)) continue;
        if (inView(...p.centroid)) {
          yield {
            key: String(p.id),
            text: p.name,
            kind: 'province',
            wx: p.centroid[0],
            wy: p.centroid[1],
            fontSize: 12,
            dot: false,
          };
        }
      }
    }
    if (s >= 0.7) {
      for (const id of this.citiesByRank) {
        const c = cities[id]!;
        if (c.isCapital || (c.generated && s < 2)) continue;
        if (inView(...c.position)) yield cityLabel(c.id, c.name, c.position, 11);
      }
    }
  }
}

function cityLabel(
  id: number,
  name: string,
  [wx, wy]: [number, number],
  fontSize: number,
): LabelCandidate {
  return { key: String(id), text: name, kind: 'city', wx, wy, fontSize, dot: true };
}
