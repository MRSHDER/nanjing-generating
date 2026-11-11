// 后期（负责人：Claude）。分两段，中间留给 Codex 的二维合成：
//   stage3D(三维层) → [Codex 合成二维层] → finish(合成结果) → 画布 / 渲染目标
// stage3D：震屏、缩放、色散、泛光、光晕 —— 只作用于三维层，文字不会被泛光和色散影响。
// finish：曝光、闪白、淡出、暗角、高光肩部压缩、sRGB 编码、颗粒 —— 作用于整个画面。
import * as THREE from 'three';
import { FSPass, makeRT, W, H } from './gl';

export interface PostParams {
  /** 曝光倍数，默认 1 */
  exposure?: number;
  /** 泛光强度，默认 0.8 */
  bloom?: number;
  /** 泛光阈值（线性），默认 0.85：只有秦淮金、信号红这类高亮会发光 */
  bloomThreshold?: number;
  /** 红色光晕（胶片感），默认 0.15 */
  halation?: number;
  /** 色散强度，默认 0.15 */
  ca?: number;
  /** 颗粒，默认 0.04 */
  grain?: number;
  /** 暗角，默认 0.3 */
  vignette?: number;
  /** 闪白 0..1（向米白闪），默认 0 */
  flash?: number;
  /** 淡出到黑 0..1，默认 0 */
  fade?: number;
  /** 震屏（逻辑像素） */
  shake?: [number, number];
  /** 缩放（1 = 不缩放） */
  zoom?: number;
}

const D = {
  exposure: 1,
  bloom: 0.8,
  bloomThreshold: 0.85,
  halation: 0.15,
  ca: 0.15,
  grain: 0.04,
  vignette: 0.3,
  flash: 0,
  fade: 0,
  zoom: 1,
};

const tex = () => ({ value: null as THREE.Texture | null });

export class Post {
  private rtA = makeRT();
  private rtOut = makeRT();
  private mips: THREE.WebGLRenderTarget[] = [];
  private ups: THREE.WebGLRenderTarget[] = [];

  private pre = new FSPass(
    /* glsl */ `
    uniform sampler2D tIn; uniform vec2 uShake; uniform float uZoom, uCa;
    void main() {
      vec2 c = vUv - 0.5;
      vec2 uv = c / uZoom + 0.5 - uShake;
      vec2 dir = c * uCa * 0.012;
      float r = texture2D(tIn, uv + dir).r;
      float g = texture2D(tIn, uv).g;
      float b = texture2D(tIn, uv - dir).b;
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      // 2026-10-18 Claude：清掉 NaN / 无穷大。单个坏像素进泛光金字塔会被逐级放大成一整块灰白方块
      // （本机显卡导出的片尾 86.0 / 86.25 秒「京」字上的方块；软件渲染不出现，所以云端截图一直复现不了）。
      vec3 col = vec3(r, g, b);
      col = mix(col, vec3(0.0), vec3(isnan(col)));
      col = mix(col, vec3(0.0), vec3(isinf(col)));
      gl_FragColor = vec4(clamp(col, 0.0, 64.0) * inside, 1.0);
    }`,
    { tIn: tex(), uShake: { value: new THREE.Vector2() }, uZoom: { value: 1 }, uCa: { value: 0 } },
  );

  private bright = new FSPass(
    /* glsl */ `
    uniform sampler2D tIn; uniform vec2 uTexel; uniform float uThr;
    vec3 tap(vec2 o) { vec3 c = texture2D(tIn, vUv + o * uTexel).rgb; float l = max(c.r, max(c.g, c.b)); float k = max(l - uThr, 0.0); k = k * k / (k + 0.25 + 1e-4); return c * (k / max(l, 1e-4)); }
    void main() { gl_FragColor = vec4((tap(vec2(-1,-1)) + tap(vec2(1,-1)) + tap(vec2(-1,1)) + tap(vec2(1,1))) * 0.25, 1.0); }`,
    { tIn: tex(), uTexel: { value: new THREE.Vector2() }, uThr: { value: 0.85 } },
  );

  private down = new FSPass(
    /* glsl */ `
    uniform sampler2D tIn; uniform vec2 uTexel;
    void main() {
      vec3 c = texture2D(tIn, vUv).rgb * 0.5;
      c += texture2D(tIn, vUv + vec2(-1,-1) * uTexel).rgb * 0.125;
      c += texture2D(tIn, vUv + vec2( 1,-1) * uTexel).rgb * 0.125;
      c += texture2D(tIn, vUv + vec2(-1, 1) * uTexel).rgb * 0.125;
      c += texture2D(tIn, vUv + vec2( 1, 1) * uTexel).rgb * 0.125;
      gl_FragColor = vec4(c, 1.0);
    }`,
    { tIn: tex(), uTexel: { value: new THREE.Vector2() } },
  );

  private up = new FSPass(
    /* glsl */ `
    uniform sampler2D tLow, tHigh; uniform vec2 uTexel; uniform float uMix;
    void main() {
      vec3 c = vec3(0.0);
      c += texture2D(tLow, vUv + vec2(-1,-1) * uTexel).rgb; c += texture2D(tLow, vUv + vec2(0,-1) * uTexel).rgb * 2.0; c += texture2D(tLow, vUv + vec2(1,-1) * uTexel).rgb;
      c += texture2D(tLow, vUv + vec2(-1, 0) * uTexel).rgb * 2.0; c += texture2D(tLow, vUv).rgb * 4.0; c += texture2D(tLow, vUv + vec2(1, 0) * uTexel).rgb * 2.0;
      c += texture2D(tLow, vUv + vec2(-1, 1) * uTexel).rgb; c += texture2D(tLow, vUv + vec2(0, 1) * uTexel).rgb * 2.0; c += texture2D(tLow, vUv + vec2(1, 1) * uTexel).rgb;
      gl_FragColor = vec4(texture2D(tHigh, vUv).rgb + c / 16.0 * uMix, 1.0);
    }`,
    { tLow: tex(), tHigh: tex(), uTexel: { value: new THREE.Vector2() }, uMix: { value: 1 } },
  );

  private combine = new FSPass(
    /* glsl */ `
    uniform sampler2D tBase, tBloom, tWide; uniform float uBloom, uHal;
    void main() {
      vec3 base = texture2D(tBase, vUv).rgb;
      vec3 bl = texture2D(tBloom, vUv).rgb;
      vec3 wide = texture2D(tWide, vUv).rgb;
      vec3 hal = C_PAPER * dot(wide, vec3(0.33));
      gl_FragColor = vec4(base + bl * uBloom + hal * uHal, 1.0);
    }`,
    { tBase: tex(), tBloom: tex(), tWide: tex(), uBloom: { value: 0.8 }, uHal: { value: 0.15 } },
  );

  private fin = new FSPass(
    /* glsl */ `
    uniform sampler2D tIn; uniform float uExposure, uFlash, uFade, uVignette, uGrain, uFrame; uniform vec2 uRes;
    vec3 shoulder(vec3 x) {
      // 0.8 以下保持原样（颜色准确），以上平滑压到 1，避免高光“烧白”
      const float k = 0.8;
      vec3 over = max(x - k, 0.0);
      return min(x, vec3(k)) + (1.0 - k) * (1.0 - exp(-over / (1.0 - k)));
    }
    vec3 toSRGB(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec3 c = texture2D(tIn, vUv).rgb * uExposure;
      c = mix(c, C_PAPER * 1.1, uFlash);
      vec2 q = vUv - 0.5; q.x *= ${(W / H).toFixed(4)};
      c *= mix(1.0, smoothstep(1.15, 0.25, length(q)), uVignette);
      c *= 1.0 - uFade;
      c = shoulder(c);
      vec3 s = toSRGB(c);
      float n = hash21(floor(vUv * uRes) + vec2(uFrame * 7.13, uFrame * 3.71)) - 0.5;
      s += n * uGrain * (0.6 + 0.4 * (1.0 - dot(s, vec3(0.33))));
      s += (hash21(vUv * uRes + 0.5 + uFrame) - 0.5) / 255.0; // 抖动，避免色带
      gl_FragColor = vec4(s, 1.0);
    }`,
    {
      tIn: tex(),
      uExposure: { value: 1 },
      uFlash: { value: 0 },
      uFade: { value: 0 },
      uVignette: { value: 0.3 },
      uGrain: { value: 0.04 },
      uFrame: { value: 0 },
      uRes: { value: new THREE.Vector2(W, H) },
    },
  );

  constructor(private r: THREE.WebGLRenderer) {
    let w = W / 2, h = H / 2;
    for (let i = 0; i < 6; i++) {
      this.mips.push(makeRT(w, h));
      this.ups.push(makeRT(w, h));
      w /= 2;
      h /= 2;
    }
  }

  /** 只作用于三维层。返回内部渲染目标（线性 HDR），下一次调用前有效。 */
  stage3D(in3D: THREE.WebGLRenderTarget, p: PostParams = {}): THREE.WebGLRenderTarget {
    const q = { ...D, ...p };
    const r = this.r;
    const shake = p.shake ?? [0, 0];

    this.pre.u.tIn!.value = in3D.texture;
    (this.pre.u.uShake!.value as THREE.Vector2).set(shake[0] / W, -shake[1] / H);
    this.pre.u.uZoom!.value = q.zoom;
    this.pre.u.uCa!.value = 0;
    this.pre.render(r, this.rtA);

    // 泛光：阈值 → 逐级缩小 → 逐级放大叠加
    const texel = (rt: THREE.WebGLRenderTarget) => new THREE.Vector2(1 / rt.width, 1 / rt.height);
    this.bright.u.tIn!.value = this.rtA.texture;
    this.bright.u.uTexel!.value = texel(this.rtA);
    this.bright.u.uThr!.value = q.bloomThreshold;
    this.bright.render(r, this.mips[0]!);
    for (let i = 1; i < this.mips.length; i++) {
      this.down.u.tIn!.value = this.mips[i - 1]!.texture;
      this.down.u.uTexel!.value = texel(this.mips[i - 1]!);
      this.down.render(r, this.mips[i]!);
    }
    const last = this.mips.length - 1;
    for (let i = last - 1; i >= 0; i--) {
      const low = i === last - 1 ? this.mips[last]! : this.ups[i + 1]!;
      this.up.u.tLow!.value = low.texture;
      this.up.u.tHigh!.value = this.mips[i]!.texture;
      this.up.u.uTexel!.value = texel(low);
      this.up.u.uMix!.value = 1;
      this.up.render(r, this.ups[i]!);
    }

    this.combine.u.tBase!.value = this.rtA.texture;
    this.combine.u.tBloom!.value = this.ups[0]!.texture;
    this.combine.u.tWide!.value = this.ups[2]!.texture;
    this.combine.u.uBloom!.value = q.bloom;
    this.combine.u.uHal!.value = q.halation;
    this.combine.render(r, this.rtOut);
    return this.rtOut;
  }

  /** 作用于整个画面并输出（target = null 时输出到画布）。frame 用于颗粒的逐帧变化。 */
  finish(composited: THREE.WebGLRenderTarget, p: PostParams = {}, target: THREE.WebGLRenderTarget | null = null, frame = 0) {
    const q = { ...D, ...p };
    const u = this.fin.u;
    u.tIn!.value = composited.texture;
    u.uExposure!.value = q.exposure;
    u.uFlash!.value = q.flash;
    u.uFade!.value = q.fade;
    u.uVignette!.value = q.vignette;
    u.uGrain!.value = q.grain;
    u.uFrame!.value = frame % 997;
    (u.uRes!.value as THREE.Vector2).set(composited.width, composited.height);
    this.fin.render(this.r, target);
  }
}
