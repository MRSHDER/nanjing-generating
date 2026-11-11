// 通用 GLSL 工具（负责人：Claude）：哈希、噪声、抗锯齿线、缓动。拼接在着色器前面使用。
export const GLSL_COMMON = /* glsl */ `
#define PI 3.14159265359
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
float saturate(float x) { return clamp(x, 0.0, 1.0); }
float outExpo(float x) { x = saturate(x); return x >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * x); }
float inOutCubic(float x) { x = saturate(x); return x < 0.5 ? 4.0 * x * x * x : 1.0 - pow(-2.0 * x + 2.0, 3.0) / 2.0; }
float outCubic(float x) { x = saturate(x); return 1.0 - pow(1.0 - x, 3.0); }
float prog(float t, float a, float b) { return saturate((t - a) / (b - a)); }
/** 抗锯齿网格线：返回 0..1，width 以像素计。 */
float gridLine(vec2 uv, float width) {
  vec2 g = abs(fract(uv - 0.5) - 0.5) / max(fwidth(uv), vec2(1e-5));
  return 1.0 - saturate(min(g.x, g.y) - width + 1.0);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
`;
