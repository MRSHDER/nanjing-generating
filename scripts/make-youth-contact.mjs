import { chromium } from 'playwright-core';
import { readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('out/combined/youth-rework');
const batch = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().at(-1);
const directory = resolve(root, batch);
const base = `http://127.0.0.1:5187/out/combined/youth-rework/${batch}`;
const times = Array.from({ length: 35 }, (_, index) => 44.5 + index / 4);
const html = `<!doctype html><meta charset="utf-8"><title>大桥0.25秒逐帧</title><style>body{margin:0;background:#171717;color:#eee;font:14px sans-serif}main{display:grid;grid-template-columns:repeat(7,320px)}figure{margin:0;width:320px;height:204px}img{width:320px;height:180px}figcaption{padding:2px 8px}</style><main>${times.map(time => `<figure><img src="${base}/t${time.toFixed(3)}.png"><figcaption>${time.toFixed(2)}s</figcaption></figure>`).join('')}</main>`;
writeFileSync(resolve(directory, 'bridge-strip.html'), html);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 2240, height: 1020 } });
  await page.setContent(html);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1920));
  await page.screenshot({ path: resolve(directory, 'bridge-strip.png'), fullPage: true });
  console.log(JSON.stringify({ directory, frames: times.length, size: [2240, 1020] }));
} finally { await browser.close(); }
