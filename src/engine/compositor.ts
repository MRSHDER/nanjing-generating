import * as THREE from 'three';
import { FSPass, makeRT } from './gl';
import type { OverlayMask, OverlayRole } from '../overlay2d/boot';
import { GLSL_SKY_NIGHT } from './transition.glsl';

const ROLES: OverlayRole[] = ['muted', 'signal', 'foreground'];
export interface SubtitleLabels { plate: HTMLCanvasElement; text: HTMLCanvasElement; rule: HTMLCanvasElement; revision?: number }

export class Compositor {
  private posterTarget = makeRT();
  private resultTarget = makeRT();
  private textures = new Map<HTMLCanvasElement, THREE.CanvasTexture>();
  private textureRevisions = new WeakMap<HTMLCanvasElement, number>();
  private empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  private pass = new FSPass(`
    uniform sampler2D tBase, tMuted, tSignal, tForeground, tBacking, tTypography, tPlate, tLabel, tRule;
    uniform vec3 uTypographyColor;
    uniform float uHasBase, uPaper, uInkProgress, uSkyNight;
    uniform vec2 uInkCenter;
    ${GLSL_SKY_NIGHT}
    float inkHash(vec2 point) { return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453); }
    float inkNoise(vec2 point) {
      vec2 cell = floor(point), blend = fract(point);
      blend = blend * blend * (3.0 - 2.0 * blend);
      return mix(mix(inkHash(cell), inkHash(cell + vec2(1.0, 0.0)), blend.x), mix(inkHash(cell + vec2(0.0, 1.0)), inkHash(cell + vec2(1.0, 1.0)), blend.x), blend.y);
    }
    void main() {
      float paper = uSkyNight > 0.5 ? 1.0 - skyNight(vUv.y, 1.0 - uPaper) : uPaper;
      if (uInkProgress >= 0.0) {
        vec2 offset = vUv * vec2(1920.0, 1080.0) - uInkCenter;
        float irregular = (inkNoise(offset * 0.009) - 0.5) * 110.0 + (inkNoise(offset * 0.027) - 0.5) * 38.0;
        float extent = length(max(uInkCenter, vec2(1920.0, 1080.0) - uInkCenter)) + 160.0;
        float radius = extent * pow(uInkProgress, 1.25);
        float grain = inkNoise(offset * 0.12) * 2.0 - 1.0;
        float distance = length(offset) + irregular + grain * 18.0 + 40.0;
        float wet = smoothstep(radius - 95.0, radius + 80.0, distance);
        float dry = smoothstep(radius - 75.0, radius + 5.0, distance);
        paper = mix(dry, wet, 0.35) + (1.0 - dry) * wet * max(0.0, grain) * 0.12;
        paper = mix(1.0, clamp(paper, 0.0, 1.0), smoothstep(0.0, 0.03, uInkProgress));
      }
      vec3 background = mix(C_INK, C_PAPER, paper);
      vec3 foreground = mix(C_PAPER, C_INK, paper);
      vec3 color = uHasBase > 0.5 ? texture2D(tBase, vUv).rgb : background;
      color = mix(color, background, texture2D(tBacking, vUv).a);
      color = mix(color, uTypographyColor, texture2D(tTypography, vUv).a);
      color = mix(color, C_WALL, texture2D(tMuted, vUv).a);
      color = mix(color, C_RED, texture2D(tSignal, vUv).a);
      color = mix(color, foreground, texture2D(tForeground, vUv).a);
      // 中英双语版式文字（Claude 2026-10-17）：半透明米白底托 → 红色短线 → 深灰文字，固定配色、不随黑底段反色
      color = mix(color, C_PAPER, texture2D(tPlate, vUv).a);
      color = mix(color, C_RED, texture2D(tRule, vUv).a);
      color = mix(color, mix(C_INK, C_WALL, 0.1), texture2D(tLabel, vUv).a);
      gl_FragColor = vec4(color, 1.0);
    }
  `, {
    tBase: { value: null }, tMuted: { value: null }, tSignal: { value: null }, tBacking: { value: null },
    tForeground: { value: null }, uHasBase: { value: 0 }, uPaper: { value: 1 },
    uInkProgress: { value: -1 }, uInkCenter: { value: new THREE.Vector2(960, 540) }, uSkyNight: { value: 0 },
    tTypography: { value: null }, uTypographyColor: { value: new THREE.Vector3() },
    tPlate: { value: null }, tLabel: { value: null }, tRule: { value: null },
  });

  constructor(private renderer: THREE.WebGLRenderer) {
    this.empty.needsUpdate = true;
  }

  private texture(canvas: HTMLCanvasElement, revision?: number) {
    let texture = this.textures.get(canvas);
    if (!texture) {
      texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.NoColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      this.textures.set(canvas, texture);
    }
    if (revision === undefined || this.textureRevisions.get(canvas) !== revision) {
      texture.needsUpdate = true;
      if (revision !== undefined) this.textureRevisions.set(canvas, revision);
    }
    return texture;
  }

  private draw(masks: OverlayMask[], layer: 'behind' | 'front', paper: boolean | number, target: THREE.WebGLRenderTarget, base?: THREE.Texture, backing?: HTMLCanvasElement, inkSpread?: { center: [number, number]; progress: number }, labels?: SubtitleLabels) {
    const uniforms = this.pass.u;
    uniforms.tPlate!.value = labels ? this.texture(labels.plate, labels.revision) : this.empty;
    uniforms.tLabel!.value = labels ? this.texture(labels.text, labels.revision) : this.empty;
    uniforms.tRule!.value = labels ? this.texture(labels.rule, labels.revision) : this.empty;
    uniforms.tBase!.value = base ?? this.empty;
    uniforms.uHasBase!.value = base ? 1 : 0;
    uniforms.uPaper!.value = typeof paper === 'number' ? paper : paper ? 1 : 0;
    uniforms.uSkyNight!.value = typeof paper === 'number' ? 1 : 0;
    uniforms.uInkProgress!.value = inkSpread?.progress ?? -1;
    if (inkSpread) uniforms.uInkCenter!.value.set(inkSpread.center[0], 1080 - inkSpread.center[1]);
    uniforms.tBacking!.value = backing ? this.texture(backing) : this.empty;
    const typography = masks.find(candidate => candidate.tint && (candidate.layer ?? 'front') === layer);
    uniforms.tTypography!.value = typography ? this.texture(typography.canvas) : this.empty;
    if (typography?.tint) uniforms.uTypographyColor!.value.set(...typography.tint);
    for (const role of ROLES) {
      const mask = masks.find(candidate => !candidate.tint && candidate.role === role && (candidate.layer ?? 'front') === layer);
      let texture: THREE.Texture = this.empty;
      if (mask) {
        texture = this.texture(mask.canvas);
      }
      uniforms[role === 'foreground' ? 'tForeground' : role === 'signal' ? 'tSignal' : 'tMuted']!.value = texture;
    }
    this.pass.render(this.renderer, target);
    return target;
  }

  poster(masks: OverlayMask[], paper: boolean | number, inkSpread?: { center: [number, number]; progress: number }) {
    return this.draw(masks, 'behind', paper, this.posterTarget, undefined, undefined, inkSpread);
  }

  front(masks: OverlayMask[], paper: boolean | number, base: THREE.Texture, backing?: HTMLCanvasElement, inkSpread?: { center: [number, number]; progress: number }, labels?: SubtitleLabels) {
    return this.draw(masks, 'front', paper, this.resultTarget, base, backing, inkSpread, labels);
  }

  dispose() {
    for (const texture of this.textures.values()) texture.dispose();
    this.empty.dispose();
    this.posterTarget.dispose();
    this.resultTarget.dispose();
    this.pass.material.dispose();
  }
}
