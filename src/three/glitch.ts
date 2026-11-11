// 段落 4「数据故障」三维层（24 拍 = 6 小节，米白底）。负责人：Claude。
//
// 用户 10-13 01:48 选定"每闪一次，换一个南京"+ 每小节换机位（取代 Codex 方案A 的单一弧线迁移；方案A 的弧线汇成人物保留为第 6 小节收尾）。
// 同一批 960 条墨线短线在六个造型之间迁移；迁移都藏在二进制闪屏里，闪回来时新造型已经拼好、镜头已换：
//   第 1 小节  0–2.5 拍   红色扫描线把城墙扫成整齐的数据方块（26.67 秒起）
//   第 2 小节  3.5 拍闪回 南京长江大桥：桁架、桥墩、桥头堡和三面红旗（28.13 秒）
//   第 3 小节  8 拍闪回   中山陵：台阶一级级向上，顶上是祭堂（30.00 秒）
//   第 4 小节  11.5 拍闪回 秦淮河：两岸粉墙、马头墙，河上一串串红灯笼和水里的灯影（31.46 秒）
//   第 5 小节  16 拍闪回  梧桐大道：两排梧桐枝桠在路上方合拢，路中间一条红线（33.33 秒）
//   第 6 小节  19.5 拍闪回 前四个画面缩成四张小片悬在左边（34.79 秒），20 拍起沿弧线汇成右边玻璃球的经纬线，
//             22.5–23.5 拍闪屏时换成真的玻璃球（10-13 用户：火柴人改为玻璃球贯穿全片），青年段从这里滚出去
// 卡顿与冻结用 beat.ts 的 glitchTime()；闪屏按真实时间（glitchBinaryAt）。全部由拍决定，可乱序取帧。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { BEAT, glitchTime, type Frame } from '../engine/beat';
import { PALETTE } from '../engine/palette.glsl';
import type { PostParams } from '../engine/post';
import type { Layer3D, Layer3DContext } from './index';
import { lin, softStudioEnv } from './env';
import { FIGURE_ANCHOR } from './figure';
import { BALL_ENTRY, BALL_RADIUS, createRollingBall, createBallShadow } from './rollingBall';
import { buildBridge, buildMausoleum, buildQinhuai, buildWutong } from './glitchModels';
import { GlitchBackdropTypography } from './glitchBackdropTypography';
import { AlgoOverlay, type AlgoTarget } from './glitchAlgo';
import { getWutongModel, wutongContours } from './wutongModel';

const BW = 0.8, BH = 0.38, BD = 0.4;
const AC = 20, AR = 12; // 砖阵：20 列 × 12 行
const N = AC * AR;
const K = N * 4; // 短线条数：每块砖四条边

/** 红色扫描线在第 b 拍的位置（世界 x）：0.3–2.3 拍从左扫到右（第 2.5 拍第一次闪屏前扫完）。 */
export const glitchScanX = (b: number) => -9.5 + 19 * Math.min(1, Math.max(0, (b - 0.3) / 2));
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = (x: number) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const smooth = (x: number) => { x = clamp01(x); return x * x * (3 - 2 * x); };

export function glitchArc(start: [number, number, number], target: [number, number, number], lane: number, progress: number): [number, number, number] {
  const bend = [-1.8, 1.2, 2.5][lane]!;
  return start.map((value, axis) => {
    const control = (value + target[axis]!) * 0.5 + (axis === 1 ? bend : axis === 2 ? -0.5 * lane : 0);
    return (1 - progress) ** 2 * value + 2 * (1 - progress) * progress * control + progress ** 2 * target[axis]!;
  }) as [number, number, number];
}

// ---------- 六个造型（三维线段：x0 y0 z0 x1 y1 z1，red = 1 为朱砂红） ----------
type S3 = { a: [number, number, number]; b: [number, number, number]; red: number };
const G = FIGURE_ANCHOR.y; // 地面 / 水面高度（与二维地面网格一致）
const seg = (out: S3[], a: [number, number, number], b: [number, number, number], red = 0) => out.push({ a, b, red });
const poly = (out: S3[], pts: [number, number, number][], red = 0, close = false) => {
  for (let i = 0; i < pts.length - 1; i++) seg(out, pts[i]!, pts[i + 1]!, red);
  if (close) seg(out, pts[pts.length - 1]!, pts[0]!, red);
};
const boxEdges = (out: S3[], x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, red = 0) => {
  for (const z of [z0, z1]) poly(out, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], red, true);
  for (const x of [x0, x1]) for (const y of [y0, y1]) seg(out, [x, y, z0], [x, y, z1], red);
};

/** 南京长江大桥：钢桁架、桥墩、桥头堡、三面红旗、桥上路灯。 */
function bridgeShape(): S3[] {
  const o: S3[] = [];
  const top = 0.2, bot = -0.8, L = 10;
  for (const z of [-0.7, 0.7]) {
    seg(o, [-L, top, z], [L, top, z]);
    seg(o, [-L, bot, z], [L, bot, z]);
    for (let x = -L; x < L; x += 1) {
      seg(o, [x, bot, z], [x, top, z]);
      seg(o, (x + L) % 2 ? [x, top, z] : [x, bot, z], (x + L) % 2 ? [x + 1, bot, z] : [x + 1, top, z]);
    }
  }
  for (let x = -L; x <= L; x += 2) seg(o, [x, top, -0.7], [x, top, 0.7]);
  for (let x = -L + 1; x < L; x += 2) for (const z of [-0.8, 0.8]) { seg(o, [x, top, z], [x, top + 0.75, z]); seg(o, [x - 0.12, top + 0.75, z], [x + 0.12, top + 0.75, z]); }
  for (const x of [-8, -4, 0, 4, 8]) boxEdges(o, x - 0.35, x + 0.35, G, bot, -1, 1);
  for (const cx of [-L - 0.7, L + 0.7]) {
    boxEdges(o, cx - 0.6, cx + 0.6, G, 2.4, -1, 1);
    for (const y of [0.2, 1.3]) poly(o, [[cx - 0.6, y, 1], [cx + 0.6, y, 1]]);
    for (const dx of [-0.38, 0, 0.38]) {
      seg(o, [cx + dx, 2.4, 0], [cx + dx, 3.25, 0]);
      poly(o, [[cx + dx, 3.25, 0], [cx + dx + 0.42, 3.12, 0], [cx + dx + 0.36, 2.96, 0], [cx + dx, 2.98, 0]], 1);
    }
  }
  return o;
}

/** 中山陵：一级级向上的台阶、两侧栏杆，顶上的祭堂（中门一笔红）。 */
function stepsShape(): S3[] {
  const o: S3[] = [];
  const n = 30, rise = 0.16, run = 0.42, z0 = 1.5, hw = 3;
  for (let i = 0; i <= n; i++) seg(o, [-hw, G + i * rise, z0 - i * run], [hw, G + i * rise, z0 - i * run]);
  const yTop = G + n * rise, zTop = z0 - n * run;
  for (const s of [-1, 1]) {
    seg(o, [s * (hw + 0.3), G, z0], [s * (hw + 0.3), yTop, zTop]);
    seg(o, [s * (hw + 0.3), G + 0.5, z0], [s * (hw + 0.3), yTop + 0.5, zTop]);
    for (let i = 0; i <= n; i += 5) seg(o, [s * (hw + 0.3), G + i * rise, z0 - i * run], [s * (hw + 0.3), G + i * rise + 0.5, z0 - i * run]);
  }
  const zb0 = zTop - 0.6, zb1 = zTop - 3, y1 = yTop + 1.7, ridge = y1 + 0.95;
  boxEdges(o, -3.2, 3.2, yTop, y1, zb0, zb1);
  poly(o, [[-3.9, y1, zb0 + 0.4], [3.9, y1, zb0 + 0.4], [3.9, y1, zb1 - 0.4], [-3.9, y1, zb1 - 0.4]], 0, true);
  seg(o, [-2.2, ridge, (zb0 + zb1) / 2], [2.2, ridge, (zb0 + zb1) / 2]);
  for (const [x, z] of [[-3.9, zb0 + 0.4], [3.9, zb0 + 0.4], [-3.9, zb1 - 0.4], [3.9, zb1 - 0.4]] as [number, number][]) seg(o, [x, y1, z], [Math.sign(x) * 2.2, ridge, (zb0 + zb1) / 2]);
  for (const dx of [-1.6, 0, 1.6]) poly(o, [[dx - 0.35, yTop, zb0], [dx - 0.35, yTop + 1.1, zb0], [dx + 0.35, yTop + 1.1, zb0], [dx + 0.35, yTop, zb0]], dx === 0 ? 1 : 0);
  return o;
}

/** 秦淮河：两岸粉墙黛瓦与马头墙，河上的红灯笼串，水里拉长的灯影。 */
function qinhuaiShape(): S3[] {
  const o: S3[] = [];
  const W2 = 3;
  for (const s of [-1, 1]) {
    seg(o, [s * W2, G, 5], [s * W2, G, -32]);
    for (let j = 0; j < 9; j++) {
      const za = 3.5 - j * 3.8, zb = za - 3.3, h = 1.3 + 0.6 * hash(j * 7 + s * 3), x = s * (W2 + 0.4), yt = G + 0.2 + h;
      poly(o, [[x, G + 0.2, za], [x, yt, za], [x, yt, zb], [x, G + 0.2, zb]]);
      seg(o, [x, yt, za], [x + s * 1.0, yt + 0.6, za]); seg(o, [x, yt, zb], [x + s * 1.0, yt + 0.6, zb]);
      seg(o, [x - s * 0.15, yt + 0.02, za + 0.2], [x - s * 0.15, yt + 0.02, zb - 0.2]);
      // 马头墙：山墙一级级升高
      const st = 0.32;
      poly(o, [[x, yt, za], [x, yt + st, za], [x + s * 0.35, yt + st, za], [x + s * 0.35, yt + 2 * st, za], [x + s * 0.7, yt + 2 * st, za]]);
      // 一扇窗
      const wz = (za + zb) / 2;
      poly(o, [[x, G + 0.9, wz - 0.35], [x, G + 1.35, wz - 0.35], [x, G + 1.35, wz + 0.35], [x, G + 0.9, wz + 0.35]], 0, true);
    }
  }
  for (let k = 0; k < 6; k++) {
    const z = -1 - k * 4.2, y0 = 0.9, sag = 0.7;
    const cat = (x: number) => y0 - sag * (1 - (x / (W2 + 0.4)) ** 2);
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 12; i++) { const x = -(W2 + 0.4) + (2 * (W2 + 0.4) * i) / 12; pts.push([x, cat(x), z]); }
    poly(o, pts);
    for (const lx of [-2.1, -0.7, 0.7, 2.1]) {
      const yc = cat(lx), cy = yc - 0.38, r = 0.17;
      seg(o, [lx, yc, z], [lx, cy + r, z]);
      const hex: [number, number, number][] = [];
      for (let i = 0; i < 6; i++) { const a = Math.PI / 2 + (i / 6) * Math.PI * 2; hex.push([lx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r, z]); }
      poly(o, hex, 1, true);
      // 水中灯影：拉长的竖条（倒影在水面之下）
      const ry = G - (cy - G);
      seg(o, [lx, ry + 0.25, z], [lx, ry - 0.55, z], 1);
    }
  }
  return o;
}

const WUTONG_MODEL = getWutongModel(G);
const WUTONG_TREES = WUTONG_MODEL.trees;

function wutongShape(): S3[] {
  return WUTONG_MODEL.skeleton;
}

export function canopyClusters(camera: THREE.Camera): Float32Array {
  return wutongContours(WUTONG_MODEL, camera);
}

/**
 * 玻璃球的经纬线（与 rollingBall.ts 的线框完全一致：纬线 -60°…60° 每 30°，经线 0°…150° 每 30°），
 * 球心 = 青年段第 0 拍玻璃球的位置。960 条短线在 20–21.9 拍汇成这颗球的线框（停留到 22.5 拍让观众看清），
 * 22.5–23.5 拍闪屏时换成真的玻璃球，青年段从这里滚出去。赤道一圈用朱砂红。
 */
// ---------- 第 6 小节：玻璃球从上方落下（用户 10-13 21:13） ----------
// 19.5 拍从画面上方出现，21.5 拍落地，弹两下，22.4 拍停稳；球里依次闪过五个南京（每半拍一个），22.5–23.5 拍最后一次闪屏后换成真的玻璃球，接青年段。
const BALL_REST = BALL_ENTRY.floor + BALL_RADIUS;
const BALL_DROP = 6.5; // 起落高度（球心高出停稳位置多少）
export function glitchBallY(b: number): number {
  if (b < 19.5) return BALL_REST + BALL_DROP;
  if (b < 21.5) { const u = (b - 19.5) / 2; return BALL_REST + BALL_DROP * (1 - u * u); }
  if (b < 22.1) { const v = (b - 21.5) / 0.6; return BALL_REST + 0.6 * 4 * v * (1 - v); }
  if (b < 22.4) { const v = (b - 22.1) / 0.3; return BALL_REST + 0.15 * 4 * v * (1 - v); }
  return BALL_REST;
}
/** 球里正在闪过的南京（0 城墙 … 4 梧桐）。 */
const lensSceneAt = (b: number) => Math.max(0, Math.min(4, Math.floor((b - 19.5) / 0.5)));

function ballShape(cyOverride?: number): S3[] {
  const o: S3[] = [];
  const cx = BALL_ENTRY.x, cy = cyOverride ?? BALL_REST, cz = BALL_ENTRY.z, R = BALL_RADIUS * 1.004;
  const n = 40;
  for (let lat = -60; lat <= 60; lat += 30) {
    const phi = (lat * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const r = R * Math.cos(phi), y = cy + R * Math.sin(phi);
      seg(o, [cx + r * Math.cos(a0), y, cz + r * Math.sin(a0)], [cx + r * Math.cos(a1), y, cz + r * Math.sin(a1)], lat === 0 ? 1 : 0);
    }
  }
  for (let lon = 0; lon < 180; lon += 30) {
    const th = (lon * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a: number): [number, number, number] => [cx + R * Math.cos(a) * Math.cos(th), cy + R * Math.sin(a), cz + R * Math.cos(a) * Math.sin(th)];
      seg(o, p(a0), p(a1));
    }
  }
  return o;
}

/** 把一组线段切成正好 n 条短线（按长度分配，每条线段至少一条；长线段被等分）。 */
function allocate(all: S3[], n: number): S3[] {
  const len3 = (s: S3) => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2]);
  // 线段比短线还多（只发生在缩小的回顾小片里）：只留最长的 n 段，小细节省略
  const segs = all.length <= n ? all : all.map((s, i) => [len3(s), i] as [number, number]).sort((p, q) => q[0] - p[0] || p[1] - q[1]).slice(0, n).sort((p, q) => p[1] - q[1]).map(([, i]) => all[i]!);
  const lens = segs.map(len3);
  const total = lens.reduce((x, y) => x + y, 0);
  const cnt = lens.map(() => 1);
  let left = n - segs.length;
  const want = lens.map((l) => (l / total) * left);
  want.forEach((w, i) => { cnt[i]! += Math.floor(w); });
  left = n - cnt.reduce((x, y) => x + y, 0);
  const order = want.map((w, i) => [w - Math.floor(w), i] as [number, number]).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (let k = 0; k < left; k++) cnt[order[k % order.length]![1]]! += 1;
  const out: S3[] = [];
  segs.forEach((s, i) => {
    const c = cnt[i]!;
    for (let k = 0; k < c; k++) {
      const u0 = k / c, u1 = (k + 1) / c;
      const at = (u: number) => s.a.map((v, ax) => v + (s.b[ax]! - v) * u) as [number, number, number];
      out.push({ a: at(u0), b: at(u1), red: s.red });
    }
  });
  // 打散顺序，让迁移时每个造型的各部分同时出发（固定种子）
  const idx = out.map((_, i) => i).sort((p, q) => hash(p * 1.37 + 5) - hash(q * 1.37 + 5));
  return idx.map((i) => out[i]!);
}

// ---------- 场景与镜头 ----------
/** 每次闪回（段内拍）后换成的场景：0 城墙，1 大桥，2 中山陵，3 秦淮，4 梧桐，5 回顾 → 玻璃球。 */
const SCENE_AT = [0, 3.5, 8, 11.5, 16, 19.5];
export function glitchScene(b: number) { let k = 0; for (let i = 0; i < SCENE_AT.length; i++) if (b >= SCENE_AT[i]!) k = i; return k; }
/** 迁移窗口（段内拍，映射后的时间）：[从, 到, 开始, 结束]。前五次都在闪屏里完成；最后一次是看得见的"汇成玻璃球"。 */
const MOVES: [number, number, number, number][] = [
  [0, 1, 2.95, 3.45], [1, 2, 7.0, 7.9], [2, 3, 10.9, 11.45], [3, 4, 15.0, 15.9], [4, 5, 18.9, 19.45], [5, 6, 20, 21.9],
];
type Pose = { pos: [number, number, number]; look: [number, number, number] };

/** 每个场景的机位（u = 进入该场景后的拍数）。第 6 场景结尾与原镜头完全一致，青年段从这里接。 */
function poseAt(b: number): Pose {
  const k = glitchScene(b), u = b - SCENE_AT[k]!;
  switch (k) {
    case 0: return { pos: [Math.sin(b * 0.25) * 0.8, Math.cos(b * 0.2) * 0.3, 18.5 + 0.35 * (1 - inOut(b))], look: [0, 0.3 * (1 - inOut(b)), 0] };
    case 1: return { pos: [-9.5 + 0.55 * u, -1.55, 8.6 - 0.2 * u], look: [1.2 + 0.4 * u, -0.25, -1] }; // 江面低机位斜看大桥
    case 2: return { pos: [0.35, -1.75, 7.2 - 0.8 * u], look: [0, 1.6, -8] }; // 台阶脚下仰望
    case 3: return { pos: [0.5 * Math.sin(u * 0.6), -1.25, 5.5 - 1.1 * u], look: [0, -0.75, -24] }; // 贴着水面向前漂
    case 4: return { pos: [0.6, -1.05, 6.2 - 0.5 * u], look: [0, 1.35, -13] }; // 骑车视角仰看梧桐：抬高视线让树冠进画（用户参考图）
    default: {
      // 19.5–22.5 拍：贴近跟拍下落的球（镜头只跟一半，球从画面上方落进来），看清球里的南京；
      // 22.5 拍最后一次闪屏时切回远景，与青年段第一帧的镜头完全一致
      const follow = (t: number): Pose => {
        const y = glitchBallY(t), u = clamp01((t - 19.5) / 3);
        return { pos: [BALL_ENTRY.x - 1.3 + 0.4 * u, BALL_REST + (y - BALL_REST) * 0.55 + 0.45, 6.4 - 0.6 * u], look: [BALL_ENTRY.x, BALL_REST + (y - BALL_REST) * 0.8, 0] };
      };
      if (b < 22.5) return follow(b);
      // 2026-10-15 Claude（用户 02:09：「这个球短时间换了四种样子，能不能连贯一点」）：
      // 去掉最后一次闪屏和「切回远景」，球落定后镜头直接推近，球里倒映的梧桐越来越大，
      // 24 拍（36.667 秒重拍）球几乎填满画面，青年段从同样填满画面的球拉出来、已经身在梧桐隧道里。
      const from = follow(22.5), k = inOut((b - 22.5) / 1.5);
      const close: Pose = { pos: [BALL_ENTRY.x, BALL_REST + 0.12, 3.3], look: [BALL_ENTRY.x, BALL_REST, 0] };
      const mix = (a: number, c: number) => a + (c - a) * k;
      return {
        pos: [mix(from.pos[0], close.pos[0]), mix(from.pos[1], close.pos[1]), mix(from.pos[2], close.pos[2])],
        look: [mix(from.look[0], close.look[0]), mix(from.look[1], close.look[1]), mix(from.look[2], close.look[2])],
      };
    }
  }
}
/** 第 6 小节的四张回顾小片（世界坐标中心 x, y，宽 w；z = 0 平面，16:9）。二维层按它画细框。 */
export const GLITCH_THUMBS: { x: number; y: number; w: number }[] = [
  { x: -7.7, y: 1.35, w: 3.6 }, { x: -3.7, y: 1.35, w: 3.6 }, { x: -7.7, y: -1.05, w: 3.6 }, { x: -3.7, y: -1.05, w: 3.6 },
];

/**
 * 闪屏 = 算法视觉（用户 10-13 20:53：闪一下时整个世界变成算法视觉，全是结构线、辅助线和分析小彩蛋）。
 * 平时四个南京场景是实体模型（glitchModels.ts，白描渲染）；闪屏时实体消失，只剩 960 条结构线，
 * 叠上 glitchAlgo.ts 画的分析标注。每次闪屏前半段"分析"当前场景，后半段结构线迁移重建成下一个场景，闪回时已是新的实体。
 * 右下角滚动的代码行沿用之前"代码行"方案的文字。
 */
const CODE_COLS = 192, CODE_ROWS = 54; // 1920 / 10 px、1080 / 20 px：每个字符格 10 × 20 逻辑像素

function codeLines(): string[] {
  const h = (n: number) => { const x = Math.sin(n * 91.7 + 13.1) * 43758.5453; return x - Math.floor(x); };
  const f = (n: number, d = 2) => (h(n) * 20 - 10).toFixed(d);
  const pad = (n: number, w: number) => String(Math.floor(n)).padStart(w, '0');
  const hex = (n: number) => '0x' + Math.floor(h(n) * 0xffffffff).toString(16).toUpperCase().padStart(8, '0');
  const T = [
    (i: number) => `wall.brick[${pad(h(i) * 999, 3)}].pos = vec3(${f(i + 1)}, ${f(i + 2)}, ${f(i + 3)});`,
    (i: number) => `bridge.truss[${pad(h(i) * 99, 2)}] = segment(${f(i + 4, 3)}, ${f(i + 5, 3)});`,
    (i: number) => `steps(zhongshanling, n=${392 - Math.floor(h(i) * 40)}, rise=${(0.1 + h(i + 6) * 0.2).toFixed(2)});`,
    (i: number) => `qinhuai.lantern[${pad(h(i) * 64, 2)}].glow = ${h(i + 7).toFixed(2)};`,
    (i: number) => `wutong.branch(depth=${1 + Math.floor(h(i) * 3)}, angle=${f(i + 8, 1)});`,
    () => `for (let i = 0; i < 960; i++) stroke[i].lerp(target[i], t);`,
    () => `// nanjing city wall, 1366-1393, 35.3 km`,
    (i: number) => `if (beat % 4 == 2.5) flash(${h(i).toFixed(3)});`,
    () => `const glass = new Sphere({ r: 1.25, ior: 1.5 });`,
    (i: number) => `${hex(i)} ${hex(i + 1)} ${hex(i + 2)} ${hex(i + 3)}`,
    (i: number) => `city.grid.cell(${Math.floor(h(i) * 32)}, ${Math.floor(h(i + 9) * 32)}).lit = ${h(i + 10) > 0.5};`,
    (i: number) => `yangtze.flow.sample(t=${h(i).toFixed(4)}) -> ${f(i + 11, 3)}`,
    () => `return render(scene, camera);`,
  ];
  const rows: string[] = [];
  let k = 0;
  for (let r = 0; r < CODE_ROWS * 2; r++) {
    let line = ' '.repeat(Math.floor(h(r * 3.3) * 4) * 2); // 缩进
    while (line.length < CODE_COLS) line += T[Math.floor(h(k * 1.7 + 0.3) * T.length)]!(k++) + '  ';
    rows.push(line.slice(0, CODE_COLS));
  }
  return rows;
}


/** 白描合成（与青年段同一套）：法线 / 深度不连续处描墨线，面上按颜色上一层淡彩，朱砂红单独提出。 */
const INK_FRAG = /* glsl */ `
uniform sampler2D tN, tD, tC, tPoster;
uniform float uHasPoster, uNear, uFar, uWutong;
uniform vec2 uTexel;
float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  vec3 paper = uHasPoster > 0.5 ? texture2D(tPoster, vUv).rgb : C_PAPER;
  float d0 = texture2D(tD, vUv).r;
  bool obj = d0 < 0.99999;
  vec2 ox = vec2(uTexel.x, 0.0), oy = vec2(0.0, uTexel.y);
  vec3 nL = texture2D(tN, vUv - ox).xyz, nR = texture2D(tN, vUv + ox).xyz;
  vec3 nU = texture2D(tN, vUv + oy).xyz, nD = texture2D(tN, vUv - oy).xyz;
  float dL = linZ(texture2D(tD, vUv - ox).r), dR = linZ(texture2D(tD, vUv + ox).r);
  float dU = linZ(texture2D(tD, vUv + oy).r), dD = linZ(texture2D(tD, vUv - oy).r);
  float z0 = linZ(d0);
  float zMin = min(z0, min(min(dL, dR), min(dU, dD)));
  float zMax = max(z0, max(max(dL, dR), max(dU, dD)));
  float en = length(nL - nR) + length(nU - nD);
  float ed = (zMax - zMin) / max(zMin, 1e-3);
  float edge = max(smoothstep(0.4, 0.7, en), smoothstep(0.045, 0.08, ed));
  float far = mix(1.0, 0.35, smoothstep(12.0, 60.0, zMin));
  vec3 col = paper;
  if (obj) {
    vec3 c = texture2D(tC, vUv).rgb;
    float mx = max(c.r, max(c.g, c.b));
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = clamp(c / max(mx, 0.3), 0.0, 1.0);
    float wash = (0.16 + 0.3 * (1.0 - clamp(lum * 1.4, 0.0, 1.0))) * far;
    col = C_PAPER * mix(vec3(1.0), tint * 0.85 + 0.15, wash); // 实体表面用纯纸色：背景板的地面网格不透到模型上
    float redness = (c.r - max(c.g, c.b)) / max(c.r, 1e-3);
    col = mix(col, C_RED * 0.95, smoothstep(0.6, 0.8, redness) * step(0.04, c.r) * 0.92);
    float solid = 1.0 - smoothstep(0.004, 0.02, mx);
    col = mix(col, C_INK * 1.3, solid);
    float foliage = step(0.18, (c.g - max(c.r, c.b)) / max(c.g, 1e-3)) * uWutong;
    col = mix(col, mix(C_PAPER, c, 0.88 * far), foliage);
  }
  col = mix(col, C_INK * 1.5, clamp(edge * far, 0.0, 1.0) * 0.92);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** 算法视觉合成：结构线画面 + 二维分析标注。 */
/**
 * 球里的南京：像水晶球一样，球里是倒过来、边缘被拉弯的微缩画面（取自 tScene），
 * 外加菲涅耳亮边、一点高光和与真玻璃球一致的经纬线（纬线 ±60° 每 30°，经线每 30°）。
 */
const LENS_VERT = /* glsl */ `
varying vec3 vN, vV, vP;
void main() {
  vP = normalize(position);
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const LENS_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform vec3 uPaper, uInk;
varying vec3 vN, vV, vP;
float gridLine(float x, float period) { float d = abs(fract(x / period + 0.5) - 0.5) * period; float w = fwidth(x) * 1.2; return 1.0 - smoothstep(0.0, w, d); }
void main() {
  vec3 n = normalize(vN), v = normalize(vV);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  vec2 q = n.xy * (1.0 + 0.45 * (1.0 - ndv));           // 越靠边拉得越弯
  vec2 uv = vec2(0.5) - vec2(q.x * 0.27, q.y * 0.42);    // 倒像（取画面中间一块，放大一些）
  vec3 col = texture2D(tScene, clamp(uv, 0.0, 1.0)).rgb;
  col = mix(col, uPaper, 0.1);
  col *= 0.82 + 0.18 * ndv;
  float fres = pow(1.0 - ndv, 3.0);
  col = mix(col, uPaper * 1.08, fres * 0.75);
  col = mix(col, uInk * 2.0, (1.0 - smoothstep(0.0, 0.16, ndv)) * 0.55); // 轮廓
  vec3 L = normalize(vec3(-0.5, 0.75, 0.55));
  col += vec3(1.0) * pow(max(dot(reflect(-L, n), v), 0.0), 70.0) * 0.9;
  float lat = degrees(asin(clamp(vP.y, -1.0, 1.0)));
  float lon = degrees(atan(vP.z, vP.x));
  float lines = max(gridLine(lat, 30.0) * step(abs(lat), 61.0), gridLine(lon, 30.0) * step(abs(lat), 89.0));
  col = mix(col, uInk, lines * 0.35);
  gl_FragColor = vec4(col, 1.0);
}`;

const ALGO_FRAG = /* glsl */ `
uniform sampler2D tIn, tOv;
void main() {
  vec3 base = texture2D(tIn, vUv).rgb;
  vec4 ov = texture2D(tOv, vUv);
  gl_FragColor = vec4(mix(base, ov.rgb, ov.a), 1.0);
}
`;

/** 每个造型（0–6）在算法视觉里的识别目标。数据 2026-10-13 查证（见回复里的来源）。 */
function algoTarget(k: number): AlgoTarget {
  const g = G;
  switch (k) {
    case 0: return { tag: 'CITY_WALL', name: '南京明城墙', conf: 0.98, facts: ['1366–1393 年筑成', '京城城墙原长 35.267 km', '现存约 25.1 km'], box: [[-7.9, -2.9, -0.2], [7.9, 2.9, 0.2]], dim: { a: [-7.75, -3.4, 0], b: [7.75, -3.4, 0], label: '原长 35.267 km' } };
    case 1: return {
      tag: 'BRIDGE', name: '南京长江大桥', conf: 0.97, facts: ['1968 年建成通车', '铁路桥 6772 m · 公路桥 4588 m', '主跨 160 m'],
      box: [[-11.3, g, -1.1], [11.3, 3.3, 1.1]], dim: { a: [0, -1.15, 1], b: [4, -1.15, 1], label: '主跨 160 m' },
      subs: [-11.4, 10].flatMap((cx) => [-0.38, 0, 0.38].map((dx) => ({ at: [cx + dx + 0.2, 3.1, 0] as [number, number, number], r: 0.22, tag: 'FLAG' }))),
    };
    case 2: return { tag: 'MAUSOLEUM', name: '中山陵', conf: 0.96, facts: ['1926–1929 年建成', '392 级台阶', '蓝色琉璃瓦'], box: [[-4.2, g, -15.3], [4.2, 5.3, 1.5]], dim: { a: [0, g + 0.08, 1.3], b: [0, g + 30 * 0.16 + 0.08, -10.9], label: '392 级' } };
    case 3: {
      const subs: AlgoTarget['subs'] = [];
      for (let j = 0; j < 6; j++) for (const lx of [-2.1, -0.7, 0.7, 2.1]) {
        const z = -1 - j * 4.2, yc = 0.9 - 0.7 * (1 - (lx / 3.4) ** 2);
        subs.push({ at: [lx, yc - 0.38, z], r: 0.22, tag: 'LANTERN' });
      }
      return { tag: 'RIVER', name: '秦淮河', conf: 0.95, facts: ['十里秦淮 · 内秦淮约 5 km', `lantern.count = ${subs.length}`, '粉墙黛瓦 · 马头墙'], box: [[-3.4, g, -22], [3.4, 1.0, 2]], subs };
    }
    case 4: return {
      tag: 'PLANE_TREE', name: '梧桐大道', conf: 0.96, facts: ['1928 年为迎接奉安大典种植', '悬铃木（法国梧桐）', `tree.count = ${WUTONG_TREES.length}`],
      box: [[-4, g, -24], [4, 2.2, 2]], subs: WUTONG_TREES.map((t) => ({ at: [t.x, g + t.h * 0.35, t.z] as [number, number, number], r: 0.35, tag: 'TREE' })),
    };
    case 5: { const y = BALL_REST + BALL_DROP; return { tag: 'GLASS_SPHERE', name: '玻璃球', conf: 0.98, facts: ['r = 1.25', `drop h = ${BALL_DROP.toFixed(1)}`, 'lens → 南京 × 5'], box: [[BALL_ENTRY.x - 1.25, y - 1.25, -1.25], [BALL_ENTRY.x + 1.25, y + 1.25, 1.25]] }; }
    default: return {
      tag: 'GLASS_SPHERE', name: '玻璃球', conf: 0.99, facts: ['r = 1.25', '经线 6 · 纬线 5', 'next → 青年'],
      box: [[BALL_ENTRY.x - 1.25, BALL_ENTRY.floor, -1.25], [BALL_ENTRY.x + 1.25, BALL_ENTRY.floor + 2.5, 1.25]],
      dim: { a: [BALL_ENTRY.x, BALL_ENTRY.floor + 1.25, 0], b: [BALL_ENTRY.x + 1.25, BALL_ENTRY.floor + 1.25, 0], label: 'r = 1.25' },
    };
  }
}

const FLASH_WINDOWS: [number, number][] = [
    [2.5, 3.5],    // 第 1 小节：静音时闪回
    [6.5, 8],      // 第 2 小节：下一小节开头闪回
    [10.5, 11.5],  // 第 3 小节（切片中）：静音时闪回
    [14.5, 16],    // 第 4 小节：下一小节开头闪回
    [18.5, 19.5],  // 第 5 小节（切片中）：静音时闪回
    [22.5, 24],    // 第 6 小节：算法凝视（用户 02:18 要保留这一拍；02:22 要一直延长到 36.667 秒切青年段）；镜头沿推近路径连续走，线框球与玻璃球同位同大，闪回后仍是倒映梧桐的玻璃球
];

/** 第 b 拍是否处在二进制世界（每小节一次，同一个底鼓进入，见 PROGRESS）。 */
export function glitchBinaryAt(b: number): boolean {
  // 用户 01:13：要在二进制世界里停留更久，再猛地闪回（按小节安排，闪回落在静音或底鼓上）
  // 用户 01:27：节拍要统一——每个小节闪一次，都从同一个底鼓（小节开始后 2.5 拍）进入，在静音或下一小节开头闪回
  const win = FLASH_WINDOWS;
  return win.some(([a, c]) => b >= a && b < c);
}

/** 第 b 拍（真实时间）所在闪屏的序号（1–6）与进度 0..1；不在闪屏里返回 null。 */
export function glitchFlashAt(b: number): { index: number; u: number } | null {
  for (let i = 0; i < FLASH_WINDOWS.length; i++) { const [a, c] = FLASH_WINDOWS[i]!; if (b >= a && b < c) return { index: i + 1, u: (b - a) / (c - a) }; }
  return null;
}


const LINE_VERT = /* glsl */ `
attribute vec4 aCol;
varying vec4 vCol;
void main() { vCol = aCol; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const LINE_FRAG = /* glsl */ `
varying vec4 vCol;
void main() { gl_FragColor = vCol; }`;

export default class GlitchLayer implements Layer3D {
  private backdropTypography = new GlitchBackdropTypography();
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 100);
  private rt = makeRT(W, H, { depth: true });
  private copy = new FSPass(`uniform sampler2D tIn; void main(){ gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }`, { tIn: { value: null } });
  private paper = lin(PALETTE.paper);
  private bricks!: THREE.InstancedMesh;
  private strokes!: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private wallPos: THREE.Vector3[] = [];
  private arrayPos: THREE.Vector3[] = [];
  private dummy = new THREE.Object3D();
  private algoPass = new FSPass(ALGO_FRAG, { tIn: { value: null }, tOv: { value: null } });
  private algo?: AlgoOverlay;
  private code = codeLines();
  /** 四个实体场景（下标 = 场景号 1–4），白描渲染用的法线 / 深度 / 合成。 */
  private solids: THREE.Group[] = [];
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8a8780, 0.9); // 只给实体场景补暗面，免得背光面在白描里压成死黑
  private rtN!: THREE.WebGLRenderTarget;
  private rtInk = makeRT(W, H);
  private normalMat = new THREE.MeshNormalMaterial();
  private inkPass = new FSPass(INK_FRAG, {
    tN: { value: null }, tD: { value: null }, tC: { value: null }, tPoster: { value: null }, uHasPoster: { value: 0 }, uWutong: { value: 0 },
    uNear: { value: 0.1 }, uFar: { value: 100 }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
  });
  /** 每个造型下每条短线的两个端点（K × 6）、红色标记（K）、可见度（K）。造型 0–6 见 MOVES。 */
  private shapes: { p: Float32Array; red: Float32Array; vis: Float32Array }[] = [];
  private pos = new Float32Array(K * 6);
  private col = new Float32Array(K * 8);
  private ink = lin(PALETTE.ink);
  private redC = lin(PALETTE.red);
  /** 梧桐树冠：多边形轮廓线（P2 风格，描边不填充）。独立于 960 条短线，只按场景淡入淡出。 */
  private canopyLines?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private ball = createRollingBall();
  /** 第 6 小节下落中的"水晶球"（透镜着色）；五个南京的微缩画面按需渲染一次后缓存。 */
  private lensBall!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private lensRT: (THREE.WebGLRenderTarget | null)[] = [null, null, null, null, null];
  private ballShadow = createBallShadow();

  get models(): readonly THREE.Group[] {
    return this.solids;
  }

  async init(r: THREE.WebGLRenderer) {
    this.rt.samples = 4;
    this.scene.environment = softStudioEnv(r);
    this.scene.environmentIntensity = 0.9;
    this.ball.position.set(BALL_ENTRY.x, BALL_ENTRY.floor + BALL_RADIUS, BALL_ENTRY.z);
    this.ballShadow.position.set(BALL_ENTRY.x, BALL_ENTRY.floor + 0.015, BALL_ENTRY.z);
    this.scene.add(this.ball, this.ballShadow);
    this.lensBall = new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 96, 64), new THREE.ShaderMaterial({
      vertexShader: LENS_VERT, fragmentShader: LENS_FRAG,
      uniforms: { tScene: { value: null }, uPaper: { value: lin(PALETTE.paper) }, uInk: { value: lin(PALETTE.ink) } },
      extensions: { derivatives: true } as never,
    }));
    this.lensBall.position.set(BALL_ENTRY.x, BALL_REST, BALL_ENTRY.z);
    this.lensBall.visible = false;
    this.scene.add(this.lensBall);
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(-4, 6, 8);
    this.scene.add(key);

    // 实体场景（平时显示；闪屏时换成结构线）
    this.rtN = new THREE.WebGLRenderTarget(this.rt.width, this.rt.height, { depthBuffer: true });
    this.rtN.depthTexture = new THREE.DepthTexture(this.rt.width, this.rt.height, THREE.UnsignedIntType);
    this.solids = [new THREE.Group(), buildBridge(G), buildMausoleum(G), buildQinhuai(G), buildWutong(G)];
    for (const sg of this.solids) { sg.visible = false; this.scene.add(sg); }
    this.hemi.visible = false;
    this.scene.add(this.hemi);

    // 砖：起点 = 错缝砌法的墙面（带一点松动），终点 = 整齐砖阵
    for (let r = 0; r < AR; r++) {
      for (let c = 0; c < AC; c++) {
        const i = r * AC + c;
        const off = r % 2 ? BW / 2 : 0;
        this.wallPos.push(new THREE.Vector3((c - AC / 2) * BW + off + (hash(i) - 0.5) * 0.25, (r - AR / 2) * BH + (hash(i + 9) - 0.5) * 0.2, (hash(i + 3) - 0.5) * 0.6));
        this.arrayPos.push(new THREE.Vector3((c - (AC - 1) / 2) * BW * 1.02, (r - (AR - 1) / 2) * BH * 1.3, 0));
      }
    }
    const geo = new RoundedBoxGeometry(BW * 0.96, BH * 0.92, BD, 3, 0.035);
    const mat = new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.wall), roughness: 0.6, clearcoat: 0.55, clearcoatRoughness: 0.35 });
    this.bricks = new THREE.InstancedMesh(geo, mat, N);
    const brickRed: boolean[] = [];
    for (let i = 0; i < N; i++) {
      const h = hash(i + 21);
      brickRed.push(h > 0.94);
      this.bricks.setColorAt(i, h > 0.94 ? lin(PALETTE.red).multiplyScalar(1 / Math.max(0.01, lin(PALETTE.wall).r)) : new THREE.Color().setScalar(0.8 + 0.3 * hash(i + 11)));
    }
    this.bricks.frustumCulled = false;
    this.scene.add(this.bricks);

    // 造型 0：每块（扫描后扁平的）数据方块的四条边
    const s0: S3[] = [];
    const hw = BW * 0.48, hh = BH * 0.46, zf = BD * 0.15;
    this.arrayPos.forEach((a, i) => {
      const c: [number, number, number][] = [[a.x - hw, a.y - hh, zf], [a.x + hw, a.y - hh, zf], [a.x + hw, a.y + hh, zf], [a.x - hw, a.y + hh, zf]];
      for (let e = 0; e < 4; e++) seg(s0, c[e]!, c[(e + 1) % 4]!, brickRed[i] ? 1 : 0);
    });
    const pack = (list: S3[], vis?: Float32Array) => {
      const p = new Float32Array(K * 6), red = new Float32Array(K);
      list.forEach((sg, i) => { p.set(sg.a, i * 6); p.set(sg.b, i * 6 + 3); red[i] = sg.red; });
      return { p, red, vis: vis ?? new Float32Array(K).fill(1) };
    };
    this.shapes.push(pack(s0)); // 0 城墙数据方块
    const raw = [bridgeShape(), stepsShape(), qinhuaiShape(), wutongShape()];
    const scenes = raw.map((sh) => allocate(sh, K));
    for (const sc of scenes) this.shapes.push(pack(sc)); // 1–4
    this.shapes.push(pack(allocate(ballShape(BALL_REST + BALL_DROP), K))); // 5 刚出现在画面上方的玻璃球
    this.shapes.push(pack(allocate(ballShape(), K))); // 6 落地停稳的玻璃球

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.strokes = new THREE.LineSegments(pg, new THREE.ShaderMaterial({ vertexShader: LINE_VERT, fragmentShader: LINE_FRAG, transparent: true, depthWrite: false }));
    this.strokes.frustumCulled = false;
    this.scene.add(this.strokes);

    // 梧桐树冠：P2 风格——不规则多边形**轮廓线**，不填充；以枝梢坐标为中心生成。
    // 用 LineSegments 而不是三角网格：把每个多边形的相邻顶点配对成线段即可。
    this.placeCam(16);
    const lineVerts = canopyClusters(this.cam);
    if (lineVerts.length > 0) {
      const cg = new THREE.BufferGeometry();
      const capacity = WUTONG_MODEL.parts.reduce((count, part) => count + part.edges.length * 6, 0);
      const positions = new Float32Array(capacity);
      positions.set(lineVerts);
      cg.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      cg.setDrawRange(0, lineVerts.length / 3);
      this.canopyLines = new THREE.LineSegments(
        cg,
        new THREE.LineBasicMaterial({
          color: this.ink.clone(),
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        }),
      );
      this.canopyLines.frustumCulled = false;
      this.canopyLines.visible = false;
      this.scene.add(this.canopyLines);
    }
  }

  /** 镜头：每个场景一个机位（三维与二维背景板共用）。 */
  private placeCam(b: number) {
    const p = poseAt(b);
    this.cam.fov = 35;
    this.cam.near = 0.1;
    this.cam.far = 100;
    this.cam.zoom = 1;
    this.cam.up.set(0, 1, 0);
    this.cam.clearViewOffset();
    this.cam.updateProjectionMatrix();
    this.cam.position.set(...p.pos);
    this.cam.lookAt(...p.look);
    this.cam.updateMatrixWorld(true);
  }

  /** 二维背景板按同一镜头投影（切片 / 静音时与三维一起卡住）。 */
  backgroundCamera(f: Frame) {
    this.placeCam(this.stateOf(f).camB);
    return this.cam.clone();
  }

  private beatOf(f: Frame) {
    return (glitchTime(f.t) - f.sectionStart) / BEAT;
  }

  /**
   * 这一帧的状态（用户 10-13 21:11：闪屏不要线条飞散重组，只要"实体闪成结构线 → 硬切到下一个场景的结构线 → 闪回实体"）：
   * shape = 闪屏里显示哪个造型的结构线（前半段 = 当前场景，后半段 = 下一个场景）；camB = 镜头用的拍。
   */
  private stateOf(f: Frame) {
    const b = this.beatOf(f), raw = f.lt / BEAT;
    const flash = glitchFlashAt(raw);
    const kRaw = glitchScene(raw);
    if (flash) {
      const second = flash.u >= 0.5;
      const shape = kRaw >= 5 ? 6 : second ? kRaw + 1 : kRaw;
      const camB = second && kRaw < 5 ? SCENE_AT[kRaw + 1]! : b;
      return { b, flash, kRaw, solid: false, shape, camB, half: second ? (flash.u - 0.5) * 2 : flash.u * 2 };
    }
    const solid = kRaw >= 1 && kRaw <= 4;
    // 实体按真实时间判断场景：闪屏后紧跟的静音冻结会把画面时间拉回闪屏之前，镜头停在新场景的第一帧
    const camB = solid && glitchScene(b) !== kRaw ? Math.max(b, SCENE_AT[kRaw]!) : b;
    return { b, flash, kRaw, solid, shape: -1, camB, half: 0 };
  }

  /** 闪屏时直接把短线摆成某个造型的结构线（不做迁移动画）。 */
  private snapStrokes(idx: number) {
    const S = this.shapes[idx]!, ink = this.ink, rc = this.redC;
    this.pos.set(S.p);
    for (let i = 0; i < K; i++) {
      const red = S.red[i]!, r = ink.r + (rc.r - ink.r) * red, g = ink.g + (rc.g - ink.g) * red, bl = ink.b + (rc.b - ink.b) * red;
      for (let e = 0; e < 2; e++) { const o = i * 8 + e * 4; this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = bl; this.col[o + 3] = 0.9 * S.vis[i]!; }
    }
    this.strokes.geometry.getAttribute('position').needsUpdate = true;
    this.strokes.geometry.getAttribute('aCol').needsUpdate = true;
  }

  anchors(f: Frame) {
    const b = this.beatOf(f);
    if (b < 20) return { figureFeet: null, figureHead: null };
    this.placeCam(b);
    const proj = (x: number, y: number): [number, number] => {
      const v = new THREE.Vector3(x, y, FIGURE_ANCHOR.z).project(this.cam);
      return [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H];
    };
    return {
      figureFeet: proj(FIGURE_ANCHOR.x, FIGURE_ANCHOR.y),
      figureHead: proj(FIGURE_ANCHOR.x, FIGURE_ANCHOR.y + 2 * BALL_RADIUS), // 现在是玻璃球顶
    };
  }

  /** 第 b 拍所有短线的位置与颜色（只依赖 b）。 */
  private updateStrokes(b: number) {
    let mv = -1;
    for (let m = 0; m < MOVES.length; m++) if (b >= MOVES[m]![2]) mv = m;
    const ink = this.ink, rc = this.redC;
    for (let i = 0; i < K; i++) {
      let A = this.shapes[0]!, B = A, p = 0;
      if (mv >= 0) {
        const [from, to, t0, t1] = MOVES[mv]!;
        A = this.shapes[from]!; B = this.shapes[to]!;
        const span = t1 - t0, delay = hash(i * 0.73 + mv * 11) * 0.35 * span, dur = span * 0.65;
        p = smooth((b - t0 - delay) / dur);
      }
      const lane = i % 3, bend = [-1.8, 1.2, 2.5][lane]!;
      for (let e = 0; e < 2; e++) {
        const o = i * 6 + e * 3;
        for (let ax = 0; ax < 3; ax++) {
          const s = A.p[o + ax]!, t = B.p[o + ax]!;
          const ctrl = (s + t) * 0.5 + (ax === 1 ? bend : ax === 2 ? -0.5 * lane : 0);
          this.pos[o + ax] = (1 - p) * (1 - p) * s + 2 * (1 - p) * p * ctrl + p * p * t;
        }
      }
      const red = A.red[i]! + (B.red[i]! - A.red[i]!) * p;
      const vis = A.vis[i]! + (B.vis[i]! - A.vis[i]!) * p;
      const r = ink.r + (rc.r - ink.r) * red, g = ink.g + (rc.g - ink.g) * red, bl = ink.b + (rc.b - ink.b) * red;
      for (let e = 0; e < 2; e++) { const o = i * 8 + e * 4; this.col[o] = r; this.col[o + 1] = g; this.col[o + 2] = bl; this.col[o + 3] = 0.9 * vis; }
    }
    this.strokes.geometry.getAttribute('position').needsUpdate = true;
    this.strokes.geometry.getAttribute('aCol').needsUpdate = true;
  }

  /** 白描：1) 法线 + 深度  2) 颜色（只取淡彩）  3) 合成到纸面（poster = 同镜头的二维背景板）。 */
  private inkRender(r: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, poster?: THREE.Texture) {
    this.scene.background = null;
    this.scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.rtN);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(this.scene, this.cam);
    this.scene.overrideMaterial = null;
    this.scene.background = this.paper;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, this.cam);
    const u = this.inkPass.u;
    u.tN!.value = this.rtN.texture;
    u.tD!.value = this.rtN.depthTexture;
    u.tC!.value = this.rt.texture;
    u.tPoster!.value = poster ?? null;
    u.uHasPoster!.value = poster ? 1 : 0;
    u.uWutong!.value = this.solids[4]!.visible ? 1 : 0;
    u.uNear!.value = this.cam.near;
    u.uFar!.value = this.cam.far;
    this.inkPass.render(r, out);
    if (poster) this.backdropTypography.render(r, this.cam, out, this.rtN.depthTexture!, this.solids);
  }

  /** 球里的第 k 个南京（0 城墙 … 4 梧桐）：用各自场景的机位渲染一次，之后缓存。只依赖 k，可乱序取帧。 */
  private renderLens(r: THREE.WebGLRenderer, k: number) {
    const target = makeRT(W, H, { depth: true });
    this.strokes.visible = false; this.ball.visible = false; this.ballShadow.visible = false; this.lensBall.visible = false;
    if (this.canopyLines) this.canopyLines.visible = false;
    this.solids.forEach((g, i) => { g.visible = k >= 1 && i === k; });
    this.hemi.visible = k >= 1;
    this.bricks.visible = k === 0;
    if (k === 0) {
      // 城墙：错缝砌法的砖墙（扫描之前的样子）
      for (let i = 0; i < N; i++) {
        this.dummy.position.copy(this.wallPos[i]!);
        this.dummy.rotation.set((hash(i + 4) - 0.5) * 0.4, (hash(i + 5) - 0.5) * 0.4, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.bricks.setMatrixAt(i, this.dummy.matrix);
      }
      this.bricks.instanceMatrix.needsUpdate = true;
      this.placeCam(1.0);
      this.scene.background = this.paper;
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.scene, this.cam);
    } else {
      this.placeCam(SCENE_AT[k]! + 1.2);
      this.inkRender(r, target);
    }
    this.lensRT[k] = target;
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget, ctx?: Layer3DContext): PostParams {
    const st = this.stateOf(f), b = st.b, flash = st.flash, solid = st.solid;
    // 第 6 小节：下落中的球里闪过五个南京（每半拍一个）
    const lens = !flash && st.kRaw === 5 && b < 24; // 球里的梧桐倒影一直保持到交给青年段
    const lk = lensSceneAt(b);
    if (lens && !this.lensRT[lk]) this.renderLens(r, lk);
    this.scene.background = ctx?.poster ?? this.paper;
    this.placeCam(st.camB);
    if (ctx?.camera) this.cam.copy(ctx.camera);

    // 0–2.3 拍：红色扫描线从左扫到右，扫过的砖从错落的墙变成整齐、扁平的“数据方块”；2.5 拍（第一次闪屏）起换成短线
    const showBricks = !flash && b < 2.5;
    this.bricks.visible = showBricks;
    if (showBricks) {
      const scan = glitchScanX(b);
      for (let i = 0; i < N; i++) {
        const w = this.wallPos[i]!, a = this.arrayPos[i]!;
        const m = inOut((scan - w.x) / 1.2);
        this.dummy.position.lerpVectors(w, a, m);
        this.dummy.rotation.set((1 - m) * (hash(i + 4) - 0.5) * 0.4, (1 - m) * (hash(i + 5) - 0.5) * 0.4, 0);
        this.dummy.scale.set(1, 1, 1 - 0.7 * m); // 扫描后变扁平
        this.dummy.updateMatrix();
        this.bricks.setMatrixAt(i, this.dummy.matrix);
      }
      this.bricks.instanceMatrix.needsUpdate = true;
    }
    // 平时：场景 1–4 显示实体模型（白描）；闪屏：实体消失，只剩结构线 + 分析标注（闪屏按真实时间判断）
    this.hemi.visible = solid;
    this.solids.forEach((g, i) => { g.visible = solid && i === st.kRaw; });
    this.strokes.visible = !!flash; // 结构线只在闪屏里出现
    this.ball.visible = false; // 2026-10-15 Claude：不再换成空白的真球，透镜球一直到段尾
    this.lensBall.visible = lens;
    if (lens) {
      this.lensBall.position.y = glitchBallY(b);
      this.lensBall.material.uniforms.tScene!.value = this.lensRT[lk]!.texture;
    }
    // 影子：球越高影子越小越淡
    const h = Math.max(0, glitchBallY(b) - BALL_REST);
    this.ballShadow.visible = this.ball.visible || lens;
    this.ballShadow.scale.setScalar(1 / (1 + h * 0.25));
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = 0.12 * Math.max(0, 1 - h / 7);
    if (flash) this.snapStrokes(st.shape);
    else if (!showBricks) this.updateStrokes(b);

    // 梧桐树冠的多边形轮廓：只在闪屏的结构线画面里出现（实体画面里是立体树冠），跟着迁移淡入淡出
    if (this.canopyLines) {
      this.canopyLines.visible = !!flash && st.shape === 4;
      this.canopyLines.material.opacity = 0.38;
      if (this.canopyLines.visible) {
        const positions = this.canopyLines.geometry.getAttribute('position');
        const contours = canopyClusters(this.cam);
        (positions.array as Float32Array).set(contours);
        positions.needsUpdate = true;
        this.canopyLines.geometry.setDrawRange(0, contours.length / 3);
      }
    }

    if (solid) {
      this.inkRender(r, out, ctx?.poster);
    } else {
      r.setRenderTarget(this.rt);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.scene, this.cam);
      if (flash) {
        // 算法视觉：前半段分析当前场景的结构线，后半段硬切到下一个场景的结构线（标注重新锁定一次）
        this.algo ??= new AlgoOverlay();
        this.algo.draw({
          cam: this.cam, target: algoTarget(st.shape), index: flash.index, u: st.half, t: f.t, beat: b, frame: f.frame,
          verts: this.pos, code: this.code, morph: false,
        });
        this.algoPass.u.tIn!.value = this.rt.texture;
        this.algoPass.u.tOv!.value = this.algo.texture;
        this.algoPass.render(r, out);
      } else {
        this.copy.u.tIn!.value = this.rt.texture;
        this.copy.render(r, out);
      }
    }

    const jit = f.env.stutter * 6;
    return {
      bloom: 0.15,
      bloomThreshold: 2,
      halation: 0,
      ca: flash ? 0 : 0.05 + 0.6 * f.env.stutter, // 算法视觉不要彩色重影，线和字要干净
      shake: [jit * Math.sin(f.frame * 2.1), jit * Math.cos(f.frame * 1.7)],
      grain: 0.03,
    };
  }
}
