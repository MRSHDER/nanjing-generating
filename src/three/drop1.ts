// 段落 3「城墙爆发」三维层（32 拍）。负责人：Codex。分工见 VISUAL_TASKS.md「3. 城墙爆发」。
//
// 物体：程序化城墙（实例化釉面砖，约 1500 块）+ 拱形城门洞 + 深色地面；材质为物理材质（清漆釉面），
//       反射环境用共用的限亮柔光环境。全部由段内拍 b 决定，可乱序取帧。
// 构图（硬切落在拍点上）：
//   0–16 拍  砌墙（10-13 用户要求放慢、多切镜头）：拱心红砖先飞到位，随后砖一排排从上方落下，
//            正面墙约 14.5 拍砌完，城门洞 4–15.5 拍由外向里一圈圈砌进去；
//            镜头约每 2 拍一切：宽景 → 侧向细节 → 高空俯视 → 城门 → 细节 → 宽景 → 城门
//   16–24 拍 穿越城门洞
//   24–32 拍 每 2 拍换构图；最后 4 拍砖块松动、砖缝透出红光，准备进入故障段
// 提供给 Codex：anchors() → gateCenter（城门洞中心）、firstBrick（拱心红砖）；DROP1_SHOTS（构图切换表）。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { BEAT, type Frame } from '../engine/beat';
import { PALETTE } from '../engine/palette.glsl';
import type { PostParams } from '../engine/post';
import type { Layer3D, Layer3DContext } from './index';
import { getDrop1Layout } from '../overlay2d/drop1';
import { lin, softStudioEnv } from './env';
import { lockBrickExit } from './lock';

// ───────── 尺寸 ─────────
const BW = 0.6, BH = 0.32, BD = 0.4;
const COLS = 38, ROWS = 26;
const GATE_HALF = 2.2, GATE_SPRING = 3.0; // 城门洞半宽、拱脚高度（拱顶 = 3.0 + 2.2）
const DEPTH = 12; // 城门洞进深（太短的话，镜头靠近出口时两侧墙壁会全部移出画面）
// 2026-10-18 Claude：镜头穿过城门洞出口时，离出口拱面不到近裁剪距离的那几毫秒，拱面被裁掉、露出城墙段背景板，
// 60fps 成片 26.617 秒闪一帧黑底城墙（30fps 恰好没采到）。提前 0.3 个单位换成满屏传送门画面，不再经过这段空窗。
const PORTAL_SWAP_Z = -DEPTH + 0.3;
const SLICE = 0.4;

type ShotName = 'wide' | 'detail' | 'gate' | 'fly' | 'high';
/** 构图切换表（段内拍）。Codex 可据此安排大字插入点。 */
export const DROP1_SHOTS: { beat: number; shot: ShotName }[] = [
  { beat: 0, shot: 'wide' },
  { beat: 3, shot: 'detail' },
  { beat: 5, shot: 'high' },
  { beat: 7, shot: 'gate' },
  { beat: 9, shot: 'detail' },
  { beat: 11, shot: 'wide' },
  { beat: 13, shot: 'gate' },
  { beat: 16, shot: 'fly' },
  { beat: 24, shot: 'high' },
  { beat: 26, shot: 'detail' },
  { beat: 28, shot: 'gate' },
  { beat: 30, shot: 'wide' },
];

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeIn = (x: number) => x * x * x;
const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);

interface Brick {
  pos: THREE.Vector3; // 落位后的位置
  rotZ: number; // 拱圈砖的倾角
  rotY: number; // 洞壁砖的朝向
  land: number; // 落位的拍
  kind: 0 | 1 | 2; // 0 城墙灰、1 红釉、2 金
  seed: number;
}

const WALL_TOP = ROWS * BH;
const masonryHeight = (b: number) => BH * Math.floor(ROWS * clamp01((b - 1.5) / 12.8));
const extensionHeight = (b: number, height: number, index: number) => Math.min(
  masonryHeight(b), height * clamp01((b - 1.5 - index % 5 * 0.65) / (12.8 - index % 5 * 0.65)),
);
interface WallSegment {
  x: number;
  z: number;
  length: number;
  height: number;
  depth: number;
  angle: number;
  land: number;
}

function wallSegments(): WallSegment[] {
  const segments: WallSegment[] = [];
  const points = [[11.2, -6], [24, -8], [38, -17], [54, -31], [74, -49], [100, -76]];
  for (const side of [-1, 1]) {
    for (let index = 0; index < points.length - 1; index++) {
      const near = points[index]!, far = points[index + 1]!;
      const deltaX = far[0]! - near[0]!, deltaZ = side * (far[1]! - near[1]!);
      segments.push({
        x: side * (near[0]! + far[0]!) / 2, z: (near[1]! + far[1]!) / 2,
        length: Math.hypot(deltaX, deltaZ) + 0.6,
        height: WALL_TOP - index * 0.5, depth: 12 - Math.min(4, index * 1.5),
        angle: -Math.atan2(deltaZ, deltaX), land: 9.5 + index * 1.1,
      });
    }
  }
  return segments;
}

function wallProfile(clearance = 0) {
  const half = COLS * BW / 2;
  const profile = new THREE.Shape();
  profile.moveTo(-half, 0);
  profile.lineTo(-half, WALL_TOP);
  profile.lineTo(half, WALL_TOP);
  profile.lineTo(half, 0);
  profile.lineTo(GATE_HALF + clearance, 0);
  profile.lineTo(GATE_HALF + clearance, GATE_SPRING);
  profile.absarc(0, GATE_SPRING, GATE_HALF + clearance, 0, Math.PI, false);
  profile.lineTo(-GATE_HALF - clearance, 0);
  profile.lineTo(-half, 0);
  return profile;
}

function roofGeometry(width: number, depth: number, height: number) {
  const vertices = [
    -width, 0, -depth, width, 0, -depth, width, 0, depth, -width, 0, depth,
    -width * 0.65, height * 0.5, -depth * 0.5, width * 0.65, height * 0.5, -depth * 0.5,
    width * 0.65, height * 0.5, depth * 0.5, -width * 0.65, height * 0.5, depth * 0.5,
    -width * 0.65, height, 0, width * 0.65, height, 0,
  ];
  const indices: number[] = [];
  for (let index = 0; index < 4; index++) {
    const next = (index + 1) % 4;
    indices.push(index, next, next + 4, index, next + 4, index + 4);
  }
  indices.push(4, 5, 9, 4, 9, 8, 7, 8, 9, 7, 9, 6, 4, 8, 7, 5, 6, 9);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildWall(): Brick[] {
  const out: Brick[] = [];
  const inGate = (x: number, y: number, margin: number) => {
    if (Math.abs(x) < GATE_HALF + margin && y < GATE_SPRING) return true;
    return Math.hypot(x, y - GATE_SPRING) < GATE_HALF + margin;
  };
  // 正面墙：错缝砌法，从下往上每拍约 1.6 排（约 14.5 拍砌完 22 排）
  for (let r = 0; r < ROWS; r++) {
    const y = BH / 2 + r * BH;
    const off = r % 2 ? BW / 2 : 0;
    for (let c = 0; c < COLS; c++) {
      const x = (c - COLS / 2) * BW + off;
      if (inGate(x, y, BW * 0.35)) continue;
      const s = r * 1000 + c;
      const h = hash(s);
      out.push({ pos: new THREE.Vector3(x, y, 0), rotZ: 0, rotY: 0, land: 0.8 + (r / ROWS) * 13.2 + hash(s + 7) * 0.5, kind: h > 0.985 ? 2 : h > 0.94 ? 1 : 0, seed: s });
    }
  }
  // 城门洞：两侧洞壁 + 半圆拱圈，沿进深方向一圈一圈砌（4–15.5 拍）
  const slices = Math.floor(DEPTH / SLICE);
  for (let k = 0; k < slices; k++) {
    const z = -BD / 2 - k * SLICE;
    const land = 4 + (k / (slices - 1)) * 9.2;
    for (let r = 0; r < Math.floor(GATE_SPRING / BH); r++) {
      for (const side of [-1, 1]) {
        const s = 50000 + k * 100 + r * 2 + (side > 0 ? 1 : 0);
        out.push({ pos: new THREE.Vector3(side * (GATE_HALF + BD / 2), BH / 2 + r * BH, z), rotZ: 0, rotY: Math.PI / 2, land: land + hash(s) * 0.3, kind: hash(s + 3) > 0.95 ? 1 : 0, seed: s });
      }
    }
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (i + 0.5) / n;
      const R = GATE_HALF + BH / 2;
      const s = 80000 + k * 100 + i;
      const archDelay = Math.min(i, n - 1 - i) / (n / 2 - 1) * 2;
      out.push({ pos: new THREE.Vector3(Math.cos(a) * R, GATE_SPRING + Math.sin(a) * R, z), rotZ: a - Math.PI / 2, rotY: 0, land: land + archDelay + hash(s) * 0.08, kind: hash(s + 5) > 0.96 ? 1 : 0, seed: s });
    }
  }
  for (const [segmentIndex, segment] of wallSegments().entries()) {
    if (segmentIndex % 5 !== 0) continue;
    const columns = Math.ceil(segment.length / BW);
    for (let row = 0; row < ROWS; row++) {
      for (let column = 0; column < columns; column++) {
        const horizontal = (column + 0.5) / columns * segment.length - segment.length / 2;
        const depth = segment.depth / 2 + 0.05;
        const seed = 120000 + segmentIndex * 2000 + row * columns + column;
        out.push({
          pos: new THREE.Vector3(segment.x + Math.cos(segment.angle) * horizontal + Math.sin(segment.angle) * depth, BH / 2 + row * BH, segment.z - Math.sin(segment.angle) * horizontal + Math.cos(segment.angle) * depth),
          rotZ: 0, rotY: segment.angle, land: 1.2 + row / ROWS * 12.4 + hash(seed) * 0.3,
          kind: hash(seed) > 0.98 ? 1 : 0, seed,
        });
      }
    }
  }
  const redCount = Math.round(out.length * 0.015);
  const redSeeds = new Set(out.filter(brick => brick.seed >= 80000 && brick.seed < 90000)
    .sort((left, right) => hash(left.seed + 13) - hash(right.seed + 13))
    .slice(0, redCount).map(brick => brick.seed));
  out.forEach(brick => {
    brick.kind = redSeeds.has(brick.seed) ? 1 : 0;
  });
  return out;
}

/** 拱心红砖：本段第 0 拍就在（承接锁定段的红色方块），其余砖块围绕它砌起来。 */
const KEYSTONE = new THREE.Vector3(0, GATE_SPRING + GATE_HALF + BH / 2, BD * 0.6);

function shotAt(b: number): ShotName {
  let s: ShotName = 'wide';
  for (const e of DROP1_SHOTS) if (b >= e.beat) s = e.shot;
  return s;
}

/** 每个构图的镜头（位置、注视点、视角）。lb = 该构图内的拍。 */
function camera(b: number): { pos: THREE.Vector3; look: THREE.Vector3; fov: number } {
  if (b >= 30) {
    const start = camera(30 - 1e-6);
    const progress = clamp01((b - 30) / 2);
    const travel = progress * progress * (3 - 2 * progress);
    return { pos: start.pos.clone().lerp(new THREE.Vector3(0, 2.4, -12.2), travel), look: start.look.clone().lerp(new THREE.Vector3(0, 2.4, -18.2), travel), fov: start.fov + (35 - start.fov) * travel };
  }
  const shot = shotAt(b);
  const start = [...DROP1_SHOTS].reverse().find((e) => b >= e.beat)!.beat;
  const lb = b - start;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (shot) {
    case 'wide': {
      const late = start >= 24 ? 1 : 0;
      if (start === 0) return { pos: v(-6 + lb * 0.35, 2.3 + lb * 0.15, 9.5 - lb * 0.3), look: v(-6 + lb * 0.35, 1.25 + lb * 0.25, 0), fov: 43 };
      if (!late) return { pos: v(Math.sin(b * 0.12) * 2, 3.8 + lb * 0.1, 27 - lb * 0.25), look: v(0, 1.5 + Math.min(5, b * 0.28), -2), fov: 43 };
      return { pos: v(Math.sin(b * 0.12) * 3 + late * 5, 6.5 + lb * 0.12 + late * 5, 43 - lb * 0.4 + late * 10), look: v(0, 5.2 + late * 1.2, -5), fov: 48 };
    }
    case 'detail':
      // 侧向细节：沿墙面斜看过去，墙只占画面一侧，上方和远处露出二维背景板
      return { pos: v(-12 + lb * 2.2 + (start % 4) * 2.5, 0.7, 5.2), look: v(-3 + lb * 2.2 + (start % 4) * 2.5, 3.2, -0.6), fov: 36 };
    case 'gate':
      return { pos: v(0.4 * Math.sin(lb), 1.9, 11 - lb * 1.8), look: v(0, 2.6, -6), fov: 46 };
    case 'fly': {
      const z = 10 - (lb / 8) * 16.5; // 从门前 10 推进到洞内 -6.5；切镜时离出口（-11.8）还有 5 个单位以上，两侧砖墙始终在画面里
      return { pos: v(0.3 * Math.sin(lb * 0.8), 2.1 + 0.15 * Math.sin(lb * 1.3), z), look: v(0, 2.3, z - 6), fov: 52 + 10 * Math.sin((lb / 8) * Math.PI) };
    }
    case 'high':
      if (start < 16) return { pos: v(-10 + lb, 11, 20), look: v(0, 1.8, -3), fov: 38 };
      return { pos: v(-22 + lb * 1.5, 26, 36), look: v(0, 5.5, -12), fov: 48 };
  }
}

export default class Drop1Layer implements Layer3D {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(40, W / H, 0.05, 200);
  private rt = makeRT(W, H, { depth: true });
  private copy = new FSPass(`uniform sampler2D tIn; void main(){ gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }`, { tIn: { value: null } });
  private bricks = buildWall();
  private meshes: THREE.InstancedMesh[] = [];
  private byKind: number[][] = [[], [], []];
  private keystone!: THREE.Mesh;
  private portal!: THREE.Mesh<THREE.ShapeGeometry, THREE.ShaderMaterial>;
  private entry?: THREE.Vector3;
  private glowPlate!: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private dummy = new THREE.Object3D();
  private sun = new THREE.DirectionalLight(0xffffff, 1.4);
  private inkBg = lin(PALETTE.ink);
  private ground!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private wallCore!: THREE.Mesh;
  // ── 墨底白描（10-13 用户：建模和环境像五毛，试墨底白描）──
  private rtN!: THREE.WebGLRenderTarget;
  private normalMats = new WeakMap<THREE.Material, THREE.MeshNormalMaterial>();
  private masonryStyle = {
    strength: { value: 0.5 },
    topSize: { value: new THREE.Vector2(1.2, 1.6) },
  };
  private inkPass = new FSPass(`
uniform sampler2D tN, tD, tC, tPoster;
uniform float uHasPoster, uNear, uFar, uCrack, uEntry;
uniform vec2 uTexel;
float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  float d0 = texture2D(tD, vUv).r;
  bool obj = d0 < 0.99999;
  bool portal = texture2D(tN, vUv).a < 0.3;
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
  // 砖缝线（法线变化）只在近处画，远处的墙只留轮廓（深度跳变），否则远墙会糊成一片噪点
  float far = mix(1.0, 0.22, smoothstep(25.0, 160.0, zMin));
  float nearDetail = 1.0 - smoothstep(14.0, 45.0, zMin);
  float edge = max(smoothstep(0.35, 0.65, en) * nearDetail, smoothstep(0.03, 0.07, ed));
  float joints = portal ? 0.0 : (1.0 - texture2D(tN, vUv).a) * (1.0 - smoothstep(30.0, 38.0, z0));
  edge = max(edge, joints);
  vec3 col = uHasPoster > 0.5 ? texture2D(tPoster, vUv).rgb : C_INK;
  if (obj) {
    vec3 c = texture2D(tC, vUv).rgb;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    col = mix(C_INK * 1.15, C_WALL * 0.32, clamp(lum * 1.8, 0.0, 1.0)); // 面：墨色，受光面略亮一点，体积读得出来
    float redness = (c.r - max(c.g, c.b)) / max(c.r, 1e-3);
    col = mix(col, C_RED * (0.75 + 0.6 * clamp(lum * 2.0, 0.0, 1.0)), smoothstep(0.55, 0.8, redness) * step(0.03, c.r));
    float goldness = step(c.b * 1.6, c.g) * step(0.04, c.r) * (1.0 - smoothstep(0.55, 0.8, redness));
    col = mix(col, C_GOLD * 0.75, goldness * 0.8);
    col = mix(C_INK, col, far * 0.85 + 0.15);
  }
  col = mix(col, C_PAPER * 0.9, clamp(edge * far, 0.0, 1.0) * 0.9 * (1.0 - uEntry)); // 线：米白
  vec3 rawColor = texture2D(tC, vUv).rgb;
  if (obj && uEntry > 0.0) col = mix(col, rawColor, uEntry);
  if (portal && obj) col = rawColor;
  float crackRed = smoothstep(0.55, 0.8, (rawColor.r - max(rawColor.g, rawColor.b)) / max(rawColor.r, 1e-3)) * step(0.08, rawColor.r);
  if (uCrack > 0.0) col = mix(col, rawColor, crackRed);
  gl_FragColor = vec4(col, 1.0);
}`, {
    tN: { value: null }, tD: { value: null }, tC: { value: null }, tPoster: { value: null }, uHasPoster: { value: 0 },
    uNear: { value: 0.05 }, uFar: { value: 200 }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) }, uCrack: { value: 0 }, uEntry: { value: 0 },
  });
  private wallClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private battlements!: THREE.InstancedMesh;
  private battlementBlocks: { pos: THREE.Vector3; angle: number; land: number }[] = [];
  private wings!: THREE.InstancedMesh;
  private segments = wallSegments();
  private gateTower = new THREE.Group();
  private towerParts: { mesh: THREE.Object3D; baseY: number; land: number }[] = [];
  private wingGlow!: THREE.InstancedMesh;
  private platform!: THREE.Mesh;

  async init(r: THREE.WebGLRenderer) {
    this.rtN = new THREE.WebGLRenderTarget(this.rt.width, this.rt.height, { depthBuffer: true });
    this.rtN.depthTexture = new THREE.DepthTexture(this.rt.width, this.rt.height, THREE.UnsignedIntType);
    this.rt.samples = 4;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene.environment = softStudioEnv(r, { key: 1.2, rim: 0.6 });
    this.scene.environmentIntensity = 0.28;
    this.scene.fog = new THREE.FogExp2(lin(PALETTE.wall), 0.007);
    this.scene.add(new THREE.HemisphereLight(lin(PALETTE.paper), lin(PALETTE.ink), 0.45));
    this.scene.background = this.inkBg; // 收到 Codex 的背景板后每帧替换

    this.sun.color.set('#ffffff');
    this.sun.intensity = 1.65;
    this.sun.position.set(-28, 45, 22);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -35; sc.right = 35; sc.top = 30; sc.bottom = -20; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight(lin(PALETTE.paper), 0.16);
    rim.position.set(10, 4, -12);
    this.scene.add(rim);

    const groundMaterial = new THREE.MeshStandardMaterial({ color: lin(PALETTE.wall), roughness: 0.92, metalness: 0 });
    groundMaterial.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGroundWorld;')
        .replace('#include <color_fragment>', `#include <color_fragment>
vec2 paving = vGroundWorld.xz / vec2(3.2, 1.6);
vec2 nearestJoint = abs(fract(paving - 0.5) - 0.5);
vec2 lineWidth = max(fwidth(paving), vec2(0.001));
float joint = 1.0 - clamp(min(nearestJoint.x / lineWidth.x, nearestJoint.y / lineWidth.y), 0.0, 1.0);
float distanceFade = 1.0 - smoothstep(15.0, 90.0, distance(cameraPosition, vGroundWorld));
diffuseColor.rgb *= 1.0 - 0.12 * joint * distanceFade;`);
    };
    groundMaterial.customProgramCacheKey = () => 'drop1-dusk-paving-v1';
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.025;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // 三种砖：城墙灰釉、红釉、金属金。砖缝的红光（最后 4 拍）用自发光做。
    const geo = new RoundedBoxGeometry(BW * 0.96, BH * 0.92, BD, 3, 0.035);
    const mats = [
      new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.wall), roughness: 0.78, clearcoat: 0.18, clearcoatRoughness: 0.5 }),
      new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.red), roughness: 0.48, clearcoat: 0.45, clearcoatRoughness: 0.3 }),
      new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.gold), metalness: 0.65, roughness: 0.5 }),
    ];
    this.bricks.forEach((br, i) => this.byKind[br.kind]!.push(i));
    this.byKind.forEach((list, k) => {
      const m = new THREE.InstancedMesh(geo, mats[k]!, list.length);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      // 同一种砖之间做一点明暗差异（实例颜色，叠乘在材质色上）
      list.forEach((bi, j) => {
        const h = hash(this.bricks[bi]!.seed + 11);
        m.setColorAt(j, new THREE.Color().setScalar(0.78 + 0.3 * h));
      });
      this.meshes.push(m);
      this.scene.add(m);
    });

    // 墙后的红光背板（中间挖出城门洞）：最后 4 拍砖块松动时，红光从砖缝漏出来
    const plate = new THREE.Shape();
    const half = (COLS / 2) * BW;
    plate.moveTo(-half, 0); plate.lineTo(half, 0); plate.lineTo(half, ROWS * BH); plate.lineTo(-half, ROWS * BH); plate.lineTo(-half, 0);
    const hole = new THREE.Path();
    hole.moveTo(-GATE_HALF, 0); hole.lineTo(-GATE_HALF, GATE_SPRING);
    hole.absarc(0, GATE_SPRING, GATE_HALF, Math.PI, 0, true);
    hole.lineTo(GATE_HALF, 0); hole.lineTo(-GATE_HALF, 0);
    plate.holes.push(hole);
    this.glowPlate = new THREE.Mesh(new THREE.ShapeGeometry(plate, 24), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    this.glowPlate.position.z = -BD * 0.55;
    this.scene.add(this.glowPlate);

    this.buildCityWall();

    this.keystone = new THREE.Mesh(new RoundedBoxGeometry(1, 0.5, 0.5, 4, 0.05), mats[1]!.clone());
    const portalShape = new THREE.Shape();
    portalShape.moveTo(-GATE_HALF, 0);
    portalShape.lineTo(-GATE_HALF, GATE_SPRING);
    portalShape.absarc(0, GATE_SPRING, GATE_HALF, Math.PI, 0, true);
    portalShape.lineTo(GATE_HALF, 0);
    portalShape.closePath();
    this.portal = new THREE.Mesh(new THREE.ShapeGeometry(portalShape, 64), new THREE.ShaderMaterial({
      uniforms: { tPortal: { value: null }, uSize: { value: new THREE.Vector2(this.rt.width, this.rt.height) } },
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tPortal; uniform vec2 uSize; void main(){gl_FragColor=vec4(texture2D(tPortal,gl_FragCoord.xy/uSize).rgb,1.0);}',
      side: THREE.DoubleSide,
    }));
    this.portal.position.z = -DEPTH;
    this.portal.visible = false;
    this.scene.add(this.portal);
    this.keystone.castShadow = true;
    this.scene.add(this.keystone);
  }

  private buildCityWall() {
    const stone = new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.wall).multiplyScalar(0.86), roughness: 0.8, clearcoat: 0.15 });
    const masonryMaterial = stone.clone();
    const coreMaterial = stone.clone();
    coreMaterial.clippingPlanes = [this.wallClip];
    coreMaterial.clipShadows = true;
    const coreGeometry = new THREE.ExtrudeGeometry(wallProfile(0.28), { depth: DEPTH - 0.55, bevelEnabled: false, curveSegments: 32 });
    coreGeometry.translate(0, 0, -DEPTH + 0.25);
    this.wallCore = new THREE.Mesh(coreGeometry, coreMaterial);
    this.wallCore.castShadow = true;
    this.wallCore.receiveShadow = true;
    this.scene.add(this.wallCore);
    this.platform = new THREE.Mesh(new THREE.BoxGeometry(COLS * BW, 0.24, DEPTH - 0.3), masonryMaterial);
    this.platform.position.set(0, WALL_TOP + 0.12, -DEPTH / 2);
    this.platform.receiveShadow = true;
    this.scene.add(this.platform);

    this.wings = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), masonryMaterial, this.segments.length);
    this.wings.castShadow = true;
    this.wings.receiveShadow = true;
    this.wings.frustumCulled = false;
    this.scene.add(this.wings);
    const crackMaterial = new THREE.ShaderMaterial({
      uniforms: { uGlow: { value: 0 }, uRed: { value: lin(PALETTE.red) } },
      vertexShader: `varying vec2 vFaceUv; varying vec2 vFaceSize;
void main() {
  vFaceUv = uv;
  vFaceSize = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`,
      fragmentShader: `uniform float uGlow; uniform vec3 uRed; varying vec2 vFaceUv; varying vec2 vFaceSize;
void main() {
  vec2 brick = vFaceUv * vFaceSize;
  float row = floor(brick.y / 0.38);
  float jointX = mod(brick.x + mod(row, 2.0) * 0.4, 0.8);
  float jointY = mod(brick.y, 0.38);
  if (jointX > 0.035 && jointY > 0.025) discard;
  gl_FragColor = vec4(uRed * uGlow, 1.0);
}`,
      side: THREE.DoubleSide,
    });
    this.wingGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), crackMaterial, this.segments.length);
    this.wingGlow.frustumCulled = false;
    this.scene.add(this.wingGlow);

    for (let column = 0; column < 15; column++) {
      for (let row = 0; row < 3; row++) {
        this.battlementBlocks.push({ pos: new THREE.Vector3(-10.8 + column * 1.54, WALL_TOP + 0.24 + BH * (row + 0.5), 0.02), angle: 0, land: 13.8 + row * 0.4 + column / 15 * 0.35 });
      }
    }
    for (const segment of this.segments) {
      const columns = Math.ceil(segment.length / 2.2);
      for (let column = 0; column < columns; column++) {
        const horizontal = (column + 0.5) / columns * segment.length - segment.length / 2;
        for (let row = 0; row < 3; row++) {
          this.battlementBlocks.push({
            pos: new THREE.Vector3(segment.x + Math.cos(segment.angle) * horizontal + Math.sin(segment.angle) * segment.depth / 2, segment.height + BH * (row + 0.5), segment.z - Math.sin(segment.angle) * horizontal + Math.cos(segment.angle) * segment.depth / 2),
            angle: segment.angle, land: Math.min(15.2, segment.land + 0.45 + row * 0.16 + column / columns * 0.18),
          });
        }
      }
    }
    this.battlements = new THREE.InstancedMesh(new RoundedBoxGeometry(1.05, BH * 0.94, 0.55, 1, 0.025), stone, this.battlementBlocks.length);
    this.battlements.castShadow = true;
    this.battlements.frustumCulled = false;
    this.scene.add(this.battlements);

    const timber = new THREE.MeshStandardMaterial({ color: lin(PALETTE.red).multiplyScalar(0.38), roughness: 0.85 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: lin(PALETTE.ink).lerp(lin(PALETTE.wall), 0.32), roughness: 0.9, side: THREE.DoubleSide });
    const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.45, 4.4), timber);
    lowerBody.position.y = 0.96;
    const lowerRoof = new THREE.Mesh(roofGeometry(4.8, 3.0, 1.15), roofMaterial);
    lowerRoof.position.y = 1.68;
    const upperBody = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.0, 3.1), timber);
    upperBody.position.y = 2.78;
    const upperRoof = new THREE.Mesh(roofGeometry(3.8, 2.25, 1.35), roofMaterial);
    upperRoof.position.y = 3.25;
    this.gateTower.add(lowerBody, lowerRoof, upperBody, upperRoof);
    const columns = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 1.45, 0.22), stone, 12);
    for (let index = 0; index < 12; index++) {
      this.dummy.position.set(-3.35 + index % 6 * 1.34, 0.96, index < 6 ? 2.26 : -2.26);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(1);
      this.dummy.updateMatrix();
      columns.setMatrixAt(index, this.dummy.matrix);
    }
    this.gateTower.add(columns);
    // 2026-10-18 Claude（用户 00:10：城楼「扁扁的再慢慢升起来」跟城墙一块块掉下来的搭法不搭）：
    // 城楼拆成 5 件，像砖一样从上方加速落下、按拍逐件落位：柱 → 下层屋身 → 下檐 → 上层屋身 → 上檐。
    this.towerParts = [columns, lowerBody, lowerRoof, upperBody, upperRoof].map((mesh, index) => ({ mesh, baseY: mesh.position.y, land: 12.15 + index * 0.15 })); // 远景只到约 13 拍就推近，5 件在 12.15–12.75 拍内落完，落位卡十六分音符
    this.gateTower.position.set(0, WALL_TOP + 0.24, -DEPTH / 2);
    this.gateTower.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = true; });
    this.scene.add(this.gateTower);
  }

  private placeCityWall(b: number, glow: number) {
    this.wallClip.constant = masonryHeight(b);
    this.wallCore.visible = b > 1.6;
    this.platform.visible = b > 14.3;
    this.platform.scale.y = outCubic((b - 14.3) / 1);
    this.wings.visible = b > 1.5;
    this.segments.forEach((segment, index) => {
      const height = extensionHeight(b, segment.height, index);
      this.dummy.position.set(segment.x, height / 2, segment.z);
      this.dummy.rotation.set(0, segment.angle, 0);
      this.dummy.scale.set(segment.length, height, segment.depth);
      this.dummy.updateMatrix();
      this.wings.setMatrixAt(index, this.dummy.matrix);
      const offset = segment.depth / 2 + 0.015;
      this.dummy.position.set(segment.x + Math.sin(segment.angle) * offset, segment.height / 2, segment.z + Math.cos(segment.angle) * offset);
      this.dummy.scale.set(segment.length, segment.height, 1);
      this.dummy.updateMatrix();
      this.wingGlow.setMatrixAt(index, this.dummy.matrix);
    });
    this.wings.instanceMatrix.needsUpdate = true;
    this.wingGlow.instanceMatrix.needsUpdate = true;
    this.wingGlow.visible = b > 28;
    (this.wingGlow.material as THREE.ShaderMaterial).uniforms.uGlow!.value = glow;
    this.battlements.visible = b > 9;
    this.battlementBlocks.forEach((block, index) => {
      const extension = index >= 45;
      const land = extension ? Math.max(14.3, block.land) : block.land;
      const progress = clamp01((b - land + (extension ? 0 : 0.45)) / (extension ? 0.3 : 0.45));
      this.dummy.position.copy(block.pos);
      this.dummy.position.y += extension ? -(1 - progress) * BH / 2 : (1 - progress ** 3) * 1.6;
      this.dummy.rotation.set(0, block.angle, 0);
      if (progress > 0) this.dummy.scale.set(1, extension ? progress : 1, 1);
      else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      this.battlements.setMatrixAt(index, this.dummy.matrix);
    });
    this.battlements.instanceMatrix.needsUpdate = true;
    this.gateTower.visible = b > 11.7;
    for (const part of this.towerParts) {
      const p = (b - (part.land - 0.35)) / 0.35;
      part.mesh.visible = p > 0;
      part.mesh.position.y = part.baseY + (p < 1 ? (1 - easeIn(clamp01(p))) * 3 : 0);
    }
  }

  /** 第 b 拍时某块砖的位置：落位前从上方加速落下；最后 4 拍开始松动。 */
  private place(br: Brick, b: number, out: THREE.Object3D) {
    const arch = br.seed >= 80000 && br.seed < 90000;
    const tunnelSide = br.seed >= 50000 && br.seed < 80000;
    const extension = br.seed >= 120000;
    const fall = arch ? 0.35 : tunnelSide ? 0.45 : 0.5;
    const p = (b - (br.land - fall)) / fall;
    const height = extension ? extensionHeight(b, WALL_TOP, Math.floor((br.seed - 120000) / 2000)) : 0;
    const reveal = extension ? clamp01((height - br.pos.y + BH / 2) / BH) : 1;
    const nearby = Math.abs(br.pos.x - this.cam.position.x) < 8 && Math.abs(br.pos.z - this.cam.position.z) < 14;
    if (extension ? reveal <= 0 : p <= 0 || p < 1 && br.seed < 50000 && !nearby) {
      out.scale.setScalar(0);
      out.position.copy(br.pos);
      return;
    }
    out.scale.setScalar(1);
    const drop = !extension && p < 1 ? (1 - easeIn(p)) * (arch ? 0.65 : tunnelSide ? 1.1 : 2) : 0;
    // 落地瞬间的轻微压扁回弹
    const squash = extension ? reveal : p >= 1 && p < 1.5 ? 1 - 0.12 * Math.sin((p - 1) * 2 * Math.PI) * (1.5 - p) * 2 : 1;
    // 最后 4 拍：按砖的种子错开松动
    const loose = clamp01((b - 28) / 4);
    const j = loose * loose * 0.35;
    out.position.set(
      br.pos.x + j * (hash(br.seed + 1) - 0.5),
      br.pos.y + drop - (extension ? (1 - reveal) * BH / 2 : 0) + j * (hash(br.seed + 2) - 0.5),
      br.pos.z + j * 1.6 * hash(br.seed + 3),
    );
    out.rotation.set(j * (hash(br.seed + 4) - 0.5), br.rotY + j * (hash(br.seed + 5) - 0.5), br.rotZ);
    const archWidth = Math.PI * (GATE_HALF + BH / 2) / 24 * 1.035 / (BW * 0.96);
    out.scale.set(arch ? archWidth : 1, squash, arch ? 1.05 : 1);
  }

  /** 二维背景板按同一镜头投影（地面、墙后城市、山脊跟着镜头一起动）。 */
  recapSpace() {
    return { camera: this.cam, occluders: [...this.meshes, this.keystone, this.wallCore, this.wings, this.battlements, this.gateTower, this.platform] };
  }

  backgroundCamera(f: Frame) {
    this.setCamera(f.lt / BEAT);
    return this.cam.clone();
  }

  anchors(f: Frame) {
    const b = f.lt / BEAT;
    this.setCamera(b);
    const proj = (p: THREE.Vector3): [number, number] | null => {
      const v = p.clone().project(this.cam);
      if (v.z > 1 || v.z < -1) return null;
      return [(v.x * 0.5 + 0.5) * W, (0.5 - v.y * 0.5) * H];
    };
    return {
      gateCenter: proj(new THREE.Vector3(0, GATE_SPRING * 0.8, 0)),
      firstBrick: proj(KEYSTONE),
    };
  }

  private setCamera(b: number) {
    const c = camera(b);
    this.cam.position.copy(c.pos);
    this.cam.lookAt(c.look);
    this.cam.fov = c.fov;
    if (b < 2) {
      const progress = clamp01(b / 2);
      const travel = progress * progress * (3 - 2 * progress);
      this.cam.quaternion.slerpQuaternions(new THREE.Quaternion(), this.cam.quaternion.clone(), travel);
      this.cam.fov = 30 + (c.fov - 30) * travel;
    }
    // 画面中心移到 Codex 背景板主体区域的中心（左侧留给竖排大字）
    const [rx, ry, rw, rh] = getDrop1Layout(b).subjectRegion;
    const cx = rx + rw / 2, cy = ry + rh / 2;
    this.cam.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
  }

  /** 第 0 拍的红砖在屏幕上的出发点（锁定段红块的位置），反投影到世界坐标。 */
  private entryWorld(depthTo: THREE.Vector3): THREE.Vector3 {
    this.setCamera(0);
    const [ex, ey] = getDrop1Layout(0).entryBrickCenter;
    const ndc = new THREE.Vector3((ex / W) * 2 - 1, 1 - (ey / H) * 2, 0.5).unproject(this.cam);
    const dir = ndc.sub(this.cam.position).normalize();
    const dist = depthTo.clone().sub(this.cam.position).length() * 0.55;
    return this.cam.position.clone().add(dir.multiplyScalar(dist));
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget, _ctx?: Layer3DContext): PostParams {
    const b = f.lt / BEAT;
    this.setCamera(b);

    this.byKind.forEach((list, k) => {
      const m = this.meshes[k]!;
      list.forEach((bi, j) => {
        this.place(this.bricks[bi]!, b, this.dummy);
        this.dummy.updateMatrix();
        m.setMatrixAt(j, this.dummy.matrix);
      });
      m.instanceMatrix.needsUpdate = true;
    });

    // 拱心红砖：第 0 拍从锁定段红块的屏幕位置出发，2 拍内飞到拱顶；底鼓时轻微脉动
    const fly = outCubic(b / 2);
    const exit = lockBrickExit();
    const start = this.entry ??= new THREE.Vector3(-6, 2.3, 9.5).addScaledVector(exit.position, 0.45);
    this.setCamera(b);
    const pulse = 1 + 0.06 * f.env.kick;
    if (_ctx?.camera) this.cam.copy(_ctx.camera);
    this.keystone.position.lerpVectors(start, KEYSTONE, fly);
    this.keystone.rotation.set(exit.rotation.x * (1 - fly), exit.rotation.y * (1 - fly), exit.rotation.z * (1 - fly));
    this.keystone.scale.copy(exit.scale).multiplyScalar(0.45).lerp(new THREE.Vector3(BW * 0.96, BH * 0.92 / 0.5, BD / 0.5), fly).multiplyScalar(1 + (pulse - 1) * fly);
    this.portal.visible = b >= 30 && Boolean(_ctx?.portal) && this.cam.position.z > PORTAL_SWAP_Z;
    this.portal.material.uniforms.tPortal!.value = _ctx?.portal ?? null;

    // 最后 4 拍：砖缝透出红光，跟着底鼓闪
    const crack = clamp01((b - 28) / 4);
    const glow = crack * (1.2 + 2.5 * f.env.kick); // 高于泛光门槛：砖缝里的光会发出光晕
    this.glowPlate.material.color.copy(lin(PALETTE.red)).multiplyScalar(glow);
    this.glowPlate.visible = crack > 0;
    this.placeCityWall(b, glow);

    // 太阳光的阴影范围跟着镜头走
    this.sun.target.position.set(this.cam.position.x * 0.5, 0, Math.min(0, this.cam.position.z * 0.3));
    this.sun.target.updateMatrixWorld();

    // ── 墨底白描：1) 法线 + 深度（逐个换成保留裁切面的法线材质） 2) 颜色 3) 合成 ──
    const fog = this.scene.fog;
    const background = this.scene.background;
    const groundVisible = this.ground.visible;
    const glowVisible = this.glowPlate.visible;
    const wingGlowVisible = this.wingGlow.visible;
    this.scene.fog = null;
    this.ground.visible = false; // 地面交给二维背景板（砖缝网格），三维只留墙
    this.scene.background = null;
    this.glowPlate.visible = false;
    this.wingGlow.visible = false;
    const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      swapped.push([o, o.material]);
      const normalFor = (material: THREE.Material) => {
        let normal = this.normalMats.get(material);
        if (!normal) {
          normal = new THREE.MeshNormalMaterial({ side: material.side });
          normal.clippingPlanes = material.clippingPlanes;
          normal.clipIntersection = material.clipIntersection;
          normal.clipShadows = material.clipShadows;
          if (o === this.portal) normal.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace(/\n}\s*$/, '\n gl_FragColor.a = 0.15;\n}'); };
          if (o === this.wallCore || o === this.wings || o === this.platform) {
            normal.userData.masonryJoints = true;
            normal.onBeforeCompile = shader => {
              shader.uniforms.uMasonryStrength = this.masonryStyle.strength;
              shader.uniforms.uMasonryTopSize = this.masonryStyle.topSize;
              shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vMasonryPosition;
varying vec3 vMasonryAxis;`)
                .replace('#include <begin_vertex>', `#include <begin_vertex>
mat4 masonryTransform = modelMatrix;
#ifdef USE_INSTANCING
  masonryTransform *= instanceMatrix;
#endif
vec3 masonryWorld = (masonryTransform * vec4(transformed, 1.0)).xyz;
vMasonryPosition = vec3(dot(masonryWorld, normalize(masonryTransform[0].xyz)), masonryWorld.y, dot(masonryWorld, normalize(masonryTransform[2].xyz)));
vMasonryAxis = abs(normal);`);
              shader.fragmentShader = shader.fragmentShader.replace('#include <packing>', `#include <packing>
uniform float uMasonryStrength;
uniform vec2 uMasonryTopSize;
varying vec3 vMasonryPosition;
varying vec3 vMasonryAxis;`)
                .replace(/\n}\s*$/, `
  bool masonryTop = vMasonryAxis.y > 0.5;
  vec2 masonryUv = masonryTop ? vMasonryPosition.xz : vMasonryAxis.x > 0.5 ? vMasonryPosition.zy : vMasonryPosition.xy;
  vec2 masonrySize = masonryTop ? uMasonryTopSize : vec2(0.6, 0.32);
  float masonryRow = floor(masonryUv.y / masonrySize.y);
  masonryUv.x += mod(masonryRow, 2.0) * masonrySize.x * 0.5;
  vec2 masonryCell = mod(masonryUv, masonrySize);
  vec2 masonryDistance = min(masonryCell, masonrySize - masonryCell);
  vec2 masonryAa = max(fwidth(masonryUv), vec2(0.001));
  vec2 masonryLines = 1.0 - smoothstep(vec2(0.004), vec2(0.004) + masonryAa, masonryDistance);
  gl_FragColor.a = 1.0 - max(masonryLines.x, masonryLines.y) * uMasonryStrength;
}`);
            };
            normal.customProgramCacheKey = () => 'drop1-masonry-joints-1';
          }
          this.normalMats.set(material, normal);
        }
        return normal;
      };
      o.material = Array.isArray(o.material) ? o.material.map(normalFor) : normalFor(o.material);
    });
    const previousClipping = r.localClippingEnabled;
    try {
      r.localClippingEnabled = true;
      r.setRenderTarget(this.rtN);
      r.setClearColor(0x8080ff, 1);
      r.clear();
      r.render(this.scene, this.cam);
      for (const [o, m] of swapped) o.material = m;
      this.glowPlate.visible = glowVisible;
      this.wingGlow.visible = wingGlowVisible;
      this.scene.background = this.inkBg;
      r.setRenderTarget(this.rt);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.scene, this.cam);
    } finally {
      for (const [o, m] of swapped) o.material = m;
      r.localClippingEnabled = previousClipping;
      this.scene.fog = fog;
      this.ground.visible = groundVisible;
      this.glowPlate.visible = glowVisible;
      this.wingGlow.visible = wingGlowVisible;
      this.scene.background = background;
    }
    const iu = this.inkPass.u;
    iu.tN!.value = this.rtN.texture;
    iu.tD!.value = this.rtN.depthTexture;
    iu.tC!.value = this.rt.texture;
    const poster = b >= 30 && this.cam.position.z <= PORTAL_SWAP_Z ? _ctx?.portal ?? _ctx?.poster : _ctx?.poster;
    iu.tPoster!.value = poster ?? null;
    iu.uHasPoster!.value = poster ? 1 : 0;
    iu.uEntry!.value = 1 - outCubic(b / 0.5);
    iu.uNear!.value = this.cam.near;
    iu.uFar!.value = this.cam.far;
    iu.uCrack!.value = crack;
    this.inkPass.render(r, out);

    const imp = f.env.impact;
    const k = imp * 9 + f.env.kick * 1.5;
    const jx = Math.sin(f.frame * 12.9898) * 43758.5453 % 1;
    const jy = Math.sin(f.frame * 78.233) * 12345.678 % 1;
    const seam = clamp01((b - 30.5) / 1);
    return {
      bloom: (0.18 + 0.65 * crack) * (1 - seam) + 0.15 * seam,
      bloomThreshold: 1.6, // 釉面高光偶尔很亮，门槛高一些避免爆白
      halation: 0.04 * (1 - seam),
      ca: (0.08 + 0.25 * imp + 0.5 * crack * f.env.kick) * (1 - seam) + 0.05 * seam,
      zoom: 1 + 0.015 * f.env.kick * (1 - seam),
      shake: [jx * k * clamp01(b / 0.5) * (1 - clamp01((b - 30) / 0.5)), jy * k * clamp01(b / 0.5) * (1 - clamp01((b - 30) / 0.5))],
      grain: 0.045 * (1 - seam) + 0.03 * seam,
      vignette: 0.16 * (1 - seam),
      fade: f.env.gap,
    };
  }
}

