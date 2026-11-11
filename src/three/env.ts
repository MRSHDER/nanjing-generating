// 三维共用：反射环境与材质库（负责人：Claude）。
// 柔光“摄影棚”环境：上方米白、下方墨黑的渐变球 + 两块限亮柔光板。
// 灯板亮度有上限：玻璃或釉面正对镜头时不会反射出整面爆白（物理材质测试中排查过）。
import * as THREE from 'three';
import { PALETTE } from '../engine/palette.glsl';

export const lin = (c: [number, number, number]) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);

export function softStudioScene(opts: { key?: number; rim?: number } = {}): THREE.Scene {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(10, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: lin(PALETTE.paper).multiplyScalar(1.1) },
        uBottom: { value: lin(PALETTE.ink) },
        uMid: { value: lin(PALETTE.wall).multiplyScalar(0.5) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader:
        'uniform vec3 uTop, uBottom, uMid; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(uMid, uTop, smoothstep(0.0, 0.8, y)) : mix(uMid, uBottom, smoothstep(0.0, 0.5, -y)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  env.add(sky);
  const panel = (w: number, h: number, intensity: number, pos: [number, number, number], tint: THREE.Color) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(6, 2.2, opts.key ?? 4.2, [-5, 5, 4], new THREE.Color(1, 1, 1)); // 左上主柔光
  panel(2, 6, opts.rim ?? 2.8, [6, 1, -2], lin(PALETTE.gold)); // 右侧暖色轮廓光
  return env;
}

/** 生成 PMREM 环境贴图（每个渲染器只需一次）。 */
export function softStudioEnv(r: THREE.WebGLRenderer, opts?: { key?: number; rim?: number }): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(r);
  const tex = pmrem.fromScene(softStudioScene(opts), 0.03).texture;
  pmrem.dispose();
  return tex;
}

/** 材质库（已在物理材质测试中验证）。 */
export const MATERIALS = {
  glass: () =>
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.09, transmission: 1, thickness: 1.1, ior: 1.62, dispersion: 0.12,
      clearcoat: 1, clearcoatRoughness: 0.04, attenuationColor: lin(PALETTE.paper), attenuationDistance: 8, specularIntensity: 1,
    }),
  redGlaze: () => new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.red), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
  wallGlaze: () => new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.wall), roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
  gold: () => new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.gold), metalness: 1, roughness: 0.22 }),
};
