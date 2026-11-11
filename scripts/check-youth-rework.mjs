import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = resolve(`out/combined/youth-rework/${stamp}`);
const times = [...new Set([37, 39, 41, 43, 44, ...Array.from({ length: 35 }, (_, index) => 44.5 + index / 4)])];
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
    const { getLayer3D } = await import('/src/three/index.ts');
    const { sectionRange, frameAt, BEAT } = await import('/src/engine/beat.ts');
    const { rollingBallPose, BALL_RADIUS } = await import('/src/three/rollingBall.ts');
    const { YOUTH_INSERTS } = await import('/src/three/youthMotion.ts');
    const youth = await getLayer3D('youth', null);
    if (YOUTH_INSERTS.length !== 3 || YOUTH_INSERTS.some(shot => shot.duration !== 1)) throw Error('need three one-beat inserts');
    const samples = [];
    const scratch = document.createElement('canvas'); scratch.width = 1920; scratch.height = 1080;
    const drawing = scratch.getContext('2d', { willReadFrequently: true });
    let run = 0, maximumWhiteRun = 0;
    for (let index = 0; index <= 30; index++) {
      window.__renderAt(43.5 + index / 30);
      drawing.drawImage(document.getElementById('c'), 0, 0);
      const pixels = drawing.getImageData(0, 0, 1920, 1080).data;
      let dark = 0, total = 0;
      for (let offset = 0; offset < pixels.length; offset += 128) { total++; if (Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]) < 175) dark++; }
      run = dark / total < 0.002 ? run + 1 : 0;
      maximumWhiteRun = Math.max(maximumWhiteRun, run);
    }
    if (maximumWhiteRun > 3) throw Error(`whiteout persists ${maximumWhiteRun} frames`);
    for (const time of times) {
      const frame = frameAt(time);
      window.__renderAt(time);
      const pose = rollingBallPose(frame.lt / BEAT);
      if (time < 43.9 && Math.abs(pose.ground + 2.2) > 1e-6) throw Error('tunnel still climbs');
      const center = youth.ball.position.clone().project(youth.cam);
      const ahead = youth.ball.position.clone(); ahead.x += 0.5; ahead.project(youth.cam);
      if (time >= 44.5 && time < 51.5 && ahead.x <= center.x) throw Error('bridge reverses screen direction');
      const height = BALL_RADIUS * 2 * 1080 / (2 * Math.tan(youth.cam.fov * Math.PI / 360) * youth.ball.position.distanceTo(youth.cam.position));
      if (time >= 44.5 && time < 51.5 && height < 180) throw Error('ball too small to read');
      const image = document.getElementById('c').toDataURL();
      window.__renderAt(52.9); window.__renderAt(time);
      if (image !== document.getElementById('c').toDataURL()) throw Error('seek-dependent frame');
      samples.push({ time, height, direction: ahead.x - center.x, image });
    }
    const boundary = sectionRange('gen').start;
    const gen = await getLayer3D('gen', null);
    const before = youth.backgroundCamera({ ...frameAt(boundary - 1e-7), lt: 40 * BEAT });
    const after = gen.backgroundCamera(frameAt(boundary));
    if (before.position.distanceTo(after.position) > 1e-5 || before.quaternion.angleTo(after.quaternion) > 1e-6) throw Error('gen handoff changed');
    return { samples, inserts: YOUTH_INSERTS, deterministic: true, maximumWhiteRun };
  }, times);
  assert.deepEqual(errors, []);
  mkdirSync(directory, { recursive: true });
  copyFileSync('reference/wutong-target-33s.png', resolve(directory, 'reference-33s.png'));
  for (const sample of result.samples) {
    writeFileSync(resolve(directory, `t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  writeFileSync(resolve(directory, 'verification.json'), JSON.stringify(result, null, 2));
  writeFileSync(resolve(directory, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>青年返工</title><style>body{background:#171717;color:#eee;font:18px sans-serif}.pair{display:flex}.pair img{width:50%}section{max-width:1440px;margin:24px auto}img{width:100%}</style>${result.samples.map(sample => `<section>${sample.time.toFixed(3)}s · sphere ${sample.height.toFixed(0)}px<div class="pair">${sample.time <= 44 ? '<img src="reference-33s.png">' : ''}<img src="t${sample.time.toFixed(3)}.png"></div></section>`).join('')}`);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${directory.slice(process.cwd().length + 1).replaceAll('\\', '/')}/gallery.html`);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
  await page.screenshot({ path: resolve(directory, 'contact-sheet.png'), fullPage: true });
  console.log(JSON.stringify({ passed: true, directory, frames: result.samples.length, errors }));
} finally { await browser?.close(); await server.close(); }
