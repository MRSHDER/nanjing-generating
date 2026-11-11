import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const protectedFiles = ['src/overlay2d/subtitles.ts', 'src/overlay2d/posterFrame.ts', 'src/main.ts', 'src/three/youthMotion.ts', 'src/three/drop2.ts'];
const hashes = () => Object.fromEntries(protectedFiles.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
const before = hashes();
const folder = `reference/process-codex/${new Date().toISOString().replace(/[:.]/g, '-')}-poster-text-layout`;
mkdirSync(folder, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(`${base}/?ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const cues = await page.evaluate(async () => (await import('/src/overlay2d/subtitles.ts')).SUBTITLES);
  await page.evaluate(async () => {
    const { SUBTITLES, subtitleAt } = await import('/src/overlay2d/subtitles.ts');
    const { BEAT } = await import('/src/engine/beat.ts');
    const expectedBars = [[1, 3], [4, 8], [8, 12], [12, 16], [16, 19], [19, 22], [22, 26], [26, 31], [32, 36], [36, 40], [40, 47], [47, 50], [50, 54]];
    if (SUBTITLES.length !== expectedBars.length) throw Error('Expected thirteen poster text cards');
    for (const [index, cue] of SUBTITLES.entries()) {
      for (const [boundary, expected] of [[cue.start, expectedBars[index][0]], [cue.end, expectedBars[index][1]]]) {
        if (Math.abs(boundary / (BEAT * 4) - expected) > 1e-9) throw Error(`Card ${index + 1} is not on its approved bar downbeat`);
      }
      if (subtitleAt(cue.start)?.zh !== cue.zh || subtitleAt(cue.end)?.zh === cue.zh) throw Error('Subtitle hard-cut boundary changed');
      if (subtitleAt(cue.start - 1e-6)?.zh === cue.zh || subtitleAt(cue.end - 1e-6)?.zh !== cue.zh) throw Error('Poster card appears early or disappears before downbeat');
      if (!['lb', 'rb', 'vr'].includes(cue.layout)) throw Error('Unexpected poster text layout');
    }
    if (Math.abs(SUBTITLES[7].start - (110 / 3 + 16 * BEAT)) > 1e-9) throw Error('Bridge and new poster text do not share the same downbeat');
  });
  const times = [...new Set([...cues.map(cue => Number(((cue.start + cue.end) / 2).toFixed(3))), 31.6, 34, 38.76, 40, 42.9, 43.3, 1300 / 30, 43.36, 43.5, 44.167, 48, 50, 55, 63, 80])].sort((left, right) => left - right);
  const captures = [];
  await page.evaluate(async () => {
    const { getLayer3D } = await import('/src/three/index.ts');
    window.__renderAt(43.36);
    const youth = await getLayer3D('youth');
    if (!youth.bridge.visible) throw Error('Bridge model is hidden after beat-16 camera cut');
    const { frameAt } = await import('/src/engine/beat.ts');
    const { youthMotionCamera } = await import('/src/three/youthMotion.ts');
    const boundary = frameAt(1300 / 30);
    const camera = youth.backgroundCamera(boundary);
    if (camera.position.distanceTo(youthMotionCamera(16).position) > 1e-8) throw Error('Exact 1300th frame uses tunnel camera due to floating-point beat boundary');
    window.__renderAt(1300 / 30);
    if (!youth.bridge.visible) throw Error('Bridge model hidden on exact 1300th frame');
  });
  for (const time of times) {
    const result = await page.evaluate(async time => {
      const { subtitleAt, drawSubtitle } = await import('/src/overlay2d/subtitles.ts');
      window.__renderAt(time);
      const canvas = document.getElementById('c'), original = canvas.toDataURL();
      window.__renderAt(80); window.__renderAt(34); window.__renderAt(time);
      const repeated = canvas.toDataURL();
      if (repeated !== original) {
        const samples = [];
        for (const source of [original, repeated]) {
          const image = new Image(); image.src = source; await image.decode();
          const scratch = document.createElement('canvas'); scratch.width = image.width; scratch.height = image.height;
          const context = scratch.getContext('2d'); context.drawImage(image, 0, 0);
          samples.push(context.getImageData(0, 0, image.width, image.height).data);
        }
        let channels = 0, maximum = 0;
        for (let index = 0; index < samples[0].length; index++) {
          const difference = Math.abs(samples[0][index] - samples[1][index]);
          if (difference) channels++; maximum = Math.max(maximum, difference);
        }
        throw Error(`Non-deterministic frame ${time}: ${channels} channels, max ${maximum}`);
      }
      const scratch = document.createElement('canvas'); scratch.width = 1920; scratch.height = 1080;
      const context = scratch.getContext('2d'); drawSubtitle(context, time);
      const pixels = context.getImageData(0, 0, 1920, 1080).data;
      let top = 1080, bottom = -1, left = 1920, right = -1, outsideReserved = 0;
      const item = subtitleAt(time);
      const reserved = item?.layout === 'lb' ? [96, 760, 700, 935] : item?.layout === 'rb' ? [1220, 760, 1824, 935] : [1640, 170, 1824, 720];
      for (let vertical = 0; vertical < 1080; vertical++) for (let horizontal = 0; horizontal < 1920; horizontal++) {
        if (pixels[(vertical * 1920 + horizontal) * 4 + 3]) {
          top = Math.min(top, vertical); bottom = Math.max(bottom, vertical);
          left = Math.min(left, horizontal); right = Math.max(right, horizontal);
          if (horizontal < reserved[0] - 2 || horizontal > reserved[2] + 2 || vertical < reserved[1] - 2 || vertical > reserved[3] + 2) outsideReserved++;
        }
      }
      return { data: original.split(',')[1], subtitle: item, top, bottom, left, right, reserved, outsideReserved };
    }, time);
    assert.ok(result.bottom < 0 || (result.top >= 72 && result.bottom < 1008 && result.left >= 72 && result.right < 1848), `Poster text outside screen safety margins at ${time}`);
    const file = `t${time.toFixed(3)}.png`;
    writeFileSync(resolve(folder, file), Buffer.from(result.data, 'base64'));
    const { data, ...measurements } = result;
    captures.push({ time, file, ...measurements });
  }
  assert.deepEqual(hashes(), before);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(folder, 'report.json'), JSON.stringify({ captures, errors, protectedHashes: before, strictRandomAccess: true }, null, 2));
  writeFileSync(resolve(folder, 'index.html'), `<!doctype html><meta charset="utf-8"><title>新版平面文字核对</title><style>body{background:#171717;color:#eee;font:18px sans-serif}main{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{width:100%}</style><h1>左下 / 右下 / 右侧竖排 · 背景排版核对</h1><p>按21:55新版实际像素检查。文案、时间、机位未改；63秒飞块暂不处理。预留矩形之外的文字像素单独记录，不把预留区误当完整字形范围。</p><main>${captures.map(entry => `<figure><a href="${entry.file}"><img src="${entry.file}"></a><figcaption>${entry.time}s · ${entry.subtitle?.layout} · ${entry.subtitle?.zh ?? '无文字'} · 预留区外${entry.outsideReserved}像素</figcaption></figure>`).join('')}</main>`);
  console.log(JSON.stringify({ folder, frames: captures.length, errors, protectedFilesUnchanged: true }));
} finally { await browser?.close(); await server.close(); }
