// 段落 5「青年」三维层（40 拍，墨黑底）。负责人：Claude。分工见 VISUAL_TASKS.md「5. 青年」。
//
// 主体：玻璃球沿梧桐大道滚动 → 南京长江大桥上持续滚动 → 航拍全桥
//       → 梧桐叶排成横向曲线，交给地形段变成等高线。全部由段内拍 b 决定，可乱序取帧。
// 南京长江大桥按真实结构简化（查证：正桥为钢桁梁，平行弦菱形桁架；上层公路、下层双线铁路；
//       南北两岸各有大小桥头堡，大堡顶端为“三面红旗”；公路桥两侧为白玉兰花灯，约每 40 米一对）。不画成斜拉桥。
// 构图切换表见 YOUTH_SHOTS；重拍：0（人物显形）、16（切到大桥）、32（航拍全桥）；36–40 拍上升音时叶片排成曲线。
// 提供给 Codex：anchors() → figureHead / figureFeet / rider / towerTop；youthCurve()（末帧曲线，地形段接续用）。
//
// 2026-10-13 用户反馈“模型太塑料、像五毛特效”，选定“纸上白描”：米白纸底，所有物体由法线 / 深度描出一根粗细均匀的墨线（用户 00:16 要求不要干笔“蹭”的笔触），
// 环境保留淡彩白描；主角球单独使用物理玻璃渲染，不被白描合成抹掉折射。
import * as THREE from 'three';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { BEAT, eventsIn, sectionRange, type Frame } from '../engine/beat';
import { PALETTE } from '../engine/palette.glsl';
import type { PostParams } from '../engine/post';
import type { Layer3D, Layer3DContext } from './index';
import { BALL_ENTRY, BALL_RADIUS, createRollingBall, createBallShadow, rollingBallPose, rollingRoadFloor, YOUTH_PORTAL_X, YOUTH_PORTAL_BEAT } from './rollingBall';
import { buildWutong } from './glitchModels';
import { youthMotionCamera, YOUTH_INSERTS } from './youthMotion';
import { lin, softStudioEnv } from './env';
import { createYouthGenLines, youthGenLine, youthGenNight, youthGenSmooth } from './youthGenTransition';
import { createPosterTypography, placeUprightPoster } from './posterTypography';
import { createDryBrushTexture } from './dryBrush';
import { createWutongPoster } from './wutongPoster';

type V3 = THREE.Vector3;
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const outCubic = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
const wrap = (x: number, a: number, b: number) => a + ((((x - a) % (b - a)) + (b - a)) % (b - a));

// ───────── 构图切换表（段内拍）─────────
export type YouthShot = 'track' | 'aerial' | (typeof YOUTH_INSERTS)[number]['shot']; // 2026-10-15 Claude：大桥段剪辑表见 youthMotion.ts
export const YOUTH_SHOTS: { beat: number; shot: YouthShot }[] = [
  { beat: 0, shot: 'track' },
  ...YOUTH_INSERTS.flatMap(shot => [{ beat: shot.beat, shot: shot.shot }, { beat: shot.beat + shot.duration, shot: 'track' as YouthShot }]),
  { beat: 32, shot: 'aerial' },
];

// ───────── 南京长江大桥（单位：米；江面 y = 0）─────────
const RAIL_Y = 24, TOP_Y = 40, DECK_Y = 41.2; // 下层铁路面、主桁上弦、上层公路桥面
const TRUSS_Z = 7, PANEL = 8;
const X0 = -480, X1 = 320; // 正桥钢桁梁范围（简化为 5 孔 160 米）
const APPROACH = 700; // 两侧引桥长度
const TOWER_X = [X1 + 64, X0 - 64]; // 大桥头堡（一对，分立公路两侧）
const DECK_HALF = 9.75; // 公路桥面半宽（车行道 15 米 + 两侧人行道）
const RIDER_Z = 3;
const riderX = (beat: number) => rollingBallPose(beat).x;

// ───────── 梧桐叶（挂在镜头上：位置以镜头为参照，所有镜头通用）─────────
const LEAVES = 640;
const CURVES = 9;

/** 末段叶片排成的第 k 条曲线（归一化屏幕坐标，x、y ∈ [-1, 1]，y 向上）；地形段接续用同一函数。 */
export function youthCurve(k: number, s: number, tau: number): [number, number] {
  const y = ((k - (CURVES - 1) / 2) / ((CURVES - 1) / 2)) * 0.78 + 0.13 * Math.sin(s * 3.1 + k * 0.9 + tau * 0.6) + 0.05 * Math.sin(s * 7.3 - k * 1.7);
  return [s, y];
}

export function youthInkDepth(depth: number) {
  return 1 - 0.4 * inOut((depth - 450) / 1800);
}

function leafShape(): THREE.ShapeGeometry {
  // 悬铃木（南京人说的“梧桐”）叶：掌状五裂，叶柄朝下
  const pts: THREE.Vector2[] = [];
  const lobes = [
    { a: Math.PI / 2, r: 1.0 },
    { a: Math.PI / 2 + 0.85, r: 0.86 },
    { a: Math.PI / 2 - 0.85, r: 0.86 },
    { a: Math.PI / 2 + 1.75, r: 0.5 },
    { a: Math.PI / 2 - 1.75, r: 0.5 },
  ];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI / 2 + 0.22 + (i / N) * (2 * Math.PI - 0.44);
    let r = 0.32;
    for (const l of lobes) {
      let d = Math.abs(a - l.a);
      d = Math.min(d, 2 * Math.PI - d);
      r = Math.max(r, l.r * Math.pow(Math.max(0, 1 - d / 0.62), 1.6) + 0.3 * (1 - d / 3));
    }
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r + 0.25));
  }
  const sh = new THREE.Shape(pts);
  const geo = new THREE.ShapeGeometry(sh, 2);
  // 沿主脉轻微对折，转动时有体积
  const p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.abs(p.getX(i)) * 0.28);
  geo.computeVertexNormals();
  geo.translate(0, -0.25, 0);
  return geo;
}

/** 白描合成：法线 / 深度不连续处描墨线（线宽、干笔随屏幕位置变化，远处变淡）；面上按颜色上一层淡彩；朱砂红单独提出；人物实心墨线。 */
const INK_FRAG = /* glsl */ `
uniform sampler2D tN, tD, tC, tPoster;
uniform float uHasPoster, uNear, uFar, uSink, uNight;
uniform vec2 uTexel;
float bmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bmNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bmHash(i), bmHash(i + vec2(1.0, 0.0)), f.x), mix(bmHash(i + vec2(0.0, 1.0)), bmHash(i + 1.0), f.x), f.y);
}
float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  vec3 paper = uHasPoster > 0.5 ? texture2D(tPoster, vUv).rgb : mix(C_PAPER, C_INK, uNight);
  float d0 = texture2D(tD, vUv).r;
  bool obj = d0 < 0.99999;
  // 线条：一根干净、粗细均匀的线（用户 00:16：不要“蹭上去”的笔触）
  float w = 1.0;
  vec2 ox = vec2(uTexel.x * w, 0.0), oy = vec2(0.0, uTexel.y * w);
  vec3 nL = texture2D(tN, vUv - ox).xyz, nR = texture2D(tN, vUv + ox).xyz;
  vec3 nU = texture2D(tN, vUv + oy).xyz, nD = texture2D(tN, vUv - oy).xyz;
  float dL = linZ(texture2D(tD, vUv - ox).r), dR = linZ(texture2D(tD, vUv + ox).r);
  float dU = linZ(texture2D(tD, vUv + oy).r), dD = linZ(texture2D(tD, vUv - oy).r);
  float z0 = linZ(d0);
  float zMin = min(z0, min(min(dL, dR), min(dU, dD)));
  float zMax = max(z0, max(max(dL, dR), max(dU, dD)));
  float en = length(nL - nR) + length(nU - nD);
  float ed = (zMax - zMin) / max(zMin, 1e-3);
  // 2026-10-18 Claude（用户 00:44 / 00:52：远处黑成一坨；「越远的地方只剩一个外轮廓」）：
  // 线分两种——外轮廓（物体对天空 / 远背景的大深度跳变）和内部线（法线转折、小深度差）。
  // 越远，内部线越淡，到远处只剩外轮廓；近处两种都保留，和原来一样。
  float rawL = texture2D(tD, vUv - ox).r, rawR = texture2D(tD, vUv + ox).r, rawU = texture2D(tD, vUv + oy).r, rawD = texture2D(tD, vUv - oy).r;
  float sky = obj && (rawL >= 0.99999 || rawR >= 0.99999 || rawU >= 0.99999 || rawD >= 0.99999) ? 1.0 : 0.0;
  float silhouette = max(sky, smoothstep(0.35, 0.6, ed));
  float interior = max(smoothstep(0.4, 0.7, en), smoothstep(0.045, 0.08, ed));
  float distant = smoothstep(35.0, 140.0, zMin);
  float edge = max(silhouette, interior * (1.0 - distant));
  // 远淡、末段整体淡出（只作用于远处的大桥）；不再做干笔飞白
  float dry = 1.0;
  float far = mix(1.0, 0.6, smoothstep(450.0, 2250.0, zMin));
  // 远处挤在一起的外轮廓（栏杆、灯柱贴着天空排成一排）也会叠成黑块：周围 ±3 像素大多在变时再淡掉，远处只剩一条浅轮廓
  vec3 n0 = texture2D(tN, vUv).xyz;
  float busy = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(k < 2 ? -3.0 : 3.0, mod(float(k), 2.0) < 0.5 ? -3.0 : 3.0) * uTexel;
    float zk = linZ(texture2D(tD, vUv + o).r);
    busy += max(step(0.3, length(texture2D(tN, vUv + o).xyz - n0)), step(0.06, abs(zk - linZ(d0)) / max(linZ(d0), 1e-3)));
  }
  far *= 1.0 - 0.75 * smoothstep(1.5, 3.5, busy) * smoothstep(25.0, 90.0, zMin);
  float sink = 1.0 - uSink * smoothstep(30.0, 60.0, zMin);
  float ink = edge * far * sink;
  vec3 col = paper;
  if (obj) {
    vec3 c = texture2D(tC, vUv).rgb;
    float mx = max(c.r, max(c.g, c.b));
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 tint = clamp(c / max(mx, 0.3), 0.0, 1.0);
    float wash = (0.16 + 0.3 * (1.0 - clamp(lum * 1.4, 0.0, 1.0))) * far * sink;
    col = paper * mix(vec3(1.0), tint * 0.85 + 0.15, wash);
    float redness = (c.r - max(c.g, c.b)) / max(c.r, 1e-3);
    col = mix(col, C_RED * 0.95, smoothstep(0.6, 0.8, redness) * step(0.04, c.r) * 0.92 * sink);
    float solid = 1.0 - smoothstep(0.004, 0.02, mx);
    col = mix(col, C_INK * 1.3, solid * sink);
  }
  col = mix(col, C_INK * 1.5, clamp(ink, 0.0, 1.0) * 0.92);
  gl_FragColor = vec4(col, 1.0);
}
`;

export default class Youth implements Layer3D {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(35, W / H, 0.1, 6000);
  private rt = makeRT(W, H, { depth: true });
  private copy = new FSPass(`uniform sampler2D tIn; void main(){ gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }`, { tIn: { value: null } });
  private ink = lin(PALETTE.ink);
  private fog = new THREE.FogExp2(0x000000, 0.001);

  private ball = createRollingBall();
  private roadTypography = new THREE.Group();
  private portalTypography = new THREE.Group();
  // 2026-10-18 Claude（用户 00:35：球滚向的终点太空，做一些文字排版）：隧道尽头亮口里立一块「下一站」字板，预告下一拍切进的大桥
  private exitTypography = createPosterTypography('YANGTZE RIVER BRIDGE', '下一站 · 南京长江大桥 1968', 4.6, 1.15, lin(PALETTE.ink), 0.62);
  private bridgeTypography = new THREE.Group();
  private ballShadow = createBallShadow();
  private actorScene = new THREE.Scene();
  private rtPaper = makeRT(W, H);
  private actorDepth = new THREE.MeshBasicMaterial({ colorWrite: false });

  private bridge = new THREE.Group();
  private tunnel = buildWutong(0);
  private portal = new THREE.Mesh(new THREE.PlaneGeometry(2, 60), new THREE.MeshBasicMaterial({ color: lin(PALETTE.paper), side: THREE.DoubleSide }));
  private trail = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
    uniforms: { uRed: { value: lin(PALETTE.red) }, uFade: { value: 1 }, tBrush: { value: createDryBrushTexture() } },
    vertexShader: `varying vec2 vBrush; void main(){ vBrush = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uRed; uniform float uFade; uniform sampler2D tBrush; varying vec2 vBrush; void main(){ float alpha = smoothstep(0.0, 0.04, vBrush.x) * uFade; /* 2026-10-17 Claude（用户 22:44：「轨迹用很实的红色，不用拖过的痕迹」）：去掉干笔纹理，实色红；tBrush 保留未用 */ gl_FragColor = vec4(uRed, alpha); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    // 2026-10-15 Claude：远处桥面深度精度不够，尾迹会和桥面打架时有时无；往镜头方向偏一点
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
  }));
  private flags: THREE.Mesh[] = [];
  private leaves!: THREE.InstancedMesh;
  private leafGroup = new THREE.Group();
  private dummy = new THREE.Object3D();
  private transitionLines!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private kicks: number[] = [];
  // ── 白描渲染：法线 / 深度一遍（描墨线）+ 颜色一遍（淡彩）+ 合成 ──
  private rtN!: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private paper = lin(PALETTE.paper);
  private inkPass = new FSPass(INK_FRAG, {
    tN: { value: null }, tD: { value: null }, tC: { value: null }, tPoster: { value: null }, uHasPoster: { value: 0 },
    uNear: { value: 0.1 }, uFar: { value: 300 }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) }, uSink: { value: 0 }, uNight: { value: 0 },
  });
  private t0 = 0;

  async init(r: THREE.WebGLRenderer) {
    this.rt.samples = 4;
    this.rtN = new THREE.WebGLRenderTarget(this.rt.width, this.rt.height, { depthBuffer: true });
    this.rtN.depthTexture = new THREE.DepthTexture(this.rt.width, this.rt.height, THREE.UnsignedIntType);
    // 线宽按成片尺寸（1920×1080 的逻辑像素）计算，不随预览分辨率变粗（用户 00:22：要高清细线）
    this.inkPass.u.uTexel!.value.set(1 / W, 1 / H);
    const range = sectionRange('youth');
    this.t0 = range.start;
    this.kicks = eventsIn('kick', range.start - 2, range.end);

    this.scene.environment = softStudioEnv(r, { key: 2.4, rim: 2.0 });
    this.scene.environmentIntensity = 0.55;
    this.fog.color.copy(lin(PALETTE.paper)); // 白描：远处淡入纸色
    const hemi = new THREE.HemisphereLight(lin(PALETTE.paper), lin(PALETTE.wall), 1.1); // 白描：中性柔光，只用来给淡彩分出明暗
    const key = new THREE.DirectionalLight(lin(PALETTE.paper), 1.3);
    key.position.set(-300, 400, 500);
    const rim = new THREE.DirectionalLight(lin(PALETTE.gold), 1.0);
    rim.position.set(600, 120, -400);
    this.scene.add(hemi, key, rim);

    this.actorScene.environment = softStudioEnv(r);
    this.actorScene.environmentIntensity = 0.9;
    const glass = (this.ball.children[0] as THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>).material;
    glass.metalness = 0;
    glass.transmission = 1;
    // 2026-10-17 Claude（用户 23:58：原来的玻璃球里透过的背景会形变、模糊）：恢复原版厚玻璃折射，ior 1.12/厚 0.45 → 1.62/2.2，粗糙 0.07 → 0.2
    glass.ior = 1.45;
    glass.thickness = 1.4;
    glass.envMapIntensity = 0.35; // 2026-10-17 Claude：0.12 → 0.35，让薄膜虹彩在转动时有光可反（用户 23:55）
    glass.roughness = 0.12;
    this.actorScene.add(this.ball, this.ballShadow);
    this.roadTypography.add(createWutongPoster('youth', lin(PALETTE.ink)));
    const portalLettering = createPosterTypography('PLANE TREES', '1928 · 梧桐', 14, 7, lin(PALETTE.ink), 0.5);
    portalLettering.rotation.y = -Math.PI / 2;
    portalLettering.position.set(YOUTH_PORTAL_X - 0.8, BALL_ENTRY.floor + 2.8, 0);
    portalLettering.scale.y = 0.52;
    this.portalTypography.add(portalLettering);
    this.exitTypography.rotation.y = -Math.PI / 2;
    this.exitTypography.position.set(YOUTH_PORTAL_X - 0.6, BALL_ENTRY.floor + 3.5, 0); // 抬到球上方的亮口留白，不被球挡
    this.actorScene.add(this.roadTypography, this.portalTypography, this.exitTypography);
    for (const shot of YOUTH_INSERTS) {
      if (shot.shot === 'dollyHigh' || shot.shot === 'top') continue;
      const reference = youthMotionCamera(shot.beat + Math.min(shot.duration / 2, 0.7));
      const camera = new THREE.PerspectiveCamera(reference.fov, W / H, 0.1, 6000);
      camera.position.copy(reference.position); camera.lookAt(reference.target); camera.updateMatrixWorld(true);
      const lettering = createPosterTypography('YANGTZE RIVER BRIDGE', '1968 · 南京长江大桥', 4, 1, lin(PALETTE.ink), 0.4);
      placeUprightPoster(lettering, camera, 0, 0.63, camera.position.distanceTo(reference.target) * 2.4, 0.72);
      lettering.userData.shot = shot.shot;
      this.bridgeTypography.add(lettering);
    }
    this.actorScene.add(this.bridgeTypography);
    this.transitionLines = createYouthGenLines(this.rt.width, this.rt.height);
    this.actorScene.add(this.transitionLines);

    this.buildBridge();
    const seamCount = Math.floor((X1 - X0) / 8) + 1;
    const seams = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.02, DECK_HALF * 2 - 1), new THREE.MeshBasicMaterial({ color: lin(PALETTE.wall) }), seamCount);
    seams.userData.expansionSeams = true;
    for (let index = 0; index < seamCount; index++) seams.setMatrixAt(index, new THREE.Matrix4().makeTranslation(X0 + index * 8, DECK_Y + 0.012, 0));
    this.bridge.add(seams);
    this.bridge.position.x = YOUTH_PORTAL_X - X0;
    this.bridge.position.y = BALL_ENTRY.floor - DECK_Y;
    this.scene.add(this.bridge);
    this.buildTunnel();
    this.scene.add(this.tunnel);
    this.actorScene.add(this.portal);
    this.portal.rotation.y = Math.PI / 2;
    this.portal.position.set(YOUTH_PORTAL_X, BALL_ENTRY.floor + 30, 0);
    const positions = new Float32Array(130 * 3);
    const uvs = new Float32Array(130 * 2);
    const indices: number[] = [];
    for (let sample = 0; sample <= 64; sample++) {
      for (let side = 0; side < 2; side++) uvs.set([sample / 64, side], (sample * 2 + side) * 2);
      if (sample < 64) {
        const first = sample * 2;
        indices.push(first, first + 1, first + 2, first + 1, first + 3, first + 2);
      }
    }
    this.trail.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.trail.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.trail.geometry.setIndex(indices);
    this.trail.frustumCulled = false;
    this.actorScene.add(this.trail);

    // 梧桐叶
    const leafGeo = leafShape();
    this.leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }), LEAVES);
    const leafInk = lin(PALETTE.plane);
    for (let i = 0; i < LEAVES; i++) {
      const h = hash(i * 3.7 + 1);
      this.leaves.setColorAt(i, leafInk.clone().multiplyScalar([0.45, 0.85, 1.3][Math.min(2, Math.floor(h * 3))]! * (0.9 + 0.2 * hash(i + 2))));
    }
    this.leaves.frustumCulled = false;
    this.leafGroup.add(this.leaves);
    this.cam.add(this.leafGroup);
    this.scene.add(this.cam);
  }

  private buildTunnel() {
    const lengthScale = 1;
    this.tunnel.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.geometry instanceof THREE.PlaneGeometry) {
        object.geometry.dispose();
        const roadLength = YOUTH_PORTAL_X - BALL_ENTRY.x + 0.5 + 6; // 2026-10-15 Claude：路面止于亮口；2026-10-18 用户 03:42「路跟石台没对齐」——路面从模型 z=6 起铺，原长度少算了这 6，路比石台早 6 米断掉
        object.geometry = new THREE.PlaneGeometry(4.8, roadLength, 1, 160).rotateX(-Math.PI / 2).translate(0, 0.008, 6 - roadLength / 2);
      }
      const positions = object.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index++) {
        const horizontal = BALL_ENTRY.x - positions.getZ(index) * lengthScale;
        positions.setXYZ(index, horizontal, BALL_ENTRY.floor + positions.getY(index), positions.getX(index));
      }
      object.geometry.computeVertexNormals();
      object.geometry.computeBoundingSphere();
    });
    // 2026-10-15 Claude：隧道在亮口处截断。亮口以外的树干 / 树冠三角形直接删掉，
    // 这样穿出亮口后桥面上不会再叠着隧道里的树，也不再需要那块白色挡板。
    const limit = YOUTH_PORTAL_X + 0.5;
    this.tunnel.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.geometry instanceof THREE.PlaneGeometry) return;
      let geometry = object.geometry as THREE.BufferGeometry;
      if (geometry.index) geometry = geometry.toNonIndexed();
      const position = geometry.getAttribute('position');
      const keep: number[] = [];
      for (let vertex = 0; vertex + 2 < position.count; vertex += 3) {
        const xs = [position.getX(vertex), position.getX(vertex + 1), position.getX(vertex + 2)];
        if (Math.max(...xs) <= limit) keep.push(vertex, vertex + 1, vertex + 2);
        // 2026-10-18 Claude（用户 03:37：数据故障段的梧桐大道两边有石台，青年段没有）：路两侧的长条石台是一整块长面，
        // 原来跨过亮口就整块删掉了；长条面（跨度 > 5）改为把超出亮口的顶点收到亮口处，石台保留到亮口为止。
        else if (Math.min(...xs) <= limit && Math.max(...xs) - Math.min(...xs) > 5) {
          for (let corner = 0; corner < 3; corner++) if (xs[corner]! > limit) position.setX(vertex + corner, limit);
          keep.push(vertex, vertex + 1, vertex + 2);
        }
      }
      if (keep.length === position.count) return;
      const trimmed = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const source = attribute as THREE.BufferAttribute;
        const array = new Float32Array(keep.length * source.itemSize);
        keep.forEach((vertex, index) => { for (let c = 0; c < source.itemSize; c++) array[index * source.itemSize + c] = source.array[vertex * source.itemSize + c]!; });
        trimmed.setAttribute(name, new THREE.BufferAttribute(array, source.itemSize));
      }
      trimmed.computeBoundingSphere();
      object.geometry = trimmed;
    });
  }

  private updateTrail(beat: number) {
    this.trail.visible = beat >= YOUTH_PORTAL_BEAT + 1 && rollingBallPose(beat).speed > 22 && beat < 38;
    this.trail.material.uniforms.uFade!.value = 1 - inOut((beat - 35) / 3);
    const positions = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let sample = 0; sample <= 64; sample++) {
      const age = 1.8 * (1 - sample / 64);
      const previousBeat = Math.max(YOUTH_PORTAL_BEAT + 1, beat - age / BEAT);
      const pose = rollingBallPose(previousBeat);
      const width = 0.58 * Math.sqrt(sample / 64) * inOut((pose.speed - 22) / 30);
      positions.setXYZ(sample * 2, pose.x, pose.ground + 0.06, pose.z - width);
      positions.setXYZ(sample * 2 + 1, pose.x, pose.ground + 0.06, pose.z + width);
    }
    positions.needsUpdate = true;
  }

  private buildBridge() {
    const g = this.bridge;
    const steel = new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.wall).multiplyScalar(0.85), metalness: 0.5, roughness: 0.48 });
    const concrete = new THREE.MeshStandardMaterial({ color: lin(PALETTE.wall).multiplyScalar(0.55), roughness: 0.85 });
    const deckMat = new THREE.MeshStandardMaterial({ color: lin(PALETTE.paper).multiplyScalar(0.8), roughness: 0.8 });
    const towerMat = new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.paper).multiplyScalar(0.62), roughness: 0.6, clearcoat: 0.2 });
    const red = new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.red), emissive: lin(PALETTE.red), emissiveIntensity: 0.35, roughness: 0.35, clearcoat: 1, side: THREE.DoubleSide });
    const lampMat = new THREE.MeshBasicMaterial({ color: lin(PALETTE.paper).lerp(lin(PALETTE.gold), 0.2) });

    // 主桁：平行弦菱形桁架（每节间交叉斜杆 + 竖杆），两片主桁 + 上下横梁
    const members: [V3, V3, number, number][] = []; // a, b, 截面宽, 截面高
    const nPanels = Math.round((X1 - X0) / PANEL);
    for (let i = 0; i <= nPanels; i++) {
      const x = X0 + i * PANEL;
      for (const z of [-TRUSS_Z, TRUSS_Z]) {
        members.push([v(x, RAIL_Y, z), v(x, TOP_Y, z), 0.7, 0.7]); // 竖杆
        if (i < nPanels) {
          const x2 = x + PANEL;
          members.push([v(x, RAIL_Y, z), v(x2, RAIL_Y, z), 1.2, 1.5]); // 下弦
          members.push([v(x, TOP_Y, z), v(x2, TOP_Y, z), 1.2, 1.5]); // 上弦
          members.push([v(x, RAIL_Y, z), v(x2, TOP_Y, z), 0.8, 0.8]); // 斜杆（两向交叉成菱形）
          members.push([v(x, TOP_Y, z), v(x2, RAIL_Y, z), 0.8, 0.8]);
        }
      }
      members.push([v(x, RAIL_Y, -TRUSS_Z), v(x, RAIL_Y, TRUSS_Z), 0.9, 1.2]); // 铁路横梁
      members.push([v(x, TOP_Y, -TRUSS_Z), v(x, TOP_Y, TRUSS_Z), 0.9, 1.2]); // 公路横梁
      if (i % 2 === 0 && i < nPanels) {
        // 下平联（斜撑）
        members.push([v(x, RAIL_Y - 0.4, -TRUSS_Z), v(x + PANEL * 2, RAIL_Y - 0.4, TRUSS_Z), 0.4, 0.4]);
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    const truss = new THREE.InstancedMesh(box, steel, members.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), X = v(1, 0, 0);
    members.forEach(([a, b, w, h], i) => {
      const d = b.clone().sub(a);
      const len = d.length();
      q.setFromUnitVectors(X, d.normalize());
      m4.compose(a.clone().add(b).multiplyScalar(0.5), q, v(len + w * 0.5, h, w));
      truss.setMatrixAt(i, m4);
    });
    g.add(truss);

    // 公路桥面（含两侧引桥）与铁路桥面
    const deckLen = X1 - X0 + APPROACH * 2;
    const deckX = (X0 + X1) / 2;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 1.2, DECK_HALF * 2), deckMat);
    deck.position.set(deckX, DECK_Y - 0.6, 0);
    g.add(deck);
    const railDeck = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.5, TRUSS_Z * 2 - 1), deckMat);
    railDeck.position.set(deckX, RAIL_Y - 0.6, 0);
    g.add(railDeck);
    // 车道线（暗金虚线）
    const dashes: V3[] = [];
    for (let x = X0 - APPROACH; x < X1 + APPROACH; x += 12) for (const z of [-3.75, 0, 3.75]) dashes.push(v(x, DECK_Y + 0.01, z));
    const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(5, 0.18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: lin(PALETTE.gold).multiplyScalar(0.45) }), dashes.length);
    dashes.forEach((p, i) => { m4.makeTranslation(p.x, p.y, p.z); dash.setMatrixAt(i, m4); });
    g.add(dash);

    // 铁轨（双线）+ 轨枕
    for (const tz of [-2.6, 2.6]) for (const s of [-0.72, 0.72]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(X1 - X0, 0.18, 0.08), steel);
      rail.position.set(deckX, RAIL_Y - 0.2, tz + s);
      g.add(rail);
    }
    const nSleep = Math.floor((X1 - X0) / 0.9);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.14, 2.6), concrete, nSleep * 2);
    for (let i = 0; i < nSleep; i++) for (let k = 0; k < 2; k++) {
      m4.makeTranslation(X0 + i * 0.9, RAIL_Y - 0.33, k ? 2.6 : -2.6);
      sleepers.setMatrixAt(i * 2 + k, m4);
    }
    g.add(sleepers);

    // 桥墩（圆端形）：正桥每 160 米一个；引桥每 32 米一对细墩
    const pierShape = new THREE.Shape();
    pierShape.absarc(0, -9, 5, Math.PI, 0, false);
    pierShape.absarc(0, 9, 5, 0, Math.PI, false);
    const pierGeo = new THREE.ExtrudeGeometry(pierShape, { depth: RAIL_Y + 8, bevelEnabled: false, curveSegments: 12 }).rotateX(-Math.PI / 2).translate(0, -8, 0);
    for (let x = X0; x <= X1; x += 160) {
      const p = new THREE.Mesh(pierGeo, concrete);
      p.position.set(x, 0, 0);
      g.add(p);
    }
    const approachPiers: V3[] = [];
    for (let x = X1 + 32; x < X1 + APPROACH; x += 32) approachPiers.push(v(x, 0, 0));
    for (let x = X0 - 32; x > X0 - APPROACH; x -= 32) approachPiers.push(v(x, 0, 0));
    const ap = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, DECK_Y - 1.2, 12), concrete, approachPiers.length);
    approachPiers.forEach((p, i) => { m4.makeTranslation(p.x, (DECK_Y - 1.2) / 2, 0); ap.setMatrixAt(i, m4); });
    g.add(ap);

    // 栏杆：两道扶手 + 每 2 米一根立柱
    for (const z of [-DECK_HALF + 0.15, DECK_HALF - 0.15]) for (const y of [0.55, 1.1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(deckLen, 0.08, 0.1), towerMat);
      rail.position.set(deckX, DECK_Y + y, z);
      g.add(rail);
    }
    const nPost = Math.floor(deckLen);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.15, 0.12), towerMat, nPost * 2);
    for (let i = 0; i < nPost; i++) for (let k = 0; k < 2; k++) {
      m4.makeTranslation(X0 - APPROACH + i, DECK_Y + 0.57, k ? DECK_HALF - 0.15 : -DECK_HALF + 0.15);
      posts.setMatrixAt(i * 2 + k, m4);
    }
    g.add(posts);

    // 白玉兰花灯：每 40 米一对；灯杆 + 一大四小五个灯球
    const lampPos: V3[] = [];
    for (let x = X0 - APPROACH + 20; x < X1 + APPROACH; x += 20) for (const z of [-DECK_HALF + 0.3, DECK_HALF - 0.3]) lampPos.push(v(x, DECK_Y, z));
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.16, 6.5, 8), towerMat, lampPos.length);
    const globes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 10), lampMat, lampPos.length * 5);
    lampPos.forEach((p, i) => {
      m4.makeTranslation(p.x, p.y + 3.25, p.z);
      poles.setMatrixAt(i, m4);
      const top = v(p.x, p.y + 6.9, p.z);
      m4.compose(top, q.identity(), v(0.42, 0.55, 0.42));
      globes.setMatrixAt(i * 5, m4);
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        m4.compose(v(p.x + Math.cos(a) * 0.62, p.y + 6.35, p.z + Math.sin(a) * 0.62), q.identity(), v(0.26, 0.34, 0.26));
        globes.setMatrixAt(i * 5 + 1 + k, m4);
      }
    });
    g.add(poles, globes);

    // 大桥头堡：公路两侧各一座塔楼（约 70 米），顶上三面红旗
    for (const tx of TOWER_X) for (const tz of [-DECK_HALF - 7.5, DECK_HALF + 7.5]) {
      const tw = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.BoxGeometry(11, 60, 11), towerMat);
      shaft.position.y = 30;
      tw.add(shaft);
      // 竖向壁柱
      for (let k = 0; k < 4; k++) for (const s of [-1, 1]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.8, 54, 0.7), towerMat);
        const off = -3.6 + k * 2.4;
        if (s > 0) rib.position.set(off, 30, 5.7); else rib.position.set(5.7, 30, off);
        tw.add(rib);
        const rib2 = rib.clone();
        rib2.position.set(s > 0 ? off : -5.7, 30, s > 0 ? -5.7 : off);
        tw.add(rib2);
      }
      const crown = new THREE.Mesh(new THREE.BoxGeometry(8.5, 4, 8.5), towerMat);
      crown.position.y = 62;
      tw.add(crown);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(13, 3, 13), towerMat);
      plinth.position.y = 1.5;
      tw.add(plinth);
      // 三面红旗：三面钢制旗帜朝三个方向斜向上展开
      const flagGeo = (() => {
        const s = new THREE.Shape();
        s.moveTo(0, 0);
        s.lineTo(0, 3.2);
        for (let i = 1; i <= 16; i++) { const u = i / 16; s.lineTo(u * 8, 3.2 + u * 1.2 + 0.45 * Math.sin(u * Math.PI * 1.6)); }
        for (let i = 16; i >= 0; i--) { const u = i / 16; s.lineTo(u * 8, u * 1.9 + 0.45 * Math.sin(u * Math.PI * 1.6 + 0.4)); }
        const geo = new THREE.ExtrudeGeometry(s, { depth: 0.35, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
        const p = geo.attributes.position!;
        for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.7 * Math.sin((p.getX(i) / 8) * Math.PI * 1.3));
        geo.computeVertexNormals();
        return geo;
      })();
      for (let k = 0; k < 3; k++) {
        const holder = new THREE.Group();
        holder.position.y = 64;
        holder.rotation.y = (k / 3) * Math.PI * 2 + 0.3;
        const f = new THREE.Mesh(flagGeo, red);
        f.rotation.z = 0.5;
        f.position.x = 0.4;
        holder.add(f);
        tw.add(holder);
        this.flags.push(f);
      }
      tw.position.set(tx, 0, tz);
      g.add(tw);
    }

    // 江面与两岸
    const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.ink).multiplyScalar(1.6), roughness: 0.32, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.25, envMapIntensity: 0.25, specularIntensity: 0.15 }));
    water.visible = false; // 白描：江面留白（二维层画几笔水纹）
    g.add(water);
    for (const [x0, x1] of [[X1 + 30, 4500], [-4500, X0 - 30]]) {
      const land = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 2, 9000), new THREE.MeshStandardMaterial({ color: lin(PALETTE.ink).multiplyScalar(1.3), roughness: 0.95 }));
      land.position.set((x0 + x1) / 2, 0.6, 0);
      land.visible = false; // 白描：地面留白
      g.add(land);
    }
    // 两岸城市灯火
    const NL = 2600;
    const lp = new Float32Array(NL * 3);
    for (let i = 0; i < NL; i++) {
      const side = hash(i * 1.3) < 0.5 ? 1 : -1;
      lp[i * 3] = side > 0 ? X1 + 60 + hash(i * 2.1) * 2600 : X0 - 60 - hash(i * 2.1) * 2600;
      lp[i * 3 + 1] = 2 + Math.pow(hash(i * 4.7), 3) * 70;
      lp[i * 3 + 2] = (hash(i * 3.3) - 0.5) * 5000;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    const cityLights = new THREE.Points(lg, new THREE.PointsMaterial({ color: lin(PALETTE.gold).multiplyScalar(1.8), size: 2.2, sizeAttenuation: false }));
    cityLights.visible = false; // 白描：不画灯火
    g.add(cityLights);
  }

  // ───────── 镜头 ─────────
  private walker(beat: number) {
    const pose = rollingBallPose(beat);
    return { pos: v(pose.x, pose.floor, pose.z) };
  }

  private setCamera(b: number) {
    const motion = youthMotionCamera(b);
    const c = this.cam;
    c.position.copy(motion.position);
    c.up.set(0, 1, 0);
    c.lookAt(motion.target);
    c.fov = motion.fov;
    c.near = b >= YOUTH_PORTAL_BEAT ? 0.25 : 0.1;
    c.far = 9000;
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    return motion;
  }

  // ───────── 梧桐叶 ─────────
  /** 底鼓阵风：每次底鼓后风速衰减，返回风的累计位移（秒）。纯函数。 */
  private gust(t: number) {
    const h = 0.35;
    let s = 0;
    for (const e of this.kicks) {
      if (e > t) break;
      s += (1 - Math.pow(0.5, (t - e) / h)) * (h / Math.LN2);
    }
    return s;
  }

  private density(b: number) {
    if (b < 3) return 0;
    // 白描：叶子少而疏（原先满天飞显得廉价）
    if (b < 8) return 0.16 * inOut((b - 3) / 3);
    if (b < 16) return 0.18;
    if (b < 20) return 0.04;
    if (b < 24) return 0.08;
    if (b < 28) return 0.0;
    if (b < 32) return 0.05;
    return 0.05 + 0.3 * inOut((b - 34.5) / 1.5); // 白描：叶片少量涌入，36 拍后由“排成曲线”接管
  }

  private updateLeaves(b: number, f: Frame) {
    const tau = f.lt;
    const G = this.gust(f.t);
    const dens = this.density(b);
    const form = inOut((b - 35.3) / 2.4);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
    const aspect = W / H;
    const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), e = new THREE.Euler();
    const perCurve = Math.ceil(LEAVES / CURVES);
    for (let i = 0; i < LEAVES; i++) {
      const h1 = hash(i + 0.1), h2 = hash(i * 1.9 + 3), h3 = hash(i * 2.7 + 5), h4 = hash(i * 3.3 + 7), h5 = hash(i * 5.1 + 11);
      // 自由飘落
      const depth = 3 + Math.pow(h1, 1.3) * 24;
      const hh = depth * tanHalf, hw = hh * aspect;
      const speed = 0.9 / Math.sqrt(depth);
      const u = wrap(h2 * 2.6 - 1.3 - (0.05 * tau + 0.16 * G) * speed * (0.7 + 0.6 * h4), -1.3, 1.3);
      const vv = wrap(h3 * 2.6 - 1.3 - 0.035 * tau * (0.5 + h5) + 0.05 * Math.sin(tau * (0.8 + h4) + i), -1.3, 1.3);
      const spin = tau * (0.6 + 1.4 * h5) + G * (1.5 + h4 * 2);
      const free = v(u * hw, vv * hh, -depth);
      e.set(spin * 0.9 + i, spin * 0.7 + h2 * 6, spin * 0.5 + h3 * 6);
      qA.setFromEuler(e);
      let scale = (0.22 + 0.16 * h4) * clamp01((dens - h5) * 8 + (form > 0 ? 1 : 0));
      // 排成曲线（镜头前 14 处）
      if (form > 0) {
        const k = i % CURVES;
        const s = ((Math.floor(i / CURVES) + 1.7 * (hash(i + 97) - 0.5)) / (perCurve - 1)) * 2.3 - 1.15;
        const D = 14;
        const ch = D * tanHalf, cw = ch * aspect;
        const [cx, cy] = youthCurve(k, s, tau);
        const [nx, ny] = youthCurve(k, s + 0.01, tau);
        const target = v(cx * cw, cy * ch, -D);
        const ang = Math.atan2((ny - cy) * ch, (nx - cx) * cw);
        qB.setFromEuler(e.set(0.25 * (h2 - 0.5), 0.3 * (h3 - 0.5), ang - Math.PI / 2 + 1.25 * (h4 - 0.5) + 0.1 * Math.sin(tau * 0.9 + i)));
        free.lerp(target, form);
        qA.slerp(qB, form);
        scale = (scale * (1 - form) + (0.18 + 0.035 * h4) * form) * (Math.floor(i / CURVES) % 3 === 0 ? 1 : 1 - form);
      }
      this.dummy.position.copy(free);
      if (this.cam.fov < 10) scale *= tanHalf / Math.tan(THREE.MathUtils.degToRad(17.5));
      this.dummy.quaternion.copy(qA);
      const line = youthGenLine(f.t);
      this.dummy.scale.set(scale * (1 - line), scale * (1 + 0.6 * line), scale * (1 - line));
      this.dummy.updateMatrix();
      this.leaves.setMatrixAt(i, this.dummy.matrix);
    }
    this.leaves.instanceMatrix.needsUpdate = true;
  }

  protagonist() {
    return this.ball;
  }

  private localBeat(frame: Frame) {
    const beat = frame.lt / BEAT, nearest = Math.round(beat);
    return Math.abs(beat - nearest) < 1e-9 ? nearest : beat;
  }

  backgroundCamera(frame: Frame) {
    this.setCamera(this.localBeat(frame));
    return this.cam.clone();
  }

  anchors(f: Frame) {
    const b = this.localBeat(f);
    this.setCamera(b);
    const proj = (p: V3): [number, number] | null => {
      const q = p.clone().project(this.cam);
      if (q.z > 1 || q.z < -1 || Math.abs(q.x) > 1.2 || Math.abs(q.y) > 1.2) return null;
      return [(q.x * 0.5 + 0.5) * W, (0.5 - q.y * 0.5) * H];
    };
    const inBridge = b >= 16;
    const out: Record<string, [number, number] | null> = { figureHead: null, figureFeet: null, rider: null, towerTop: null };
    if (!inBridge) {
      const w = this.walker(b);
      out.figureFeet = proj(w.pos);
      out.figureHead = proj(w.pos.clone().add(v(0, BALL_RADIUS * 2, 0)));
    } else if (b < 32) {
      out.rider = proj(this.walker(b).pos.add(v(0, BALL_RADIUS, 0)));
      out.towerTop = proj(v(TOWER_X[0]! + this.bridge.position.x, 68 + this.bridge.position.y, DECK_HALF + 7.5));
    } else {
      out.towerTop = proj(v(TOWER_X[0]! + this.bridge.position.x, 68 + this.bridge.position.y, DECK_HALF + 7.5));
    }
    return out;
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget, ctx?: Layer3DContext): PostParams {
    const b = this.localBeat(f);
    const shot = this.setCamera(b);
    const inBridge = b >= YOUTH_PORTAL_BEAT;
    this.roadTypography.visible = b < YOUTH_PORTAL_BEAT && window.__posterVariant !== 'portal';
    this.portalTypography.visible = b < YOUTH_PORTAL_BEAT && window.__posterVariant === 'portal';
    this.exitTypography.visible = b >= 6 && b < YOUTH_PORTAL_BEAT;
    for (const mesh of this.bridgeTypography.children) mesh.visible = b >= YOUTH_PORTAL_BEAT && b < 35.5 && mesh.userData.shot === shot.shot && shot.shot !== 'top';

    this.bridge.visible = b >= YOUTH_PORTAL_BEAT;
    this.tunnel.visible = b < 32;
    this.portal.visible = false; // 2026-10-15 Claude：去掉白色挡板，亮口就是隧道截断处透出的桥和天光
    const ballPose = rollingBallPose(b);
    this.ball.position.set(ballPose.x, ballPose.y, ballPose.z);
    this.ball.rotation.set(0, 0, ballPose.angle);
    this.ball.visible = b < 39;
    const contactX = ballPose.x + BALL_RADIUS * ballPose.slope / Math.sqrt(1 + ballPose.slope ** 2);
    this.ballShadow.position.set(contactX, rollingRoadFloor(contactX) + 0.02, ballPose.z);
    const slope = (rollingRoadFloor(ballPose.x + 0.05) - rollingRoadFloor(ballPose.x - 0.05)) / 0.1;
    this.ballShadow.quaternion.setFromUnitVectors(v(0, 0, 1), v(-slope, 1, 0).normalize());
    this.ballShadow.visible = this.ball.visible;
    this.updateTrail(b);
    this.updateLeaves(b, f);
    this.transitionLines.material.uniforms.uTime!.value = f.lt;
    this.transitionLines.material.uniforms.uLine!.value = youthGenLine(f.t);
    this.transitionLines.material.uniforms.uNight!.value = youthGenNight(f.t);
    this.transitionLines.visible = f.t > sectionRange('gen').start - 3 * BEAT; // 跟着 youthGenLine 提前 3 拍长出来（用户 01:42）

    // 雾：桥上远处渐隐到墨黑；36–40 拍大桥沉入夜色，只剩叶片曲线
    this.scene.fog = inBridge ? this.fog : null;
    const sink = inOut((b - 35) / 4);
    this.fog.density = (shot.shot === 'aerial' ? 0.00012 : 0.00025) + sink * 0.02;
    // 红旗随底鼓轻颤（钢制旗帜，幅度很小）
    for (const fl of this.flags) fl.rotation.z = 0.5 + 0.03 * f.env.kick;

    // ── 白描渲染 ──
    // 1) 法线 + 深度（点类物体不参与）
    this.scene.background = null;
    const fog = this.scene.fog;
    this.scene.fog = null;
    this.scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.rtN);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(this.scene, this.cam);
    this.scene.overrideMaterial = null;
    this.scene.fog = fog;
    // 2) 颜色（只用来取淡彩的色相和明暗）
    this.scene.background = this.paper;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, this.cam);
    // 3) 合成到纸面（纸面 = 同镜头的二维背景板）
    const u = this.inkPass.u;
    u.tN!.value = this.rtN.texture;
    u.tD!.value = this.rtN.depthTexture;
    u.tC!.value = this.rt.texture;
    u.tPoster!.value = ctx?.poster ?? null;
    u.uHasPoster!.value = ctx?.poster ? 1 : 0;
    u.uNear!.value = this.cam.near;
    u.uFar!.value = this.cam.far;
    u.uSink!.value = sink;
    u.uNight!.value = youthGenNight(f.t);
    this.inkPass.render(r, this.rtPaper);
    this.actorScene.background = this.rtPaper.texture;
    this.actorScene.fog = null;
    const savedMaterials: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    try {
      for (const environment of [this.bridge, this.tunnel]) environment.traverse(object => {
        if (object instanceof THREE.Mesh) {
          savedMaterials.push([object, object.material]);
          object.material = this.actorDepth;
        }
      });
      this.actorScene.add(this.bridge, this.tunnel);
      r.setRenderTarget(this.rt);
      r.clear();
      r.render(this.actorScene, this.cam);
    } finally {
      for (const [object, material] of savedMaterials) object.material = material;
      this.scene.add(this.bridge, this.tunnel);
    }
    this.copy.u.tIn!.value = this.rt.texture;
    this.copy.render(r, out);
    const imp = f.env.impact;
    const k = imp * 8 + f.env.kick * (b >= 16 ? 1.6 : 0.6);
    const jx = (Math.sin(f.frame * 12.9898) * 43758.5453) % 1;
    const jy = (Math.sin(f.frame * 78.233) * 12345.678) % 1;
    const settle = youthGenSmooth((b - 38.5) / 1.5);
    return {
      bloom: 0.16 * settle,
      bloomThreshold: 2 - 0.95 * settle,
      halation: 0.04 * settle,
      ca: 0,
      zoom: 1 + 0.01 * f.env.kick * (1 - settle),
      shake: [jx * k * 0.6 * (1 - settle), jy * k * 0.6 * (1 - settle)],
      grain: 0.035 - 0.01 * settle,
      vignette: 0.1 + 0.06 * settle,
      fade: f.env.gap,
    };
  }
}
