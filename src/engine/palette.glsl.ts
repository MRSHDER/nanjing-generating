const HEX = {
  ink: '#0A0A0B', // 墨黑：暗场底色
  paper: '#EEE9DF', // 米白：亮场底色、主文字
  gold: '#EEE9DF',
  red: '#E2382B', // 信号红：视觉锚点
  purple: '#343332',
  wall: '#85837F',
  plane: '#74716D',
} as const;

export type ColorName = keyof typeof HEX;

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255)];
}

/** 线性 RGB（用于 uniform）。 */
export const PALETTE = Object.fromEntries(
  (Object.keys(HEX) as ColorName[]).map((k) => [k, hexToLinear(HEX[k])]),
) as Record<ColorName, [number, number, number]>;

const v3 = (c: [number, number, number]) => `vec3(${c.map((x) => x.toFixed(5)).join(', ')})`;

/**
 * 拼接到任意片元着色器前面：
 * - 常量 C_INK, C_PAPER, C_GOLD, C_RED, C_PURPLE, C_WALL, C_PLANE（线性）
 * - ramp3(x, a, b, c)：三色插值
 * - nightRamp(x)：墨黑 → 紫金紫 → 城墙灰 → 米白（暗场的明暗关系）
 * - heatRamp(x)：墨黑 → 信号红 → 秦淮金 → 高亮（发光体，x>1 进入泛光）
 * - paperRamp(x)：米白 → 城墙灰 → 墨黑（亮场的明暗关系）
 */
export const GLSL_PALETTE = /* glsl */ `
const vec3 C_INK = ${v3(PALETTE.ink)};
const vec3 C_PAPER = ${v3(PALETTE.paper)};
const vec3 C_GOLD = ${v3(PALETTE.gold)};
const vec3 C_RED = ${v3(PALETTE.red)};
const vec3 C_PURPLE = ${v3(PALETTE.purple)};
const vec3 C_WALL = ${v3(PALETTE.wall)};
const vec3 C_PLANE = ${v3(PALETTE.plane)};

vec3 ramp3(float x, vec3 a, vec3 b, vec3 c) {
  x = clamp(x, 0.0, 1.0);
  return x < 0.5 ? mix(a, b, x * 2.0) : mix(b, c, x * 2.0 - 1.0);
}
vec3 nightRamp(float x) {
  x = clamp(x, 0.0, 1.0);
  if (x < 0.33) return mix(C_INK, C_PURPLE * 0.35, x / 0.33);
  if (x < 0.66) return mix(C_PURPLE * 0.35, C_WALL * 0.6, (x - 0.33) / 0.33);
  return mix(C_WALL * 0.6, C_PAPER, (x - 0.66) / 0.34);
}
vec3 heatRamp(float x) {
  float k = clamp(x, 0.0, 1.0);
  vec3 c = k < 0.4 ? mix(C_INK, C_RED, k / 0.4) : k < 0.8 ? mix(C_RED, C_GOLD, (k - 0.4) / 0.4) : mix(C_GOLD, C_GOLD * 1.6 + 0.2, (k - 0.8) / 0.2);
  return c * (1.0 + max(x - 1.0, 0.0) * 3.0);
}
vec3 paperRamp(float x) {
  return ramp3(x, C_PAPER, C_WALL, C_INK);
}
`;
