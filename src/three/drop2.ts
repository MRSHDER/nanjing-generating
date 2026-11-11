// 段落 8「双向奔赴」三维层（40 拍，墨黑底）。负责人：Claude。分工见 VISUAL_TASKS.md「8. 双向奔赴」。
//
// 按 v3 音乐编排（重拍 0 / 24 / 32；16–24 拍变奏：22–23.5 切片、23.5–24 静音）：
//   0–8 拍   蓄力段的中心亮点在第 0 拍爆开成冲击环 + 火花；两束光（秦淮金从左、信号红从右）螺旋接近，第 7 拍相遇再爆一次
//   8–16 拍  回收：每拍一切，直接调用前面各段的三维层取画面（城墙、大桥、玻璃球、铁路桁架、城门、走路、数据带、红旗）
//   16–24 拍 秦淮河夜景：水面倒映红灯笼，碎拍时水面起波纹；切片和静音时画面跟着音乐卡住 / 冻结（glitchTime）
//   24–32 拍 重拍：镜头拉开，两束光从两岸贴着水面奔向对方，第 28 拍在河面上方相遇成一团光
//   32–40 拍 重拍：光落进河里，冲击波在水面铺开成同心波纹；镜头升到正上方，波纹变成同心线条，交给片尾的平面线条
// 全部由段内拍 b 决定，可乱序取帧。
// 提供给 Codex：anchors() → burst（爆点 / 光团）、ring（冲击环最外圈上的一点，可求半径）、ripple（末段波纹中心）；
//   DROP2_SHOTS（构图切换表）、drop2RippleRadii(b)（末段同心线条的屏幕半径，片尾接续用）。
import * as THREE from 'three';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { BEAT, frameAt, glitchTime, sectionRange, eventsIn, type Frame, type SectionId } from '../engine/beat';
import { GLSL_PALETTE, PALETTE } from '../engine/palette.glsl';
import { GLSL_COMMON } from '../shaders/common.glsl';
import type { PostParams } from '../engine/post';
import { getLayer3D, type Layer3D, type Layer3DContext } from './index';
import { lin, softStudioEnv } from './env';
import { BALL_RADIUS, createRollingBall } from './rollingBall';
import { createQinhuaiScene } from './qinhuaiScene';
import { createPosterTypography } from './posterTypography';

type V3 = THREE.Vector3;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x: number) => { const t = clamp01(x); return t * t * t; };
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

export type Drop2Shot = 'burst' | 'recap' | 'river' | 'meet' | 'fall';
export const DROP2_SHOTS: { beat: number; shot: Drop2Shot }[] = [
  { beat: 0, shot: 'burst' },
  { beat: 8, shot: 'recap' }, // 每拍一切（见 RECAP）
  { beat: 16, shot: 'river' },
  { beat: 24, shot: 'meet' },
  { beat: 32, shot: 'fall' },
];

const WHITE_OUTLINE = `
uniform sampler2D tColor, tNormal, tDepth;
uniform vec2 uTexel;
uniform float uNear, uFar, uStrength, uFade;
float outlineDepth(float depth) {
  float normalized = depth * 2.0 - 1.0;
  return 2.0 * uNear * uFar / (uFar + uNear - normalized * (uFar - uNear));
}
void main() {
  vec2 horizontal = vec2(uTexel.x, 0.0);
  vec2 vertical = vec2(0.0, uTexel.y);
  vec3 normalLeft = texture2D(tNormal, vUv - horizontal).xyz;
  vec3 normalRight = texture2D(tNormal, vUv + horizontal).xyz;
  vec3 normalUp = texture2D(tNormal, vUv + vertical).xyz;
  vec3 normalDown = texture2D(tNormal, vUv - vertical).xyz;
  float center = outlineDepth(texture2D(tDepth, vUv).r);
  float depthLeft = outlineDepth(texture2D(tDepth, vUv - horizontal).r);
  float depthRight = outlineDepth(texture2D(tDepth, vUv + horizontal).r);
  float depthUp = outlineDepth(texture2D(tDepth, vUv + vertical).r);
  float depthDown = outlineDepth(texture2D(tDepth, vUv - vertical).r);
  float nearest = min(center, min(min(depthLeft, depthRight), min(depthUp, depthDown)));
  float farthest = max(center, max(max(depthLeft, depthRight), max(depthUp, depthDown)));
  float normalEdge = length(normalLeft - normalRight) + length(normalUp - normalDown);
  float depthEdge = (farthest - nearest) / max(nearest, 0.001);
  float edge = max(smoothstep(0.4, 0.7, normalEdge), smoothstep(0.045, 0.08, depthEdge));
  float distanceFade = mix(1.0, 0.45, smoothstep(60.0, 300.0, nearest));
  vec3 color = texture2D(tColor, vUv).rgb;
  gl_FragColor = vec4(mix(color, C_PAPER * 0.86, edge * distanceFade * uStrength * uFade), 1.0);
}
`;

/** 回收镜头：[段内拍, 来源段落, 来源段内起始拍]。 */
const RECAP: [number, SectionId, number][] = [
  [8, 'drop1', 16], // 穿越城门洞
  [9, 'youth', 21], // 大桥上骑车
  [10, 'lock', 9], // 玻璃定位球
  [11, 'youth', 23.4], // 铁路桥菱形桁架（2026-10-18 Claude：原 25 拍跨过青年段 26 拍的切点，一拍里闪两个镜头（用户 01:48）；改到侧面平移镜头 23–25 拍内）
  [12, 'drop1', 28.5], // 城墙砖缝透红光
  [13, 'youth', 5], // 走路与梧桐叶
  [14, 'glitch', 13], // 数据带
  [15, 'youth', 30.2], // 三面红旗
];

// ───────── 水面 ─────────
const MAX_RIP = 12;
const MAX_LIGHT = 28;
const WATER_VERT = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const WATER_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_PALETTE}
uniform vec3 uEye;
uniform float uTime, uLines, uGlowRip;
uniform sampler2D uReflection;
uniform mat4 uReflectionMatrix;
uniform float uRefined;
uniform vec4 uRip[${MAX_RIP}];   // x, z, 年龄（秒）, 振幅
uniform vec4 uLight[${MAX_LIGHT}]; // 位置 xyz, 强度
uniform vec3 uLightCol[${MAX_LIGHT}];
uniform int uNLight;
uniform vec3 uBigRip; // 大冲击波：x, z, 年龄（<0 表示没有）
varying vec3 vW;
float ripH(vec2 p) {
  float h = 0.0;
  // 底波（很小）
  // 主要沿纵深方向起伏：倒影被拉成竖条（夜里河面灯影的样子）
  h += 0.02 * sin(p.y * 3.1 - uTime * 1.3 + 0.6 * sin(p.x * 0.7)) + 0.014 * sin(p.y * 5.3 + uTime * 1.7 + p.x * 0.3) + 0.008 * sin(p.y * 9.1 - uTime * 2.3 + p.x * 1.1) + 0.004 * sin(p.x * 2.3 + uTime);
  for (int i = 0; i < ${MAX_RIP}; i++) {
    vec4 r = uRip[i];
    if (r.w <= 0.0) continue;
    float d = length(p - r.xy);
    float front = r.z * 3.2;
    float x = d - front;
    h += r.w * sin(x * 5.0) * exp(-x * x * 0.6) * exp(-r.z * 0.9) * step(x, 0.3);
  }
  if (uBigRip.z >= 0.0) {
    float d = length(p - uBigRip.xy);
    float x = d - uBigRip.z * 9.0;
    h += 0.16 * sin(x * 1.6) * exp(-x * x * 0.012) * exp(-uBigRip.z * 0.35) * step(x, 1.0);
  }
  return h;
}
void main() {
  vec2 p = vW.xz;
  float e = 0.04;
  float hx = ripH(p + vec2(e, 0.0)) - ripH(p - vec2(e, 0.0));
  float hz = ripH(p + vec2(0.0, e)) - ripH(p - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
  vec3 vd = normalize(vW - uEye);
  vec3 rd = reflect(vd, n);
  float fres = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(-vd, n)), 5.0);
  // 夜空倒影：上方淡淡的紫
  vec3 col = C_INK * 1.4 + C_PAPER * 0.005 * smoothstep(-0.1, 0.6, rd.y) * fres;
  if (uRefined > 0.0) {
    vec4 projected = uReflectionMatrix * vec4(vW, 1.0);
    vec2 reflectionUv = projected.xy / projected.w;
    float fragment = 0.5 + 0.5 * sin(p.y * 34.0 + sin(p.x * 6.3 + uTime * 0.55) * 2.0);
    vec2 distortion = vec2(n.x * 0.005 + sin(p.y * 18.0 + uTime * 0.7) * 0.0005, n.z * 0.005 + sin(p.y * 8.0 - uTime * 0.8) * 0.0018);
    vec3 reflection = texture2D(uReflection, clamp(reflectionUv + distortion, 0.001, 0.999)).rgb;
    float lightMask = smoothstep(0.2, 0.55, max(reflection.r, reflection.g));
    float crest = smoothstep(-0.3, 0.75, sin(p.y * 38.0 + sin(p.x * 3.2 + uTime * 0.6) * 2.0));
    vec3 reflectedColor = reflection * (0.22 + 0.28 * fres) * (0.64 + 0.36 * fragment);
    reflectedColor += reflection * lightMask * (0.18 + 0.72 * crest);
    col = mix(col, vec3(0.011) + reflectedColor, uRefined);
  }
  // 灯光倒影（被波纹拉成竖条）
  for (int i = 0; i < ${MAX_LIGHT}; i++) {
    if (i >= uNLight) break;
    vec3 L = uLight[i].xyz - vW;
    float dist = length(L);
    float s = max(0.0, dot(rd, L / dist));
    float spec = mix(pow(s, 1400.0) * 5.0 + pow(s, 260.0) * 0.25, pow(s, 650.0) * 0.9 + pow(s, 130.0) * 0.09, uRefined);
    spec *= mix(1.0, 0.38 + 0.62 * smoothstep(-0.3, 0.7, sin(p.y * 29.0 + p.x * 5.0 + sin(p.y * 3.2 - uTime))), uRefined);
    col += uLightCol[i] * uLight[i].w * spec * (0.3 + 0.7 * fres) / (1.0 + dist * 0.02);
  }
  // 大冲击波的前沿发金光
  if (uBigRip.z >= 0.0) {
    float d = length(p - uBigRip.xy);
    float x = d - uBigRip.z * 9.0;
    col += C_PAPER * uGlowRip * 2.5 * exp(-x * x * 0.5) * exp(-uBigRip.z * 0.25);
    // 末段：波纹变成同心线条（平面图形，交给片尾）
    float k = (uBigRip.z * 9.0 - d) / 3.2; // 前沿之后每 3.2 一道
    float line = (1.0 - smoothstep(0.0, fwidth(k) * 1.6, abs(fract(k + 0.5) - 0.5))) * step(0.0, k) * step(k, 7.0);
    col = mix(col, col * 0.35 + C_PAPER * 0.9 * line, uLines);
  }
  // 远处融进夜色
  float fog = exp(-length(vW - uEye) * 0.012);
  gl_FragColor = vec4(mix(C_INK, col, fog), 1.0);
}
`;

// ───────── 光束 / 冲击环 / 火花 ─────────
const BEAM_VERT = /* glsl */ `
attribute float aU;
varying float vU;
varying vec2 vUv;
void main() { vU = aU; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const BEAM_FRAG = /* glsl */ `
${GLSL_PALETTE}
uniform vec3 uCol;
uniform float uHead, uTail, uI;
varying float vU;
varying vec2 vUv;
void main() {
  float x = (uHead - vU) / uTail; // 0 = 光头，1 = 尾巴末端
  if (x < 0.0 || x > 1.0) discard;
  float a = pow(1.0 - x, 1.6);
  float core = 1.0 - abs(vUv.y - 0.5) * 2.0; // 管子横截面上越靠中心越亮（近似）
  vec3 c = uCol * (0.6 + 2.4 * a) + C_PAPER * pow(a, 6.0) * 2.5;
  gl_FragColor = vec4(c * uI * a * (0.5 + 0.5 * core), 1.0);
}
`;
const RING_FRAG = /* glsl */ `
${GLSL_PALETTE}
uniform float uR, uW, uI, uMix;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float x = (d - uR) / uW;
  float ring = exp(-x * x) + 0.35 * exp(-(x + 2.5) * (x + 2.5) * 0.3);
  // 2026-10-18 Claude（用户 00:19：「这个光环不要用白色，只用红色」）：去掉米白和米白亮芯，整圈只用点缀红
  // 00:23 用户：再换成米白色试一下（只用米白，不混红）
  vec3 c = C_PAPER;
  gl_FragColor = vec4(c * ring * uI * 2.2 + C_PAPER * exp(-x * x * 8.0) * uI * 0.8, 1.0);
}
`;
const SPARK_VERT = /* glsl */ `
attribute vec3 aDir;
attribute float aSeed;
uniform float uAge, uPx, uSize;
varying float vA;
varying float vSeed;
void main() {
  float sp = 4.0 + 10.0 * aSeed;
  float travel = sp * (1.0 - exp(-uAge * 2.2)) / 2.2;
  vec3 p = position + aDir * travel + vec3(0.0, -0.6 * uAge * uAge, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vA = exp(-uAge * (0.9 + 1.2 * aSeed));
  vSeed = aSeed;
  gl_PointSize = max(1.0, uSize * (0.5 + aSeed) * uPx / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;
const SPARK_FRAG = /* glsl */ `
${GLSL_PALETTE}
varying float vA;
varying float vSeed;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = dot(q, q);
  if (r > 0.25) discard;
  vec3 c = vSeed > 0.75 ? C_RED * 1.6 : mix(C_PAPER * 1.8, C_PAPER * 1.2, step(0.5, vSeed));
  gl_FragColor = vec4(c * vA * (1.0 - r * 4.0), 1.0);
}
`;

interface Beam { mesh: THREE.Mesh<THREE.TubeGeometry, THREE.ShaderMaterial>; head: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; curve: THREE.CatmullRomCurve3 }

/** 末段同心线条的屏幕半径（逻辑像素，由内到外）。片尾的平面线条可从这里接续。 */
export function drop2RippleRadii(b: number): number[] {
  // 与水面着色器一致：前沿半径 = 9 · 年龄，之后每 3.2 一道，最多 8 道；俯视镜头下换算到屏幕（见 anchors 的 ripple）
  const age = Math.max(0, (b - 32) * BEAT);
  const front = age * 9;
  const out: number[] = [];
  for (let k = 0; k < 8; k++) { const r = front - k * 3.2; if (r > 0) out.push(r * RIPPLE_PX_PER_UNIT); }
  return out;
}
const RIPPLE_PX_PER_UNIT = H / (2 * 46 * Math.tan(THREE.MathUtils.degToRad(40 / 2))); // 末帧俯视：高 46、视野 40°

const FALL_POINT = v(0, 0, -18); // 光团落水点（也是末段波纹中心）
export const DROP2_BALL_EXIT = { x: W / 2, y: H / 2, radius: 48, angle: -12 };

export function recapFlight(localBeat: number, river: boolean) {
  const duration = river ? 7.45 : 0.94;
  const progress = clamp01(localBeat / duration);
  const acceleration = easeIn((progress - (river ? 0.9 : 0.24)) / (river ? 0.1 : 0.76));
  const distance = (river ? 32 : 18) * progress + (river ? 240 : 140) * acceleration;
  const radius = (river ? 0.7 : 0.8) * (1 - 0.7 * acceleration);
  return {
    position: v((river ? -1.6 : -0.7) * (1 - inOut(progress * 2)), radius + (river ? 0.08 : 0.02), (river ? -2 : 6) - distance),
    radius, angle: -distance / (river ? 0.7 : 0.8), visible: progress < 0.985,
  };
}

export default class Drop2 implements Layer3D {
  private scene = new THREE.Scene(); // 爆开 / 光束（0–8 拍）
  private river = new THREE.Scene(); // 秦淮河（16–40 拍）
  private cam = new THREE.PerspectiveCamera(40, W / H, 0.1, 2000);
  private rt = makeRT(W, H, { depth: true });
  private outlineTarget!: THREE.WebGLRenderTarget;
  private normalMaterial = new THREE.MeshNormalMaterial();
  private whiteOutline = new FSPass(WHITE_OUTLINE, {
    tColor: { value: null }, tNormal: { value: null }, tDepth: { value: null },
    uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
    uNear: { value: 0.1 }, uFar: { value: 2000 }, uStrength: { value: 1 }, uFade: { value: 1 },
  });
  private copy = new FSPass(`uniform sampler2D tIn; void main(){ gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }`, { tIn: { value: null } });
  private ink = lin(PALETTE.ink);
  private recap = new Map<SectionId, Layer3D>();
  private recapBall: THREE.Object3D | null = null;
  private depthCopies = new WeakMap<THREE.Object3D, THREE.Object3D>();
  private depthMaterials = new WeakMap<THREE.Material, THREE.MeshBasicMaterial>();

  private rings: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>[] = [];
  private ball = createRollingBall();
  private meetingTarget = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.paper), metalness: 1, roughness: 0.22 }));
  private arrivalTarget = createRollingBall();
  // 2026-10-18 Claude（用户 00:26：两颗球出现得太突兀，「可以不是球吗？撞到一起之后才变成一个球」）：
  // 27.5–28 拍相遇前不画球，画两道一米白一红的细光痕从两侧飞向相遇点；28 拍撞上的瞬间才凝成一颗玻璃球（四分之一拍内长出来）。
  private streaks = [0, 1].map(index => new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { uColor: { value: lin(index ? PALETTE.red : PALETTE.paper) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main(){ float across = 1.0 - abs(vUv.y - 0.5) * 2.0; float a = pow(vUv.x, 1.6) * smoothstep(0.0, 0.6, across); gl_FragColor = vec4(min(uColor * (1.0 + 0.25 * pow(vUv.x, 8.0)), vec3(1.0)), clamp(a, 0.0, 1.0)); }',
  })));
  private ballScene = new THREE.Scene();
  private ballCamera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100);
  private ballTarget!: THREE.WebGLRenderTarget;
  private beamsA: Beam[] = [];
  private beamsB: Beam[] = [];
  private riverRing!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private riverSparks!: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  // 2026-10-15 Claude（用户 02:11：76.98 秒那个重拍像烟花炸开，试试在天上炸烟花）：秦淮上空的白描烟花，倒映在水里
  private fireworks = createFireworks();
  private orb!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private water!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private qinhuai = createQinhuaiScene();
  private reflectionTarget!: THREE.WebGLRenderTarget;
  private reflectionCamera = new THREE.PerspectiveCamera();
  private riverTypography = createPosterTypography('QINHUAI RIVER', '秦淮河', 15, 3.75, lin(PALETTE.paper), 0.78); // 2026-10-17 Claude（用户 23:59：河中间的字再集中一点）21 → 15 宽
  private sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uPoster: { value: null }, uInk: { value: lin(PALETTE.ink) }, uResolution: { value: new THREE.Vector2(W, H) }, uFade: { value: 1 } },
    vertexShader: 'varying vec3 vDirection; void main(){ vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D uPoster; uniform vec3 uInk; uniform vec2 uResolution; uniform float uFade; varying vec3 vDirection; void main(){ float height = normalize(vDirection).y; vec3 color = mix(vec3(0.02), vec3(0.001), smoothstep(0.0, 0.55, height)); vec3 poster = texture2D(uPoster, gl_FragCoord.xy / uResolution).rgb; color += max(vec3(0.0), poster - uInk); gl_FragColor = vec4(mix(poster, color, uFade), 1.0); }',
  }));
  private banks = new THREE.Group();
  private ripples: { x: number; z: number; t: number; amp: number }[] = [];
  private t0 = 0;

  async init(r: THREE.WebGLRenderer) {
    this.reflectionTarget = makeRT(W / 2, H / 2, { depth: true });
    this.ballTarget = makeRT(W, H, { depth: true });
    this.ballTarget.samples = 4;
    this.ballCamera.position.set(0, 0, 12);
    this.ballCamera.updateMatrixWorld(true);
    this.ballScene.environment = softStudioEnv(r, { key: 2.8, rim: 1.6 });
    this.ballScene.add(this.ball, this.meetingTarget, this.arrivalTarget, ...this.streaks);
    const ballLines = this.ball.children[1] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    ballLines.material.color.copy(lin(PALETTE.paper));
    ballLines.material.opacity = 0.46;
    this.meetingTarget.material.envMapIntensity = 0.45;
    const targetLines = this.arrivalTarget.children[1] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    targetLines.material.color.copy(lin(PALETTE.paper));
    targetLines.material.opacity = 0.46;
    this.outlineTarget = makeRT(W, H, { depth: true });
    this.outlineTarget.depthTexture = new THREE.DepthTexture(this.rt.width, this.rt.height, THREE.UnsignedIntType);
    this.rt.samples = 4;
    const range = sectionRange('drop2');
    this.t0 = range.start;
    // 回收用的各段三维层（与主播放器共用同一份实例；三维层都是时间的纯函数，共用不会互相影响）
    for (const id of new Set(RECAP.map((x) => x[1]))) {
      const l = await getLayer3D(id, r);
      if (l) this.recap.set(id, l);
    }

    // ── 0–8 拍：冲击环 + 火花 + 两束光 ──
    const ringMat = () => new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: RING_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uR: { value: 0 }, uW: { value: 0.01 }, uI: { value: 0 }, uMix: { value: 0 } },
    });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), ringMat());
      m.frustumCulled = false;
      this.rings.push(m);
      this.scene.add(m);
    }
    const mkBeam = (pts: V3[], col: [number, number, number], scene: THREE.Scene, radius = 0.07): Beam => {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const geo = new THREE.TubeGeometry(curve, 600, radius, 10, false);
      const u = new Float32Array(geo.attributes.position!.count);
      const uv = geo.attributes.uv!;
      for (let i = 0; i < u.length; i++) u[i] = uv.getX(i);
      geo.setAttribute('aU', new THREE.BufferAttribute(u, 1));
      const mat = new THREE.ShaderMaterial({
        vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uCol: { value: lin(col) }, uHead: { value: 0 }, uTail: { value: 0.35 }, uI: { value: 1 } },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      const head = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glowMat(col));
      head.frustumCulled = false;
      scene.add(mesh, head);
      return { mesh, head, curve };
    };
    // 两束光从左右两侧螺旋接近画面中心（相遇点 = 原点）
    const approach = (side: number) => {
      const pts: V3[] = [];
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        pts.push(v(side * 5 * (1 - u), side * 0.85 * Math.sin(u * Math.PI), 0));
      }
      return pts;
    };
    this.beamsA.push(mkBeam(approach(-1), PALETTE.paper, this.scene, 0.018), mkBeam(approach(1), PALETTE.paper, this.scene, 0.018));

    // ── 秦淮河 ──
    this.water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      uniforms: {
        uEye: { value: v() }, uTime: { value: 0 }, uLines: { value: 0 }, uGlowRip: { value: 1 },
        uRip: { value: Array.from({ length: MAX_RIP }, () => new THREE.Vector4()) },
        uLight: { value: Array.from({ length: MAX_LIGHT }, () => new THREE.Vector4()) },
        uLightCol: { value: Array.from({ length: MAX_LIGHT }, () => new THREE.Color()) },
        uNLight: { value: 0 }, uBigRip: { value: v(0, 0, -1) },
        uReflection: { value: this.reflectionTarget.texture }, uReflectionMatrix: { value: new THREE.Matrix4() }, uRefined: { value: 1 },
      },
    }));
    this.water.position.z = -150;
    this.river.add(this.water);
    // 两岸：低矮的粉墙黛瓦剪影 + 屋檐下的红灯笼（全部程序化，示意，不对应具体建筑）
    this.banks.add(this.qinhuai.group);
    this.river.add(this.banks);
    this.sky.renderOrder = -10;
    this.river.add(this.sky);
    this.river.fog = new THREE.FogExp2(this.ink.getHex(), 0.012);
    (this.river.fog as THREE.FogExp2).color.copy(this.ink);

    // 24–32 拍两束光：从两岸贴着水面奔向河心上方
    const bank = (side: number) => {
      const pts: V3[] = [];
      for (let i = 0; i <= 20; i++) {
        const u = i / 20;
        pts.push(v(side * (16 * (1 - u)) + side * 3 * Math.sin(u * Math.PI) , 0.6 + 2.6 * u * u + 0.5 * Math.sin(u * Math.PI * 2), -6 - 12 * u + 4 * Math.sin(u * Math.PI) * side));
      }
      pts[pts.length - 1]!.set(0, 3.2, -18);
      return pts;
    };
    this.beamsB.push(mkBeam(bank(-1), PALETTE.paper, this.river), mkBeam(bank(1), PALETTE.red, this.river));
    this.orb = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glowMat(PALETTE.paper));
    this.orb.frustumCulled = false;
    this.river.add(this.orb);
    this.riverRing = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), ringMat());
    this.riverRing.frustumCulled = false;
    this.river.add(this.riverRing);
    this.riverTypography.position.set(1.35, 4.5, -38); // 字在贴图里靠左排，x 右移约 9% 宽，让字落在河道正中
    this.riverTypography.visible = false;
    this.river.add(this.riverTypography);
    this.riverSparks = this.makeSparks(1400, 11);
    this.river.add(this.riverSparks);
    this.river.add(this.fireworks);

    // 水面波纹源：16–24 拍碎拍时的滴答声、和弦重击，各落一圈
    const ticks = eventsIn('tick', range.start + 16 * BEAT, range.start + 24 * BEAT);
    const stabs = eventsIn('stab', range.start + 16 * BEAT, range.start + 24 * BEAT);
    [...ticks.map((t) => [t, 0.05] as const), ...stabs.map((t) => [t, 0.09] as const)].forEach(([t, amp], i) => {
      this.ripples.push({ x: (hash(i * 3.1) - 0.5) * 14, z: -8 - hash(i * 7.7) * 14, t, amp });
    });
    // 24–40 拍：每次底鼓在光团下方落一圈小波纹
    eventsIn('kick', range.start + 24 * BEAT, range.start + 32 * BEAT).forEach((t, i) => this.ripples.push({ x: (hash(i + 50) - 0.5) * 3, z: -18 + (hash(i + 60) - 0.5) * 3, t, amp: 0.05 }));
  }

  private glowMat(col: [number, number, number]) {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uCol: { value: lin(col) }, uI: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uCol; uniform float uI; varying vec2 vUv; void main(){ float r = length(vUv - 0.5) * 2.0; float g = exp(-r * r * 18.0) * 5.0 + exp(-r * 3.5) * 0.7; gl_FragColor = vec4((uCol + vec3(0.5) * exp(-r * r * 60.0)) * g * uI * (1.0 - smoothstep(0.85, 1.0, r)), 1.0); }',
    });
  }

  private makeSparks(n: number, seed: number) {
    const pos = new Float32Array(n * 3), dir = new Float32Array(n * 3), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = hash(i * 1.7 + seed), w = hash(i * 3.3 + seed * 2);
      const th = u * Math.PI * 2, ph = Math.acos(2 * w - 1);
      dir[i * 3] = Math.sin(ph) * Math.cos(th);
      dir[i * 3 + 1] = Math.sin(ph) * Math.sin(th);
      dir[i * 3 + 2] = Math.cos(ph) * 0.6;
      sd[i] = hash(i * 9.1 + seed * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    const p = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uAge: { value: 0 }, uPx: { value: 500 }, uSize: { value: 0.07 } },
    }));
    p.frustumCulled = false;
    return p;
  }

  private shotAt(b: number) {
    let s = DROP2_SHOTS[0]!;
    for (const x of DROP2_SHOTS) if (b >= x.beat) s = x;
    return s;
  }

  /** 河面镜头（16–40 拍）。 */
  private riverCam(b: number) {
    const c = this.cam;
    let pos: V3, look: V3, fov = 40;
    // 2026-10-15 Claude（用户 02:20：镜头一→镜头二「先往后退又往前」）：
    // 原来 27.5 拍贴水面镜头在 0.5 拍内往回拉到 z=4，32 拍又跳回 z=6。改成一条连续的前推：
    // 贴水面一直匀速往前滑，27–30.5 拍边前推边升高、视线从远处桥洞下压到相遇点；32 拍起从当前位置接着升到正上方。
    const glide = (bb: number) => {
      const lb = bb - 16;
      const rise = inOut((bb - 27) / 3.5);
      const p = v(0.16 * Math.sin(lb * 0.24) * (1 - rise), 0.92 + 0.025 * Math.sin(lb * 0.42) * (1 - rise) + 3.88 * rise, 6 - lb * 0.38);
      const l = v(0.1 * Math.sin(lb * 0.15) * (1 - rise), 1.9 + 0.9 * rise, -72 + 54 * rise);
      return { p, l, f: 46 - 6 * rise };
    };
    if (b < 32) {
      const g = glide(b);
      pos = g.p; look = g.l; fov = g.f;
    } else {
      const lb = b - 32;
      const k = inOut(lb / 7);
      const g = glide(b);
      // 从斜俯视升到正上方俯视（末帧：高 46、视野 40°，与 drop2RippleRadii 一致）
      pos = g.p.lerp(v(0, 46, FALL_POINT.z + 0.001), k);
      look = g.l.lerp(v(0, 0, -18), k);
      fov = 40;
    }
    c.position.copy(pos);
    c.up.set(0, 1, 0);
    if (b >= 32) c.up.set(0, 0, -1).lerp(v(0, 1, 0), 1 - inOut((b - 33) / 6)).normalize();
    c.lookAt(look);
    c.fov = fov;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  private burstCam(b: number) {
    const c = this.cam;
    c.position.set(0.8 * Math.sin(b * 0.4), 0.4 * Math.sin(b * 0.3), 12 - 1.2 * inOut(b / 8));
    c.up.set(Math.sin(0.12 * Math.sin(b * 0.5)), 1, 0).normalize();
    c.lookAt(0, 0, 0);
    c.fov = 40;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  private beat(f: Frame) {
    // 16–24 拍的切片 / 静音：画面跟着音乐卡住（与 glitch 段同一个函数）
    return (glitchTime(f.t) - f.sectionStart) / BEAT;
  }

  private placeBeam(bm: Beam, head: number, tail: number, intensity: number) {
    bm.mesh.material.uniforms.uHead!.value = head;
    bm.mesh.material.uniforms.uTail!.value = tail;
    bm.mesh.material.uniforms.uI!.value = intensity;
    const p = bm.curve.getPointAt(clamp01(head));
    bm.head.position.copy(p);
    bm.head.quaternion.copy(this.cam.quaternion);
    bm.head.scale.setScalar(1.6 * intensity);
    bm.head.visible = intensity > 0.01;
    bm.mesh.visible = intensity > 0.01;
  }

  /** 二维背景板按同一镜头投影（0–8 拍爆开镜头、16–40 拍河面镜头；回收镜头不用背景板）。 */
  backgroundCamera(f: Frame) {
    const b = this.beat(f);
    if (b >= 16) this.riverCam(b); else this.burstCam(Math.min(b, 7.999));
    return this.cam.clone();
  }

  anchors(f: Frame) {
    const b = this.beat(f);
    const proj = (p: V3): [number, number] | null => {
      const q = p.clone().project(this.cam);
      if (q.z > 1 || q.z < -1) return null;
      return [(q.x * 0.5 + 0.5) * W, (0.5 - q.y * 0.5) * H];
    };
    if (b < 8) {
      this.burstCam(b);
      const R = this.ringRadius(b);
      return { burst: proj(v()), ring: R > 0 ? proj(v(R, 0, 0)) : null, ripple: null };
    }
    if (b < 16) return { burst: null, ring: null, ripple: null };
    this.riverCam(b);
    return {
      burst: b >= 28 && b < 32 ? proj(v(0, 3.2, -18)) : null,
      ring: null,
      ripple: b >= 32 ? proj(FALL_POINT) : null,
    };
  }

  /** 第 0 拍冲击环的世界半径（平面在 z = 0）。 */
  private ringRadius(b: number) {
    return b < 0 || b > 3 ? 0 : 0.05 + 16 * outCubic(b / 2.4);
  }

  ballPose(f: Frame) {
    const beat = this.beat(f);
    const project = (point: V3) => {
      const projected = point.clone().project(this.cam);
      return { x: (projected.x * 0.5 + 0.5) * W, y: (0.5 - projected.y * 0.5) * H };
    };
    if (beat < 8) {
      this.burstCam(beat);
      const progress = easeIn((beat - 1) / 6) * 0.85 + 0.15 * clamp01((beat - 1) / 6);
      const entry = inOut(beat / 1);
      const primary = project(this.beamsA[0]!.curve.getPointAt(progress));
      const target = project(this.beamsA[1]!.curve.getPointAt(progress));
      return {
        x: W / 2 + (primary.x - W / 2) * entry,
        y: H / 2 + (primary.y - H / 2) * entry,
        radius: 28 + 20 * entry, angle: -4 * progress,
        target: { ...target, visible: beat >= 0.5 && beat < 7, radius: 40 * inOut((beat - 0.5) / 0.5) },
      };
    }
    if (beat >= 16 && beat < 27.5 - 1e-10) return { x: W / 2, y: H / 2, radius: 0, angle: 0, target: null };
    if (beat < 24) {
      let camera = this.cam;
      let localBeat = (f.t - f.sectionStart) / BEAT - 16;
      if (beat < 16) {
        let cut = RECAP[0]!;
        for (const entry of RECAP) if (beat >= entry[0]) cut = entry;
        const layer = this.recap.get(cut[1]);
        const native = layer?.protagonist?.();
        if (native?.visible) {
          const source = sectionRange(cut[1]);
          const frame = frameAt(source.start + (cut[2] + (beat - cut[0]) * 1.3) * BEAT);
          camera = layer!.backgroundCamera!(frame);
          const center = native.getWorldPosition(v()).project(camera);
          return { x: (center.x * 0.5 + 0.5) * W, y: (0.5 - center.y * 0.5) * H, radius: 48, angle: -4, target: null };
        }
        const space = layer?.recapSpace?.();
        if (space) camera = space.camera;
        localBeat = beat - cut[0];
      } else this.riverCam(beat);
      const flight = recapFlight(localBeat, beat >= 16);
      const center = flight.position.clone().project(camera);
      const depth = -flight.position.clone().applyMatrix4(camera.matrixWorldInverse).z;
      return { x: (center.x * 0.5 + 0.5) * W, y: (0.5 - center.y * 0.5) * H, radius: flight.radius * H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(depth, 0.1)), angle: flight.angle, target: null };
    }
    this.riverCam(beat);
    let point: { x: number; y: number };
    if (beat < 28) {
      const progress = easeIn((beat - 27.5) / 0.5);
      const destination = v(0, 3.2, FALL_POINT.z);
      const primary = project(v(-2.4, 5.6, FALL_POINT.z - 5).lerp(destination, progress));
      const target = project(v(2.4, 5.6, FALL_POINT.z - 5).lerp(destination, progress));
      return { ...primary, radius: 48, angle: -4 - 8 * inOut((beat - 16) / 24), target: { ...target, visible: true, radius: 48 } };
    } else {
      const height = 3.2 * (1 - easeIn((beat - 30.5) / 1.5));
      point = project(v(FALL_POINT.x, height, FALL_POINT.z));
    }
    return { ...point, radius: 48, angle: -4 - 8 * inOut((beat - 16) / 24), target: null };
  }

  private renderBall(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget) {
    const pose = this.ballPose(f);
    const unitsPerPixel = 24 * Math.tan(THREE.MathUtils.degToRad(20)) / H;
    this.ball.position.set((pose.x - W / 2) * unitsPerPixel, (H / 2 - pose.y) * unitsPerPixel, 0);
    this.ball.scale.setScalar(pose.radius * unitsPerPixel / BALL_RADIUS);
    this.ball.rotation.set(0.15, 0.25, pose.angle);
    this.ball.visible = pose.radius > 0;
    const arriving = f.lt / BEAT >= 24;
    this.meetingTarget.visible = !arriving && (pose.target?.visible ?? false);
    this.arrivalTarget.visible = arriving && (pose.target?.visible ?? false);
    if (pose.target) {
      this.meetingTarget.position.set((pose.target.x - W / 2) * unitsPerPixel, (H / 2 - pose.target.y) * unitsPerPixel, 0);
      this.meetingTarget.scale.setScalar(pose.target.radius * unitsPerPixel);
      this.arrivalTarget.position.copy(this.meetingTarget.position);
      this.arrivalTarget.scale.setScalar(pose.target.radius * unitsPerPixel / BALL_RADIUS);
      this.arrivalTarget.rotation.set(0.15, 0.25, -pose.angle);
    }
    // 相遇前的两道光痕（取 0.3 拍前的位置作尾巴），28 拍凝成一颗球
    const meetBeat = f.lt / BEAT;
    const approaching = meetBeat >= 27.5 && meetBeat < 28 && !!pose.target;
    // 尾巴直接用相遇轨迹公式算（不再调 ballPose 取旧帧——那会改动河景机位，播放器里偶发一整块白板）
    const meetPoint = (side: number, beatAt: number) => {
      const progress = easeIn((beatAt - 27.5) / 0.5);
      const world = v(side * 2.4, 5.6, FALL_POINT.z - 5).lerp(v(0, 3.2, FALL_POINT.z), progress).project(this.cam);
      return { x: (world.x * 0.5 + 0.5) * W, y: (0.5 - world.y * 0.5) * H };
    };
    this.streaks.forEach((streak, index) => {
      streak.visible = false;
      if (!approaching) return;
      const side = index ? 1 : -1;
      const head = meetPoint(side, meetBeat), tail = meetPoint(side, Math.max(27.5, meetBeat - 0.3));
      const hx = (head.x - W / 2) * unitsPerPixel, hy = (H / 2 - head.y) * unitsPerPixel;
      const tx = (tail.x - W / 2) * unitsPerPixel, ty = (H / 2 - tail.y) * unitsPerPixel;
      const length = Math.hypot(hx - tx, hy - ty);
      // 刚起步那几帧两端几乎重合，退化的极短平面在部分显卡上会画成一整块白板（用户 01:35 截图 78.17 秒）——短于 24 像素不画
      if (!Number.isFinite(length) || length < 24 * unitsPerPixel || length > 600 * unitsPerPixel) return;
      streak.visible = true;
      streak.position.set((hx + tx) / 2, (hy + ty) / 2, 0.5);
      streak.rotation.set(0, 0, Math.atan2(hy - ty, hx - tx));
      streak.scale.set(length, 9 * unitsPerPixel, 1);
    });
    if (approaching) { this.ball.visible = false; this.meetingTarget.visible = false; this.arrivalTarget.visible = false; }
    if (meetBeat >= 28 && meetBeat < 28.25) this.ball.scale.multiplyScalar(Math.max(0.05, outCubic((meetBeat - 28) / 0.25)));
    this.ballScene.background = out.texture;
    r.setRenderTarget(this.ballTarget);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.ballScene, this.ballCamera);
    this.copy.u.tIn!.value = this.ballTarget.texture;
    this.copy.render(r, out);
  }

  private depthCopy(source: THREE.Object3D) {
    let copy = this.depthCopies.get(source);
    if (!copy) {
      copy = source.clone(true);
      this.depthCopies.set(source, copy);
    }
    const originals: THREE.Object3D[] = [];
    const clones: THREE.Object3D[] = [];
    source.updateWorldMatrix(true, true);
    source.traverse(object => originals.push(object));
    copy.traverse(object => clones.push(object));
    originals.forEach((original, index) => {
      const clone = clones[index]!;
      clone.visible = original.visible && !(original instanceof THREE.Line || original instanceof THREE.Light);
      clone.matrixAutoUpdate = false;
      clone.matrix.copy(index === 0 ? original.matrixWorld : original.matrix);
      clone.renderOrder = -100;
      if (original instanceof THREE.Mesh && clone instanceof THREE.Mesh) {
        clone.castShadow = false;
        clone.receiveShadow = false;
        const materialFor = (material: THREE.Material) => {
          let depth = this.depthMaterials.get(material);
          if (!depth) {
            depth = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: material.side });
            depth.clippingPlanes = material.clippingPlanes;
            depth.clipIntersection = material.clipIntersection;
            this.depthMaterials.set(material, depth);
          }
          return depth;
        };
        clone.material = Array.isArray(original.material) ? original.material.map(materialFor) : materialFor(original.material);
        if (original instanceof THREE.InstancedMesh && clone instanceof THREE.InstancedMesh) {
          clone.instanceMatrix = original.instanceMatrix;
          clone.count = original.count;
        }
      }
    });
    return copy;
  }

  private renderFlight(r: THREE.WebGLRenderer, localBeat: number, river: boolean, camera: THREE.PerspectiveCamera, occluders: THREE.Object3D[], out: THREE.WebGLRenderTarget) {
    const flight = recapFlight(localBeat, river);
    this.ball.position.copy(flight.position);
    this.ball.scale.setScalar(flight.radius / BALL_RADIUS);
    this.ball.rotation.set(0.15, 0.25, flight.angle);
    this.ball.visible = flight.visible;
    this.meetingTarget.visible = false;
    if (!flight.visible) return;
    const copies = occluders.map(object => this.depthCopy(object));
    this.ballScene.add(...copies);
    this.ballScene.background = out.texture;
    const clipping = r.localClippingEnabled;
    try {
      r.localClippingEnabled = true;
      r.setRenderTarget(this.ballTarget);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.ballScene, camera);
      this.copy.u.tIn!.value = this.ballTarget.texture;
      this.copy.render(r, out);
    } finally {
      r.localClippingEnabled = clipping;
      this.ballScene.remove(...copies);
    }
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget, ctx?: Layer3DContext): PostParams {
    const b = this.beat(f);
    this.recapBall = null;
    this.ball.visible = false;
    this.meetingTarget.visible = false;
    this.arrivalTarget.visible = false;
    this.ball.position.set(0, 0, 0);
    this.ball.scale.setScalar(1);
    this.ball.rotation.set(0, 0, 0);
    const shot = this.shotAt(b);
    const imp = f.env.impact;
    const jx = (Math.sin(f.frame * 12.9898) * 43758.5453) % 1;
    const jy = (Math.sin(f.frame * 78.233) * 12345.678) % 1;

    // ── 回收：直接借用前面各段的三维层 ──
    if (shot.shot === 'recap') {
      let cut = RECAP[0]!;
      for (const c of RECAP) if (b >= c[0]) cut = c;
      const layer = this.recap.get(cut[1]);
      if (layer) {
        const src = sectionRange(cut[1]);
        const sf = frameAt(src.start + (cut[2] + (b - cut[0]) * 1.3) * BEAT); // 回收时稍快
        const p = layer.render(r, sf, out, undefined) ?? {};
        const native = layer.protagonist?.();
        const space = layer.recapSpace?.();
        if (native?.visible) this.recapBall = native;
        else if (space) this.renderFlight(r, b - cut[0], false, space.camera, space.occluders, out);
        const punch = Math.exp(-(b - cut[0]) * 6);
        return { ...p, ca: 0, halation: 0, zoom: (p.zoom ?? 1) * (1 + 0.06 * punch), flash: 0, fade: 0, shake: [jx * 6 * punch, jy * 6 * punch] };
      }
    }

    let scene: THREE.Scene;
    if (shot.shot === 'burst') {
      scene = this.scene;
      this.burstCam(b);
      // 冲击环：第 0 拍从中心亮点爆开；第 8 拍两束光相遇再爆一次（红金混色）
      const ringAt = (m: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>, start: number, size: number, mix: number) => {
        const lb = b - start;
        const u = m.material.uniforms;
        const on = lb >= 0 && lb < 3;
        m.visible = on;
        if (!on) return;
        u.uR!.value = (0.0025 + size * outCubic(lb / 2.4)) / 20;
        u.uW!.value = 0.004 + 0.02 * outCubic(lb / 2.4);
        u.uI!.value = Math.exp(-lb * 1.4) * (start < 1 ? 0.25 : 0.65);
        u.uMix!.value = mix;
        m.quaternion.copy(this.cam.quaternion);
      };
      ringAt(this.rings[0]!, 0, 16, 0);
      ringAt(this.rings[1]!, 0.25, 11, 0);
      ringAt(this.rings[2]!, 7, 14, 1); // 第 7 拍两束光相遇：红金混色的第二道冲击环，第 8 拍切入回收
      // 两束光：1–7 拍螺旋接近，第 7 拍在中心相遇
      const prog = easeIn((b - 1) / 6) * 0.85 + 0.15 * clamp01((b - 1) / 6);
      const on = b >= 1 ? inOut((b - 1) / 0.8) * (1 - inOut((b - 7) / 0.4)) : 0;
      this.beamsA.forEach((bm) => {
        this.placeBeam(bm, prog, 0.9, on * 0.22);
        bm.head.visible = false;
      });
    } else {
      scene = this.river;
      this.riverCam(b);
      const tNow = this.t0 + b * BEAT; // 已按切片 / 静音映射的时间
      const wu = this.water.material.uniforms;
      wu.uEye!.value.copy(this.cam.position);
      wu.uTime!.value = tNow;
      // 波纹
      const rips = this.ripples.filter((x) => x.t <= tNow && tNow - x.t < 4).slice(-MAX_RIP);
      for (let i = 0; i < MAX_RIP; i++) {
        const x = rips[i];
        (wu.uRip!.value as THREE.Vector4[])[i]!.set(x?.x ?? 0, x?.z ?? 0, x ? tNow - x.t : 0, x?.amp ?? 0);
      }
      // 灯光：灯笼（随底鼓轻闪）+ 光束头 + 光团
      const lights = wu.uLight!.value as THREE.Vector4[];
      const lcol = wu.uLightCol!.value as THREE.Color[];
      let n = 0;
      const red = lin(PALETTE.red), paper = lin(PALETTE.paper);
      const lantSorted = this.qinhuai.lights.slice().sort((a, c) => a.pos.distanceToSquared(this.cam.position) - c.pos.distanceToSquared(this.cam.position));
      for (const l of lantSorted) {
        if (n >= MAX_LIGHT - 3) break;
        lights[n]!.set(l.pos.x, l.pos.y, l.pos.z, l.strength);
        lcol[n]!.copy(l.color);
        n++;
      }
      // 24–32 拍：两束光从两岸奔向河心上方，第 28 拍相遇
      const lb = b - 24;
      const prog = clamp01(easeIn(lb / 4) * 0.8 + 0.2 * clamp01(lb / 4));
      const beamOn = 0;
      this.beamsB.forEach((bm, i) => {
        this.placeBeam(bm, prog, 0.5, beamOn * (1 + 0.5 * f.env.kick));
        if (beamOn > 0.01) {
          lights[n]!.set(bm.head.position.x, bm.head.position.y, bm.head.position.z, 6 * beamOn);
          lcol[n]!.copy(i ? red : paper);
          n++;
        }
      });
      // 光团：28 拍相遇后悬在河心上方随底鼓脉动；32 拍落进水里
      const orbOn = b >= 28 ? inOut((b - 28) / 0.3) * (1 - inOut((b - 32) / 0.25)) : 0;
      const fall = easeIn((b - 30.5) / 1.5);
      const oy = 3.2 - 3.2 * fall;
      this.orb.position.set(0, oy, FALL_POINT.z);
      this.orb.quaternion.copy(this.cam.quaternion);
      this.orb.scale.setScalar((2.2 + 1.2 * f.env.kick) * (0.5 + 0.5 * orbOn));
      this.orb.visible = false;
      if (orbOn > 0.01) { lights[n]!.set(0, oy, FALL_POINT.z, 10 * orbOn); lcol[n]!.copy(paper).lerp(red, 0.3); n++; }
      wu.uNLight!.value = n;
      // 28 拍相遇时的竖直冲击环
      const ru = this.riverRing.material.uniforms;
      const rl = b - 28;
      this.riverRing.visible = rl >= 0 && rl < 2.4;
      this.riverRing.position.set(0, 0.12, FALL_POINT.z);
      this.riverRing.rotation.set(-Math.PI / 2, 0, 0);
      ru.uR!.value = (0.08 + 4.5 * outCubic(rl / 2.4)) / 20;
      ru.uW!.value = 0.0025 + 0.003 * outCubic(rl / 2.4);
      ru.uI!.value = 0.7 * Math.exp(-Math.max(0, rl) * 1.3);
      ru.uMix!.value = 1;
      // 32 拍：落水冲击波 + 水花
      const age = (b - 32) * BEAT;
      (wu.uBigRip!.value as V3).set(FALL_POINT.x, FALL_POINT.z, b >= 32 ? age : -1);
      // 2026-10-18 Claude（用户 00:19：「不要这种发光粒子效果，好难看，换一种」）：去掉白色光晕和水花粒子，
      // 落水改为白描式的同心波纹线——从 32 拍落水那一刻起就出线（原来 34 拍才淡入）
      wu.uGlowRip!.value = 0;
      wu.uLines!.value = inOut((b - 32) / 1.5);
      const sp = this.riverSparks.material.uniforms;
      this.riverSparks.position.set(0, 0.1, FALL_POINT.z);
      sp.uAge!.value = Math.max(0, age);
      sp.uPx!.value = this.rt.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)));
      sp.uSize!.value = 0.12;
      this.riverSparks.visible = false;
      updateFireworks(this.fireworks, b);
      // 末段两岸与灯笼沉入夜色，只剩同心线条
      (this.river.fog as THREE.FogExp2).density = 0.012 + 0.08 * inOut((b - 35) / 4);
      this.banks.visible = b < 35.5; // 俯视前撤掉两岸，只留水面和同心线条
      this.sky.visible = this.banks.visible;
      const waterfrontFade = 1 - inOut((b - 34) / 1.5);
      this.qinhuai.setFade(waterfrontFade);
      this.sky.material.uniforms.uFade!.value = waterfrontFade;
      wu.uRefined!.value = this.banks.visible ? waterfrontFade : 0;
      if (b >= 35.5) wu.uNLight!.value = 0;
    }

    scene.background = ctx?.poster ?? this.ink;
    this.sky.material.uniforms.uPoster!.value = ctx?.poster ?? null;
    (this.sky.material.uniforms.uResolution!.value as THREE.Vector2).set(this.rt.width, this.rt.height);
    if (scene === this.river && this.banks.visible) this.renderReflection(r);
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, this.cam);
    if (scene === this.river && this.banks.visible) {
      const background = scene.background;
      const fog = scene.fog;
      const override = scene.overrideMaterial;
      const visibility = scene.children.map(child => child.visible);
      try {
        scene.background = null;
        scene.fog = null;
        scene.overrideMaterial = this.normalMaterial;
        scene.children.forEach(child => { child.visible = child.visible && child === this.banks; });
        r.setRenderTarget(this.outlineTarget);
        r.setClearColor(0x8080ff, 1);
        r.clear();
        r.render(scene, this.cam);
      } finally {
        scene.background = background;
        scene.fog = fog;
        scene.overrideMaterial = override;
        scene.children.forEach((child, index) => { child.visible = visibility[index]!; });
      }
      const uniforms = this.whiteOutline.u;
      uniforms.tColor!.value = this.rt.texture;
      uniforms.tNormal!.value = this.outlineTarget.texture;
      uniforms.tDepth!.value = this.outlineTarget.depthTexture;
      uniforms.uNear!.value = this.cam.near;
      uniforms.uFar!.value = this.cam.far;
      uniforms.uFade!.value = 0.64 * (1 - inOut((b - 34) / 1.5));
      this.whiteOutline.render(r, out);
    } else {
      this.copy.u.tIn!.value = this.rt.texture;
      this.copy.render(r, out);
    }

    if (shot.shot !== 'river') this.renderBall(r, f, out);
    const k = imp * 10 + f.env.kick * 1.6;
    const burst0 = b < 0.5 ? 1 - b / 0.5 : 0;
    if (b >= 16 && b < 27.5) return {
      bloom: 0.24, bloomThreshold: 0.95, halation: 0,
      ca: 0, zoom: 1, shake: [0, 0], grain: 0.025, vignette: 0.23, flash: 0, fade: 0,
    };
    return {
      bloom: b < 8 ? 0.18 : 0.9,
      bloomThreshold: 0.9,
      halation: 0,
      ca: 0,
      zoom: 1 + 0.02 * f.env.kick,
      shake: [jx * k, jy * k],
      grain: 0.045,
      vignette: 0.32,
      flash: 0.22 * burst0, // 只在爆开的半拍内
      fade: 0,
    };
  }

  private renderReflection(r: THREE.WebGLRenderer) {
    const camera = this.reflectionCamera;
    camera.copy(this.cam);
    camera.position.y *= -1;
    const target = v(0, 0, -1).applyQuaternion(this.cam.quaternion).add(this.cam.position);
    target.y *= -1;
    camera.up.copy(this.cam.up);
    camera.up.y *= -1;
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const textureMatrix = this.water.material.uniforms.uReflectionMatrix!.value as THREE.Matrix4;
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
    const visibility = this.river.children.map(child => child.visible);
    (this.sky.material.uniforms.uResolution!.value as THREE.Vector2).set(this.reflectionTarget.width, this.reflectionTarget.height);
    try {
      this.river.children.forEach(child => { child.visible = child === this.riverTypography || child.visible && (child === this.banks || child === this.sky || child === this.fireworks); });
      r.setRenderTarget(this.reflectionTarget);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.river, camera);
    } finally {
      this.river.children.forEach((child, index) => { child.visible = visibility[index]!; });
      (this.sky.material.uniforms.uResolution!.value as THREE.Vector2).set(this.rt.width, this.rt.height);
    }
  }
}

// ───────── 秦淮上空的烟花（Claude 2026-10-15）─────────
// 段内拍（drop2 第 24 拍 = 76.667 秒重拍 impact）：23–23.5 拍一道细线从水面升空（随上升音），静音停顿时停在半空，
// 24 拍主烟花炸开；25、26、27 拍各一朵小的；28 拍两球相遇前全部散尽。
// 白描风格：每朵是一圈放射的细线（米白为主，每三根一根红），线头亮、线尾淡，带一点下坠；不做实心光团。
// 仍是时间的纯函数（输入是已按切片 / 静音映射过的段内拍）。
const FIREWORK_BURSTS = [
  { beat: 24, center: [0, 19, -82], radius: 18, rays: 96 },
  { beat: 25, center: [-18, 15, -70], radius: 10, rays: 56 },
  { beat: 26, center: [17, 17, -78], radius: 11, rays: 60 },
  { beat: 27, center: [-3, 23, -96], radius: 9, rays: 48 },
] as const;
const FIREWORK_SEGMENTS = FIREWORK_BURSTS.reduce((sum, burst) => sum + burst.rays, 0) + 1;
const FIREWORK_LIFE = 1.7; // 秒

function createFireworks() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FIREWORK_SEGMENTS * 6), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FIREWORK_SEGMENTS * 8), 4));
  const lines = new THREE.LineSegments(geometry, new THREE.ShaderMaterial({
    vertexShader: 'attribute vec4 color; varying vec4 vColor; void main(){ vColor = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec4 vColor; void main(){ gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  lines.frustumCulled = false;
  lines.visible = false;
  return lines;
}

function updateFireworks(lines: THREE.LineSegments, beat: number) {
  const position = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
  const color = lines.geometry.getAttribute('color') as THREE.BufferAttribute;
  const red = lin(PALETTE.red), paper = lin(PALETTE.paper);
  let segment = 0, any = false;
  const put = (a: V3, b: V3, c: THREE.Color, tailAlpha: number, headAlpha: number) => {
    position.setXYZ(segment * 2, a.x, a.y, a.z);
    position.setXYZ(segment * 2 + 1, b.x, b.y, b.z);
    color.setXYZW(segment * 2, c.r, c.g, c.b, tailAlpha);
    color.setXYZW(segment * 2 + 1, c.r, c.g, c.b, headAlpha);
    segment++;
  };
  // 升空的细线（23–24 拍）
  const main = FIREWORK_BURSTS[0];
  const rise = clamp01((beat - 23) / 0.5);
  if (beat >= 23 && beat < 24) {
    const top = v(main.center[0], main.center[1] * rise, main.center[2]);
    const tail = v(main.center[0], Math.max(0, top.y - 6), main.center[2]);
    put(tail, top, paper, 0, 0.9);
    any = true;
  } else put(v(0, 0, 0), v(0, 0, 0), paper, 0, 0);
  for (const burst of FIREWORK_BURSTS) {
    const age = (beat - burst.beat) * BEAT;
    const alive = age >= 0 && age < FIREWORK_LIFE;
    const fade = alive ? Math.pow(1 - age / FIREWORK_LIFE, 1.4) : 0;
    const spread = 1 - Math.exp(-age * 4.5);
    const droop = 2.2 * age * age;
    const center = v(burst.center[0], burst.center[1], burst.center[2]);
    for (let ray = 0; ray < burst.rays; ray++) {
      if (!alive) { put(center, center, paper, 0, 0); continue; }
      any = true;
      // 球面上均匀分布的方向（斐波那契），压扁一点，更像平面上绽开的花
      const k = (ray + 0.5) / burst.rays;
      const polar = Math.acos(1 - 2 * k), azimuth = Math.PI * (3 - Math.sqrt(5)) * ray;
      const dir = v(Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth) * 0.45);
      const jitter = 0.85 + 0.3 * Math.abs(Math.sin(ray * 12.9898 + burst.beat * 78.233));
      const reach = burst.radius * jitter * spread;
      const head = center.clone().addScaledVector(dir, reach);
      head.y -= droop;
      const trail = burst.radius * jitter * (0.18 + 0.5 * Math.exp(-age * 2.5));
      const tail = center.clone().addScaledVector(dir, Math.max(0, reach - trail));
      tail.y -= droop * 0.6;
      put(tail, head, ray % 3 === 0 ? red : paper, 0, fade * (ray % 3 === 0 ? 1.15 : 0.95));
    }
  }
  position.needsUpdate = true;
  color.needsUpdate = true;
  lines.visible = any;
}
