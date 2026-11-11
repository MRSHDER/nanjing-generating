import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('out/combined/wall-transitions');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { sectionRange } = await import('/src/engine/beat.ts');
    const lock = await getLayer3D('lock', null);
    const wall = await getLayer3D('drop1', null);
    const glitch = await getLayer3D('glitch', null);
    window.__renderAt(33.7);
    const projection = [glitch.cam.fov, glitch.cam.near, glitch.cam.far];
    window.__renderAt(sectionRange('drop1').start + 30.2 * 60 / 144);
    window.__renderAt(33.7);
    if ([glitch.cam.fov, glitch.cam.near, glitch.cam.far].some((value, index) => value !== projection[index])) throw Error('portal camera projection leaked into later glitch frames');
    const boundary = sectionRange('drop1').start;
    window.__renderAt(boundary - 0.00001);
    const before = lock.brick.getWorldPosition(lock.cam.position.clone()).project(lock.cam);
    window.__renderAt(boundary);
    const after = wall.keystone.getWorldPosition(wall.cam.position.clone()).project(wall.cam);
    const jump = Math.hypot((after.x - before.x) * 960, (after.y - before.y) * 540);
    if (jump > 1) throw Error(`lock-to-wall brick jumps ${jump.toFixed(2)}px`);
    if (!wall.portal) throw Error('gate portal is missing');
    const samples = [];
    for (const boundary of [sectionRange('drop1').start, sectionRange('glitch').start]) {
      for (const offset of [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5]) {
        const time = boundary + offset;
        window.__renderAt(time);
        samples.push({ time, image: document.getElementById('c').toDataURL() });
      }
    }
    return { jump, samples };
  });
  mkdirSync(directory, { recursive: true });
  for (const sample of result.samples) {
    writeFileSync(resolve(directory, `t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(directory, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify({ directory, jump: result.jump, browserErrors: errors }));
} finally {
  await browser?.close();
  await server.close();
}
