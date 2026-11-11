// 玻璃立体字（负责人：Claude）。从 lab/glass.ts 的“南京”实验提炼成共用模块；lab/glass.ts 本身保持不动（用户点名保留）。
// 字形：Noto Sans SC Black 的字体轮廓，挤出厚度并倒圆角（three.js 自带字体解析，无新依赖）；
// 材质：MeshPhysicalMaterial 透射 + 色散 + 清漆，折射身后的画面（同镜头的二维背景板）。
// 字体文件按 Unicode 分段打包，一个分段只含部分汉字：逐字在下面几个分段里找字形，再按字宽排版。
// 新增文字时，若某字不在这些分段里，控制台会报出缺字，把含该字的分段加到 FONT_FILES 即可。
import * as THREE from 'three';
import { TTFLoader } from 'three/examples/jsm/loaders/TTFLoader.js';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import f117 from '@fontsource/noto-sans-sc/files/noto-sans-sc-117-900-normal.woff?url'; // 南 京
import f116 from '@fontsource/noto-sans-sc/files/noto-sans-sc-116-900-normal.woff?url'; // 双 向
import f110 from '@fontsource/noto-sans-sc/files/noto-sans-sc-110-900-normal.woff?url'; // 奔
import f108 from '@fontsource/noto-sans-sc/files/noto-sans-sc-108-900-normal.woff?url'; // 赴
import { MATERIALS } from './env';
import { GLSL_PALETTE } from '../engine/palette.glsl';

const FONT_FILES = [f117, f116, f110, f108];

let fontsPromise: Promise<Font[]> | null = null;
function loadFonts() {
  fontsPromise ??= Promise.all(FONT_FILES.map((u) => fetch(u).then((r) => r.arrayBuffer()).then((buf) => new Font(new TTFLoader().parse(buf)))));
  return fontsPromise;
}

interface FontData { resolution: number; glyphs: Record<string, { ha: number } | undefined> }

/** 生成居中的玻璃立体字（字高约 1）。返回的网格可直接加入场景。 */
export async function createGlassText(text: string, opts: { depth?: number; bevel?: number; spacing?: number } = {}): Promise<THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshPhysicalMaterial>> {
  const fonts = await loadFonts();
  const shapes: THREE.Shape[] = [];
  let x = 0;
  for (const ch of text) {
    const font = fonts.find((f) => (f.data as unknown as FontData).glyphs[ch]);
    if (!font) { console.error(`glassText: 字体分段里没有「${ch}」`); continue; }
    const data = font.data as unknown as FontData;
    for (const s of font.generateShapes(ch, 1)) {
      // 平移这个字的轮廓到排版位置
      s.getPoints(); // 确保曲线已建立
      const moved = new THREE.Shape();
      moved.curves = s.curves.map((c) => { const k = c.clone(); shiftCurve(k, x); return k; });
      moved.holes = s.holes.map((h) => { const p = new THREE.Path(); p.curves = h.curves.map((c) => { const k = c.clone(); shiftCurve(k, x); return k; }); return p; });
      shapes.push(moved);
    }
    x += (data.glyphs[ch]!.ha / data.resolution) * (opts.spacing ?? 1);
  }
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: opts.depth ?? 0.12,
    curveSegments: 10,
    bevelEnabled: true,
    bevelThickness: opts.bevel ?? 0.11, // 厚而圆的倒角：像“充气”的软糖 / 玻璃（与实验一致）
    bevelSize: 0.03,
    bevelSegments: 10,
  });
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -(bb.min.z + bb.max.z) / 2);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, MATERIALS.glass());
}

function shiftCurve(c: THREE.Curve<THREE.Vector2>, dx: number) {
  for (const key of ['v0', 'v1', 'v2', 'v3', 'aX'] as const) {
    const p = (c as unknown as Record<string, unknown>)[key];
    if (p instanceof THREE.Vector2) p.x += dx;
    else if (key === 'aX' && typeof p === 'number') (c as unknown as Record<string, number>).aX = p + dx;
  }
}

/**
 * 屏幕空间折射的玻璃材质：先把身后的画面（含背景板、光束、冲击环这类叠加发光物体）渲染好，再用法线偏移采样它。
 * 内置透射材质只折射不透明物体，暗场里光束等发光体不会出现在玻璃里，所以高潮段用这个版本。
 * 用法：tBg 设为“不含玻璃字的这一帧”；分 R/G/B 三次采样做色散；边缘用菲涅尔混入柔光棚反射，保证暗底上字形可读。
 */
export function glassRefractMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { tBg: { value: null }, uStrength: { value: 0.1 }, uDisp: { value: 0.003 }, uGlow: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec4 vClip;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        vClip = gl_Position;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_PALETTE}
      uniform sampler2D tBg; uniform float uStrength, uDisp, uGlow;
      varying vec3 vN; varying vec3 vV; varying vec4 vClip;
      void main() {
        vec2 uv = vClip.xy / vClip.w * 0.5 + 0.5;
        vec3 n = normalize(vN);
        if (!gl_FrontFacing) n = -n;
        float ndv = max(dot(n, vV), 0.0);
        float fres = pow(1.0 - ndv, 2.6);
        vec2 off = n.xy * uStrength * (0.6 + 0.8 * (1.0 - ndv));
        vec3 refr = vec3(
          texture2D(tBg, uv - off * (1.0 - uDisp)).r,
          texture2D(tBg, uv - off).g,
          texture2D(tBg, uv - off * (1.0 + uDisp)).b);
        // 柔光棚反射（与 env.ts 的限亮柔光环境同一布光：左上主光、右侧暖色轮廓光）
        vec3 R = reflect(-vV, n);
        float sky = smoothstep(-0.1, 0.9, R.y);
        float key = pow(max(dot(R, normalize(vec3(-0.55, 0.6, 0.55))), 0.0), 22.0);
        float key2 = pow(max(dot(R, normalize(vec3(0.3, 0.75, 0.6))), 0.0), 60.0);
        float rim = pow(max(dot(R, normalize(vec3(0.85, 0.1, -0.1))), 0.0), 10.0);
        vec3 refl = C_PAPER * 0.3 * sky + vec3(1.0) * (key * 3.2 + key2 * 2.0) + C_GOLD * rim * 2.0;
        // 正面几乎全透（暗底上像真玻璃），倒角和边缘接住高光，字形靠亮边读出来
        vec3 col = mix(refr, refl, clamp(fres * 1.2, 0.0, 1.0)) + refl * 0.22 + C_PAPER * 0.006;
        col += (C_GOLD * 0.6 + C_RED * 0.4) * uGlow * (0.3 + fres);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
