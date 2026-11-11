import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(`reference/process-codex/${new Date().toISOString().replace(/[:.]/g, '-')}-poster`);
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?ui=0&scale=0.6666666667`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { posterChapter } = await import('/src/overlay2d/posterFrame.ts');
    const { frameAt } = await import('/src/engine/beat.ts');
    return [0, 14, 35, 40, 46, 55, 63, 70, 76, 85].map(time => posterChapter(frameAt(time)));
  });
  assert.equal(result[3].name, 'PLANE TREES');
  assert.equal(result[4].name, 'YANGTZE RIVER BRIDGE');
  assert.equal(result[8].name, 'QINHUAI RIVER');
  assert.ok(result.every(entry => entry.subtitle === null));
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { algoBounds } = await import('/src/three/glitchAlgo.ts');
    const camera = new THREE.PerspectiveCamera(35, 1920 / 1080, 0.1, 100);
    for (const distance of [12, 5, 2, 1]) {
      camera.position.set(0, 0, distance); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
      const bounds = algoBounds(camera, [[-1.25, -1.25, -1.25], [1.25, 1.25, 1.25]], true);
      if (bounds.x0 < 1920 * 0.06 || bounds.x1 > 1920 * 0.94 || bounds.y0 < 1080 * 0.06 || bounds.y1 > 1080 * 0.94) throw Error('Algorithm bounds outside 6% safe frame');
      if (distance <= 2 && !bounds.oversized) throw Error('Close sphere must use safe-frame corner marks');
    }
  });
  mkdirSync(directory, { recursive: true });
  const captures = [];
  for (const variant of ['road', 'portal']) {
    await page.evaluate(variant => { window.__posterVariant = variant; }, variant);
    for (const time of variant === 'road' ? [3, 10, 17, 24, 36.04, 36.3, 36.63, 38, 40, 42, 46.5, 55, 63, 70, 74.5, 76.8, 78.7, 82, 87] : [38, 40, 42]) {
      const source = await page.evaluate(time => {
        window.__renderAt(time);
        const canvas = document.getElementById('c');
        const original = canvas.toDataURL();
        window.__renderAt(24); window.__renderAt(82); window.__renderAt(time);
        if (original !== canvas.toDataURL()) throw Error(`Frame depends on playback history: ${time}`);
        return original;
      }, time);
      const filename = `${variant}-${time.toFixed(2)}.png`;
      writeFileSync(resolve(directory, filename), Buffer.from(source.split(',')[1], 'base64'));
      captures.push({ filename, time, variant });
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><title>海报第一批</title><style>body{background:#171717;color:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}img{width:100%}figure{margin:0}</style><h1>海报第一批 · 梧桐两方案 / 秦淮倒影 / 安全标注</h1><main>${captures.map(entry => `<figure><img src="${entry.filename}"><figcaption>${entry.time}s · ${entry.variant}</figcaption></figure>`).join('')}</main>`);
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ captures, errors, deterministic: true }, null, 2));
  console.log(`PASS ${captures.length} deterministic frames: ${directory}`);
} finally {
  await browser?.close();
  await server.close();
}
