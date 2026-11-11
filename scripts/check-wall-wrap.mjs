import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(`out/combined/wall-wrap/${new Date().toISOString().replace(/[:.]/g, '-')}`);
const times = [14, 17, 20, 23, 24, 25.5];
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const result = await page.evaluate(async times => {
    const { createDrop1Overlay, WALL_BACKGROUND_TEXT } = await import('/src/overlay2d/drop1.ts');
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt, BEAT } = await import('/src/engine/beat.ts');
    const wall = await getLayer3D('drop1', null);
    const overlay = createDrop1Overlay();
    const text = overlay.masks.find(mask => mask.tint);
    const count = () => {
      const pixels = text.canvas.getContext('2d').getImageData(0, 0, 1920, 1080).data;
      let alpha = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) alpha++;
      return alpha;
    };
    const samples = times.map(time => {
      const frame = frameAt(time);
      window.__renderAt(time);
      overlay.render({ localBeat: frame.lt / BEAT, presentationBeat: frame.lt / BEAT }, wall.backgroundCamera(frame));
      return { time, alpha: count(), image: document.getElementById('c').toDataURL() };
    });
    const camera = wall.backgroundCamera(frameAt(24));
    const directions = Array.from({ length: 8 }, (_, index) => {
      camera.position.set(0, 26, -6);
      camera.lookAt(100 * Math.sin(index * Math.PI / 4), 10, -6 - 100 * Math.cos(index * Math.PI / 4));
      camera.updateMatrixWorld(true);
      overlay.render({ localBeat: 24, presentationBeat: 24 }, camera);
      return count();
    });
    overlay.render({ localBeat: 32, presentationBeat: 32 }, camera);
    return { samples, directions, after: count(), layout: WALL_BACKGROUND_TEXT };
  }, times);
  mkdirSync(directory, { recursive: true });
  for (const sample of result.samples) {
    writeFileSync(resolve(directory, `t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  writeFileSync(resolve(directory, 'verification.json'), JSON.stringify({ ...result, errors }, null, 2));
  writeFileSync(resolve(directory, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>城墙环幕</title><style>body{background:#171717;color:#eee;font:18px sans-serif}main{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}img{width:100%}</style><main>${times.map(time => `<section>${time}s<img src="t${time.toFixed(3)}.png"></section>`).join('')}</main>`);
  assert.deepEqual(errors, []);
  for (const sample of result.samples) assert(sample.alpha > 1000, `background absent at ${sample.time}s`);
  assert(result.directions.every(count => count > 1000), 'ring does not surround the scene');
  assert.equal(result.after, 0);
  console.log(JSON.stringify({ passed: true, directory, frames: times.length, directions: result.directions }));
} finally { await browser?.close(); await server.close(); }
