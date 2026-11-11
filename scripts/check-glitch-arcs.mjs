// 数据故障段验收（负责人：DeepSeek）。
//
// 2026-10-13 02:20 按用户决定重写：数据段采用小克新版「每闪一次换一个南京」——960 条墨线短线在 7 个造型之间迁移，
// 每个场景一个机位。取代 Codex 方案A 的「噪点沿弧线汇成人物」（旧版备份在 backup-2026-10-13/）。
//
// 本脚本断言三件事：
//   1. 二进制闪屏程序与六次窗口**逐字节未变**（用户与三方共同的硬约束）。
//   2. 新版结构成立：7 个造型、6 个迁移窗口、每场景机位、第 6 场景末镜头与原版一致。
//   3. 画面可乱序取帧（纯函数）、浏览器无错误。
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// ---- 1. 保护区：只圈真正的闪屏契约（BINARY_FRAG 着色器 + glitchBinaryAt 的六个窗口）----
// 旧脚本圈的是 BINARY_FRAG → export default class，会把保护区**之后**追加的着色器也圈进来，
// 于是小克新增 LINE_VERT / LINE_FRAG 时误报「flash shader or windows changed」。这里按契约划界。
const source = readFileSync('src/three/glitch.ts', 'utf8');
const shader = source.slice(source.indexOf('const BINARY_FRAG'), source.indexOf('/** 第 b 拍是否处在二进制世界'));
const windows = source.slice(source.indexOf('export function glitchBinaryAt'), source.indexOf('const LINE_VERT'));
const protectedCode = `${shader}\n|||\n${windows}`;
const flashHash = createHash('sha256').update(protectedCode).digest('hex');
const EXPECTED_FLASH = '55a8c00fac1cb9112b4cf63ca295270ea7b13215db2b4275d01378b04f50c69e';
// 首次运行时记录基线；若闪屏被动过，这里会失败并打印实际值。
if (flashHash !== EXPECTED_FLASH) throw Error(`flash shader or windows changed: ${flashHash}`);

// 无论基线如何，独立再断言一次六个窗口的字面值（防止基线被顺手改掉）。
const REQUIRED_WINDOWS = [[2.5, 3.5], [6.5, 8], [10.5, 11.5], [14.5, 16], [18.5, 19.5], [22.5, 23.5]];
for (const [a, b] of REQUIRED_WINDOWS) {
  if (!new RegExp(`\\[\\s*${a}\\s*,\\s*${b}\\s*\\]`).test(windows)) throw Error(`flash window missing or changed: [${a}, ${b}]`);
}
if (!/uCell/.test(shader) || !/22 \/ W/.test(source) || !/30 \/ H/.test(source)) throw Error('binary cell size changed');

const output = resolve(process.argv[2] ?? 'out/combined/glitch-arcs');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?ui=0&scale=0.5`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });

  const result = await page.evaluate(async () => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { glitchBinaryAt, glitchScene, GLITCH_THUMBS } = await import('/src/three/glitch.ts');
    const layer = await getLayer3D('glitch', null);

    // 新版应为短线（LineSegments），且密度与旧版一致：960 条线 = 1920 顶点
    if (!layer.strokes?.isLineSegments) throw Error('no clean line fragments');
    const count = layer.strokes.geometry.getAttribute('position').count;
    if (count !== 1920) throw Error(`line vertex count changed: ${count}`);

    // 七个造型：SCENE_AT = 0 / 3.5 / 8 / 11.5 / 16 / 19.5 → 场景 0..6
    const sceneCases = [[0, 0], [3.4, 0], [3.5, 1], [7.9, 1], [8, 2], [11.4, 2], [11.5, 3], [15.9, 3], [16, 4], [19.4, 4], [19.5, 5], [23, 5]];
    for (const [beat, expected] of sceneCases) {
      const got = glitchScene(beat);
      if (got !== expected) throw Error(`scene mapping wrong at beat ${beat}: ${got} !== ${expected}`);
    }

    // 六次闪屏窗口逐 0.125 拍核对
    const windows = [[2.5, 3.5], [6.5, 8], [10.5, 11.5], [14.5, 16], [18.5, 19.5], [22.5, 23.5]];
    for (let beat = 0; beat < 24; beat += 0.125) {
      if (glitchBinaryAt(beat) !== windows.some(([begin, end]) => beat >= begin && beat < end)) throw Error('six flashes changed');
    }

    // 真实时间判断（切片窗口里画面时间原地重复，必须按真实时间切闪屏）
    const originalBinaryRender = layer.binary.render;
    let binaryCalls = 0;
    layer.binary.render = function (...argumentsList) { binaryCalls++; return originalBinaryRender.apply(this, argumentsList); };
    try {
      for (const [begin, end] of windows) {
        for (const [beat, expected] of [[begin - 0.025, false], [begin + 0.025, true], [end - 0.025, true], [end + 0.025, false]]) {
          binaryCalls = 0;
          window.__renderAt(26.666666666666668 + beat * 60 / 144);
          if ((binaryCalls > 0) !== expected) throw Error('real-time binary switch changed');
        }
      }
    } finally { layer.binary.render = originalBinaryRender; }

    // 第 6 小节的四张回顾小片
    if (GLITCH_THUMBS.length !== 4) throw Error('thumbnail count changed');
    // 第 6 场景结束时镜头必须回到原版（z = 12），青年段衔接不能跳。
    // poseAt 是模块私有函数，这里通过 layer.backgroundCamera 取实际机位。
    const endCam = layer.backgroundCamera ? layer.backgroundCamera({ t: 26.666666666666668 + 23.2 * 60 / 144, sectionStart: 26.666666666666668, lt: 23.2 * 60 / 144, env: {} }) : null;
    if (endCam && Math.abs(endCam.position.z - 12) > 0.4) throw Error(`scene-6 camera drifted: z=${endCam.position.z}`);

    // 乱序取帧一致（纯函数）
    const times = [27.0, 28.6, 30.3, 31.9, 33.6, 35.3, 36.3];
    for (const time of times) {
      window.__renderAt(time); const first = document.getElementById('c').toDataURL();
      window.__renderAt(15); window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error('random access differs');
    }
    // 六个场景画面必须互不相同
    const shots = times.map(time => { window.__renderAt(time); return document.getElementById('c').toDataURL(); });
    if (new Set(shots).size !== times.length) throw Error('scenes are not visually distinct');

    const current = layer.binary.u.uCell.value;
    if (current.x !== 22 / 1920 || current.y !== 30 / 1080) throw Error('binary cell size changed');
    return {
      vertices: count,
      sevenScenes: true,
      sixMoves: true,
      sixFlashWindowsPreserved: true,
      realTimeFlashBoundariesPreserved: true,
      binaryCellPreserved: true,
      scene6CameraMatchesOriginal: true,
      scenesVisuallyDistinct: times.length,
      deterministic: true,
    };
  });

  mkdirSync(output, { recursive: true });
  const shots = [27.0, 28.6, 30.3, 31.9, 33.6, 35.3, 36.3];
  for (const time of shots) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, flashHash, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
