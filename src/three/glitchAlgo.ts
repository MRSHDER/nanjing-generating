// 段落 4 闪屏的"算法视觉"叠层（负责人：Claude，2026-10-13 用户提出：闪一下时整个世界变成算法视觉——
// 全是结构线、辅助线，再加一些分析的小彩蛋）。
// 三维部分（结构线 = 960 条短线）在 glitch.ts 里画；这里在一张 1920×1080 的二维画布上画分析标注：
//   透视消失线与地平线、三分线与中心十字、识别框与标签、尺寸线（真实数据，2026-10-13 查证）、
//   子目标小识别框、顶点小点、坐标轴、左上读数、右下滚动代码、扫描条。全部只依赖输入参数，可乱序取帧。
import * as THREE from 'three';
import { W, H } from '../engine/gl';

type V = [number, number, number];
export interface AlgoTarget {
  tag: string; // 英文识别标签
  name: string; // 中文名
  conf: number; // 置信度
  facts: string[]; // 查证过的数据
  box: [V, V]; // 世界坐标包围盒（min, max）
  dim?: { a: V; b: V; label: string }; // 尺寸线
  subs?: { at: V; r: number; tag: string }[]; // 子目标（灯笼、树……）
}

export interface AlgoInput {
  cam: THREE.PerspectiveCamera;
  target: AlgoTarget;
  index: number; // 第几次扫描（1–6）
  u: number; // 本次闪屏内的进度 0..1
  t: number; // 片内秒
  beat: number; // 段内拍
  frame: number;
  verts: Float32Array; // 短线端点（K × 6）
  code: string[];
  morph: boolean; // 结构线正在迁移（重建中）
}

const RED = '#E2382B', INK = '#0A0A0B', WALL = '#8A8780';
const MONO = '"IBM Plex Mono","Cascadia Mono",Consolas,"DejaVu Sans Mono","Courier New",monospace';
const SANS = '"Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei",sans-serif';
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export function algoBounds(camera: THREE.PerspectiveCamera, box: [V, V], sphere: boolean) {
  const [minimum, maximum] = box;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (sphere) {
    const center = new THREE.Vector3(...minimum).add(new THREE.Vector3(...maximum)).multiplyScalar(0.5).applyMatrix4(camera.matrixWorldInverse);
    const radius = (maximum[0] - minimum[0]) / 2, distance = -center.z;
    if (distance <= radius + camera.near) return { x0: W * 0.06, y0: H * 0.06, x1: W * 0.94, y1: H * 0.94, oversized: true };
    const denominator = distance * distance - radius * radius;
    const extentX = radius * Math.sqrt(center.x * center.x + denominator);
    const extentY = radius * Math.sqrt(center.y * center.y + denominator);
    const projection = camera.projectionMatrix.elements;
    x0 = (((center.x * distance - extentX) / denominator * projection[0]! - projection[8]!) * 0.5 + 0.5) * W;
    x1 = (((center.x * distance + extentX) / denominator * projection[0]! - projection[8]!) * 0.5 + 0.5) * W;
    y0 = (0.5 - ((center.y * distance + extentY) / denominator * projection[5]! - projection[9]!) * 0.5) * H;
    y1 = (0.5 - ((center.y * distance - extentY) / denominator * projection[5]! - projection[9]!) * 0.5) * H;
  } else {
    for (const horizontal of [minimum[0], maximum[0]]) for (const vertical of [minimum[1], maximum[1]]) for (const depth of [minimum[2], maximum[2]]) {
      const point = new THREE.Vector3(horizontal, vertical, depth).applyMatrix4(camera.matrixWorldInverse);
      if (point.z >= -camera.near) continue;
      point.applyMatrix4(camera.projectionMatrix);
      x0 = Math.min(x0, (point.x * 0.5 + 0.5) * W); x1 = Math.max(x1, (point.x * 0.5 + 0.5) * W);
      y0 = Math.min(y0, (0.5 - point.y * 0.5) * H); y1 = Math.max(y1, (0.5 - point.y * 0.5) * H);
    }
  }
  const oversized = sphere && (x0 < 0 || y0 < 0 || x1 > W || y1 > H);
  const limit = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  return { x0: oversized ? W * 0.06 : limit(x0, W * 0.06, W * 0.94), y0: oversized ? H * 0.06 : limit(y0, H * 0.06, H * 0.94), x1: oversized ? W * 0.94 : limit(x1, W * 0.06, W * 0.94), y1: oversized ? H * 0.94 : limit(y1, H * 0.06, H * 0.94), oversized };
}

export class AlgoOverlay {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private v = new THREE.Vector3();

  constructor() {
    this.canvas.width = W; this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  /** 世界坐标 → 屏幕逻辑像素（在镜头后面返回 null）。 */
  private proj(cam: THREE.PerspectiveCamera, p: V): [number, number] | null {
    const v = this.v.set(p[0], p[1], p[2]).applyMatrix4(cam.matrixWorldInverse);
    if (v.z > -0.05) return null;
    v.applyMatrix4(cam.projectionMatrix);
    return [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H];
  }

  draw(I: AlgoInput) {
    const g = this.g, cam = I.cam, T = I.target;
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    const reveal = (k: number) => clamp01((I.u - k * 0.5) / 0.1); // 各层依次出现（闪屏只有半秒左右，要快）

    // 1) 三分线 + 中心十字
    g.save();
    g.globalAlpha = 0.16 * reveal(0);
    g.strokeStyle = INK; g.lineWidth = 1; g.setLineDash([6, 8]);
    for (const k of [1, 2]) { line(g, (W * k) / 3, 0, (W * k) / 3, H); line(g, 0, (H * k) / 3, W, (H * k) / 3); }
    g.setLineDash([]);
    g.globalAlpha = 0.5 * reveal(0);
    line(g, W / 2 - 14, H / 2, W / 2 + 14, H / 2); line(g, W / 2, H / 2 - 14, W / 2, H / 2 + 14);
    g.restore();

    // 2) 透视：沿 -z 的消失点 + 地平线 + 放射线
    const fwd = new THREE.Vector3(0, 0, -1);
    const far: V = [cam.position.x + fwd.x * 5000, cam.position.y, cam.position.z + fwd.z * 5000];
    const vp = this.proj(cam, far);
    if (vp) {
      g.save();
      g.globalAlpha = 0.32 * reveal(0.05);
      g.strokeStyle = INK; g.lineWidth = 1;
      line(g, 0, vp[1], W, vp[1]);
      g.setLineDash([3, 6]);
      for (let k = 0; k <= 10; k++) {
        const x = (W * k) / 10;
        line(g, vp[0], vp[1], x + (x - vp[0]) * 0.6, H + 200);
        if (k % 2 === 0) line(g, vp[0], vp[1], x + (x - vp[0]) * 0.6, -200);
      }
      g.setLineDash([]);
      g.globalAlpha = 0.8 * reveal(0.05);
      g.strokeStyle = RED; g.lineWidth = 1.5;
      g.beginPath(); g.arc(vp[0], vp[1], 7, 0, Math.PI * 2); g.stroke();
      text(g, 'VP', vp[0] + 12, vp[1] - 10, 13, RED, MONO);
      text(g, 'HORIZON  y = ' + cam.position.y.toFixed(2), 24, vp[1] - 8, 12, INK, MONO, 0.6);
      g.restore();
    }

    // 3) 顶点小点（结构线端点）
    g.save();
    g.fillStyle = INK; g.globalAlpha = 0.55 * reveal(0.1);
    for (let i = 0; i < I.verts.length / 6; i += 3) {
      const p = this.proj(cam, [I.verts[i * 6]!, I.verts[i * 6 + 1]!, I.verts[i * 6 + 2]!]);
      if (p) g.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3);
    }
    g.restore();

    // 4) 识别框（红色角框）+ 标签 + 数据
    const { x0, y0, x1, y1, oversized } = algoBounds(cam, T.box, T.tag === 'GLASS_SPHERE');
    const rb = reveal(0.15);
    if (x1 > x0 && y1 > y0 && rb > 0) {
      // 框从中心向外"锁定"
      const k = 1;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = ((x1 - x0) / 2) * k, hh = ((y1 - y0) / 2) * k;
      const a = Math.min(36, hw * 0.4, hh * 0.4);
      g.save();
      g.strokeStyle = RED; g.lineWidth = 2.5; g.globalAlpha = rb;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]) {
        const px = cx + sx * hw, py = cy + sy * hh;
        g.beginPath(); g.moveTo(px - sx * a, py); g.lineTo(px, py); g.lineTo(px, py - sy * a); g.stroke();
      }
      g.globalAlpha = 0.35 * rb; g.lineWidth = 1;
      if (!oversized) g.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
      // 标签条
      g.globalAlpha = rb;
      const label = `${T.tag}  ${T.conf.toFixed(2)}`;
      g.font = `600 15px ${MONO}`;
      const lw = g.measureText(label).width + 16;
      // 标签放在框的左上角外侧；框顶贴近画面上沿时收进框内
      const lx = Math.max(W * 0.06, Math.min(W * 0.94 - lw - 110, cx - hw));
      const ly = Math.max(150, Math.min(H * 0.94 - 30, cy - hh - 30));
      g.fillStyle = RED; g.fillRect(lx, ly, lw, 24);
      text(g, label, lx + 8, ly + 17, 15, '#FFFFFF', MONO, 1, 600);
      text(g, T.name, lx + lw + 10, ly + 18, 18, INK, SANS, 1, 600);
      // 数据：逐字打出来
      const tw = clamp01((I.u - 0.15) / 0.35);
      // 数据：默认写在框的右侧；右边放不下就写在标签下面（框内）
      g.font = `400 17px ${SANS}`;
      const fw = Math.max(...T.facts.map((s) => g.measureText('› ' + s).width));
      const outside = cx + hw + 20 + fw < W * 0.94;
      const fx = Math.max(W * 0.06 + 8, Math.min(W * 0.94 - fw - 8, outside ? cx + hw + 20 : lx + 4));
      const fy = Math.max(H * 0.06 + 20, Math.min(H * 0.94 - T.facts.length * 27, outside ? cy - hh + 20 : ly + 50));
      if (!outside) { g.fillStyle = 'rgba(238,233,223,0.82)'; g.fillRect(fx - 8, fy - 20, fw + 16, T.facts.length * 27 + 10); }
      T.facts.forEach((s, i) => {
        const n = Math.floor(s.length * clamp01(tw * 1.6 - i * 0.25));
        if (n > 0) text(g, '› ' + s.slice(0, n), fx, fy + i * 27, 17, INK, SANS, 0.92);
      });
      g.restore();
    }

    // 5) 子目标小识别框
    if (T.subs) {
      g.save();
      g.strokeStyle = RED; g.lineWidth = 1.2;
      T.subs.forEach((s, i) => {
        const al = reveal(0.25 + (i % 8) * 0.04);
        if (al <= 0) return;
        const c = this.proj(cam, s.at), e = this.proj(cam, [s.at[0] + s.r, s.at[1] + s.r, s.at[2]]);
        if (!c || !e) return;
        const r = Math.max(6, Math.abs(e[0] - c[0]));
        g.globalAlpha = 0.85 * al;
        g.strokeRect(c[0] - r, c[1] - r, r * 2, r * 2);
        if (i % 2 === 0) text(g, `${s.tag} ${(0.86 + 0.12 * hash(i)).toFixed(2)}`, c[0] - r, c[1] - r - 4, 10, RED, MONO);
      });
      g.restore();
    }

    // 6) 尺寸线（红色，两端箭头 + 端部引线）
    if (T.dim) {
      const a = this.proj(cam, T.dim.a), b = this.proj(cam, T.dim.b), rd = reveal(0.35);
      if (a && b && rd > 0) {
        const bx = a[0] + (b[0] - a[0]) * rd, by = a[1] + (b[1] - a[1]) * rd;
        g.save();
        g.strokeStyle = RED; g.fillStyle = RED; g.lineWidth = 1.8;
        line(g, a[0], a[1], bx, by);
        arrow(g, b[0], b[1], a[0], a[1]);
        if (rd >= 1) arrow(g, a[0], a[1], b[0], b[1]);
        const nx = -(b[1] - a[1]), ny = b[0] - a[0], nl = Math.hypot(nx, ny) || 1;
        g.lineWidth = 1; g.globalAlpha = 0.7;
        for (const p of [a, b]) line(g, p[0] - (nx / nl) * 10, p[1] - (ny / nl) * 10, p[0] + (nx / nl) * 10, p[1] + (ny / nl) * 10);
        g.globalAlpha = rd;
        const mx2 = (a[0] + b[0]) / 2, my2 = (a[1] + b[1]) / 2;
        g.font = `600 16px ${SANS}`;
        const w2 = g.measureText(T.dim.label).width + 12;
        g.fillStyle = '#EEE9DF'; g.fillRect(mx2 - w2 / 2, my2 - 13, w2, 24);
        text(g, T.dim.label, mx2 - w2 / 2 + 6, my2 + 5, 16, RED, SANS, 1, 600);
        g.restore();
      }
    }

    // 7) 坐标轴（左下角，随镜头转）
    g.save();
    const ox = 90, oy = H - 90;
    const axes: [V, string, string][] = [[[1, 0, 0], 'x', RED], [[0, 1, 0], 'y', INK], [[0, 0, 1], 'z', WALL]];
    g.globalAlpha = reveal(0.05);
    for (const [d, n, c] of axes) {
      const v = this.v.set(d[0], d[1], d[2]).transformDirection(cam.matrixWorldInverse);
      const ex = ox + v.x * 46, ey = oy - v.y * 46;
      g.strokeStyle = c; g.fillStyle = c; g.lineWidth = 2;
      line(g, ox, oy, ex, ey);
      text(g, n, ex + 4, ey + 4, 13, c, MONO, 1, 600);
    }
    g.restore();

    // 8) 左上读数
    g.save();
    const rows = [
      `ALGORITHM VIEW  ·  scan ${String(I.index).padStart(2, '0')}/06  ·  ${I.morph ? 'RECONSTRUCTING' : 'ANALYZING'}`,
      `t ${I.t.toFixed(2)}s   beat ${I.beat.toFixed(2)}   frame ${I.frame}   BPM 144`,
      `strokes 960   verts 1920   cam (${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)})  fov ${cam.fov.toFixed(0)}°`,
    ];
    rows.forEach((s, i) => text(g, s, 24, 34 + i * 20, 13, i === 0 ? RED : INK, MONO, i === 0 ? 1 : 0.7, i === 0 ? 600 : 400));
    g.restore();

    // 9) 右下滚动代码
    g.save();
    const nLines = 7, start = Math.floor(I.t * 14) % Math.max(1, I.code.length - nLines);
    for (let i = 0; i < nLines; i++) {
      const s = (I.code[start + i] ?? '').trim().slice(0, 62);
      text(g, s, W - 560, H - 40 - (nLines - 1 - i) * 18, 12, INK, MONO, 0.25 + 0.5 * (i / nLines));
    }
    g.restore();

    // 10) 扫描条：一条淡红的横带从上往下扫过
    const sy = ((I.t * 1.6) % 1) * H;
    const grd = g.createLinearGradient(0, sy - 60, 0, sy);
    grd.addColorStop(0, 'rgba(226,56,43,0)'); grd.addColorStop(1, 'rgba(226,56,43,0.13)');
    g.fillStyle = grd; g.fillRect(0, sy - 60, W, 60);
    g.fillStyle = 'rgba(226,56,43,0.5)'; g.fillRect(0, sy, W, 1.5);

    this.texture.needsUpdate = true;
  }
}

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}
function arrow(g: CanvasRenderingContext2D, x: number, y: number, fx: number, fy: number) {
  const a = Math.atan2(y - fy, x - fx), s = 10;
  g.beginPath(); g.moveTo(x, y);
  g.lineTo(x - s * Math.cos(a - 0.4), y - s * Math.sin(a - 0.4));
  g.lineTo(x - s * Math.cos(a + 0.4), y - s * Math.sin(a + 0.4));
  g.closePath(); g.fill();
}
function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, font: string, alpha = 1, weight = 400) {
  g.save();
  g.globalAlpha *= alpha;
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.fillText(s, x, y);
  g.restore();
}
