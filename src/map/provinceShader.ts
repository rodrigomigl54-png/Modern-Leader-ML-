import { BufferImageSource, Shader, UniformGroup, type TextureSource } from 'pixi.js';
import { PALETTE_HEIGHT, PALETTE_WIDTH, type PaletteData, type RGB } from './palette';

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

// Every pixel of the ID tile is a province color (r, g) that addresses the palette directly, so no
// large integers are computed and the shader works at mediump precision on any phone.
// Borders: a pixel is on a border when a sample a few screen pixels away has another color.
const fragment = /* glsl */ `
in vec2 vUV;
out vec4 finalColor;

uniform sampler2D uIdTex;
uniform sampler2D uPalette;
uniform vec2 uTexel;
uniform float uLevelScale;
uniform float uScreenScale;
uniform float uProvinceAlpha;
uniform float uCountryWidth;
uniform float uProvinceWidth;
uniform vec3 uSelected;
uniform vec3 uUnownedColor;
uniform vec3 uCountryBorderColor;
uniform vec3 uProvinceBorderColor;
uniform vec3 uHighlightColor;

vec3 idAt(vec2 uv) {
  return texture(uIdTex, uv).rgb;
}

vec2 paletteUv(vec3 id, float rowOffset) {
  return vec2((floor(id.r * 255.0 + 0.5) + 0.5) / 256.0,
              (floor(id.g * 255.0 + 0.5) + rowOffset + 0.5) / 512.0);
}

bool isUnowned(vec3 id) { return id.b > 0.5; }
bool isWater(vec3 id) { return id.r + id.g + id.b < 0.002; }
bool same(vec3 a, vec3 b) { return all(lessThan(abs(a - b), vec3(0.002))); }

vec3 ownerOf(vec3 id) {
  if (isUnowned(id)) return vec3(1.0);
  return texture(uPalette, paletteUv(id, 256.0)).rgb;
}

// 0 = no border, 1 = province border, 2 = country border or coast.
float borderKind(vec3 id, vec3 owner, vec3 n) {
  if (same(id, n)) return 0.0;
  return same(owner, ownerOf(n)) ? 1.0 : 2.0;
}

float selectionEdge(bool selected, vec3 n) {
  return selected != same(n, uSelected) ? 1.0 : 0.0;
}

void main() {
  vec3 id = idAt(vUV);
  if (isWater(id)) {
    finalColor = vec4(texture(uPalette, paletteUv(id, 0.0)).rgb, 1.0);
    return;
  }
  vec3 color = isUnowned(id) ? uUnownedColor : texture(uPalette, paletteUv(id, 0.0)).rgb;
  vec3 owner = ownerOf(id);

  float texelsPerPixel = 1.0 / (uScreenScale * uLevelScale);
  vec2 dc = uTexel * texelsPerPixel * uCountryWidth;
  vec2 dp = uTexel * texelsPerPixel * uProvinceWidth;

  vec3 c1 = idAt(vUV + vec2(dc.x, 0.0));
  vec3 c2 = idAt(vUV - vec2(dc.x, 0.0));
  vec3 c3 = idAt(vUV + vec2(0.0, dc.y));
  vec3 c4 = idAt(vUV - vec2(0.0, dc.y));
  float country = max(max(borderKind(id, owner, c1), borderKind(id, owner, c2)),
                      max(borderKind(id, owner, c3), borderKind(id, owner, c4)));

  float province = 0.0;
  if (uProvinceAlpha > 0.01) {
    province = max(max(borderKind(id, owner, idAt(vUV + vec2(dp.x, 0.0))),
                       borderKind(id, owner, idAt(vUV - vec2(dp.x, 0.0)))),
                   max(borderKind(id, owner, idAt(vUV + vec2(0.0, dp.y))),
                       borderKind(id, owner, idAt(vUV - vec2(0.0, dp.y)))));
  }

  if (country > 1.5) {
    color = mix(color, uCountryBorderColor, 0.85);
  } else if (province > 0.5) {
    color = mix(color, uProvinceBorderColor, 0.55 * uProvinceAlpha);
  }

  bool selected = same(id, uSelected);
  if (selected) {
    color = mix(color, uHighlightColor, 0.18);
    float edge = max(max(selectionEdge(selected, c1), selectionEdge(selected, c2)),
                     max(selectionEdge(selected, c3), selectionEdge(selected, c4)));
    if (edge > 0.5) color = uHighlightColor;
  }
  finalColor = vec4(color, 1.0);
}
`;

const rgbToVec = ([r, g, b]: RGB): Float32Array => new Float32Array([r / 255, g / 255, b / 255]);

export interface MapStyle {
  unowned: RGB;
  countryBorder: RGB;
  provinceBorder: RGB;
  highlight: RGB;
  countryWidth: number;
  provinceWidth: number;
}

/** State shared by every tile shader: palette texture and view uniforms. */
export class ProvinceShaderShared {
  readonly paletteSource: BufferImageSource;
  readonly uniforms: UniformGroup;

  constructor(palette: PaletteData, style: MapStyle) {
    this.paletteSource = new BufferImageSource({
      resource: palette.data,
      width: PALETTE_WIDTH,
      height: PALETTE_HEIGHT,
      format: 'rgba8unorm',
      alphaMode: 'no-premultiply-alpha',
      scaleMode: 'nearest',
      autoGenerateMipmaps: false,
    });
    this.uniforms = new UniformGroup({
      uScreenScale: { value: 1, type: 'f32' },
      uProvinceAlpha: { value: 1, type: 'f32' },
      uCountryWidth: { value: style.countryWidth, type: 'f32' },
      uProvinceWidth: { value: style.provinceWidth, type: 'f32' },
      uSelected: { value: new Float32Array([2, 2, 2]), type: 'vec3<f32>' },
      uUnownedColor: { value: rgbToVec(style.unowned), type: 'vec3<f32>' },
      uCountryBorderColor: { value: rgbToVec(style.countryBorder), type: 'vec3<f32>' },
      uProvinceBorderColor: { value: rgbToVec(style.provinceBorder), type: 'vec3<f32>' },
      uHighlightColor: { value: rgbToVec(style.highlight), type: 'vec3<f32>' },
    });
  }

  /** Call after changing the palette data. */
  paletteChanged(): void {
    this.paletteSource.update();
  }

  setView(deviceScale: number, provinceAlpha: number): void {
    this.uniforms.uniforms.uScreenScale = deviceScale;
    this.uniforms.uniforms.uProvinceAlpha = provinceAlpha;
    this.uniforms.update();
  }

  /** Selects a province by id (or none with -1). */
  setSelected(provinceId: number): void {
    const sel = this.uniforms.uniforms.uSelected as Float32Array;
    if (provinceId < 0) sel.set([2, 2, 2]);
    else {
      const label = provinceId + 1;
      sel.set([(label & 255) / 255, (label >> 8) / 255, 0]);
    }
    this.uniforms.update();
  }

  createTileShader(idTexture: TextureSource, levelScale: number): Shader {
    return Shader.from({
      gl: { vertex, fragment, name: 'province-map' },
      resources: {
        uIdTex: idTexture,
        uPalette: this.paletteSource,
        shared: this.uniforms,
        tile: new UniformGroup({
          uTexel: {
            value: new Float32Array([1 / idTexture.pixelWidth, 1 / idTexture.pixelHeight]),
            type: 'vec2<f32>',
          },
          uLevelScale: { value: levelScale, type: 'f32' },
        }),
      },
    });
  }
}
