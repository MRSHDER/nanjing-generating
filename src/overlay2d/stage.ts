// 二维“空间背景板”共用工具（负责人：Claude，2026-10-12 用户要求“平面背景服务三维主体”后新增）。
// 二维图形不再是固定贴图：画在三维世界坐标里，用三维这一帧的真实镜头投影（沿用 Codex spatial.ts 的视锥裁切），
// 所以镜头推拉摇移、物体旋转时，背景跟着一起动。颜色仍按遮罩角色（muted / signal / foreground）由合成器上色。
import type { PerspectiveCamera } from 'three';
import { OVERLAY_HEIGHT, OVERLAY_WIDTH, type OverlayMask, type OverlayRole } from './boot';
import { projectPath } from './spatial';

export type P3 = [number, number, number];
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
export const inOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

export interface Stage {
  masks: OverlayMask[];
  /** behind/front × muted/signal/foreground 的画布 */
  ctx: (layer: 'behind' | 'front', role: OverlayRole) => CanvasRenderingContext2D;
  clear: () => void;
}

export function createStage(): Stage {
  const masks: OverlayMask[] = [];
  const map = new Map<string, CanvasRenderingContext2D>();
  for (const layer of ['behind', 'front'] as const) {
    for (const role of ['muted', 'signal', 'foreground'] as OverlayRole[]) {
      const canvas = document.createElement('canvas');
      canvas.width = OVERLAY_WIDTH;
      canvas.height = OVERLAY_HEIGHT;
      const c = canvas.getContext('2d');
      if (!c) throw new Error('二维层需要 Canvas 2D');
      map.set(`${layer}/${role}`, c);
      masks.push({ canvas, role, layer });
    }
  }
  return {
    masks,
    ctx: (layer, role) => map.get(`${layer}/${role}`)!,
    clear() {
      for (const c of map.values()) {
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.globalAlpha = 1;
        c.globalCompositeOperation = 'source-over';
        c.setLineDash([]);
        c.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
        c.fillStyle = '#ffffff';
        c.strokeStyle = '#ffffff';
        c.lineCap = 'round';
        c.lineJoin = 'round';
      }
    },
  };
}

/** 世界坐标折线 → 投影后描边（逐段裁切，镜头背后的部分不画）。 */
export function line3(c: CanvasRenderingContext2D, cam: PerspectiveCamera, pts: P3[], alpha: number, width = 1.5, closed = false) {
  if (alpha <= 0.002) return;
  c.save();
  c.globalAlpha = clamp01(alpha);
  c.lineWidth = width;
  c.beginPath();
  const n = closed ? pts.length : pts.length - 1;
  let open = false;
  let last: [number, number] | null = null;
  for (let i = 0; i < n; i++) {
    const seg = projectPath([pts[i]!, pts[(i + 1) % pts.length]!], cam);
    if (seg.length < 2) { open = false; continue; }
    const [a, b] = [seg[0]!, seg[seg.length - 1]!];
    if (!open || !last || Math.abs(last[0] - a[0]) > 0.5 || Math.abs(last[1] - a[1]) > 0.5) c.moveTo(a[0], a[1]);
    c.lineTo(b[0], b[1]);
    last = b;
    open = true;
  }
  c.stroke();
  c.restore();
}

/** 世界坐标多边形 → 投影后填充。 */
export function fill3(c: CanvasRenderingContext2D, cam: PerspectiveCamera, pts: P3[], alpha: number) {
  if (alpha <= 0.002) return;
  const poly = projectPath(pts, cam, true);
  if (poly.length < 3) return;
  c.save();
  c.globalAlpha = clamp01(alpha);
  c.beginPath();
  c.moveTo(poly[0]![0], poly[0]![1]);
  for (const p of poly.slice(1)) c.lineTo(p[0], p[1]);
  c.closePath();
  c.fill();
  c.restore();
}

/** 只画折线的前 frac（0..1），用于“描出来”的动画。 */
export function partial(pts: P3[], frac: number): P3[] {
  const f = clamp01(frac);
  if (f >= 1) return pts;
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1], pts[i]![2] - pts[i - 1]![2]); lens.push(d); total += d; }
  let rest = total * f;
  const out: P3[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const d = lens[i - 1]!;
    if (rest >= d) { out.push(pts[i]!); rest -= d; continue; }
    const k = d > 0 ? rest / d : 0;
    const a = pts[i - 1]!, b = pts[i]!;
    out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    break;
  }
  return out;
}

// ───────── 南京的抽象图形（平面坐标 u, v，单位约 1 = 1 公里的示意比例；不是测绘）─────────
const H2 = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** 明城墙：不规则的闭合环（南京城墙不是方城，是依山就水的不规则形）。示意形状。 */
export const CITY_WALL: [number, number][] = (() => {
  const out: [number, number][] = [];
  const N = 72;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // 东北角收、西北沿江拉长、南面较平：用几个低频起伏做出不规则轮廓
    const r = 5.2 + 0.9 * Math.cos(a - 2.3) + 0.55 * Math.sin(2 * a + 0.7) + 0.3 * Math.cos(3 * a - 1.1) + 0.12 * Math.sin(7 * a + H2(3));
    out.push([Math.cos(a) * r * 0.82, Math.sin(a) * r]);
  }
  return out;
})();

/** 长江：从西南流向东北，绕过城的西北侧（中心线）。 */
export const YANGTZE: [number, number][] = Array.from({ length: 40 }, (_, i) => {
  const t = i / 39;
  const u = -16 + t * 32;
  return [u, 7.6 + 0.18 * u + 1.6 * Math.sin(t * 3.4 + 0.6)] as [number, number];
});

/** 秦淮河：在城南绕一个弯（示意）。 */
export const QINHUAI: [number, number][] = Array.from({ length: 30 }, (_, i) => {
  const t = i / 29;
  return [-6 + t * 11, -3.6 - 1.4 * Math.sin(t * Math.PI) + 0.5 * Math.sin(t * 9)] as [number, number];
});

/** 紫金山：城东的山脊轮廓（高度剖面，u → 高）。 */
export const ZIJIN_RIDGE: [number, number][] = Array.from({ length: 40 }, (_, i) => {
  const t = i / 39;
  const h = Math.max(0, Math.sin(t * Math.PI)) * (1 + 0.25 * Math.sin(t * 11) + 0.12 * Math.sin(t * 23 + 1));
  return [t, h] as [number, number];
});

/** 玄武湖：城墙环东北内侧的湖（示意轮廓）。 */
export const XUANWU: [number, number][] = Array.from({ length: 36 }, (_, i) => {
  const a = (i / 36) * Math.PI * 2;
  const r = 1.5 + 0.35 * Math.sin(2 * a + 0.4) + 0.2 * Math.cos(3 * a);
  return [1.6 + Math.cos(a) * r * 1.1, 3.1 + Math.sin(a) * r * 0.8] as [number, number];
});

/** 紫金山等高线：城东的一组不规则同心环（k = 0 最外圈），与地形段的等高线呼应。 */
export function zijinContour(k: number): [number, number][] {
  return Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * Math.PI * 2;
    const r = (3.4 - k * 0.55) * (1 + 0.14 * Math.cos(a * 3 + 0.6 + k * 0.2) + 0.08 * Math.sin(a * 5 - 1.2));
    return [9.6 + Math.cos(a) * r * 1.3, 1.8 + Math.sin(a) * r * 0.8] as [number, number];
  });
}

/** 城内主要道路（示意直线网）。 */
export const STREETS: [number, number][][] = [
  [[-3.6, 0.2], [3.4, 0.6]], [[-3.2, -2.2], [3.8, -1.8]], [[-0.4, -4.4], [0.2, 4.6]], [[-2.6, -4.0], [-2.2, 3.8]], [[2.2, -3.8], [2.6, 1.2]],
];
