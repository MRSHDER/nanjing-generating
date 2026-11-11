// 段落 2「锁定」三维层（16 拍，米白底）。负责人：Claude。分工见 VISUAL_TASKS.md「2. 锁定」。
//
// 画面：Codex 的二维后层海报铺满背景，一颗刻着经纬细线的玻璃球浮在它前面并折射它（物理材质）。
// 位置和大小完全跟随 Codex 的版式 getLockLayout(frame)（I4）；海报由播放器每帧传入 { poster }（I1）。
//   0–8 拍   侧向自转，转速在底鼓上微微加快
//   8–12 拍  转正：经线对准镜头，配合二维红色定位框锁定
// 提供给 Codex：anchors() → sphereCenter、sphereEdge（I5，屏幕逻辑像素）。
// 没有收到海报时（例如单独测试），背景用米白纸色代替，不会报错。
import * as THREE from 'three';
import { rainbowRim } from './rollingBall';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { BEAT, frameAt, glitchTime, sectionRange, type Frame } from '../engine/beat';
import { PALETTE } from '../engine/palette.glsl';
import type { PostParams } from '../engine/post';
import { getLockLayout } from '../overlay2d/lock';
import { flowBeat } from '../overlay2d/rhythm';
import type { Layer3D, Layer3DContext } from './index';
import { lin, softStudioEnv, MATERIALS } from './env';

const FOV = 30;
const DEPTH = 10; // 玻璃球离镜头的距离
const POSTER_DEPTH = 30; // 海报平面离镜头的距离

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = (x: number) => { x = clamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

export function lockCut(beat: number) {
  // 用户 10-13 01:33：球快速下降（视觉加速度），在下落途中直接切成砖，砖落地有一点物理弹跳；不变形、不压扁。
  // 用户 01:40–01:43：在 12.60 秒（段内 14.25 拍，比截图 12.69 秒再早一点）球就变成砖，由砖接着掉下去。
  // 13.6–14.25 拍球加速下落；14.25 拍在球当时的位置硬切成砖，砖带着球的速度落到地面、弹两下，15.5 拍静音前停稳。
  const progress = clamp01((beat - CUT_FALL0) / (CUT_AT - CUT_FALL0));
  const travel = progress * progress * progress;
  return { showSphere: beat < CUT_AT, showBrick: beat >= CUT_AT, travel, spin: travel * Math.PI * 3 };
}
const CUT_FALL0 = 13.6, CUT_AT = 14.25;
const ABOVE = 1.1; // 球落到离地这么高时切成砖（屏幕上球几乎贴地，切换后砖只再落一小段）
const GROUND_Y = -2.2, LAND_Z = -16; // 与二维地图平放后的地面一致：城中心 (0, -2.2, -16) 投影到屏幕 (960, 817)

/** 砖从切换点落到地面后的弹跳（纯函数：给定切换后经过的秒数，返回离地高度和每次着地的时刻）。 */
function brickBounce(tau: number, drop: number, v0: number) {
  const g = 70, e = 0.32;
  let y = drop, v = -v0, t0 = 0;
  const hits: number[] = [];
  for (let n = 0; n < 6; n++) {
    const tHit = (v + Math.sqrt(v * v + 2 * g * y)) / g; // y + v·t − ½g·t² = 0
    if (tau < t0 + tHit) { const t = tau - t0; return { h: y + v * t - 0.5 * g * t * t, hits }; }
    t0 += tHit;
    hits.push(t0);
    const vHit = v - g * tHit;
    v = -vHit * e;
    y = 0;
    if (v < 0.6) break;
  }
  return { h: 0, hits };
}

/** 屏幕像素（左上原点）→ 距离 depth 处的世界坐标（镜头在原点、朝 -z）。 */
function screenToWorld(px: number, py: number, depth: number): THREE.Vector3 {
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  const x = ((px / W) * 2 - 1) * t * (W / H) * depth;
  const y = (1 - (py / H) * 2) * t * depth;
  return new THREE.Vector3(x, y, -depth);
}
/** 距离 DEPTH 处的世界坐标 → 屏幕像素。 */
function toPx(p: THREE.Vector3): [number, number] {
  const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  return [((p.x / (-p.z * t * (W / H))) + 1) / 2 * W, (1 - p.y / (-p.z * t)) / 2 * H];
}
/** 屏幕像素长度 → 距离 depth 处的世界长度。 */
const pxToWorld = (px: number, depth: number) => (px / (H / 2)) * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * depth;

export function lockBrickPose(frame: Frame) {
  const layout = getLockLayout(frame);
  const width = pxToWorld(layout.brickSize[0], -LAND_Z);
  const height = pxToWorld(layout.brickSize[1], -LAND_Z);
  const tau = Math.max(0, (frame.lt / BEAT - CUT_AT) * BEAT);
  const start = screenToWorld(layout.sphereCenter[0], layout.sphereCenter[1], DEPTH);
  const cutPosition = new THREE.Vector3(0, GROUND_Y + ABOVE, LAND_Z);
  const velocity = 3 / ((CUT_AT - CUT_FALL0) * BEAT) * (start.y - cutPosition.y);
  const rest = GROUND_Y + height / 2;
  const drop = Math.max(0.05, cutPosition.y - rest);
  const bounce = brickBounce(tau, drop, velocity);
  let roll = 0, pitch = 0;
  for (const [index, hit] of bounce.hits.entries()) {
    if (tau < hit) continue;
    const elapsed = tau - hit, amplitude = 0.22 / (index + 1);
    roll += amplitude * Math.exp(-elapsed * 7) * Math.sin(elapsed * 26 + index);
    pitch += 0.5 * amplitude * Math.exp(-elapsed * 7) * Math.sin(elapsed * 21 + 1 + index);
  }
  return { position: new THREE.Vector3(0, rest + bounce.h, LAND_Z), scale: new THREE.Vector3(width, height / 0.5, height), rotation: new THREE.Euler(0.12 + pitch, -0.35 + 0.15 * Math.exp(-tau * 4), roll) };
}

export function lockBrickExit() {
  return lockBrickPose(frameAt(glitchTime(sectionRange('lock').end - 1e-6)));
}

export function lockBrickExitAnchor() {
  return toPx(lockBrickExit().position);
}

export default class LockLayer implements Layer3D {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 100);
  private rt = makeRT(W, H, { depth: true });
  private copy = new FSPass(`uniform sampler2D tIn; void main(){ gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }`, { tIn: { value: null } });
  private poster!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private paperFallback = lin(PALETTE.paper);
  private globe = new THREE.Group();
  private entryRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, index) => new THREE.Vector3(Math.cos(index / 128 * Math.PI * 2), Math.sin(index / 128 * Math.PI * 2), 0))), new THREE.LineBasicMaterial({ color: lin(PALETTE.ink), transparent: true, depthTest: false, depthWrite: false }));
  private glass!: THREE.Mesh;
  private rim!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private lines!: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private brick!: THREE.Mesh<RoundedBoxGeometry, THREE.MeshPhysicalMaterial>;

  async init(r: THREE.WebGLRenderer) {
    this.rt.samples = 4;
    this.scene.environment = softStudioEnv(r);
    this.cam.position.set(0, 0, 0);
    this.cam.lookAt(0, 0, -1);

    // 海报平面：正好铺满镜头视野，像素一一对应
    const ph = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * POSTER_DEPTH;
    this.poster = new THREE.Mesh(new THREE.PlaneGeometry(ph * (W / H), ph), new THREE.MeshBasicMaterial({ color: this.paperFallback.clone(), toneMapped: false }));
    this.poster.position.z = -POSTER_DEPTH;
    this.scene.add(this.poster);

    // 玻璃球（单位半径，按版式缩放）
    const glassMat = MATERIALS.glass();
    glassMat.thickness = 2.2; // 球体厚，折射更明显
    this.glass = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), glassMat);
    this.globe.add(this.glass);
    // 2026-10-17 Claude（用户 23:18：「这一段变回之前的彩色玻璃球」）：同青年段的彩虹边光 + 强色散
    // 用户 23:45 找回的原版（10-14 02:09 预览 8.5 秒）：整个球面泛粉 / 绿 / 紫的肥皂泡薄膜彩光，随转动变化——物理薄膜虹彩
    glassMat.dispersion = 4;
    glassMat.iridescence = 1;
    glassMat.iridescenceIOR = 2.0;
    glassMat.iridescenceThicknessRange = [100, 560];
    this.rim = rainbowRim(1);
    this.rim.visible = false; // 开场用原版的整面彩光，不加边光

    // 经纬细线：墨黑、半透明，略大于球面，像刻在玻璃上
    const pts: number[] = [];
    const R = 1.004;
    for (let lat = -60; lat <= 60; lat += 30) {
      const phi = THREE.MathUtils.degToRad(lat);
      for (let i = 0; i < 96; i++) {
        const a0 = (i / 96) * Math.PI * 2, a1 = ((i + 1) / 96) * Math.PI * 2;
        pts.push(R * Math.cos(phi) * Math.cos(a0), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(a0));
        pts.push(R * Math.cos(phi) * Math.cos(a1), R * Math.sin(phi), R * Math.cos(phi) * Math.sin(a1));
      }
    }
    for (let lon = 0; lon < 180; lon += 30) {
      const th = THREE.MathUtils.degToRad(lon);
      for (let i = 0; i < 96; i++) {
        const a0 = (i / 96) * Math.PI * 2, a1 = ((i + 1) / 96) * Math.PI * 2;
        pts.push(R * Math.cos(a0) * Math.cos(th), R * Math.sin(a0), R * Math.cos(a0) * Math.sin(th));
        pts.push(R * Math.cos(a1) * Math.cos(th), R * Math.sin(a1), R * Math.cos(a1) * Math.sin(th));
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: lin(PALETTE.ink), transparent: true, opacity: 0.55 }));
    this.globe.add(this.lines);
    this.scene.add(this.globe);
    this.scene.add(this.entryRing);

    // 收束用的红色釉面砖（与城墙段的第一块砖同一种材质）
    this.brick = new THREE.Mesh(new RoundedBoxGeometry(1, 0.5, 0.5, 4, 0.05), MATERIALS.redGlaze());
    this.scene.add(this.brick);

    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(-3, 4, 5);
    this.scene.add(key);
  }

  private state(f: Frame) {
    const b = f.lt / BEAT;
    const layout = getLockLayout(f);
    const cut = lockCut(b);
    const land = cut.travel;
    const radius = pxToWorld(layout.sphereRadius, DEPTH);
    // 球从悬停位置加速落向地图上的城中心正上方（落点在地面上方一点，切成砖后再由砖完成落地）
    const start = screenToWorld(layout.sphereCenter[0], layout.sphereCenter[1], DEPTH);
    const above = new THREE.Vector3(0, GROUND_Y + ABOVE, LAND_Z);
    const center = start.clone().lerp(above, land);

    // 0–8 拍侧向自转（底鼓时稍快）；8–10 拍转正
    const poseBeat = flowBeat(Math.min(b, 14.2));
    const spin = poseBeat * 0.55;
    const settle = inOut((poseBeat - 8) / 2);
    const rotY = spin * (1 - settle) + 0.4 * Math.max(0, poseBeat - 8) * settle + cut.spin;
    const tilt = 0.45 * (1 - settle);

    return { b, poseBeat, layout, center, radius, rotY, tilt, land, ...cut };
  }

  /** 二维背景板按同一镜头投影（镜头固定，但二维的地图在同一空间里倒下、旋转）。 */
  protagonist() {
    return this.globe;
  }

  backgroundCamera(_f: Frame) {
    this.cam.updateMatrixWorld(true);
    return this.cam.clone();
  }

  anchors(f: Frame) {
    const s = this.state(f);
    if (!s.showSphere) return { sphereCenter: null, sphereEdge: null };
    return {
      sphereCenter: toPx(s.center),
      sphereEdge: (() => { const c = toPx(s.center); return [c[0] + (s.radius / pxToWorld(1, DEPTH)), c[1]] as [number, number]; })(),
    };
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget, ctx?: Layer3DContext): PostParams {
    const s = this.state(f);

    // 海报：只读使用调用方的纹理，不修改、不释放
    const mat = this.poster.material;
    if (ctx?.poster) {
      if (mat.map !== ctx.poster) {
        mat.map = ctx.poster;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      }
    } else if (mat.map) {
      mat.map = null;
      mat.color.copy(this.paperFallback);
      mat.needsUpdate = true;
    }

    // 玻璃球
    this.globe.visible = s.showSphere;
    this.globe.position.copy(s.center);
    this.globe.rotation.set(s.tilt, s.rotY, 0.12 * (1 - inOut((s.poseBeat - 8) / 2)));
    this.globe.scale.setScalar(s.radius);
    const birth = inOut(s.b / 1);
    this.glass.visible = birth > 1e-6;
    const glassMaterial = this.glass.material as THREE.MeshPhysicalMaterial;
    glassMaterial.transparent = true;
    glassMaterial.opacity = birth;
    this.rim.material.uniforms.uOpacity!.value = birth;
    this.rim.visible = false;
    this.entryRing.visible = s.b < 1 && s.showSphere;
    this.entryRing.position.copy(s.center);
    this.entryRing.position.z += 0.01;
    this.entryRing.scale.setScalar(s.radius);
    this.entryRing.material.opacity = 1 - birth;
    this.lines.material.opacity = 0.55 * birth;
    const lineVertices = this.lines.geometry.getAttribute('position').count;
    this.lines.geometry.setDrawRange(0, Math.floor(lineVertices * Math.min(1, (s.poseBeat + 1) / 8) / 2) * 2);

    // 砖：在地图的城中心落地、弹两下、晃一晃停稳（尺寸按落地处的深度换算，屏幕上与版式 brickSize 一致）
    const brickPose = lockBrickPose(f);
    this.brick.visible = s.showBrick;
    this.brick.position.copy(brickPose.position);
    this.brick.scale.copy(brickPose.scale);
    this.brick.rotation.copy(brickPose.rotation);

    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, this.cam);
    this.copy.u.tIn!.value = this.rt.texture;
    this.copy.render(r, out);

    // 米白底：不要泛光把纸面冲白；红砖出现时轻微震一下
    return {
      bloom: 0.25,
      bloomThreshold: 1.8,
      halation: 0.03,
      ca: 0.06,
      shake: [0, 0],
    };
  }
}
