// 段落 4「数据故障」的实体场景（负责人：Claude，2026-10-13 用户要求四个南京场景改用建模）。
// 尺寸、位置与 glitch.ts 里同名场景的结构线完全一致（同一单位、同一地面高度 G），
// 这样闪屏时的"算法视觉"结构线正好压在实体模型的边上。
// 渲染风格沿用青年段的"纸上白描"：实体只提供法线 / 深度 / 淡彩，墨线由 glitch.ts 的白描合成画出。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../engine/palette.glsl';
import { lin } from './env';
import { getWutongModel } from './wutongModel';

type V = [number, number, number];
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------- 材质（颜色只决定白描里的淡彩色相与深浅） ----------
const mat = (c: THREE.Color, rough = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 });
const M = {
  stone: () => mat(lin(PALETTE.paper).multiplyScalar(0.92)),
  white: () => mat(lin(PALETTE.paper)),
  steel: () => mat(lin(PALETTE.wall).multiplyScalar(0.9), 0.6),
  tile: () => mat(lin(PALETTE.ink).multiplyScalar(5)), // 黛瓦：深灰，淡彩里压得最重
  ink: () => mat(lin(PALETTE.ink)),
  red: () => mat(lin(PALETTE.red), 0.5),
  gold: () => mat(lin(PALETTE.gold), 0.5),
  green: () => mat(lin(PALETTE.plane), 0.9),
  blue: () => mat(lin(PALETTE.wall).multiplyScalar(0.65), 0.6),
  road: () => mat(lin(PALETTE.wall).multiplyScalar(0.55)),
};

// ---------- 几何工具 ----------
/** 轴对齐盒子：x0..x1, y0..y1, z0..z1。 */
function boxG(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  return g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}
/** 从 a 到 b 的方截面杆件（t × t）。 */
function beamG(a: V, b: V, t: number, t2 = t): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A), len = d.length();
  const g = new THREE.BoxGeometry(len, t, t2);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  return g.applyQuaternion(q).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}
/** 从 a 到 b 的圆截面杆件（树枝、灯杆），r0 起点半径、r1 终点半径。 */
function rodG(a: V, b: V, r0: number, r1: number, seg = 6): THREE.BufferGeometry {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return g.applyQuaternion(q).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
}
/** 把同材质的几何合并成一个网格（减少绘制次数）。 */
function mesh(geos: THREE.BufferGeometry[], m: THREE.Material): THREE.Mesh {
  const flat = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  flat.forEach((g) => { g.deleteAttribute('uv'); if (!g.attributes.normal) g.computeVertexNormals(); });
  const mm = new THREE.Mesh(mergeGeometries(flat, false)!, m);
  mm.frustumCulled = false;
  return mm;
}

// ---------- 南京长江大桥（与 bridgeShape 同尺寸：桁架 x ±10，上弦 0.2、下弦 -0.8，桁面 z ±0.7） ----------
export function buildBridge(G: number): THREE.Group {
  const g = new THREE.Group();
  const top = 0.2, bot = -0.8, L = 10;
  const steel: THREE.BufferGeometry[] = [], white: THREE.BufferGeometry[] = [], stone: THREE.BufferGeometry[] = [];
  const red: THREE.BufferGeometry[] = [], ink: THREE.BufferGeometry[] = [];
  for (const z of [-0.7, 0.7]) {
    steel.push(beamG([-L, top, z], [L, top, z], 0.12), beamG([-L, bot, z], [L, bot, z], 0.12));
    for (let x = -L; x < L; x += 1) {
      steel.push(beamG([x, bot, z], [x, top, z], 0.07));
      const up = (x + L) % 2 === 1;
      steel.push(beamG(up ? [x, top, z] : [x, bot, z], up ? [x + 1, bot, z] : [x + 1, top, z], 0.07));
    }
  }
  // 上层公路桥面（含人行道栏杆）、下层铁路桥面
  stone.push(boxG(-L - 0.2, L + 0.2, top + 0.01, top + 0.11, -0.95, 0.95));
  for (const z of [-0.93, 0.93]) white.push(boxG(-L, L, top + 0.11, top + 0.24, z - 0.02, z + 0.02));
  steel.push(boxG(-L, L, bot - 0.05, bot + 0.03, -0.7, 0.7));
  // 玉兰花灯：灯杆 + 横担 + 两盏灯
  for (let x = -L + 1; x < L; x += 2) for (const z of [-0.8, 0.8]) {
    ink.push(rodG([x, top + 0.11, z], [x, top + 0.75, z], 0.022, 0.016));
    ink.push(beamG([x - 0.12, top + 0.75, z], [x + 0.12, top + 0.75, z], 0.02));
    for (const dx of [-0.12, 0.12]) white.push(new THREE.SphereGeometry(0.05, 8, 6).translate(x + dx, top + 0.79, z));
  }
  // 桥墩（圆端形，墩顶小帽）
  for (const x of [-8, -4, 0, 4, 8]) {
    const pier = new THREE.CylinderGeometry(0.35, 0.42, bot - G, 12, 1).scale(1, 1, 2.6).translate(x, (G + bot) / 2, 0);
    stone.push(pier, boxG(x - 0.45, x + 0.45, bot - 0.12, bot - 0.02, -1.05, 1.05));
  }
  // 引桥：桥头堡以外接一段混凝土引桥
  for (const s of [-1, 1]) {
    stone.push(boxG(s * (L + 1.3), s * (L + 26), top + 0.01, top + 0.11, -0.95, 0.95));
    for (let k = 0; k < 10; k++) { const x = s * (L + 2.5 + k * 2.4); stone.push(boxG(x - 0.12, x + 0.12, G, top, -0.5, 0.5)); }
  }
  // 大桥头堡 + 三面红旗
  for (const cx of [-L - 0.7, L + 0.7]) {
    white.push(boxG(cx - 0.6, cx + 0.6, G, 2.4, -1, 1));
    white.push(boxG(cx - 0.7, cx + 0.7, 2.25, 2.4, -1.1, 1.1));
    for (const y of [0.2, 1.3]) ink.push(boxG(cx - 0.45, cx + 0.45, y - 0.08, y + 0.08, 1.0, 1.02));
    for (const dx of [-0.38, 0, 0.38]) {
      stone.push(rodG([cx + dx, 2.4, 0], [cx + dx, 3.25, 0], 0.035, 0.03));
      const sh = new THREE.Shape([new THREE.Vector2(0, 3.25), new THREE.Vector2(0.42, 3.12), new THREE.Vector2(0.36, 2.96), new THREE.Vector2(0, 2.98)]);
      red.push(new THREE.ExtrudeGeometry(sh, { depth: 0.07, bevelEnabled: false }).translate(cx + dx, 0, -0.035));
    }
  }
  g.add(mesh(steel, M.steel()), mesh(white, M.white()), mesh(stone, M.stone()), mesh(red, M.red()), mesh(ink, M.ink()));
  // 江面
  const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2).translate(0, G, -40), new THREE.MeshBasicMaterial({ color: lin(PALETTE.wall).multiplyScalar(0.45) }));
  water.frustumCulled = false;
  g.add(water);
  return g;
}

// ---------- 中山陵（与 stepsShape 同尺寸：30 级台阶，每级 0.16 × 0.42，宽 ±3） ----------
export function buildMausoleum(G: number): THREE.Group {
  const g = new THREE.Group();
  const n = 30, rise = 0.16, run = 0.42, z0 = 1.5, hw = 3;
  const stone: THREE.BufferGeometry[] = [], white: THREE.BufferGeometry[] = [], ink: THREE.BufferGeometry[] = [];
  const red: THREE.BufferGeometry[] = [], green: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) stone.push(boxG(-hw, hw, G, G + (i + 1) * rise, z0 - (i + 1) * run, z0 - i * run));
  const yTop = G + n * rise, zTop = z0 - n * run;
  // 两侧栏杆（随台阶斜上）
  for (const s of [-1, 1]) {
    const x = s * (hw + 0.3);
    white.push(beamG([x, G + 0.25, z0], [x, yTop + 0.25, zTop], 0.5, 0.18));
    for (let i = 0; i <= n; i += 5) white.push(boxG(x - 0.12, x + 0.12, G + i * rise, G + i * rise + 0.62, z0 - i * run - 0.12, z0 - i * run + 0.12));
  }
  // 平台与祭堂
  const zb0 = zTop - 0.6, zb1 = zTop - 3, y1 = yTop + 1.7, ridge = y1 + 0.95, zm = (zb0 + zb1) / 2;
  stone.push(boxG(-4.2, 4.2, G, yTop, zTop + 0.01, zb1 - 1.2));
  white.push(boxG(-3.2, 3.2, yTop, y1, zb1, zb0));
  white.push(boxG(-3.5, 3.5, y1 - 0.12, y1, zb1 - 0.25, zb0 + 0.25)); // 檐下额枋
  // 歇山顶（蓝色琉璃瓦）：前后两个梯形坡面 + 两侧三角坡面
  const E1: V = [-3.9, y1, zb0 + 0.4], E2: V = [3.9, y1, zb0 + 0.4], E3: V = [3.9, y1, zb1 - 0.4], E4: V = [-3.9, y1, zb1 - 0.4];
  const R1: V = [-2.2, ridge, zm], R2: V = [2.2, ridge, zm];
  const tri = (a: V, b: V, c: V) => [...a, ...b, ...c];
  const roofPos = [...tri(E1, E2, R2), ...tri(E1, R2, R1), ...tri(E3, E4, R1), ...tri(E3, R1, R2), ...tri(E4, E1, R1), ...tri(E2, E3, R2)];
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3));
  roof.computeVertexNormals();
  const roofMesh = new THREE.Mesh(roof, M.blue());
  (roofMesh.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  roofMesh.frustumCulled = false;
  ink.push(beamG([-2.3, ridge, zm], [2.3, ridge, zm], 0.12)); // 正脊
  // 三个拱门（中门红色门框）
  for (const dx of [-1.6, 0, 1.6]) {
    ink.push(boxG(dx - 0.35, dx + 0.35, yTop, yTop + 1.1, zb0, zb0 + 0.03));
    if (dx === 0) red.push(boxG(dx - 0.42, dx + 0.42, yTop + 1.1, yTop + 1.2, zb0, zb0 + 0.05));
  }
  // 台阶两侧的松柏
  for (const s of [-1, 1]) for (let k = 0; k < 7; k++) {
    const i = 2 + k * 4, x = s * (hw + 1.1 + hash(k + s) * 0.8), y = G + i * rise, z = z0 - i * run;
    green.push(new THREE.ConeGeometry(0.42, 1.5, 7, 1, true).translate(x, y + 0.75, z));
  }
  g.add(mesh(stone, M.stone()), mesh(white, M.white()), mesh(ink, M.ink()), mesh(red, M.red()), mesh(green, M.green()), roofMesh);
  return g;
}

// ---------- 秦淮河（与 qinhuaiShape 同尺寸：河宽 ±3，两岸各 9 栋，灯笼串 6 道） ----------
export function buildQinhuai(G: number): THREE.Group {
  const g = new THREE.Group();
  const W2 = 3;
  const white: THREE.BufferGeometry[] = [], tile: THREE.BufferGeometry[] = [], stone: THREE.BufferGeometry[] = [];
  const red: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], ink: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    stone.push(boxG(s * W2, s * (W2 + 0.45), G - 0.2, G + 0.2, 5, -34)); // 驳岸
    for (let j = 0; j < 9; j++) {
      const za = 3.5 - j * 3.8, zb = za - 3.3, h = 1.3 + 0.6 * hash(j * 7 + s * 3), x = s * (W2 + 0.4), yt = G + 0.2 + h;
      const xo = x + s * 2.0; // 房子向岸里的进深
      white.push(boxG(x, xo, G + 0.2, yt, zb, za));
      // 双坡屋面：靠河一坡（挑檐伸出墙面 0.15）、背河一坡
      const roofA = beamG([x - s * 0.15, yt + 0.02, (za + zb) / 2], [x + s * 1.0, yt + 0.6, (za + zb) / 2], 0.06, za - zb - 0.4);
      const roofB = beamG([x + s * 1.0, yt + 0.6, (za + zb) / 2], [xo + s * 0.1, yt + 0.02, (za + zb) / 2], 0.06, za - zb - 0.4);
      tile.push(roofA, roofB);
      // 马头墙：山墙一级级升高，每级顶上压一道黛瓦
      const st = 0.32;
      for (const z of [za, zb]) {
        const steps: [number, number, number][] = [[0, 2.0, yt + st], [0.35, 1.65, yt + 2 * st], [0.7, 1.3, yt + 3 * st]];
        for (const [a, b2, yy] of steps) {
          white.push(boxG(x + s * a, x + s * b2, G + 0.2, yy, z - 0.06, z + 0.06));
          tile.push(boxG(x + s * (a - 0.06), x + s * (b2 + 0.06), yy, yy + 0.07, z - 0.1, z + 0.1));
        }
      }
      // 临河的窗（暖光）
      const wz = (za + zb) / 2;
      gold.push(boxG(x - s * 0.02, x, G + 0.9, G + 1.35, wz - 0.35, wz + 0.35));
      ink.push(boxG(x - s * 0.03, x, G + 0.86, G + 0.9, wz - 0.4, wz + 0.4));
    }
  }
  // 灯笼串：悬链线 + 红灯笼 + 水面上拉长的灯影
  for (let k = 0; k < 6; k++) {
    const z = -1 - k * 4.2, y0 = 0.9, sag = 0.7;
    const cat = (x: number) => y0 - sag * (1 - (x / (W2 + 0.4)) ** 2);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) { const x = -(W2 + 0.4) + (2 * (W2 + 0.4) * i) / 16; pts.push(new THREE.Vector3(x, cat(x), z)); }
    ink.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.012, 4, false));
    for (const lx of [-2.1, -0.7, 0.7, 2.1]) {
      const yc = cat(lx), cy = yc - 0.38;
      ink.push(rodG([lx, yc, z], [lx, cy + 0.17, z], 0.008, 0.008, 4));
      red.push(new THREE.SphereGeometry(0.17, 12, 8).scale(1, 1.15, 1).translate(lx, cy, z));
      gold.push(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8).translate(lx, cy + 0.2, z), new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8).translate(lx, cy - 0.2, z));
      // 灯影：水波打碎的一串横向短光斑，越远越短
      for (let q = 0; q < 7; q++) {
        const w = 0.26 * (1 - q * 0.1) * (0.7 + 0.6 * hash(k * 31 + lx * 7 + q));
        red.push(new THREE.PlaneGeometry(w, 0.05).rotateX(-Math.PI / 2).translate(lx + (hash(q * 3.1 + k) - 0.5) * 0.08, G + 0.006, z + 0.25 + q * 0.16));
      }
    }
  }
  g.add(mesh(white, M.white()), mesh(tile, M.tile()), mesh(stone, M.stone()), mesh(red, M.red()), mesh(gold, M.gold()), mesh(ink, M.ink()));
  // 水纹：几道淡淡的横向波纹
  const ripple: THREE.BufferGeometry[] = [];
  for (let q = 0; q < 26; q++) {
    const z = 3 - q * 1.3 - hash(q) * 0.5, x = (hash(q * 7.7) - 0.5) * 3.6, w = 0.6 + hash(q * 2.3) * 1.2;
    ripple.push(new THREE.PlaneGeometry(w, 0.03).rotateX(-Math.PI / 2).translate(x, G + 0.004, z));
  }
  g.add(mesh(ripple, mat(lin(PALETTE.paper).multiplyScalar(0.75))));
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W2 * 2, 60).rotateX(-Math.PI / 2).translate(0, G, -20), new THREE.MeshBasicMaterial({ color: lin(PALETTE.wall).multiplyScalar(0.45) }));
  water.frustumCulled = false;
  g.add(water);
  return g;
}

// ---------- 梧桐大道（树枝用 glitch.ts 的同一组枝条线段，树冠是包住枝梢的多面体团块） ----------
export function buildWutong(G: number): THREE.Group {
  const model = getWutongModel(G);
  const group = new THREE.Group();
  group.name = 'wutong-tunnel';
  group.userData.wutong = model;
  const materialByKind = {
    wood: mat(lin(PALETTE.wall).multiplyScalar(0.55)),
    white: M.white(),
    canopy: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  for (const kind of ['wood', 'white', 'canopy'] as const) {
    const geometries = model.parts.filter(part => part.kind === kind).map(part => part.geometry.clone());
    const material = materialByKind[kind];
    material.side = THREE.DoubleSide;
    if (material instanceof THREE.MeshStandardMaterial) material.flatShading = true;
    const batch = mesh(geometries, material);
    batch.name = `wutong-${kind}`;
    group.add(batch);
  }
  const hw = 2.4;
  const stone = [
    boxG(-hw - 1.6, -hw, G - 0.05, G + 0.04, 6, -55),
    boxG(hw, hw + 1.6, G - 0.05, G + 0.04, 6, -55),
  ];
  const red: THREE.BufferGeometry[] = [];
  for (let depth = 5; depth > -30; depth -= 2) red.push(boxG(-0.05, 0.05, G + 0.002, G + 0.012, depth - 0.9, depth));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 61).rotateX(-Math.PI / 2).translate(0, G, -24.5), M.road());
  road.frustumCulled = false;
  group.add(mesh(red, M.red()), mesh(stone, M.stone()), road);
  return group;
}
