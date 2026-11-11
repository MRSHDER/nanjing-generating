import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const groups = [
  ['22:15 大桥第16拍与版式文字同拍进入', [42.9, 43.3, 1300 / 30, 43.36, 43.5, 44.166667]],
  ['本轮：平路梧桐与稳定同侧过桥', [37, 39, 41, 43, 44, 44.5, 46.041667, 47.708333, 49.375, 51.5]],
  ['本轮：环绕城墙的文字背景', [14, 17, 20, 23, 24, 25.5]],
  ['本轮：梧桐隧道、高速过桥与红墨尾迹', [37, 40, 43, 44, 45, 45.572917, 46.770834, 47, 48, 48.125, 49, 49.322917, 51, 52.5]],
  ['本轮：红色远景字幕墙', [22.25, 22.675, 22.708334, 22.75, 23.2, 23.333334]],
  ['本轮：秦淮河纯享版与双球登场', [73.5, 73.78, 75, 76.4, 76.8, 77.6, 77.9, 78.1, 78.2, 78.4]],
  ['本轮：墨迹洇开与上落夜色', [13.366667, 13.4, 13.433334, 13.466667, 13.5, 13.533334, 53.333334, 53.366667, 53.4, 53.433334, 53.5]],
  ['本轮：门洞单球与其他闪回保留', [70.1, 70.3, 71.1, 71.8, 72, 74, 76.39, 76.67, 78]],
  ['本轮：梧桐冠层与片尾标识', [33.4, 33.7, 34.5, 88.5, 89.9]],
  ...[6.666666666666667, 13.333333333333334, 26.666666666666668, 53.333333333333336].map(boundary => [`一镜到底：${boundary.toFixed(2)}秒`, [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5].map(offset => boundary + offset)]),
  ['00:25 美术调整', [51.5, 52.5, 53, 85.5, 88.5]],
  ['00:00 小收尾', [52.5, 84.6, 84.8, 88.5]],
  ['青年清晰度', [40.5, 43.5, 46.5, 49.5, 52.5]],
  ['玻璃球与印章', [65.5, 66.5, 83.5, 85.5, 88.5]],
  ['片尾转正', [84.2, 84.9, 85.1, 85.4, 86.5]],
  ['墨色地形', [54, 55.5, 57, 58.5]],
  ['双向奔赴与主角交接', [67, 68.5, 70, 70.5, 82.5, 83.3, 83.34]],
];
const reviewPath = `out/combined/full-review/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const directory = resolve(reviewPath);
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(`${base}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  mkdirSync(directory, { recursive: true });
  const captures = [];
  for (const time of new Set(groups.flatMap(group => group[1]))) {
    const result = await page.evaluate(async time => {
      window.__renderAt(time);
      const canvas = document.getElementById('c');
      const source = canvas.toDataURL();
      window.__renderAt(13.6); window.__renderAt(25.916666666666668); window.__renderAt(time);
      const repeated = canvas.toDataURL();
      let differences = 0, maximum = 0;
      if (source !== repeated) {
        const pixels = await Promise.all([source, repeated].map(async source => {
          const image = new Image(); image.src = source; await image.decode();
          const scratch = document.createElement('canvas'); scratch.width = canvas.width; scratch.height = canvas.height;
          const context = scratch.getContext('2d'); context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, scratch.width, scratch.height).data;
        }));
        for (let index = 0; index < pixels[0].length; index++) {
          const difference = Math.abs(pixels[0][index] - pixels[1][index]);
          if (difference) differences++;
          maximum = Math.max(maximum, difference);
        }
      }
      const mismatch = maximum > 1 || differences > 64;
      return { data: source.split(',')[1], differences, maximum, mismatch, repeated: mismatch ? repeated.split(',')[1] : null };
    }, time);
    const file = `t${time.toFixed(2)}.png`;
    writeFileSync(resolve(directory, file), Buffer.from(result.data, 'base64'));
    if (result.repeated) writeFileSync(resolve(directory, `repeat-${file}`), Buffer.from(result.repeated, 'base64'));
    captures.push({ time, file, quantizationDifferences: result.differences, maximumDifference: result.maximum, mismatch: result.mismatch });
  }
  if (errors.length) throw Error(errors.join('; '));
  const transitions = groups.filter(([name]) => name.startsWith('一镜到底'));
  for (const [name, times] of transitions) {
    await page.setViewportSize({ width: 2240, height: 230 });
    await page.setContent(`<style>body{margin:0;background:#111;color:#eee;font:16px Arial}.row{display:flex}figure{margin:0;width:320px}img{width:320px;height:180px}p{margin:6px}</style><div class="row">${times.map(time => `<figure><p>${name} / ${time.toFixed(3)}s</p><img src="${base}/${reviewPath}/t${time.toFixed(2)}.png"></figure>`).join('')}</div>`);
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1920));
    const boundary = times[3];
    await page.screenshot({ path: resolve(directory, `one-take-${boundary.toFixed(2)}-strip.png`) });
  }
  const body = groups.map(([name, times]) => `<h2>${name}</h2><main>${times.map(time => `<figure><a href="t${time.toFixed(2)}.png"><img src="t${time.toFixed(2)}.png"><figcaption>${time}秒</figcaption></a></figure>`).join('')}</main>`).join('');
  writeFileSync(resolve(directory, 'gallery.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>全片调整核对</title><style>body{margin:0;padding:24px;background:#161616;color:#eee;font:18px Arial}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0}img{width:100%;aspect-ratio:16/9;display:block}a{color:inherit;text-decoration:none}figcaption{padding:8px 0}</style><h1>全片调整关键帧 · 1920×1080</h1>${body}`);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.route('**/favicon.ico', route => route.fulfill({ status: 204, body: '' }));
  await page.goto(`${base}/${reviewPath}/gallery.html`);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1920));
  await page.screenshot({ path: resolve(directory, 'contact-sheet.png'), fullPage: true });
  if (errors.length) throw Error(errors.join('; '));
  const mismatches = captures.filter(capture => capture.mismatch);
  writeFileSync(resolve(directory, 'verification.json'), JSON.stringify({ captures, deterministic: !mismatches.length, mismatches, errors }, null, 2));
  console.log(JSON.stringify({ directory, captures: captures.length, deterministic: !mismatches.length, mismatches, errors }));
  if (mismatches.length) throw Error(`${mismatches.length} random-access frame comparisons exceeded unchanged tolerance; original and repeat PNGs preserved`);
} catch (error) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'failure.json'), JSON.stringify({ status: 'failed', reason: String(error) }, null, 2));
  throw error;
} finally { await browser?.close(); await server.close(); }
