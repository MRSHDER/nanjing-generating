import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(`out/combined/wall-typography/${new Date().toISOString().replace(/[:.]/g, '-')}`);
const entry = (32 + 1) * 60 / 144;
const exit = (32 + 32) * 60 / 144;
const times = [entry - 1 / 30, 22.25, 22.75, 23.2, exit];
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
  const result = await page.evaluate(async ({ entry, exit, times }) => {
    const { createDrop1Overlay, WALL_BACKGROUND_TEXT } = await import('/src/overlay2d/drop1.ts');
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt, BEAT, sectionRange } = await import('/src/engine/beat.ts');
    const { PALETTE } = await import('/src/engine/palette.glsl.ts');
    const wall = await getLayer3D('drop1', null);
    const range = sectionRange('drop1');
    const overlay = createDrop1Overlay();
    const text = overlay.masks.find(mask => mask.tint);
    if (!text || text.layer !== 'behind' || text.tint.some((value, index) => value !== PALETTE.red[index])) throw Error('default overlay is not the red background wall');
    if (WALL_BACKGROUND_TEXT.radius !== 140 || WALL_BACKGROUND_TEXT.bottom < 0 || WALL_BACKGROUND_TEXT.entryBeat !== 1 || WALL_BACKGROUND_TEXT.exitBeat !== 32) throw Error('approved text ring or window changed');
    const samples = [];
    for (const time of [entry - 1 / 30, entry, 22.75, exit, exit + 0.1]) {
      const frame = frameAt(time);
      const beat = (time - range.start) / BEAT;
      overlay.render({ localBeat: beat, presentationBeat: beat }, wall.backgroundCamera(frame));
      const pixels = text.canvas.getContext('2d').getImageData(0, 0, 1920, 1080).data;
      let colored = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) colored++;
      const active = beat >= 1 - 1e-10 && beat < 32 - 1e-10;
      if ((colored > 0) !== active) throw Error(`text window incorrect at ${time}s: ${colored} pixels`);
      samples.push({ time, active, colored });
    }
    const images = [];
    for (const time of times) {
      window.__renderAt(time);
      const image = document.getElementById('c').toDataURL();
      window.__renderAt(13.6); window.__renderAt(25.916666666666668); window.__renderAt(time);
      if (image !== document.getElementById('c').toDataURL()) throw Error(`text replay differs at ${time}s`);
      images.push({ time, image });
    }
    return { samples, images, layout: WALL_BACKGROUND_TEXT, default: 'red', oldModesRemoved: true };
  }, { entry, exit, times });
  mkdirSync(directory, { recursive: true });
  for (const sample of result.images) {
    writeFileSync(resolve(directory, `approved-t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  assert.deepEqual(errors, []);
  const html = `<!doctype html><meta charset="utf-8"><title>红色远景字幕墙定稿</title><style>body{background:#111;color:#eee;font:20px sans-serif;margin:20px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}figure{margin:0}img{width:100%}</style><h1>红色字幕墙 · 22.083–23.333秒 · 主片已开启</h1><p>出现前一帧 / 出现中三帧 / 离开后一帧；年份与明城墙同属远景背景板。</p><main>${times.map((time,index) => `<figure><p>${['出现前','出现中','出现中','出现中','离开后'][index]} / ${time.toFixed(3)}s</p><img src="approved-t${time.toFixed(3)}.png"></figure>`).join('')}</main>`;
  writeFileSync(resolve(directory, 'approved.html'), html);
  writeFileSync(resolve(directory, 'gallery.html'), html);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/${directory.slice(process.cwd().length + 1).replaceAll('\\', '/')}/approved.html`);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1920));
  await page.screenshot({ path: resolve(directory, 'approved-comparison.png'), fullPage: true });
  writeFileSync(resolve(directory, 'verification.json'), JSON.stringify({ ...result, entry, exit, errors }, null, 2));
  console.log(JSON.stringify({ entry, exit, default: 'red', samples: result.samples, errors }));
} finally {
  await browser?.close(); await server.close();
}
