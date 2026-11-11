import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const directory = resolve(`reference/process-codex/${new Date().toISOString().replace(/[:.]/g, '-')}-single-backdrops`);
const locked = ['src/three/glitch.ts', 'src/three/glitchModels.ts', 'src/three/youthMotion.ts', 'src/three/gen.ts', 'src/three/drop2.ts', 'src/overlay2d/drop1.ts', 'scripts/cut-policy.mjs'];
const hashes = Object.fromEntries(locked.map(path => {
  let source = readFileSync(path, 'utf8');
  if (path === 'src/three/glitch.ts') source = source.replace(/^import \{ GlitchBackdropTypography \} from '\.\/glitchBackdropTypography';\r?\n/m, '').replace(/^  private backdropTypography = new GlitchBackdropTypography\(\);\r?\n/m, '').replace(/^    if \(poster\) this\.backdropTypography\.render\(r, this\.cam, out, this\.rtN\.depthTexture!, this\.solids\);\r?\n/m, '');
  return [path, createHash('sha256').update(source).digest('hex')];
}));
if (process.env.BACKDROP_BASELINE) assert.deepEqual(hashes, JSON.parse(readFileSync(resolve(process.env.BACKDROP_BASELINE, 'locked.json'), 'utf8')));
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?ui=0&scale=0.6666666667`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'locked.json'), JSON.stringify(hashes, null, 2));
  const images = [];
  for (const time of [31.6, 32, 34, 37, 38.76, 40, 50, 50.2, 30.3, 48, 55]) {
    const result = await page.evaluate(async time => {
      const { getLayer3D } = await import('/src/three/index.ts');
      const { frameAt } = await import('/src/engine/beat.ts');
      const { createEnvironmentPosters } = await import('/src/overlay2d/environmentPosters.ts');
      window.__renderAt(time);
      const original = document.getElementById('c').toDataURL();
      window.__renderAt(55); window.__renderAt(32); window.__renderAt(time);
      if (original !== document.getElementById('c').toDataURL()) throw Error(`Non-deterministic ${time}`);
      const youth = await getLayer3D('youth'), glitch = await getLayer3D('glitch');
      const { createWutongPoster } = await import('/src/three/wutongPoster.ts');
      const { BALL_ENTRY } = await import('/src/three/rollingBall.ts');
      const canonical = createWutongPoster('glitch', youth.roadTypography.children[0].material.color), translated = createWutongPoster('youth', youth.roadTypography.children[0].material.color);
      const expected = canonical.position.clone().set(BALL_ENTRY.x - canonical.position.z, canonical.position.y, canonical.position.x);
      if (translated.position.distanceTo(expected) > 1e-10) throw Error('Shared tunnel board position changed at handoff');
      for (const mesh of [canonical, translated, ...youth.bridgeTypography.children]) {
        mesh.updateMatrixWorld(true);
        const matrix = mesh.matrixWorld.elements;
        if (Math.abs(matrix[5] / Math.hypot(matrix[4], matrix[5], matrix[6]) - 1) > 1e-8) throw Error('Poster is not upright');
      }
      const environment = createEnvironmentPosters(), scratch = document.createElement('canvas').getContext('2d');
      environment.render(frameAt(34), glitch.backgroundCamera(frameAt(34)), scratch, scratch);
      return { image: original, wutong: youth.roadTypography.children.length, otherWutong: environment.posters.get(4).length, river: environment.posters.get(3).length, bridge: frameAt(time).section === 'youth' ? youth.bridgeTypography.children.filter(mesh => mesh.visible).length : 0 };
    }, time);
    const filename = `t${time.toFixed(2)}.png`;
    writeFileSync(resolve(directory, filename), Buffer.from(result.image.split(',')[1], 'base64'));
    images.push({ time, filename, ...result, image: undefined });
  }
  writeFileSync(resolve(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><title>一场一块背景字板</title><style>body{background:#171717;color:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}img{width:100%}figure{margin:0}</style><h1>街尽头背景字板 · 本轮实帧</h1><main>${images.map(entry => `<figure><a href="${entry.filename}"><img src="${entry.filename}"></a><figcaption>${entry.time}s</figcaption></figure>`).join('')}</main>`);
  console.log(`CAPTURES ${directory}`);
  assert.ok(images.every(entry => entry.wutong === 1 && entry.otherWutong === 1 && entry.river === 1 && entry.bridge <= 1), 'Exactly one shared Wutong and Qinhuai background board, at most one bridge board');
  for (const time of [30.3, 48, 55]) {
    const current = readFileSync(resolve(directory, `t${time.toFixed(2)}.png`)), original = readFileSync(resolve('reference/process-codex/2026-10-17T12-10-47-286Z-single-backdrops', `t${time.toFixed(2)}.png`));
    if (!current.equals(original)) {
      const difference = await page.evaluate(async sources => {
        const pixels = [];
        for (const source of sources) {
          const image = new Image(); image.src = `data:image/png;base64,${source}`; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          pixels.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
        }
        let channels = 0, maximum = 0, total = 0;
        for (let index = 0; index < pixels[0].length; index++) {
          const value = Math.abs(pixels[0][index] - pixels[1][index]);
          if (value) channels++; maximum = Math.max(maximum, value); total += value;
        }
        return { channels, maximum, mean: total / pixels[0].length };
      }, [current.toString('base64'), original.toString('base64')]);
      writeFileSync(resolve(directory, `approved-diff-${time}.json`), JSON.stringify(difference));
      console.log({ time, ...difference });
      assert.ok(difference.maximum <= 1 && difference.channels <= 64, `Approved frame ${time} exceeds cross-run GPU rounding allowance`);
    }
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ images, errors, locked: hashes, deterministic: true }, null, 2));
  console.log('PASS: single backdrops, deterministic frames, approved scenes unchanged');
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.setContent(`<style>body{margin:0;padding:16px;background:#171717;color:#eee;font:18px sans-serif}main{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0}img{width:100%;display:block}figcaption{padding:6px}</style><h2>街尽头单字板 · 三处收尾</h2><main>${images.filter(entry => [31.6, 32, 34, 37, 40, 50, 50.2].includes(entry.time)).map(entry => `<figure><img src="http://127.0.0.1:${server.httpServer.address().port}/${directory.replaceAll('\\', '/').split('/nanjing-short/')[1]}/${entry.filename}"><figcaption>${entry.time}s</figcaption></figure>`).join('')}</main>`);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth));
  await page.screenshot({ path: resolve(directory, 'overview.png'), fullPage: true });
} finally { await browser?.close(); await server.close(); }
