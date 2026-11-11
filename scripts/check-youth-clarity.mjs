import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('out/combined/youth-clarity');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { youthInkDepth } = await import('/src/three/youth.ts');
    if (!youthInkDepth || youthInkDepth(400) < 0.9 || youthInkDepth(1100) < 0.7) throw Error('bridge fades before the far bank');
    const snapshots = [];
    const { getLayer3D } = await import('/src/three/index.ts');
    const { Matrix4 } = await import('/node_modules/three/build/three.module.js');
    const youth = await getLayer3D('youth', null);
    window.__renderAt(52.5);
    const matrix = new Matrix4();
    let visibleLeaves = 0;
    const scales = new Set();
    for (let index = 0; index < youth.leaves.count; index++) {
      youth.leaves.getMatrixAt(index, matrix);
      if (Math.abs(matrix.elements[14] + 14) > 1e-5) throw Error('52.5s leaves still scatter instead of forming curves');
      const scale = Math.hypot(matrix.elements[0], matrix.elements[1], matrix.elements[2]);
      if (scale > 1e-5) { visibleLeaves++; scales.add(scale.toFixed(4)); if (scale < 0.17 || scale > 0.23) throw Error('plane-tree leaf is outside the readable size range'); }
    }
    if (visibleLeaves > 230 || visibleLeaves < 180) throw Error('curve leaves not sparsely distributed');
    if (scales.size < 12) throw Error('leaf arrangement still rigid and uniform');
    for (const time of [40.5, 43.5, 46.5, 49.5, 52.5]) {
      window.__renderAt(time);
      const first = document.getElementById('c').toDataURL();
      window.__renderAt(38); window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error('youth clarity depends on seek order');
      snapshots.push(first.split(',')[1]);
    }
    return { snapshots, visibleLeaves, deterministic: true, nearInk: youthInkDepth(400), middleInk: youthInkDepth(1100) };
  });
  mkdirSync(output, { recursive: true });
  for (const [index, time] of [40.5, 43.5, 46.5, 49.5, 52.5].entries()) writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(result.snapshots[index], 'base64'));
  if (errors.length) throw Error(errors.join('; '));
  delete result.snapshots;
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
