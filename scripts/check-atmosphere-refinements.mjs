import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const times = [13.333334, 13.366667, 13.4, 13.433334, 13.466667, 13.5, 13.533334, 13.566667, 53.233334, 53.333334, 53.366667, 53.4, 53.433334, 53.5, 53.6];
const directory = resolve('out/combined/atmosphere-refinements');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 90000 });
  const result = await page.evaluate(async times => {
    const samples = [];
    const canvas = document.getElementById('c');
    const scratch = document.createElement('canvas');
    scratch.width = canvas.width; scratch.height = canvas.height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    for (const time of times) {
      window.__renderAt(time);
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
      let dark = 0, count = 0, top = 0, bottom = 0, topCount = 0, bottomCount = 0;
      for (let vertical = 8; vertical < scratch.height; vertical += 8) for (let horizontal = 8; horizontal < scratch.width; horizontal += 8) {
        const offset = (vertical * scratch.width + horizontal) * 4;
        const luminance = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
        count++; if (luminance < 100) dark++;
        if (vertical < scratch.height * 0.2) { top += luminance; topCount++; }
        if (vertical > scratch.height * 0.8) { bottom += luminance; bottomCount++; }
      }
      samples.push({ time, darkFraction: dark / count, top: top / topCount, bottom: bottom / bottomCount, image: canvas.toDataURL() });
    }
    const early = samples.find(sample => sample.time === 13.4);
    if (early.darkFraction > 0.65 || early.darkFraction < 0.02) throw Error(`ink spread still too fast or absent: ${early.darkFraction}`);
    const inkSamples = samples.filter(sample => sample.time < 14);
    if (inkSamples.slice(1).some((sample, index) => sample.darkFraction + 0.002 < inkSamples[index].darkFraction)) throw Error('ink coverage reverses while spreading');
    if (inkSamples.find(sample => sample.time === 13.5).darkFraction > 0.97 || inkSamples.find(sample => sample.time === 13.533334).darkFraction < 0.98) throw Error('ink does not finish in approximately 0.2 seconds');
    const night = samples.find(sample => sample.time === 53.366667);
    if (night.bottom - night.top < 70) throw Error(`night is still uniform gray: top ${night.top}, bottom ${night.bottom}`);
    const { getLayer3D } = await import('/src/three/index.ts');
    const wall = await getLayer3D('drop1', null);
    if (wall.byKind[2].length !== 0) throw Error('gold-colored wall bricks remain');
    return { samples, goldBricks: wall.byKind[2].length };
  }, times);
  mkdirSync(directory, { recursive: true });
  for (const sample of result.samples) {
    writeFileSync(resolve(directory, `t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(directory, 'verification.json'), JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }));
} finally {
  await browser?.close();
  await server.close();
}
