// 段落 9「片尾」三维层（16 拍，米白底）。负责人：Claude。构图为提案，位置常量可按 Codex 片尾版式调整。
//
//   0–2.4 拍 接双向奔赴玻璃球，续滚并停在中心；同心圆保持平面，从中心荡开
//   3.6 拍   一次硬切将球替换为已有红砖印章，不做形变
//   4–10 拍  同心圆收住，南京字用 2.5 秒转正、小过冲后精确归零
//   之后     印章静止，高光扫过；赛事落款保留
// 全部由段内拍 b 决定，可乱序取帧。
// 提供给 Codex：OUTRO_SEAL（印章砖的屏幕位置与宽度，可改）、anchors() → seal / ringCenter。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FSPass, makeRT, W, H } from '../engine/gl';
import { BEAT, type Frame } from '../engine/beat';
import { PALETTE } from '../engine/palette.glsl';
import type { PostParams } from '../engine/post';
import type { Layer3D, Layer3DContext } from './index';
import { DROP2_BALL_EXIT, drop2RippleRadii } from './drop2';
import { lin, MATERIALS, softStudioEnv } from './env';
import { BALL_RADIUS, createRollingBall } from './rollingBall';
import { createGlassText } from './glassText';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const inOut = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

/** 印章砖的屏幕位置（逻辑像素，砖中心）和屏幕宽度。默认放在画面右下，避开居中的片名；Codex 定版式后改这里即可。 */
export const OUTRO_SEAL = { x: 1175, y: 980, width: 46 };

const FOV = 40;
const D = 10; // 镜头到纸面的距离
const pxToWorld = (px: number) => (px / (H / 2)) * D * Math.tan(THREE.MathUtils.degToRad(FOV / 2));

export function outroLightReveal(localSeconds: number) {
  const sweep = inOut((localSeconds - 3.6 * BEAT) / 0.5);
  return {
    visible: localSeconds >= 3.6 * BEAT,
    sweep: -0.15 + 1.3 * sweep,
    fill: 1,
    light: 1 - inOut((localSeconds - 2) / 1),
  };
}

export function outroWordPose(localSeconds: number) {
  const progress = clamp01((localSeconds - 4 * BEAT) / (6 * BEAT));
  const remaining = progress < 0.75
    ? 1 - 1.1 * inOut(progress / 0.75)
    : -0.1 * (1 - inOut((progress - 0.75) / 0.25));
  if (progress >= 1 - 1e-12) return { pitch: 0, yaw: 0 };
  return { pitch: -0.07 * remaining, yaw: 0.18 * remaining };
}

export function outroFinalePose(b: number) {
  const roll = clamp01(b / 2.4);
  const horizontal = DROP2_BALL_EXIT.x + (W / 2 - DROP2_BALL_EXIT.x) * (1 - (1 - roll) ** 3);
  const vertical = DROP2_BALL_EXIT.y + (H / 2 - DROP2_BALL_EXIT.y) * inOut(roll);
  const distance = horizontal - DROP2_BALL_EXIT.x;
  return {
    ball: { x: horizontal, y: vertical, radius: DROP2_BALL_EXIT.radius, angle: DROP2_BALL_EXIT.angle - distance / DROP2_BALL_EXIT.radius, visible: b * BEAT < 3.6 * BEAT },
    sealVisible: b * BEAT >= 3.6 * BEAT,
    ringFade: 1 - inOut((b - 2.4) / 1.6),
    ringExpansion: 90 * Math.min(Math.max(b, 0), 4) + 140 * inOut((b - 2.4) / 1.6),
    impact: inOut((b - 2.4) / 0.3),
  };
}

export default class Outro implements Layer3D {
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(FOV, W / H, 0.1, 100);
  private rt = makeRT(W, H, { depth: true });
  private copy = new FSPass(`uniform sampler2D tIn; void main(){ gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }`, { tIn: { value: null } });
  private paper = lin(PALETTE.paper);
  private disc = new THREE.Group();
  private rings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private radii: number[] = [];
  private brick!: THREE.Mesh;
  private shadowPlane!: THREE.Mesh;
  private key!: THREE.DirectionalLight;
  private sealWorld = new THREE.Vector3();
  private brickW = 1;
  private ball = createRollingBall();
  private impactRings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
  private glassWord!: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial>;
  private wordReveal = {
    uWordSweep: { value: -0.15 }, uWordFill: { value: 0 }, uWordLight: { value: 0 },
    uWordBounds: { value: new THREE.Vector2(0, 1) },
    uWordHeight: { value: new THREE.Vector2(0, 1) },
  };
  private ringColors: THREE.Color[] = [];

  async init(r: THREE.WebGLRenderer) {
    this.rt.samples = 0;
    this.scene.environment = softStudioEnv(r);
    this.scene.environmentIntensity = 0.9;
    this.cam.position.set(0, 0, D);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld(true);

    // 双向奔赴第 40 拍（= 片尾第 0 拍）的同心圆，换算到纸面上的世界半径
    this.radii = drop2RippleRadii(40).map(pxToWorld);
    const ink = lin(PALETTE.ink);
    this.radii.forEach((rad, i) => {
      // 不透明（淡出用颜色向纸色过渡）：玻璃字的透射只折射不透明物体
      const col = i === 0 ? lin(PALETTE.gold).multiplyScalar(0.8) : ink.clone();
      this.ringColors.push(col);
      const m = new THREE.Mesh(new THREE.TorusGeometry(1, 1, 6, 220), new THREE.MeshBasicMaterial({ color: col.clone() }));
      m.userData.r = rad;
      this.rings.push(m);
      this.disc.add(m);
    });
    this.scene.add(this.disc);
    for (let index = 0; index < 3; index++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.006, 6, 160), new THREE.MeshBasicMaterial({ color: ink, transparent: true, opacity: 0 }));
      this.impactRings.push(ring);
      this.scene.add(ring);
    }
    this.scene.add(this.ball);

    // 印章位置：屏幕坐标 → 纸面（z = 0）上的世界坐标
    const ndc = new THREE.Vector3((OUTRO_SEAL.x / W) * 2 - 1, 1 - (OUTRO_SEAL.y / H) * 2, 0.5).unproject(this.cam);
    const dir = ndc.sub(this.cam.position).normalize();
    this.sealWorld.copy(this.cam.position).addScaledVector(dir, -this.cam.position.z / dir.z);
    this.brickW = pxToWorld(OUTRO_SEAL.width);

    // 玻璃立体字“南京”：中心下移到 (960, 475)，保留字号，顶部留安全边距
    this.glassWord = await createGlassText('南京');
    this.glassWord.position.set(0, pxToWorld(540 - 475), 1.6);
    this.glassWord.scale.setScalar(pxToWorld(620) / 2.05);
    this.glassWord.rotation.set(-0.07, 0.18, 0);
    this.glassWord.geometry.computeBoundingBox();
    const bounds = this.glassWord.geometry.boundingBox!;
    this.wordReveal.uWordBounds.value.set(bounds.min.x, bounds.max.x);
    this.wordReveal.uWordHeight.value.set(bounds.min.y, bounds.max.y);
    const wordMaterial = this.glassWord.material;
    wordMaterial.transparent = true;
    wordMaterial.depthWrite = false;
    wordMaterial.attenuationColor.setRGB(1, 1, 1);
    wordMaterial.attenuationDistance = 100;
    wordMaterial.thickness = 2.2;
    wordMaterial.roughness = 0.045;
    wordMaterial.clearcoatRoughness = 0.03;
    wordMaterial.envMap = this.scene.environment;
    wordMaterial.envMapIntensity = 0.9;
    wordMaterial.envMapRotation.set(0, 0, 0);
    // 2026-10-17 Claude（用户 00:00：结尾「南京」大字与玻璃球同一种物理材质）：同款薄膜虹彩 + 色散 + 略带模糊的折射
    wordMaterial.iridescence = 1;
    wordMaterial.iridescenceIOR = 2.0;
    wordMaterial.iridescenceThicknessRange = [100, 560];
    wordMaterial.dispersion = 4;
    wordMaterial.ior = 1.45;
    wordMaterial.roughness = 0.12;
    wordMaterial.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.wordReveal);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWordPosition;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWordPosition = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWordPosition;
uniform vec2 uWordBounds, uWordHeight;
uniform float uWordSweep, uWordFill, uWordLight;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float wordLensHorizontal = (vWordPosition.x - uWordBounds.x) / (uWordBounds.y - uWordBounds.x);
float wordLensX = (fract(wordLensHorizontal * 2.0) - 0.5) * 2.0;
float wordLensY = (vWordPosition.y - uWordHeight.x) / (uWordHeight.y - uWordHeight.x) * 2.0 - 1.0;
float wordFace = smoothstep(0.8, 0.98, abs(normal.z));
normal = normalize(normal + vec3(wordLensX, wordLensY, 0.0) * 0.45 * wordFace);`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float wordHorizontal = (vWordPosition.x - uWordBounds.x) / (uWordBounds.y - uWordBounds.x);
float wordSwept = 1.0 - smoothstep(uWordSweep - 0.08, uWordSweep + 0.08, wordHorizontal);
if (wordSwept < 0.002) discard;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
float wordRim = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), 1.3);
float wordEdge = smoothstep(0.25, 0.65, wordRim);
float wordBandX = (wordHorizontal - uWordSweep) / 0.07;
float wordBand = exp(-wordBandX * wordBandX) * uWordLight; // 2026-10-18 Claude：pow(负数, 2.0) 在 GLSL 里是未定义，部分显卡给 NaN，改成自乘
gl_FragColor.rgb += vec3(0.18) * wordBand * (0.25 + 0.75 * wordEdge);
gl_FragColor.a *= wordSwept * uWordFill;
if (gl_FragColor.a < 0.002) discard;`);
    };
    wordMaterial.customProgramCacheKey = () => 'outro-word-light-reveal-clear-glass-v4';
    this.scene.add(this.glassWord);
    this.brick = new THREE.Mesh(new RoundedBoxGeometry(1, 0.5, 0.42, 4, 0.06), MATERIALS.redGlaze());
    this.brick.castShadow = true;
    this.scene.add(this.brick);
    // 纸面上的柔和投影
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.ShadowMaterial({ opacity: 0.18, depthWrite: false }));
    this.shadowPlane.receiveShadow = true;
    this.shadowPlane.position.z = -0.01;
    this.scene.add(this.shadowPlane);
    this.key = new THREE.DirectionalLight(0xffffff, 1.4);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.left = -3; this.key.shadow.camera.right = 3; this.key.shadow.camera.top = 3; this.key.shadow.camera.bottom = -3;
    this.key.shadow.radius = 6;
    this.scene.add(this.key, this.key.target);
  }

  anchors(f: Frame) {
    const b = f.lt / BEAT;
    return {
      ringCenter: b < 4 ? [W / 2, H / 2] as [number, number] : null,
      seal: b >= 3.6 ? [OUTRO_SEAL.x, OUTRO_SEAL.y] as [number, number] : null,
      ball: b < 3.6 ? [outroFinalePose(b).ball.x, H / 2] as [number, number] : null,
    };
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget, ctx?: Layer3DContext): PostParams {
    const b = f.lt / BEAT;

    const finale = outroFinalePose(b);
    this.disc.rotation.set(0, 0, 0);
    this.disc.position.set(0, 0, 0);
    const lineW = pxToWorld(1.6);
    this.rings.forEach((m, i) => {
      const r0 = m.userData.r as number;
      const rad = r0 + pxToWorld(finale.ringExpansion);
      m.scale.set(Math.max(1e-4, rad), Math.max(1e-4, rad), 1);
      // 圆环管径不随半径缩放：几何是单位圆环，把管径换算到 1/半径
      m.geometry.dispose();
      m.geometry = new THREE.TorusGeometry(1, lineW / Math.max(rad, 1e-3), 6, 220);
      const a = clamp01((0.85 - i * 0.06) * finale.ringFade);
      m.material.color.copy(this.paper).lerp(this.ringColors[i]!, a);
      m.visible = finale.ringFade > 0;
    });
    this.impactRings.forEach((ring, index) => {
      const radius = pxToWorld(48 + Math.max(0, b - 2.4) * (190 + index * 80));
      ring.scale.set(radius, radius, 1);
      ring.material.opacity = 0.45 * finale.impact * finale.ringFade;
      ring.visible = b > 2.4 && b < 4;
    });
    this.ball.visible = finale.ball.visible;
    this.ball.position.set(pxToWorld(finale.ball.x - W / 2), pxToWorld(H / 2 - finale.ball.y), 0);
    this.ball.scale.setScalar(pxToWorld(finale.ball.radius) / BALL_RADIUS);
    this.ball.rotation.set(0.15, 0.25, finale.ball.angle);
    this.brick.visible = finale.sealVisible;
    this.brick.position.set(this.sealWorld.x, this.sealWorld.y, 0.21 * this.brickW);
    this.brick.rotation.set(0.42, -0.5, 0);
    this.brick.scale.setScalar(this.brickW);
    const reveal = outroLightReveal(f.lt);
    const wordPose = outroWordPose(f.lt);
    this.glassWord.rotation.set(wordPose.pitch, wordPose.yaw, 0);
    this.glassWord.visible = reveal.visible;
    this.wordReveal.uWordSweep.value = reveal.sweep;
    this.wordReveal.uWordFill.value = reveal.fill;
    this.wordReveal.uWordLight.value = reveal.light;
    // 8–16 拍：环境光缓慢转动，釉面上的高光扫过
    this.scene.environmentRotation.set(0, 0.35 * Math.max(0, b - 8), 0);

    this.key.position.set(this.sealWorld.x - 3, this.sealWorld.y + 4, 6);
    this.key.target.position.copy(this.sealWorld);
    this.key.target.updateMatrixWorld();

    this.scene.background = ctx?.poster ?? this.paper;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, this.cam);
    this.copy.u.tIn!.value = this.rt.texture;
    this.copy.render(r, out);

    return {
      bloom: 0.15,
      bloomThreshold: 2,
      halation: 0.05,
      ca: 0.03 + 0.2 * f.env.impact,
      grain: 0.03,
      vignette: 0.12,
      zoom: 1,
      shake: [0, 0],
      flash: 0,
      fade: 0,
    };
  }
}
