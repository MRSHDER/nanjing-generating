// 时间驱动工具：所有画面都应是 t 的纯函数（不使用 Math.random / Date.now）。
export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const smoothstep = (a: number, b: number, x: number) => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};

export const ease = {
  linear: (k: number) => k,
  outCubic: (k: number) => 1 - Math.pow(1 - k, 3),
  inOutCubic: (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outExpo: (k: number) => (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k)),
};

/** 区间进度：t 在 [a,b] 内映射到 0..1，并可套缓动。 */
export const prog = (t: number, a: number, b: number, e: (k: number) => number = ease.linear) =>
  e(clamp((t - a) / (b - a)));

/** 带种子的伪随机，保证每次渲染结果一致。 */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 二维整数坐标哈希 → 0..1。 */
export function hash2(x: number, y: number, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 闪烁等“按帧跳变”的效果用它取离散帧号，避免连续时间噪声。 */
export const stepIdx = (t: number, fps: number) => Math.floor(t * fps + 1e-6);
