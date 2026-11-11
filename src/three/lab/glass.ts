// 物理材质测试（Claude，实验用，不属于任何正式段落）。
// 玻璃质感的立体“南京”二字 + 几块釉面城墙砖，浮在一张米白海报前，折射海报上的大字与红色圆。
// - 字形：从 Noto Sans SC Black 的字体轮廓挤出厚度并倒圆角（three.js 自带的字体解析，无新依赖）
// - 材质：MeshPhysicalMaterial：透射（折射背景）、厚度、折射率、色散（边缘彩虹）、清漆高光
// - 海报：占位用的 Canvas 平面；正式片中换成 Codex 提供的二维层画布
import * as THREE from 'three';
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import '@fontsource/noto-sans-sc/900.css';
import fontUrl from '@fontsource/noto-sans-sc/files/noto-sans-sc-117-900-normal.woff?url';
import { FSPass, makeRT, W, H } from '../../engine/gl';
import { PALETTE } from '../../engine/palette.glsl';
import type { Frame } from '../../engine/beat';
import type { PostParams } from '../../engine/post';
import type { Layer3D } from '../index';
import { lin, softStudioEnv } from '../env';


/** 占位海报：米白底、细网格、超大黑色数字、红色圆。 */
function drawPoster(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#EEE9DF';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(138,135,128,0.35)';
  c.lineWidth = 1;
  for (let x = 0; x <= W; x += 80) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, H); c.stroke(); }
  for (let y = 0; y <= H; y += 80) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(W, y + 0.5); c.stroke(); }
  c.fillStyle = '#E2382B';
  c.beginPath();
  c.arc(1180, 560, 330, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#0A0A0B';
  c.font = '900 380px "Noto Sans SC"';
  c.textBaseline = 'alphabetic';
  c.fillText('32.06', -30, 380);
  c.font = '900 120px "Noto Sans SC"';
  c.fillText('118.79°E', 1180, 1030);
  c.fillRect(0, 720, 760, 70);
  c.fillRect(1560, 120, 240, 24);
  c.font = '500 30px "Noto Sans SC"';
  c.fillText('NANJING / 32.0603 N 118.7969 E', 96, 860);
  return cv;
}

export default class GlassLab implements Layer3D {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
  private rt = makeRT(W, H, { depth: true });
  private copy = new FSPass(`uniform sampler2D tIn; void main(){ gl_FragColor = vec4(texture2D(tIn, vUv).rgb, 1.0); }`, { tIn: { value: null } });
  private word = new THREE.Group();
  private bricks: { mesh: THREE.Mesh; base: THREE.Vector3 }[] = [];

  async init(r: THREE.WebGLRenderer) {
    this.rt.samples = 4; // 多重采样抗锯齿

    // 环境光照：程序生成的“房间”环境，用于反射与高光
    this.scene.environment = softStudioEnv(r);
    this.scene.environmentIntensity = 1;
    const key = new THREE.DirectionalLight(0xffffff, 0.7); // 太强会在平整的玻璃面上反射出一团爆白
    key.position.set(-3, 4, 5);
    this.scene.add(key);

    // 海报平面（不受光照，颜色与二维层一致）
    await document.fonts.load('900 100px "Noto Sans SC"', '32.06°E南京');
    const tex = new THREE.CanvasTexture(drawPoster());
    tex.colorSpace = THREE.SRGBColorSpace;
    const dist = 9;
    const ph = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (dist + 6);
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(ph * (W / H), ph), new THREE.MeshBasicMaterial({ map: tex }));
    poster.position.z = -dist;
    this.scene.add(poster);
    this.camera.position.set(0, 0, 6);

    // 字形 → 立体
    const buf = await (await fetch(fontUrl)).arrayBuffer();
    const font = new Font(new TTFLoader().parse(buf));
    const shapes = font.generateShapes('南京', 1);
    const geo = new THREE.ExtrudeGeometry(shapes, {
      depth: 0.12,
      curveSegments: 10,
      bevelEnabled: true,
      bevelThickness: 0.11, // 厚而圆的倒角：更像“充气”的软糖 / 玻璃
      bevelSize: 0.03,
      bevelSegments: 10,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
    geo.computeVertexNormals();

    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.09,
      transmission: 1,
      thickness: 1.1, // 越厚，背景被弯折得越明显
      ior: 1.62,
      dispersion: 6, // 色散：边缘出现彩虹色
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      attenuationColor: lin(PALETTE.paper),
      attenuationDistance: 8, // 几乎无色的透明玻璃
      specularIntensity: 1,
    });
    const mesh = new THREE.Mesh(geo, glass);
    mesh.scale.setScalar(1.18);
    this.word.add(mesh);
    this.scene.add(this.word);

    // 釉面城墙砖（为“城墙爆发”段试质感）
    const brickGeo = new RoundedBoxGeometry(0.72, 0.34, 0.34, 4, 0.06);
    const red = new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.red), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
    const wall = new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.wall), roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const gold = new THREE.MeshPhysicalMaterial({ color: lin(PALETTE.gold), metalness: 1, roughness: 0.22 });
    const spots: [number, number, number, THREE.Material][] = [
      [-2.6, -1.25, -1.2, red],
      [2.7, 1.2, -1.6, wall],
      [2.2, -1.45, 0.4, gold],
      [-2.2, 1.4, 0.2, red],
    ];
    for (const [x, y, z, m] of spots) {
      const b = new THREE.Mesh(brickGeo, m);
      b.position.set(x, y, z);
      this.bricks.push({ mesh: b, base: new THREE.Vector3(x, y, z) });
      this.scene.add(b);
    }
  }

  render(r: THREE.WebGLRenderer, f: Frame, out: THREE.WebGLRenderTarget): PostParams {
    const t = f.t;
    this.word.rotation.set(-0.18 + 0.08 * Math.sin(t * 0.9), 0.42 * Math.sin(t * 0.55), 0.04 * Math.sin(t * 0.7));
    this.word.position.y = 0.06 * Math.sin(t * 1.3);
    // 只由时间 t 决定（修正：原先 position.y += … 会随渲染次数累积）
    this.bricks.forEach(({ mesh, base }, i) => {
      mesh.rotation.set(t * (0.3 + 0.1 * i), t * (0.45 - 0.07 * i), 0.2 * i);
      mesh.position.set(base.x, base.y + 0.06 * Math.sin(t * 2 + i), base.z);
    });
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.scene, this.camera);
    this.copy.u.tIn!.value = this.rt.texture;
    this.copy.render(r, out);
    return { bloom: 0.3, bloomThreshold: 1.4, halation: 0.05, ca: 0.1, grain: 0.03, vignette: 0.15 };
  }
}
