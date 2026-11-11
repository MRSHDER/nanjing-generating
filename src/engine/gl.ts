// 渲染器与基础工具（负责人：Claude）。
// 逻辑尺寸固定 1920×1080；scale 控制实际像素（预览可用 0.5，导出用 1 或 2）。
// 所有渲染目标是线性 HDR（HalfFloat），色调映射与 sRGB 编码只在 Post.finish 里做一次。
import * as THREE from 'three';
import { GLSL_COMMON } from '../shaders/common.glsl';
import { GLSL_PALETTE } from './palette.glsl';

export const W = 1920;
export const H = 1080;
export let SCALE = 1;

export function createRenderer(canvas: HTMLCanvasElement, opts: { scale?: number } = {}) {
  SCALE = opts.scale ?? 1;
  const r = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true, // 逐帧取图需要
    powerPreference: 'high-performance',
  });
  r.setPixelRatio(1);
  r.setSize(W * SCALE, H * SCALE, false);
  r.outputColorSpace = THREE.LinearSRGBColorSpace; // sRGB 编码在 Post.finish 里手动做
  r.toneMapping = THREE.NoToneMapping;
  r.autoClear = true;
  return r;
}

export function makeRT(w = W, h = H, opts: { depth?: boolean; scaled?: boolean } = {}) {
  const s = opts.scaled === false ? 1 : SCALE;
  const rt = new THREE.WebGLRenderTarget(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: opts.depth ?? false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
  return rt;
}

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const sharedGeo = new THREE.BufferGeometry();
sharedGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
sharedGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const sharedCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * 全屏着色器 pass。片元着色器里可直接用 vUv、GLSL_COMMON、GLSL_PALETTE 中的函数与常量，
 * 写 gl_FragColor（线性 HDR）。
 */
export class FSPass {
  readonly material: THREE.ShaderMaterial;
  readonly u: Record<string, THREE.IUniform>;
  private scene = new THREE.Scene();

  constructor(frag: string, uniforms: Record<string, THREE.IUniform> = {}, opts: { blending?: THREE.Blending } = {}) {
    this.u = uniforms;
    this.material = new THREE.ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: `precision highp float;\n${GLSL_COMMON}\n${GLSL_PALETTE}\nvarying vec2 vUv;\n${frag}`,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: opts.blending ?? THREE.NoBlending,
      transparent: opts.blending !== undefined && opts.blending !== THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(sharedGeo, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null) {
    r.setRenderTarget(target);
    r.render(this.scene, sharedCam);
  }
}
