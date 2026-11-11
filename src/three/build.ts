// 段落 7「蓄力」三维层（16 拍，墨黑底）。负责人：Claude。分工见 VISUAL_TASKS.md「7. 蓄力」。
//
// 主体：城市网格隧道（圆筒内壁着色器画环线 + 纵线 + 零星亮起的“窗格”），镜头沿轴线前进。
//   0–2 拍    接地形段末帧：Codex gen.ts 第 14 拍收成的 9 个金色圆环（同一屏幕位置、同一大小、同一视野 42°）
//             沿纵深拉开，成为隧道最前面的 9 道环；画面中心从地形段的偏移位置移回正中
//   2–12 拍   前进速度每 4 拍翻倍（与底鼓由四分加速到十六分同步），视野随上升音由 42° 变宽到 72°；
//             每次底鼓一道亮环从镜头前向深处推进，窗格随进度逐渐亮起
//   12–15.5 拍 隧道收缩，中心接共用经纬线玻璃球；15.5–16 拍音乐静音，小球定格
//   第 16 拍（下一段第 0 拍）从中心小球接入双向奔赴
// 三维里不画数字（计数由 Codex 负责）。全部由段内拍 b 决定，可乱序取帧。
// 提供给 Codex：anchors() → vanish（消失点 / 最后的亮点）；buildCenter(b)（同一坐标的函数版本）。
import * as THREE from 'three';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { BEAT, lastEvent, type Frame } from '../engine/beat';
import { GLSL_PALETTE, PALETTE } from '../engine/palette.glsl';
import { GLSL_COMMON } from '../shaders/common.glsl';
import type { PostParams } from '../engine/post';
import type { Layer3D, Layer3DContext } from './index';
import { lin, softStudioEnv } from './env';
import { BALL_RADIUS, createRollingBall } from './rollingBall';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

// 地形段末帧的圆环（与 Codex gen.ts 的 contourProjection 一致：半径 0.8 + 0.22k，深度 -9 + 0.25k，视野 42°，
// 投影后整体偏移 NDC (+0.1, -0.3)，即屏幕上中心在 (1056, 702)）
const GEN_RINGS = 9;
const GEN_FOV = 42;
const GEN_CENTER: [number, number] = [W / 2 + 0.1 * (W / 2), H / 2 + 0.3 * (H / 2)];

const R0 = 2.2; // 隧道半径
const LEN = 90; // 隧道可见长度
const V0 = 2.0; // 第 0 拍的前进速度（单位 / 拍）
/** 前进距离：速度 v = V0 · 2^(b/4)，积分得到。 */
const dist = (b: number) => (V0 * 4 / Math.LN2) * (Math.pow(2, b / 4) - 1);
const speed = (b: number) => V0 * Math.pow(2, b / 4);

/** 第 b 拍隧道消失点（= 最后亮点）的屏幕坐标（逻辑像素，y 向下）。 */
export function buildCenter(b: number): [number, number] {
  const k = inOut(b / 2);
  return [GEN_CENTER[0] + (W / 2 - GEN_CENTER[0]) * k, GEN_CENTER[1] + (H / 2 - GEN_CENTER[1]) * k];
}

const fovAt = (b: number) => GEN_FOV + 30 * inOut((b - 1) / 11) - 10 * inOut((b - 12) / 3.5);
/** 收缩进度：12–15.5 拍 0 → 1。 */
const collapseAt = (b: number) => inOut((b - 12) / 3.5);

export function buildBallPose(b: number) {
  return { center: buildCenter(b), radius: 28 * inOut((b - 12.5) / 0.7), visible: b > 12.5 };
}

const TUNNEL_VERT = /* glsl */ `
uniform float uR, uCollapse;
varying vec3 vLocal;
varying float vDepth;
void main() {
  vLocal = position;
  vec3 p = position;
  // 收缩：远处先收，近处整段被拉向轴线，形成指向中心的细锥
  float d = -p.z;
  float shrink = mix(1.0, 0.0, uCollapse * smoothstep(-0.2, 0.6, uCollapse - d / 120.0));
  p.xy *= uR * shrink;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const TUNNEL_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_PALETTE}
uniform float uDist, uS0, uSpeed, uBlur, uSpin, uLit, uKickAge, uKickAmp, uFade, uDMin, uCollapse, uWarm;
varying vec3 vLocal;
varying float vDepth;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 周期线：距离整数点的屏幕宽度 w 内为 1；blur 为运动模糊长度（单位：周期）
float lineAA(float x, float w) {
  float f = abs(fract(x + 0.5) - 0.5);
  float px = fwidth(x) * w;
  return 1.0 - smoothstep(px * 0.5, px * 1.5, f);
}
void main() {
  float zz = -vLocal.z;
  if (zz < uDMin) discard;
  float a = atan(vLocal.y, vLocal.x) / 6.28318530718 + 0.5 + uSpin;
  float s = zz + uDist + uS0; // 隧道纵向坐标：整数处是环线
  // 环线（随速度变成拖影）、纵线
  float ring = lineAA(s, 1.6);
  ring = mix(ring, 0.07, smoothstep(0.15, 0.7, uBlur));
  float lon = lineAA(a * 24.0, 1.4);
  // 窗格：零星亮起，像夜里城市的窗；随段落推进越来越多
  vec2 cell = vec2(floor(s), floor(a * 24.0));
  float h = h21(cell);
  vec2 fc = vec2(fract(s), fract(a * 24.0));
  float inCell = step(0.14, fc.x) * step(fc.x, 0.86) * step(0.18, fc.y) * step(fc.y, 0.82);
  float lit = step(1.0 - uLit, h) * inCell;
  float red = step(0.985, h21(cell + 17.3)) * inCell * step(0.3, uLit);
  // 底鼓：一道亮环从镜头前向深处推进
  float front = 4.0 + uKickAge * 70.0;
  float wave = uKickAmp * exp(-uKickAge * 5.0) * exp(-abs(zz - front) * 0.9);
  // 远处渐隐到墨黑
  float fog = exp(-zz * 0.045);
  vec3 col = C_INK;
  col += C_WALL * 0.32 * lon;
  col += mix(C_WALL * 0.45, C_GOLD * 0.9, uWarm) * ring;
  col += C_GOLD * 1.6 * lit * (0.6 + 0.4 * h21(cell + floor(uDist * 0.5)));
  col += C_RED * 2.2 * red;
  col += C_GOLD * 3.0 * wave * (ring * 0.9 + lon * 0.3 + 0.04);
  col *= fog;
  // 收缩时整体变亮成一束金色
  col += C_GOLD * 0.6 * uCollapse * fog * (0.4 + ring);
  // 收缩时最近的截面是一道金色亮环（隧道收成环 → 点，下一段从这一点爆开成冲击环）
  col += C_GOLD * 2.4 * uCollapse * exp(-(zz - uDMin) * 3.0);
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

export default class Build implements Layer3D {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(GEN_FOV, W / H, 0.05, 400);
  private rt = makeRT(W, H, { depth: true });
  private copy = new FSPass(`uniform sampler2D tIn; void main(){ gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }`, { tIn: { value: null } });
  private ink = lin(PALETTE.ink);
  private tunnel!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private rings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private streaks!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private ball = createRollingBall();

  async init(r: THREE.WebGLRenderer) {
    this.rt.samples = 4;
    this.scene.environment = softStudioEnv(r, { key: 2.8, rim: 1.6 });
    const ballLines = this.ball.children[1] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
    ballLines.material.color.copy(lin(PALETTE.paper));
    ballLines.material.opacity = 0.46;
    this.scene.add(this.cam);

    // 隧道：开口圆筒，轴线沿 -z，从镜头处延伸到 LEN
    const geo = new THREE.CylinderGeometry(1, 1, LEN, 96, 240, true).rotateX(Math.PI / 2).translate(0, 0, -LEN / 2);
    this.tunnel = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: TUNNEL_VERT,
      fragmentShader: TUNNEL_FRAG,
      side: THREE.BackSide,
      uniforms: {
        uR: { value: R0 }, uCollapse: { value: 0 }, uDist: { value: 0 }, uS0: { value: 0 }, uSpeed: { value: 0 }, uBlur: { value: 0 },
        uSpin: { value: 0 }, uLit: { value: 0 }, uKickAge: { value: 10 }, uKickAmp: { value: 0 }, uFade: { value: 1 }, uDMin: { value: 0 },
        uWarm: { value: 0 },
      },
    }));
    this.tunnel.frustumCulled = false;
    this.tunnel.material.depthWrite = false; // 隧道当背景画：交接圆环比隧道半径大时也不会被内壁挡住
    this.tunnel.renderOrder = -1;
    this.scene.add(this.tunnel); // 镜头停在原点，前进由着色器里的纵向坐标表现；镜头滚转时看到隧道在转

    // 地形段交接的 9 个金色圆环
    const gold = lin(PALETTE.gold);
    for (let k = 0; k < GEN_RINGS; k++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.0095, 6, 160), new THREE.MeshBasicMaterial({ color: gold.clone().multiplyScalar(0.82 + 0.22 * (k / 8)), transparent: true, opacity: 0.82 }));
      m.frustumCulled = false;
      this.rings.push(m);
      this.scene.add(m);
    }

    // 速度线：贴近内壁的短线段，长度随速度变长
    const N = 700;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.streaks = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: lin(PALETTE.paper).multiplyScalar(0.7), transparent: true, opacity: 0.8 }));
    this.streaks.frustumCulled = false;
    this.scene.add(this.streaks);

    this.ball.position.set(0, 0, -6);
    this.cam.add(this.ball);
  }

  private setCamera(b: number) {
    const c = this.cam;
    c.fov = fovAt(b);
    c.position.set(0, 0, 0);
    // 中段开始缓慢滚转，速度越快滚得越多；收缩时回正
    const roll = 0.35 * Math.sin(b * 0.55) * inOut((b - 4) / 4) * (1 - collapseAt(b));
    c.rotation.set(0, 0, roll);
    const [cx, cy] = buildCenter(b);
    c.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
  }

  anchors(f: Frame) {
    const b = f.lt / BEAT;
    return { vanish: buildCenter(b) };
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget, ctx?: Layer3DContext): PostParams {
    const b = Math.min(f.lt / BEAT, 15.5); // 15.5–16 拍静音：停在最后的亮点上
    this.setCamera(b);
    const D = dist(b);
    const v = speed(b);
    const col = collapseAt(b);

    // 隧道
    const u = this.tunnel.material.uniforms;
    u.uDist!.value = D;
    u.uS0!.value = -dist(2); // 让交接圆环正好落在隧道的环线上
    u.uSpeed!.value = v;
    u.uBlur!.value = (v * (1 / BEAT)) / 60; // 每帧（60fps）前进多少个环距
    u.uSpin!.value = 0.04 * b + 0.02 * b * inOut((b - 8) / 4);
    u.uLit!.value = 0.02 + 0.1 * inOut((b - 2) / 10);
    const ka = f.t - lastEvent('kick', f.t);
    u.uKickAge!.value = Number.isFinite(ka) ? ka : 10;
    u.uKickAmp!.value = b >= 1 ? 1 : 0;
    u.uFade!.value = inOut((b - 0.3) / 1.4) * (1 - inOut((b - 13) / 1.5));
    u.uCollapse!.value = col;
    u.uDMin!.value = 0.2 + 26 * col * col;
    u.uWarm!.value = inOut((b - 8) / 4);

    // 交接圆环：0–2 拍从“平面靶心”沿纵深拉开成隧道最前面的 9 道环，然后随前进从镜头旁掠过
    const m = inOut(b / 2);
    this.rings.forEach((ring, k) => {
      const rGen = 0.8 + 0.22 * k, zGen = -9 + 0.25 * k;
      const zTun = -(2 + (GEN_RINGS - 1 - k)); // 最外圈 → 最近
      const z = zGen + (zTun - zGen) * m + (D - dist(Math.min(b, 2)));
      const rad = rGen + (R0 - rGen) * m;
      ring.position.set(0, 0, z);
      ring.scale.setScalar(rad * (1 - col));
      ring.visible = z < -0.3 && col < 0.98;
      ring.material.opacity = 0.82 * (1 - inOut((b - 4) / 2));
    });

    // 速度线
    const pos = this.streaks.geometry.attributes.position as THREE.BufferAttribute;
    const n = pos.count / 2;
    const len = Math.min(6, 0.05 + v * 0.12);
    const shrink = 1 - col;
    for (let i = 0; i < n; i++) {
      const h1 = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
      const h2 = Math.abs(Math.sin(i * 78.233) * 12345.678) % 1;
      const h3 = Math.abs(Math.sin(i * 39.425) * 24634.633) % 1;
      const ang = h1 * Math.PI * 2;
      const rr = R0 * (0.55 + 0.4 * h2) * shrink;
      const zz = ((h3 * LEN - D * (0.9 + 0.2 * h2)) % LEN + LEN) % LEN + 0.5;
      const x = Math.cos(ang) * rr, y = Math.sin(ang) * rr;
      pos.setXYZ(i * 2, x, y, -zz);
      pos.setXYZ(i * 2 + 1, x, y, -zz - len);
    }
    pos.needsUpdate = true;
    this.streaks.material.opacity = 0.75 * inOut((b - 2) / 2) * (1 - col);

    const ballPose = buildBallPose(b);
    const ballRadius = ballPose.radius / (H / 2) * Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2)) * 6;
    this.ball.scale.setScalar(ballRadius / BALL_RADIUS);
    this.ball.rotation.set(0.15, 0.25, 0);
    this.ball.visible = ballPose.visible;

    this.scene.background = ctx?.poster ?? this.ink;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, this.cam);
    this.copy.u.tIn!.value = this.rt.texture;
    this.copy.render(r, out);

    const sp = clamp01((b - 4) / 8);
    const k = f.env.kick * (1 + 3 * sp) * (1 - col);
    const jx = (Math.sin(f.frame * 12.9898) * 43758.5453) % 1;
    const jy = (Math.sin(f.frame * 78.233) * 12345.678) % 1;
    return {
      bloom: 0.55 + 0.35 * sp,
      bloomThreshold: 0.95,
      halation: 0.12,
      ca: (0.06 + 0.4 * sp + 0.2 * f.env.kick) * (1 - col),
      zoom: 1 + 0.015 * f.env.kick * (1 - col),
      shake: [jx * k, jy * k],
      grain: 0.04,
      vignette: 0.3 + 0.2 * sp,
    };
  }
}
