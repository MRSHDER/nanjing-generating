import * as THREE from 'three';
import { BEAT, sectionRange } from '../engine/beat';
import { GLSL_PALETTE } from '../engine/palette.glsl';
import { rollingBallPose } from './rollingBall';
import { GLSL_SKY_NIGHT } from '../engine/transition.glsl';

export const YOUTH_GEN_BOUNDARY = sectionRange('gen').start;
export const GEN_WORLD_SCALE = 60;
const youthStart = sectionRange('youth').start;
const youthEndBeat = (YOUTH_GEN_BOUNDARY - youthStart) / BEAT;
const endPose = rollingBallPose(youthEndBeat);
export const GEN_WORLD_ORIGIN = new THREE.Vector3(endPose.x, endPose.y, endPose.z);

export function youthGenSmooth(value: number): number {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
}

// 2026-10-18 Claude（用户 01:42：53 秒白天→夜晚这段过渡希望长一点）：
// 入夜从 1 拍拉长到 4 拍（52.5–54.2 秒，以 53.333 秒重拍为中点）；起伏线条提前 3 拍开始长出来，在重拍上长满。
export function youthGenNight(time: number): number {
  return youthGenSmooth((time - YOUTH_GEN_BOUNDARY) / BEAT / 4 + 0.5);
}

export function youthGenLine(time: number): number {
  return youthGenSmooth((time - YOUTH_GEN_BOUNDARY) / BEAT / 3 + 1);
}

export function youthGenAerial(beat: number) {
  const pose = rollingBallPose(beat);
  const localBeat = beat - 32;
  const lift = youthGenSmooth((beat - 36) / 6);
  return {
    position: new THREE.Vector3(
      pose.x - 48 - 24 * localBeat * (1 - 0.8 * lift),
      pose.y + 32 + 16 * localBeat + 180 * lift,
      pose.z + 70 + 25 * localBeat * (1 - 0.8 * lift),
    ),
    target: new THREE.Vector3(pose.x, pose.y, pose.z),
  };
}

export function genBackdropCamera(camera: THREE.PerspectiveCamera): THREE.PerspectiveCamera {
  if (camera.userData.genWorldScale !== GEN_WORLD_SCALE) return camera;
  const local = camera.clone();
  local.position.sub(GEN_WORLD_ORIGIN).divideScalar(GEN_WORLD_SCALE);
  local.near /= GEN_WORLD_SCALE;
  local.far /= GEN_WORLD_SCALE;
  local.updateProjectionMatrix();
  local.updateMatrixWorld(true);
  return local;
}

export function createYouthGenLines(width: number, height: number) {
  const samples = 160;
  const positions: number[] = [];
  const nextPositions: number[] = [];
  const sides: number[] = [];
  const indices: number[] = [];
  for (let curve = 0; curve < 9; curve++) {
    const offset = positions.length / 3;
    for (let sample = 0; sample <= samples; sample++) {
      const along = sample / samples * 2.3 - 1.15;
      const nextAlong = (sample + 1) / samples * 2.3 - 1.15;
      for (const side of [-1, 1]) {
        positions.push(along, curve, 0);
        nextPositions.push(nextAlong, curve, 0);
        sides.push(side);
      }
      if (sample < samples) {
        const base = offset + sample * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aNext', new THREE.Float32BufferAttribute(nextPositions, 3));
  geometry.setAttribute('aSide', new THREE.Float32BufferAttribute(sides, 1));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uLine: { value: 0 }, uNight: { value: 0 }, uViewport: { value: new THREE.Vector2(width, height) } },
    vertexShader: `
      uniform float uTime;
      uniform vec2 uViewport;
      attribute vec3 aNext;
      attribute float aSide;
      vec2 curvePoint(vec3 samplePoint) {
        float along = samplePoint.x, curve = samplePoint.y;
        return vec2(along, (curve - 4.0) / 4.0 * 0.78
          + 0.13 * sin(along * 3.1 + curve * 0.9 + uTime * 0.6)
          + 0.05 * sin(along * 7.3 - curve * 1.7));
      }
      void main() {
        vec2 current = curvePoint(position), next = curvePoint(aNext);
        vec2 tangent = (next - current) * uViewport;
        tangent /= max(length(tangent), 1e-5);
        current += vec2(-tangent.y, tangent.x) * aSide * 1.2 / uViewport;
        gl_Position = vec4(current, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      ${GLSL_PALETTE}
      uniform float uLine, uNight;
      uniform vec2 uViewport;
      ${GLSL_SKY_NIGHT}
      void main() {
        float night = skyNight(gl_FragCoord.y / uViewport.y, uNight);
        vec3 ink = mix(C_INK, C_PAPER, step(0.8, night));
        gl_FragColor = vec4(ink, 0.95 * uLine);
      }
    `,
    transparent: true,
    toneMapped: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}
