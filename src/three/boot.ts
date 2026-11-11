// 段落 1「启动」三维层（0:00–0:07.5，16 拍）。负责人：Claude。
//
// 拍 0–2   黑场中一个金色光点亮起（配乐：钟声）
// 拍 2–4   光点向两侧拉成一条白色扫描线（配乐：上扫滑音）
// 拍 4–8   镜头升起：扫描线原来就是一张无限网格地面的侧影，网格向下展开成透视地面；
//          网格单元随“数据滴答”声闪烁
// 拍 8     南京坐标点升起一根金色光柱（配乐：撞击），地面红色准星与扩散圆环
// 拍 8–15.5 镜头转向光柱并加速掠过，上升音推动色散和视野变宽
// 拍 15.5–16 静音停顿：全黑，切到「锁定」
//
// 整个画面是一个全屏着色器：射线与地平面求交画网格，光柱与扫描线用解析距离场发光。
// 颜色全部在着色器里由色板函数计算。
import * as THREE from 'three';
import { FSPass, W, H } from '../engine/gl';
import { BEAT, type Frame } from '../engine/beat';
import type { PostParams } from '../engine/post';
import type { Layer3D } from './index';

const FRAG = /* glsl */ `
uniform float uB, uLt, uTick, uImpact, uRiser, uGap, uAspect;
uniform vec3 uRo;                       // 镜头位置（由 TS 计算，和屏幕锚点共用一套数学）
uniform float uPitch, uYaw, uRoll, uFocal, uRise;
uniform vec2 uPillar;

void main() {
  float b = uB;
  vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
  float rise = uRise;
  vec2 PILLAR = uPillar;

  p *= rot(uRoll);
  vec3 rd = normalize(vec3(p, -uFocal));
  rd = vec3(rd.x, rd.y * cos(uPitch) - rd.z * sin(uPitch), rd.y * sin(uPitch) + rd.z * cos(uPitch));
  rd = vec3(rd.x * cos(uYaw) - rd.z * sin(uYaw), rd.y, rd.x * sin(uYaw) + rd.z * cos(uYaw));
  vec3 ro = uRo;

  vec3 col = C_INK;
  // 地平线附近的紫色微光（雾）
  col += C_PURPLE * 0.10 * exp(-abs(rd.y) * 16.0) * rise;

  float groundT = rd.y < -1e-4 ? -ro.y / rd.y : 1e9;

  // ── 地面网格 ──
  if (groundT < 1e8) {
    vec3 hp = ro + rd * groundT;
    vec2 g = hp.xz;
    float fog = exp(-groundT * 0.05);
    float show = smoothstep(0.0, 0.35, rise);

    float minor = gridLine(g, 1.0);
    float major = gridLine(g / 8.0, 1.5);
    vec3 lines = mix(C_WALL * 0.45, C_PAPER * 0.85, major) * max(minor * 0.55, major);

    vec2 id = floor(g);
    float h = hash21(id);
    float dP = length(g - PILLAR);
    // 光柱周围的“城市块”逐渐点亮
    float reach = 1.5 + 12.0 * outCubic(prog(b, 5.0, 12.0));
    float lit = step(dP + (h - 0.5) * 5.0, reach) * step(0.74, h);
    float near = smoothstep(1.5, 9.0, groundT); // 近处的格子不要抢画面
    vec3 cell = mix(C_WALL * 0.018, C_GOLD * 0.075, step(0.92, h)) * lit * near;
    // 数据滴答：随机单元闪一下
    float flash = step(0.86, hash21(id + floor(uLt * 9.0))) * uTick;
    cell += C_PAPER * 0.22 * flash * smoothstep(30.0, 4.0, groundT) * near;

    vec3 ground = lines + cell;

    // 红色准星：十字虚线 + 每拍扩散一圈
    float on = step(8.0, b);
    float ph = fract(b);
    float ring = exp(-abs(dP - ph * 7.0) * 5.0) * (1.0 - ph) * on;
    float dash = step(0.5, fract(dP * 1.2));
    vec2 dl = abs(g - PILLAR) / max(fwidth(g), vec2(1e-5)); // 以像素计的距离：远近都是细线
    float cross = (saturate(1.5 - dl.x) + saturate(1.5 - dl.y)) * dash * exp(-dP * 0.06) * on;
    float disk = exp(-dP * 3.0) * on;
    ground += C_RED * (ring * 2.2 + cross * 0.9 + disk * 1.5);

    col = mix(col, col + ground * show, fog);
  }

  // ── 光点 / 扫描线（地平线） ──
  {
    float halfW = outExpo(prog(b, 2.0, 3.6)) * uAspect * 0.6;
    vec2 q = vec2(max(abs(p.x) - halfW, 0.0), rd.y);
    float d = length(q);
    float appear = prog(b, 0.0, 0.5);
    float breathe = 0.85 + 0.15 * sin(uLt * 7.0);
    float core = exp(-d * 320.0) * 2.6 + exp(-d * 45.0) * 0.35;
    float fadeOut = 1.0 - 0.8 * prog(b, 6.0, 9.0);
    vec3 tint = mix(C_GOLD * 1.4, C_PAPER * 1.2, prog(b, 2.0, 3.0));
    col += tint * core * appear * breathe * fadeOut;
  }

  // ── 金色光柱 ──
  if (b >= 8.0) {
    vec2 o = ro.xz - PILLAR;
    vec2 dxz = rd.xz;
    float tt = -dot(o, dxz) / max(dot(dxz, dxz), 1e-6);
    if (tt > 0.0 && tt < groundT) {
      float dist = length(o + dxz * tt);
      float y = ro.y + rd.y * tt;
      float height = outExpo(prog(b, 8.0, 9.0)) * 40.0;
      float hm = step(0.0, y) * smoothstep(height, height * 0.6, y);
      float pulse = 1.0 + uImpact * 2.5 + 0.3 * sin(uLt * 20.0);
      float glow = (exp(-dist * 45.0) * 3.5 + exp(-dist * 5.0) * 0.4) * hm * pulse;
      col += mix(C_GOLD, C_GOLD * 1.8 + 0.25, saturate(glow * 0.3)) * glow;
    }
  }

  // 地平线上方的少量“星点”：远处的城市灯
  {
    vec2 sp = vec2(atan(rd.x, -rd.z) * 90.0, rd.y * 90.0);
    vec2 sid = floor(sp);
    vec2 sf = fract(sp) - 0.5 - (hash22(sid) - 0.5) * 0.6;
    float dot_ = smoothstep(0.12, 0.0, length(sf));
    float s = step(0.988, hash21(sid)) * dot_ * smoothstep(0.0, 0.015, rd.y) * smoothstep(0.2, 0.03, rd.y);
    col += mix(C_PAPER, C_GOLD, hash21(sid + 3.1)) * s * 0.9 * rise;
  }

  col *= 1.0 - uGap;
  gl_FragColor = vec4(col, 1.0);
}
`;

const PILLAR: [number, number] = [1.2, -16.5]; // 南京坐标点；镜头在静音停顿前正好冲到光柱跟前

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const prog = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const inOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** 镜头：只依赖段内拍号与上升音进度。 */
function camera(b: number, riser: number) {
  const rise = outCubic(prog(b, 4, 8.5));
  const swoop = inOutCubic(prog(b, 9, 15.5));
  const s = Math.max(b - 8, 0);
  return {
    rise,
    ro: [0, 0.0015 + (1.8 - 0.0015) * rise - 0.95 * swoop, -(0.12 * b + 0.032 * s * s * s)] as [number, number, number],
    pitch: -0.21 * rise + 0.12 * swoop,
    yaw: 0.1 * inOutCubic(prog(b, 8, 13)) - 0.05 * swoop,
    roll: 0.025 * Math.sin(b * 0.9) * rise + 0.06 * swoop * Math.sin(b * 2.1),
    focal: 1.25 - 0.45 * riser,
  };
}

/** 世界坐标 → 屏幕逻辑像素（1920×1080，y 向下）；在镜头后方返回 null。 */
function project(cam: ReturnType<typeof camera>, P: [number, number, number]): [number, number] | null {
  let x = P[0] - cam.ro[0], y = P[1] - cam.ro[1], z = P[2] - cam.ro[2];
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  [y, z] = [y * cp + z * sp, -y * sp + z * cp];
  if (z > -1e-3) return null;
  const px = (x * cam.focal) / -z, py = (y * cam.focal) / -z;
  const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
  const qx = px * cr - py * sr, qy = px * sr + py * cr;
  return [(qx / (W / H) + 0.5) * W, (0.5 - qy) * H];
}

export type BootAnchors = {
  /** 地平线中点（屏幕逻辑像素） */
  horizon: [number, number] | null;
  /** 光柱底部（拍 8 之前也给出位置，供二维层预先瞄准） */
  pillarBase: [number, number] | null;
  /** 光柱顶部（当前高度） */
  pillarTop: [number, number] | null;
};

export default class BootLayer implements Layer3D {
  private pass = new FSPass(FRAG, {
    uB: { value: 0 },
    uLt: { value: 0 },
    uTick: { value: 0 },
    uImpact: { value: 0 },
    uRiser: { value: 0 },
    uGap: { value: 0 },
    uAspect: { value: W / H },
    uRo: { value: new THREE.Vector3() },
    uPitch: { value: 0 },
    uYaw: { value: 0 },
    uRoll: { value: 0 },
    uFocal: { value: 1.25 },
    uRise: { value: 0 },
    uPillar: { value: new THREE.Vector2(...PILLAR) },
  });

  async init() {}

  /** 三维物体在屏幕上的位置，供二维层对齐（例如把定位框锁在光柱上）。 */
  anchors(f: Frame): BootAnchors {
    const b = f.lt / BEAT;
    const cam = camera(b, f.env.riser);
    const fwd: [number, number] = [Math.sin(cam.yaw), -Math.cos(cam.yaw)];
    const height = 40 * (b < 8 ? 0 : 1 - Math.pow(2, -10 * Math.min(1, b - 8)));
    return {
      horizon: project(cam, [cam.ro[0] + fwd[0] * 1e5, 0, cam.ro[2] + fwd[1] * 1e5]),
      pillarBase: project(cam, [PILLAR[0], 0, PILLAR[1]]),
      pillarTop: b >= 8 ? project(cam, [PILLAR[0], Math.max(height, 0.01), PILLAR[1]]) : null,
    };
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget): PostParams {
    const b = f.lt / BEAT;
    const cam = camera(b, f.env.riser);
    const u = this.pass.u;
    u.uB!.value = b;
    u.uLt!.value = f.lt;
    u.uTick!.value = f.env.tick;
    u.uImpact!.value = f.env.impact;
    u.uRiser!.value = f.env.riser;
    u.uGap!.value = f.env.gap;
    (u.uRo!.value as THREE.Vector3).set(...cam.ro);
    u.uPitch!.value = cam.pitch;
    u.uYaw!.value = cam.yaw;
    u.uRoll!.value = cam.roll;
    u.uFocal!.value = cam.focal;
    u.uRise!.value = cam.rise;
    this.pass.render(r, out);

    // 撞击时震屏（用帧号做确定性抖动）
    const k = f.env.impact * (b >= 8 && b < 10 ? 10 : 3);
    const j = (n: number) => (Math.sin(f.frame * 12.9898 + n * 78.233) * 43758.5453) % 1;
    const flash = b >= 8 && b < 8.5 ? (1 - (b - 8) / 0.5) * 0.18 : 0;
    return {
      bloom: 0.9,
      bloomThreshold: 0.8,
      halation: 0.2,
      ca: 0.12 + f.env.riser * 1.4,
      zoom: 1 + 0.02 * f.env.riser,
      shake: [j(1) * k, j(2) * k],
      flash,
      fade: f.env.gap,
      grain: 0.05,
      vignette: 0.35,
    };
  }
}
