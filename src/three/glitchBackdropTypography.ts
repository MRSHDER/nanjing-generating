import * as THREE from 'three';
import { FSPass, makeRT } from '../engine/gl';
import { createPosterTypography } from './posterTypography';
import { createWutongPoster } from './wutongPoster';
import { lin } from './env';
import { PALETTE } from '../engine/palette.glsl';

export class GlitchBackdropTypography {
  private scene = new THREE.Scene();
  private wutong = createWutongPoster('glitch', lin(PALETTE.ink));
  private lanterns = createPosterTypography('QINHUAI RIVER', '秦淮河 · 夫子庙', 4.6, 1.15, lin(PALETTE.ink), 0.43); // 2026-10-17 Claude：7.8 宽两侧被街两边的墙挡住、「秦」字看不到（用户 22:29），缩到街口宽度以内
  private letters = makeRT(undefined, undefined, { depth: true });
  private base = makeRT();
  private copy = new FSPass('uniform sampler2D tInput; void main(){gl_FragColor=texture2D(tInput,vUv);}', { tInput: { value: null } });
  private composite = new FSPass(`
    uniform sampler2D tBase, tLetters, tSceneDepth, tLetterDepth;
    void main() {
      vec4 letters = texture2D(tLetters, vUv);
      float visible = step(texture2D(tLetterDepth, vUv).r - 0.000001, texture2D(tSceneDepth, vUv).r);
      vec3 ink = letters.rgb / max(letters.a, 0.0001);
      gl_FragColor = vec4(mix(texture2D(tBase, vUv).rgb, ink, letters.a * visible), 1.0);
    }
  `, { tBase: { value: null }, tLetters: { value: null }, tSceneDepth: { value: null }, tLetterDepth: { value: null } });

  constructor() {
    this.letters.depthTexture = new THREE.DepthTexture(this.letters.width, this.letters.height, THREE.UnsignedIntType);
    this.lanterns.position.set(0, -1.1, -8);
    for (const mesh of [this.wutong, this.lanterns]) {
      mesh.material.depthWrite = true;
      mesh.material.alphaTest = 0.01;
      this.scene.add(mesh);
    }
  }

  render(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, output: THREE.WebGLRenderTarget, depth: THREE.DepthTexture, solids: THREE.Group[]) {
    this.wutong.visible = solids[4]!.visible;
    this.lanterns.visible = solids[3]!.visible;
    if (!this.wutong.visible && !this.lanterns.visible) return;
    const clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
    const target = renderer.getRenderTarget();
    try {
      this.copy.u.tInput!.value = output.texture;
      this.copy.render(renderer, this.base);
      renderer.setRenderTarget(this.letters); renderer.setClearColor(0, 0); renderer.clear();
      renderer.render(this.scene, camera);
      const uniforms = this.composite.u;
      uniforms.tBase!.value = this.base.texture; uniforms.tLetters!.value = this.letters.texture;
      uniforms.tSceneDepth!.value = depth; uniforms.tLetterDepth!.value = this.letters.depthTexture;
      this.composite.render(renderer, output);
    } finally {
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.setRenderTarget(target);
    }
  }
}
