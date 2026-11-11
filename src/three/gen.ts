import * as THREE from 'three';
import { FSPass, makeRT, W as WIDTH, H as HEIGHT } from '../engine/gl';
import { BEAT, frameAt, type Frame } from '../engine/beat';
import { PALETTE, GLSL_PALETTE } from '../engine/palette.glsl';
import { GLSL_COMMON } from '../shaders/common.glsl';
import type { PostParams } from '../engine/post';
import type { Layer3D, Layer3DContext } from './index';
import { youthCurve } from './youth';
import { GEN_WORLD_ORIGIN, GEN_WORLD_SCALE, youthGenAerial, youthGenNight } from './youthGenTransition';
import { GLSL_SKY_NIGHT } from '../engine/transition.glsl';
import { createPosterTypography, placeUprightPoster } from './posterTypography';

const CURVES = 9;
const SAMPLES = 160;
const YOUTH_END = 40 * BEAT;
const smooth = (value: number) => {
  const progress = Math.min(1, Math.max(0, value));
  return progress * progress * (3 - 2 * progress);
};

export function genHeight(horizontal: number, depth: number): number {
  const warpedX = (horizontal + 0.38 * Math.sin(depth * 0.6)) / 4;
  const warpedZ = depth / 2.7;
  const radius = Math.hypot(warpedX, warpedZ);
  const angle = Math.atan2(warpedZ, warpedX);
  const ridge = 1 + 0.14 * Math.cos(angle * 3 + 0.6) + 0.08 * Math.sin(angle * 5 - 1.2);
  return 1.95 * Math.exp(-radius * radius * ridge) * (1 - smooth((radius - 2.05) / 0.4));
}

export function genLayout(localSeconds: number) {
  const beat = Math.min(14, Math.max(0, localSeconds / BEAT));
  const first = smooth(beat / 2);
  const second = smooth((beat - 2) / 2);
  const third = smooth((beat - 4) / 4);
  const warm = smooth((beat - 8) / 4);
  return {
    beat,
    angle: -0.5 + 0.24 * first + 0.34 * second + 0.38 * third + 0.08 * warm,
    distance: 16 - 1.8 * first + 1.1 * second - 1.3 * third,
    elevation: 6.8 + 0.6 * first - 0.9 * second + 1.1 * third,
    form: smooth(beat / 3),
    warm,
    roll: smooth((beat - 12) / 2),
  };
}

const HEIGHT_GLSL = `
float terrainHeight(vec2 positionXZ) {
  vec2 warped = vec2((positionXZ.x + 0.38 * sin(positionXZ.y * 0.6)) / 4.0, positionXZ.y / 2.7);
  float radius = length(warped);
  float angle = atan(warped.y, warped.x + 1e-8);
  float ridge = 1.0 + 0.14 * cos(angle * 3.0 + 0.6) + 0.08 * sin(angle * 5.0 - 1.2);
  return 1.95 * exp(-radius * radius * ridge) * (1.0 - smoothstep(2.05, 2.45, radius));
}
`;

const TERRAIN_VERTEX = `
${HEIGHT_GLSL}
uniform float uRoll;
varying vec3 vTerrain;
varying vec3 vNormal;
void main() {
  vec3 terrain = position;
  float height = terrainHeight(terrain.xz);
  float flatten = 1.0 - 0.3 * uRoll;
  terrain.y = height * flatten;
  float slopeX = (terrainHeight(terrain.xz + vec2(0.015, 0.0)) - terrainHeight(terrain.xz - vec2(0.015, 0.0))) / 0.03;
  float slopeZ = (terrainHeight(terrain.xz + vec2(0.0, 0.015)) - terrainHeight(terrain.xz - vec2(0.0, 0.015))) / 0.03;
  vTerrain = vec3(terrain.x, height, terrain.z);
  vNormal = normalize(vec3(-slopeX * flatten, 1.0, -slopeZ * flatten));
  vec4 projected = projectionMatrix * modelViewMatrix * vec4(terrain, 1.0);
  projected.xy += vec2(0.1, -0.3) * projected.w;
  gl_Position = projected;
}
`;

const TERRAIN_FRAGMENT = `
${GLSL_COMMON}
${GLSL_PALETTE}
uniform float uForm, uRoll, uWarm;
uniform vec3 uEye;
varying vec3 vTerrain;
varying vec3 vNormal;
void main() {
  float coverage = smoothstep(0.025, 0.12, vTerrain.y) * uForm * (1.0 - uRoll);
  if (coverage < 0.002) discard;
  vec3 normal = normalize(vNormal);
  vec3 light = normalize(vec3(-0.5, 0.7, -0.35));
  vec3 viewDirection = normalize(uEye - vTerrain);
  float diffuse = max(0.0, dot(normal, light));
  float rim = pow(1.0 - max(0.0, dot(normal, viewDirection)), 3.0);
  float backlight = max(0.0, dot(normal, normalize(vec3(0.4, 0.25, -0.9))));
  vec3 color = C_INK * (1.4 + 1.6 * diffuse);
  color += C_WALL * (0.018 + 0.055 * diffuse);
  color += C_PAPER * (0.012 * rim + 0.006 * backlight);
  gl_FragColor = vec4(color, coverage);
}
`;

const CONTOUR_VERTEX = `
uniform vec2 uViewport;
uniform float uForm, uRoll, uYouthPhase, uYouthStart;
attribute vec3 aNext;
attribute vec2 aYouth, aYouthNext;
attribute float aAlong, aNextAlong, aCurve, aSide;
varying float vLevel;
vec4 contourProjection(vec3 terrain, vec2 youth, float along) {
  float phase = along * 3.1 + aCurve * 0.9;
  youth.y += 0.13 * (sin(phase + uYouthPhase) - sin(phase + uYouthStart));
  vec4 projectedTerrain = projectionMatrix * modelViewMatrix * vec4(terrain, 1.0);
  projectedTerrain.xy += vec2(0.1, -0.3) * projectedTerrain.w;
  float angle = ((along + 1.15) / 2.3) * 6.28318530718;
  float radius = 0.8 + 0.22 * aCurve;
  float twist = (1.0 - uRoll) * 0.5 * sin(angle * 2.0 + aCurve * 0.35);
  vec3 ring = vec3(cos(angle + twist) * radius, sin(angle + twist) * radius, -9.0 + 0.25 * aCurve);
  vec4 projectedRing = projectionMatrix * vec4(ring, 1.0);
  projectedRing.xy += vec2(0.1, -0.3) * projectedRing.w;
  vec4 subject = mix(projectedTerrain, projectedRing, uRoll);
  subject.xy = mix(youth * subject.w, subject.xy, uForm);
  return subject;
}
void main() {
  vec4 current = contourProjection(position, aYouth, aAlong);
  vec4 next = contourProjection(aNext, aYouthNext, aNextAlong);
  vec2 tangent = (next.xy / next.w - current.xy / current.w) * uViewport;
  tangent /= max(length(tangent), 1e-5);
  vec2 perpendicular = vec2(-tangent.y, tangent.x);
  current.xy += perpendicular * aSide * 1.2 / uViewport * current.w;
  current.z -= 0.0003 * current.w;
  vLevel = aCurve / 8.0;
  gl_Position = current;
}
`;

const CONTOUR_FRAGMENT = `
${GLSL_PALETTE}
uniform float uForm, uWarm, uNight;
uniform vec2 uViewport;
varying float vLevel;
${GLSL_SKY_NIGHT}
void main() {
  vec3 contour = mix(C_PAPER * 0.68, C_GOLD * 0.85, 0.25 + 0.55 * uWarm);
  float night = skyNight(gl_FragCoord.y / uViewport.y, uNight);
  vec3 line = mix(C_INK, C_PAPER, step(0.8, night));
  vec3 color = mix(line, contour * (0.85 + 0.15 * vLevel), uForm);
  gl_FragColor = vec4(color, 0.82);
}
`;

function contourGeometry() {
  const positions: number[] = [];
  const nextPositions: number[] = [];
  const youths: number[] = [];
  const nextYouths: number[] = [];
  const alongs: number[] = [];
  const nextAlongs: number[] = [];
  const curves: number[] = [];
  const sides: number[] = [];
  const indices: number[] = [];
  const pointAt = (curve: number, sample: number): [number, number, number] => {
    const angle = sample / SAMPLES * Math.PI * 2;
    const height = 0.14 + 0.205 * curve;
    const ridge = 1 + 0.14 * Math.cos(angle * 3 + 0.6) + 0.08 * Math.sin(angle * 5 - 1.2);
    const radius = Math.sqrt(-Math.log(height / 1.95) / ridge);
    const depth = Math.sin(angle) * radius * 2.7;
    return [Math.cos(angle) * radius * 4 - 0.38 * Math.sin(depth * 0.6), height, depth];
  };
  for (let curve = 0; curve < CURVES; curve++) {
    const offset = positions.length / 3;
    for (let sample = 0; sample <= SAMPLES; sample++) {
      const along = sample / SAMPLES * 2.3 - 1.15;
      const nextAlong = (sample + 1) / SAMPLES * 2.3 - 1.15;
      const youth = youthCurve(curve, along, YOUTH_END);
      const nextYouth = youthCurve(curve, nextAlong, YOUTH_END);
      for (const side of [-1, 1]) {
        positions.push(...pointAt(curve, sample));
        nextPositions.push(...pointAt(curve, sample + 1));
        youths.push(...youth);
        nextYouths.push(...nextYouth);
        alongs.push(along);
        nextAlongs.push(nextAlong);
        curves.push(curve);
        sides.push(side);
      }
      if (sample < SAMPLES) {
        const base = offset + sample * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aNext', new THREE.Float32BufferAttribute(nextPositions, 3));
  geometry.setAttribute('aYouth', new THREE.Float32BufferAttribute(youths, 2));
  geometry.setAttribute('aYouthNext', new THREE.Float32BufferAttribute(nextYouths, 2));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(alongs, 1));
  geometry.setAttribute('aNextAlong', new THREE.Float32BufferAttribute(nextAlongs, 1));
  geometry.setAttribute('aCurve', new THREE.Float32BufferAttribute(curves, 1));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 1));
  geometry.setIndex(indices);
  return geometry;
}

export default class Gen implements Layer3D {
  private typography!: ReturnType<typeof createPosterTypography>;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private target!: THREE.WebGLRenderTarget;
  private copy!: FSPass;
  private terrain!: THREE.ShaderMaterial;
  private contours!: THREE.ShaderMaterial;
  private ink!: THREE.Color;
  private world = new THREE.Group();

  async init(_renderer: THREE.WebGLRenderer): Promise<void> {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, WIDTH / HEIGHT, 0.25, 9000);
    this.camera.userData.genWorldScale = GEN_WORLD_SCALE;
    this.target = makeRT(WIDTH, HEIGHT, { depth: true });
    this.ink = new THREE.Color().setRGB(...PALETTE.ink, THREE.LinearSRGBColorSpace);
    this.terrain = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERTEX,
      fragmentShader: TERRAIN_FRAGMENT,
      uniforms: {
        uForm: { value: 0 }, uRoll: { value: 0 }, uWarm: { value: 0 },
        uEye: { value: new THREE.Vector3() },
      },
      transparent: true,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(20, 13.5, 144, 96).rotateX(-Math.PI / 2), this.terrain);
    terrain.frustumCulled = false;
    this.world.position.copy(GEN_WORLD_ORIGIN);
    this.world.scale.setScalar(GEN_WORLD_SCALE);
    this.scene.add(this.world);
    this.world.add(terrain);
    this.contours = new THREE.ShaderMaterial({
      vertexShader: CONTOUR_VERTEX,
      fragmentShader: CONTOUR_FRAGMENT,
      uniforms: {
        uForm: { value: 0 }, uRoll: { value: 0 }, uWarm: { value: 0 },
        uYouthPhase: { value: YOUTH_END * 0.6 }, uYouthStart: { value: YOUTH_END * 0.6 },
        uNight: { value: 0 },
        uViewport: { value: new THREE.Vector2(this.target.width, this.target.height) },
      },
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const contours = new THREE.Mesh(contourGeometry(), this.contours);
    contours.frustumCulled = false;
    contours.renderOrder = 1;
    this.world.add(contours);
    this.typography = createPosterTypography('PURPLE MOUNTAIN', '紫金山', 4, 1, new THREE.Color().setRGB(...PALETTE.paper, THREE.LinearSRGBColorSpace), 0.52);
    placeUprightPoster(this.typography, this.backgroundCamera(frameAt(55.9)), 0, 0.63, 2400, 0.58);
    this.scene.add(this.typography);
    this.copy = new FSPass(`
      uniform sampler2D tIn;
      void main() { gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }
    `, { tIn: { value: this.target.texture } });
  }

  backgroundCamera(frame: Frame) {
    const layout = genLayout(frame.lt);
    const settle = smooth((layout.beat - 0.75) / 3.25);
    const aerial = youthGenAerial(40 + layout.beat);
    const terrainPosition = new THREE.Vector3(Math.sin(layout.angle) * layout.distance, layout.elevation, Math.cos(layout.angle) * layout.distance).multiplyScalar(GEN_WORLD_SCALE).add(GEN_WORLD_ORIGIN);
    const terrainTarget = new THREE.Vector3(0, 0.6, 0).multiplyScalar(GEN_WORLD_SCALE).add(GEN_WORLD_ORIGIN);
    this.camera.position.copy(aerial.position).lerp(terrainPosition, settle);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(aerial.target.lerp(terrainTarget, settle));
    this.camera.fov = 36 + 6 * settle;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    return this.camera.clone();
  }

  render(renderer: THREE.WebGLRenderer, frame: Frame, output: THREE.WebGLRenderTarget, context?: Layer3DContext): PostParams {
    const layout = genLayout(frame.lt);
    this.backgroundCamera(frame);
    this.typography.material.opacity = 0.52 * smooth(layout.beat / 2) * (1 - smooth((layout.beat - 12) / 2));
    for (const material of [this.terrain, this.contours]) {
      material.uniforms.uForm!.value = layout.form;
      material.uniforms.uRoll!.value = layout.roll;
      material.uniforms.uWarm!.value = layout.warm;
    }
    this.terrain.uniforms.uEye!.value.copy(this.camera.position).sub(GEN_WORLD_ORIGIN).divideScalar(GEN_WORLD_SCALE);
    this.contours.uniforms.uYouthPhase!.value = (YOUTH_END + layout.beat * BEAT) * 0.6;
    this.contours.uniforms.uNight!.value = youthGenNight(frame.t);
    this.contours.depthTest = layout.form > 0.999 && layout.roll < 0.001;
    this.scene.background = context?.poster ?? new THREE.Color().setRGB(...PALETTE.paper, THREE.LinearSRGBColorSpace).lerp(this.ink, youthGenNight(frame.t));
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.copy.render(renderer, output);
    return {
      exposure: 1, bloom: 0.16, bloomThreshold: 1.05, halation: 0.04,
      ca: 0, grain: 0.025, vignette: 0.16, zoom: 1,
      shake: [0, 0], flash: 0, fade: 0,
    };
  }
}
