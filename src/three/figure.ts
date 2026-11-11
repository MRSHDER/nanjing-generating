// 共用的抽象线条人物（负责人：Claude）。数据故障段的点云收束成它，青年段从它开始行动。
// 只用线段组成，不做人脸。坐标单位：身高约 3.6，脚底在 y = 0。
export type Seg = [number, number, number, number]; // x0, y0, x1, y1

/** 站立（略带迈步）的姿态。 */
export const FIGURE_STAND: Seg[] = (() => {
  const segs: Seg[] = [];
  const head = { x: 0, y: 3.2, r: 0.32 };
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
    segs.push([head.x + Math.cos(a0) * head.r, head.y + Math.sin(a0) * head.r, head.x + Math.cos(a1) * head.r, head.y + Math.sin(a1) * head.r]);
  }
  segs.push([0, 2.88, 0, 2.7]); // 颈
  segs.push([0, 2.7, 0.05, 1.55]); // 躯干
  segs.push([-0.42, 2.62, 0.42, 2.62]); // 肩
  segs.push([-0.42, 2.62, -0.62, 1.95], [-0.62, 1.95, -0.55, 1.35]); // 左臂
  segs.push([0.42, 2.62, 0.6, 2.0], [0.6, 2.0, 0.78, 1.5]); // 右臂（略前摆）
  segs.push([-0.22, 1.55, 0.25, 1.55]); // 胯
  segs.push([-0.2, 1.55, -0.38, 0.78], [-0.38, 0.78, -0.5, 0.0]); // 左腿（后）
  segs.push([0.22, 1.55, 0.42, 0.8], [0.42, 0.8, 0.36, 0.0]); // 右腿（前）
  segs.push([-0.5, 0, -0.25, 0], [0.36, 0, 0.62, 0]); // 脚
  // 背包（青年 / 行李的意象）
  segs.push([-0.45, 2.45, -0.78, 2.35], [-0.78, 2.35, -0.8, 1.75], [-0.8, 1.75, -0.45, 1.7]);
  return segs;
})();

/** 沿线段均匀取点：返回 n 个点（x, y），按线段长度分配。 */
export function samplePoints(segs: Seg[], n: number, jitter = 0.03, seed = 1): Float32Array {
  const lens = segs.map(([a, b, c, d]) => Math.hypot(c - a, d - b));
  const total = lens.reduce((x, y) => x + y, 0);
  const out = new Float32Array(n * 2);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < n; i++) {
    let d = (i / n) * total, k = 0;
    while (k < segs.length - 1 && d > lens[k]!) { d -= lens[k]!; k++; }
    const [x0, y0, x1, y1] = segs[k]!;
    const u = lens[k]! > 0 ? d / lens[k]! : 0;
    out[i * 2] = x0 + (x1 - x0) * u + (rnd() - 0.5) * jitter;
    out[i * 2 + 1] = y0 + (y1 - y0) * u + (rnd() - 0.5) * jitter;
  }
  return out;
}

/** 人物在两段之间共用的世界位置（脚底中心）和缩放，保证故障 → 青年的交接位置一致。 */
export const FIGURE_ANCHOR = { x: 2.6, y: -2.2, z: 0, scale: 1.25 };
