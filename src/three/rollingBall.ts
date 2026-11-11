import * as THREE from 'three';
import { BEAT } from '../engine/beat';
import { PALETTE } from '../engine/palette.glsl';
import { lin, MATERIALS } from './env';

export const BALL_RADIUS = 1.25;
export const BALL_ENTRY = { x: 2.6, floor: -2.2, z: 0 };
export const YOUTH_PORTAL_BEAT = 16; // 2026-10-17 Claude（用户 22:06：「是否可以在这个鼓点上就出现大桥？」）16.5 → 16，出隧道 = 43.333 秒重拍
export const YOUTH_PORTAL_X = BALL_ENTRY.x + 6 * YOUTH_PORTAL_BEAT * BEAT;
const smooth = (value: number) => {
  const progress = Math.max(0, Math.min(1, value));
  return progress * progress * (3 - 2 * progress);
};
const integral = (progress: number) => progress ** 3 - progress ** 4 / 2;

function rollingRoute(beat: number) {
  const time = Math.max(0, beat) * BEAT;
  const tunnelTime = YOUTH_PORTAL_BEAT * BEAT;
  if (time < tunnelTime) {
    const progress = time / tunnelTime;
    const horizontalSpeed = 4 + 4 * smooth(progress);
    return {
      x: BALL_ENTRY.x + 4 * time + 4 * tunnelTime * integral(progress),
      floor: BALL_ENTRY.floor, ground: BALL_ENTRY.floor, slope: 0, z: 0,
      speed: horizontalSpeed,
    };
  }
  const accelerationTime = 4 * BEAT;
  const elapsed = time - tunnelTime;
  const progress = Math.min(1, elapsed / accelerationTime);
  let distance = 8 * Math.min(elapsed, accelerationTime) + 67 * accelerationTime * integral(progress);
  let speed = 8 + 67 * smooth(progress);
  if (beat > YOUTH_PORTAL_BEAT + 4) distance += 75 * Math.min((beat - YOUTH_PORTAL_BEAT - 4) * BEAT, (32 - YOUTH_PORTAL_BEAT - 4) * BEAT);
  if (beat >= 32) {
    const brakingTime = 8 * BEAT;
    const braking = Math.min(1, (beat - 32) / 8);
    distance += 75 * braking * brakingTime - 55 * brakingTime * integral(braking);
    speed = 75 - 55 * smooth(braking);
    if (beat > 40) distance += (beat - 40) * BEAT * 20;
  }
  return { x: YOUTH_PORTAL_X + distance, floor: BALL_ENTRY.floor, ground: BALL_ENTRY.floor, slope: 0, z: 0, speed };
}

const routeStep = 0.025;
const routeDistances = [0];
for (let index = 1; index <= 1600; index++) {
  const before = rollingRoute((index - 1) * routeStep).speed;
  const middle = rollingRoute((index - 0.5) * routeStep).speed;
  const after = rollingRoute(index * routeStep).speed;
  routeDistances.push(routeDistances[index - 1]! + (before + 4 * middle + after) * routeStep * BEAT / 6);
}

export function rollingRoadFloor(_horizontal: number) {
  return BALL_ENTRY.floor;
}

export function rollingBallPose(beat: number) {
  const route = rollingRoute(beat);
  const sample = Math.max(0, Math.min(40, beat)) / routeStep;
  const index = Math.min(1599, Math.floor(sample));
  const distance = routeDistances[index]! + (routeDistances[index + 1]! - routeDistances[index]!) * (sample - index) + Math.max(0, beat - 40) * BEAT * 20;
  return {
    ...route, y: route.floor + BALL_RADIUS,
    distance, angle: -distance / BALL_RADIUS,
  };
}

/** 玻璃球的彩虹边光：轮廓处（菲涅尔）出现彩虹色，色相跟着球自身的朝向走——球一转 / 一滚，颜色就在边上流动（用户 23:19：「颜色变化很漂亮」）。正面透明，不依赖背景和灯光，仍是时间的纯函数。 */
export function rainbowRim(radius = BALL_RADIUS) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 96, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uOpacity: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vO;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vO = normal; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOpacity; varying vec3 vN; varying vec3 vV; varying vec3 vO;
      vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
      void main(){
        float facing = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        float rim = pow(1.0 - facing, 2.4);
        vec3 color = mix(vec3(1.0), hue(fract(rim * 1.3 + vO.x * 0.55 + vO.y * 0.35 + vO.z * 0.25)), 0.78);
        float alpha = smoothstep(0.02, 0.6, rim) * 0.72 * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }`,
  }));
  mesh.name = 'rainbow-rim';
  mesh.renderOrder = 2;
  return mesh;
}

export function createRollingBall() {
  const ball = new THREE.Group();
  ball.name = 'glass-protagonist';
  const material = MATERIALS.glass();
  // 2026-10-17 Claude（用户 22:48–22:50：「这个球没有彩色反光了」「整体配色不破坏，但除了这个球之外」）：
  // 全片米白 / 墨 / 红，唯独玻璃球保留彩色。用户 23:55：「玻璃球正常还是透明的，只有在有光照的环境下转动才会表现出彩虹」
  // → 不用画上去的彩虹边光，改为与开场同款的物理薄膜虹彩（参数对齐 10-14 02:09 原版，见 lock.ts）。
  material.dispersion = 4;
  material.iridescence = 1;
  material.iridescenceIOR = 2.0;
  material.iridescenceThicknessRange = [100, 560];
  material.thickness = 2.2;
  ball.add(new THREE.Mesh(new THREE.SphereGeometry(BALL_RADIUS, 96, 64), material));
  const points: number[] = [];
  const radius = BALL_RADIUS * 1.004;
  for (let latitude = -60; latitude <= 60; latitude += 30) {
    const phi = THREE.MathUtils.degToRad(latitude);
    for (let sample = 0; sample < 96; sample++) {
      for (const step of [sample, sample + 1]) {
        const angle = step / 96 * Math.PI * 2;
        points.push(radius * Math.cos(phi) * Math.cos(angle), radius * Math.sin(phi), radius * Math.cos(phi) * Math.sin(angle));
      }
    }
  }
  for (let longitude = 0; longitude < 180; longitude += 30) {
    const theta = THREE.MathUtils.degToRad(longitude);
    for (let sample = 0; sample < 96; sample++) {
      for (const step of [sample, sample + 1]) {
        const angle = step / 96 * Math.PI * 2;
        points.push(radius * Math.cos(angle) * Math.cos(theta), radius * Math.sin(angle), radius * Math.cos(angle) * Math.sin(theta));
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  ball.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: lin(PALETTE.ink), transparent: true, opacity: 0.32 })));
  // rainbowRim() 保留导出但不再挂到球上（用户 23:55 改为物理虹彩）
  return ball;
}

export function createBallShadow() {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(BALL_RADIUS * 0.86, 48),
    new THREE.MeshBasicMaterial({ color: lin(PALETTE.ink), transparent: true, opacity: 0.12, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  return shadow;
}
