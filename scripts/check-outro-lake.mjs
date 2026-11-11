import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'out/combined/outro-lake');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
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
    const { outroLakeOutline, createOutroOverlay } = await import('/src/overlay2d/outro.ts');
    const { frameAt } = await import('/src/engine/beat.ts');
    const points = outroLakeOutline();
    const horizontal = points.map(point => point[0]);
    const vertical = points.map(point => point[1]);
    const width = Math.max(...horizontal) - Math.min(...horizontal);
    const height = Math.max(...vertical) - Math.min(...vertical);
    if (width < 850 || height < 350 || Math.min(...horizontal) >= 0 || Math.max(...vertical) <= 1080 || Math.min(...vertical) < 700) throw Error('lake must be enlarged and cropped at lower-left');
    const overlay = createOutroOverlay();
    overlay.render(frameAt(88));
    const mask = overlay.masks.find(mask => mask.layer === 'behind' && mask.role === 'muted');
    const context = mask.canvas.getContext('2d');
    const centerAlpha = context.getImageData(150, 1040, 1, 1).data[3];
    if (centerAlpha > 5) throw Error('gray lake fill remains');
    for (const role of ['muted', 'signal', 'foreground']) {
      const behind = overlay.masks.find(mask => mask.layer === 'behind' && mask.role === role).canvas.getContext('2d');
      const pixels = behind.getImageData(0, 0, 1920, 670).data;
      if (pixels.some((value, index) => index % 4 === 3 && value > 0)) throw Error('background lines overlap title or upper whitespace');
    }
    overlay.render(frameAt(88));
    const first = mask.canvas.toDataURL(); overlay.render(frameAt(85)); overlay.render(frameAt(88));
    if (first !== mask.canvas.toDataURL()) throw Error('lake not deterministic');
    for (const time of [87, 88, 89]) {
      window.__renderAt(time); const first = document.getElementById('c').toDataURL(); window.__renderAt(7); window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error('combined frame not deterministic');
    }
    return { width, height, centerAlpha, deterministic: true };
  });
  mkdirSync(output, { recursive: true });
  for (const time of [87, 88, 89]) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close(); await server.close();
}
