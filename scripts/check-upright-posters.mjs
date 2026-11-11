import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';

const directory = resolve(`reference/process-codex/${new Date().toISOString().replace(/[:.]/g, '-')}-upright-posters`);
const protectedFiles = ['src/three/glitch.ts', 'src/three/drop2.ts', 'scripts/cut-policy.mjs', 'src/overlay2d/drop1.ts'];
const fingerprints = Object.fromEntries(protectedFiles.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
if (process.env.PROTECTED_POSTER_BASELINE) assert.deepEqual(fingerprints, JSON.parse(readFileSync(resolve(process.env.PROTECTED_POSTER_BASELINE, 'protected-files.json'), 'utf8')), 'Protected sources must remain byte-identical');
const frames = [['bridge-scan', 28], ['bridge-solid', 28.3], ['steps', 30], ['steps-solid', 30.3], ['lanterns', 32], ['wutong-entry', 33], ['wutong-scan', 33.4], ['wutong-34', 34], ['wutong-35', 35], ['wutong-36', 36], ['handoff', 36.63], ['wutong', 37], ['wutong-wide', 40], ['bridge-48', 48], ['bridge-50', 50], ['bridge-wide', 50.2], ['bridge-51', 51], ['mountain', 55], ['mountain-end', 58]];
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
  const captures = [];
  for (const [label, time] of frames) {
    const image = await page.evaluate(time => {
      window.__renderAt(time);
      const original = document.getElementById('c').toDataURL();
      window.__renderAt(55); window.__renderAt(28); window.__renderAt(time);
      if (original !== document.getElementById('c').toDataURL()) throw Error(`Non-deterministic ${time}`);
      return original;
    }, time);
    const filename = `${label}-${time.toFixed(2)}.png`;
    writeFileSync(resolve(directory, filename), Buffer.from(image.split(',')[1], 'base64'));
    captures.push({ label, time, filename });
  }
  writeFileSync(resolve(directory, 'index.html'), `<!doctype html><meta charset="utf-8"><title>竖立文字逐场核对</title><style>body{background:#171717;color:#eee;font:16px sans-serif}main{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}img{width:100%}figure{margin:0}a{color:#f55}</style><h1>竖立文字 · 每场截图</h1><p>点图查看原尺寸</p><main>${captures.map(entry => `<figure><a href="${entry.filename}"><img src="${entry.filename}"></a><figcaption>${entry.label} · ${entry.time}s</figcaption></figure>`).join('')}</main>`);
  writeFileSync(resolve(directory, 'protected-files.json'), JSON.stringify(fingerprints, null, 2));
  console.log(`CAPTURES ${directory}`);
  const meshes = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { getLayer3D } = await import('/src/three/index.ts');
    const youth = await getLayer3D('youth');
    const gen = await getLayer3D('gen');
    const { createEnvironmentPosters } = await import('/src/overlay2d/environmentPosters.ts');
    const { frameAt } = await import('/src/engine/beat.ts');
    const glitch = await getLayer3D('glitch');
    const environment = createEnvironmentPosters();
    const context = document.createElement('canvas').getContext('2d');
    environment.render(frameAt(33.4), glitch.backgroundCamera(frameAt(33.4)), context, context);
    const all = [...youth.roadTypography.children, ...youth.bridgeTypography.children, gen.typography, ...[...environment.posters.values()].flat()];
    return all.map(mesh => ({ title: mesh.userData.posterTypography, normalY: new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).y, upY: new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).y }));
  });
  assert.ok(new Set(meshes.map(mesh => mesh.title)).size >= 5);
  assert.ok(meshes.every(mesh => Math.abs(mesh.normalY) < 1e-7 && mesh.upY > 0.999), 'Wutong typography must be upright, never lying on the road');
  assert.deepEqual(errors, []);
  const selections = [['梧桐大道', 'wutong-wide'], ['长江大桥', 'bridge-48'], ['中山陵台阶', 'steps-solid'], ['灯笼街', 'lanterns'], ['紫金山', 'mountain'], ['大桥高侧位', 'bridge-50']].map(([title, label]) => ({ title, ...captures.find(entry => entry.label === label) }));
  const overview = await page.evaluate(async ({ selections, folder }) => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1530;
    const context = canvas.getContext('2d');
    context.fillStyle = '#171717'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#eee9df'; context.font = '500 28px "Noto Sans SC", sans-serif';
    context.fillText('竖立排版 · 各场景实帧 · 2026-10-17', 24, 39);
    for (const [index, entry] of selections.entries()) {
      const image = new Image(); image.src = `/reference/process-codex/${folder}/${entry.filename}`; await image.decode();
      const horizontal = index % 2 * 800, vertical = 60 + Math.floor(index / 2) * 490;
      context.drawImage(image, horizontal, vertical, 800, 450);
      context.fillText(`${entry.title} · ${entry.time}s`, horizontal + 16, vertical + 480);
    }
    return canvas.toDataURL();
  }, { selections, folder: basename(directory) });
  writeFileSync(resolve(directory, 'overview.png'), Buffer.from(overview.split(',')[1], 'base64'));
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ captures, meshes, errors, deterministic: true, protectedFiles: fingerprints }, null, 2));
  console.log(`PASS ${captures.length} deterministic frames and upright typography`);
} finally {
  await browser?.close();
  await server.close();
}
