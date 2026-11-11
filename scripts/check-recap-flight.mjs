import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('out/combined/recap-flight');
const times = [70.05, 70.2, 70.39, 71.1, 72, 73.5, 74, 75.5, 76, 76.3, 76.39, 76.42, 76.62, 78, 82.5];
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
  const result = await page.evaluate(async times => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt } = await import('/src/engine/beat.ts');
    const drop = await getLayer3D('drop2', null);
    const lock = await getLayer3D('lock', null);
    window.__renderAt(71.1);
    if (lock.globe.visible && drop.ball.visible) throw Error('lock recap has two glass protagonists');
    if (drop.recapBall !== lock.globe) throw Error('native lock protagonist was not reused');
    const samples = [];
    for (const time of times) {
      window.__renderAt(time);
      const pose = drop.ballPose(frameAt(time));
      const position = drop.ball.position.toArray();
      const visible = drop.ball.visible;
      const native = Boolean(drop.recapBall);
      const canvas = document.getElementById('c');
      const first = canvas.toDataURL();
      window.__renderAt(20.5);
      window.__renderAt(78);
      window.__renderAt(time);
      if (drop.ball.visible !== visible || drop.ball.position.toArray().some((value, index) => value !== position[index])) throw Error(`flight depends on playback state at ${time}`);
      samples.push({ time, pose, position, visible, native, image: first });
    }
    for (const sample of samples.filter(sample => sample.time >= 73.333334 && sample.time < 76.666667)) {
      if (sample.visible || sample.native || sample.pose.radius !== 0) throw Error(`Qinhuai pure scene contains a ball at ${sample.time}`);
    }
    if (!samples.find(sample => sample.time === 78).visible) throw Error('meeting ball was not restored');
    if (samples.find(sample => sample.time === 82.5).pose.radius !== 48) throw Error('outro handoff radius changed');
    return samples;
  }, times);
  mkdirSync(output, { recursive: true });
  for (const sample of result) {
    writeFileSync(resolve(output, `t${sample.time.toFixed(2)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ samples: result, browserErrors: errors }, null, 2));
  writeFileSync(resolve(output, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>Recap flight</title><style>body{background:#111;color:#eee;font:18px sans-serif;margin:24px}section{display:inline-block;width:48%;margin:1%}img{width:100%}</style>${times.map(time => `<section><p>${time}s</p><img src="t${time.toFixed(2)}.png"></section>`).join('')}`);
  console.log(JSON.stringify({ output, samples: result, browserErrors: errors }));
} finally {
  await browser?.close();
  await server.close();
}
