import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'out/combined/lock-cut');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?ui=0&scale=0.5`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const { lockCut, default: LockLayer } = await import('/src/three/lock.ts');
    const { frameAt, glitchTime, BEAT } = await import('/src/engine/beat.ts');
    const layer = new LockLayer();
    const start = 16 * BEAT;
    const radius = layer.state(frameAt(start + 10 * BEAT)).radius;
    for (let frameNumber = 0; frameNumber < 120; frameNumber++) {
      const beat = 11 + frameNumber / 24;
      const cut = lockCut(beat);
      const state = layer.state(frameAt(start + beat * BEAT));
      if (cut.showSphere === cut.showBrick) throw Error('objects overlap or both hidden');
      if (Math.abs(state.radius - radius) > 1e-8) throw Error('sphere radius changed');
      if (cut.showSphere && !layer.anchors(frameAt(start + beat * BEAT)).sphereCenter) throw Error('sphere anchor disappears early');
      if (cut.showBrick && layer.anchors(frameAt(start + beat * BEAT)).sphereCenter) throw Error('sphere anchor remains after cut');
    }
    // 切换拍由 lockCut 自身求出，不在脚本里硬编码：源码改拍号时验收自动跟随（2026-10-13 曾因硬编码 15.15 而误报失败）。
    // 二分到 1e-6 拍精度，找出球→砖交界。
    let lo = 11, hi = 16;
    if (lockCut(lo).showBrick || !lockCut(hi).showBrick) throw Error('cut outside expected range');
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (lockCut(mid).showBrick) hi = mid; else lo = mid;
    }
    const cutBeat = hi;
    // 用户 01:43：切换点在段内 14.25 拍（全片约 12.60 秒）。容差半个检查步长。
    if (Math.abs(cutBeat - 14.25) > 0.01) throw Error(`cut beat drifted: ${cutBeat}`);
    if (!lockCut(cutBeat - 1e-4).showSphere || !lockCut(cutBeat).showBrick) throw Error('cut not a clean hard switch');
    if (!lockCut(cutBeat + 0.5).showBrick) throw Error('brick hidden right after cut');
    // 加速：球下坠的进度在末尾应明显快于前段。
    const early = lockCut(cutBeat - 0.85).spin - lockCut(cutBeat - 0.95).spin;
    const late = lockCut(cutBeat - 0.05).spin - lockCut(cutBeat - 0.15).spin;
    if (!(late > early * 3)) throw Error('no acceleration');
    const { WebGLRenderer, WebGLRenderTarget } = await import('/node_modules/three/build/three.module.js');
    const renderer = new WebGLRenderer();
    const target = new WebGLRenderTarget(960, 540);
    try {
      await layer.init(renderer);
      for (const beat of [11.9, 12, cutBeat - 1.5, cutBeat - 1, cutBeat - 1e-4, cutBeat, cutBeat + 0.3, 15.5]) {
        layer.render(renderer, frameAt(start + beat * BEAT), target);
        const scale = layer.globe.scale;
        if (scale.x !== scale.y || scale.y !== scale.z) throw Error('rendered sphere squashed');
        if (layer.globe.visible === layer.brick.visible) throw Error('rendered models overlap');
        if (layer.brick.visible && layer.brick.scale.x <= 0) throw Error('brick incomplete');
      }
    } finally {
      target.dispose();
      renderer.dispose();
    }
    const times = [12.43, 12.80, 12.93, 12.97, 12.99, 13.05, 13.14, 13.31, 13.34];
    for (const time of times) {
      window.__renderAt(time);
      const first = document.getElementById('c').toDataURL();
      window.__renderAt(14);
      window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error('non-deterministic transition');
    }
    window.__renderAt(13.14);
    const freeze = document.getElementById('c').toDataURL();
    window.__renderAt(13.31);
    if (JSON.stringify(layer.state(frameAt(glitchTime(13.14)))) !== JSON.stringify(layer.state(frameAt(glitchTime(13.31))))) throw Error('brick animation in music gap not frozen');
    if (freeze === document.getElementById('c').toDataURL()) throw Error('presentation camera froze before wall handoff');
    return { exclusiveObjects: true, constantSphereRadius: true, renderedSphereUniformScale: true, accelerated: true, cutBeat: Number(cutBeat.toFixed(4)), deterministic: true, gapFrozen: true, presentationCameraContinuous: true, duration: window.__movie.duration };
  });
  mkdirSync(output, { recursive: true });
  for (const time of [12.43, 12.80, 12.93, 12.97, 12.99, 13.05, 13.14, 13.31, 13.34]) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
