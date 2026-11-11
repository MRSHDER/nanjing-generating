import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'out/combined/river-outline');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?ui=0&scale=0.5`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const layer = await getLayer3D('drop2', null);
    if (!layer.whiteOutline) throw Error('river white outline pass missing');
    const snapshot = time => { window.__renderAt(time); return document.getElementById('c').toDataURL(); };
    const pixels = async source => {
      const image = new Image(); image.src = source; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let white = 0, red = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index] > 150 && data[index + 1] > 150 && data[index + 2] > 150 && Math.max(data[index], data[index + 1], data[index + 2]) - Math.min(data[index], data[index + 1], data[index + 2]) < 25) white++;
        if (data[index] > 100 && data[index] > data[index + 1] * 1.6 && data[index] > data[index + 2] * 1.6) red++;
      }
      return { white, red };
    };
    layer.whiteOutline.u.uStrength.value = 0;
    const baseline = await pixels(snapshot(74.85));
    const burst = snapshot(68);
    layer.whiteOutline.u.uStrength.value = 1;
    const outlined = await pixels(snapshot(74.85));
    if (outlined.white < baseline.white + 100) throw Error('no visible white model edges');
    if (outlined.red < baseline.red * 0.6) throw Error('lantern color lost');
    if (burst !== snapshot(68)) throw Error('burst altered');
    for (const time of [73.5, 74.85, 75.4, 76.6, 78, 81, 83]) {
      const first = snapshot(time); snapshot(9); if (first !== snapshot(time)) throw Error('random access differs');
      if (layer.river.overrideMaterial !== null) throw Error('normal material leaked');
    }
    return { baseline, outlined, deterministic: true, burstUnchanged: true, materialRestored: true };
  });
  mkdirSync(output, { recursive: true });
  for (const time of [73.5, 74.85, 75.4, 76.6, 78, 81, 83]) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close(); await server.close();
}
