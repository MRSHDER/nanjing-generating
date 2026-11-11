import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseline = process.argv.includes('--baseline');
const label = baseline ? 'before' : 'after';
const directory = resolve('out/combined/ink-palette');
const samples = [['开场', 3.4], ['玻璃球', 10.5], ['城墙', 17.9], ['梧桐', 33.4], ['青年', 49.5], ['地形', 58.5], ['蓄力', 64.5], ['秦淮', 73.78], ['片尾', 88.5]];
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
  mkdirSync(directory, { recursive: true });
  const result = await page.evaluate(samples => {
    const canvas = document.getElementById('c');
    const scratch = document.createElement('canvas');
    scratch.width = canvas.width; scratch.height = canvas.height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    return samples.map(([name, time]) => {
      window.__renderAt(time);
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let forbidden = 0, red = 0, total = 0;
      for (let index = 0; index < pixels.length; index += 16) {
        const first = pixels[index], second = pixels[index + 1], third = pixels[index + 2];
        const spread = Math.max(first, second, third) - Math.min(first, second, third);
        const signal = first - second > 25 && first - second > (second - third) * 1.3 && first - third > 28;
        if (signal) red++;
        if (spread > 28 && !signal) forbidden++;
        total++;
      }
      return { name, time, forbiddenFraction: forbidden / total, redFraction: red / total, image: canvas.toDataURL() };
    });
  }, samples);
  for (const sample of result) {
    writeFileSync(resolve(directory, `${label}-t${sample.time.toFixed(2)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(directory, `${label}-verification.json`), JSON.stringify({ samples: result, errors }, null, 2));
  console.log(JSON.stringify({ label, samples: result, errors }));
  if (!baseline && result.some(sample => sample.forbiddenFraction > 0.002)) throw Error('colored regions remain outside ink, paper and signal red');
  if (!baseline) {
    const rows = samples.map(([name, time]) => `<figure><p>${name} / ${time}s</p><img src="after-t${time.toFixed(2)}.png"></figure>`).join('');
    writeFileSync(resolve(directory, 'overview.html'), `<!doctype html><meta charset="utf-8"><title>全片米白墨红总览</title><style>body{background:#111;color:#eee;margin:16px;font:20px sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}p{margin:8px 0}img{width:100%;display:block}</style><h1>全片色彩：米白 · 墨 · 一点红</h1><main>${rows}</main>`);
    writeFileSync(resolve(directory, 'comparison.html'), `<!doctype html><meta charset="utf-8"><title>逐段改色对照</title><style>body{background:#111;color:#eee;font:18px sans-serif;margin:20px}.row{display:flex;gap:16px}figure{width:50%;margin:0}img{width:100%}</style><h1>逐段改色：旧版 / 米白墨红</h1>${samples.map(([name, time]) => `<h2>${name} / ${time}s</h2><div class="row">${['before','after'].map(mode => `<figure><p>${mode}</p><img src="${mode}-t${time.toFixed(2)}.png"></figure>`).join('')}</div>`).join('')}`);
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/out/combined/ink-palette/overview.html`);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await page.screenshot({ path: resolve(directory, 'overview.png'), fullPage: true });
  }
} finally {
  await browser?.close();
  await server.close();
}
