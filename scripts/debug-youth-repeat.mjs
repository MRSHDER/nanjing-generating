import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve(`out/combined/youth-repeat/${new Date().toISOString().replace(/[:.]/g, '-')}`);
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const youth = await getLayer3D('youth', null);
    const scratch = document.createElement('canvas'); scratch.width = 1920; scratch.height = 1080;
    const drawing = scratch.getContext('2d', { willReadFrequently: true });
    const capture = () => { drawing.drawImage(document.getElementById('c'), 0, 0); return drawing.getImageData(0, 0, 1920, 1080).data; };
    const samples = [];
    for (const variant of ['normal', 'noGlass', 'noSeams', 'noLeaves']) {
      const mesh = youth.ball.children[0];
      const seams = youth.bridge.children.find(child => child.userData.expansionSeams);
      const leaves = youth.leafGroup;
      if (variant === 'noGlass') mesh.visible = false;
      if (variant === 'noSeams' && seams) seams.visible = false;
      if (variant === 'noLeaves') leaves.visible = false;
      window.__renderAt(46.770834);
      const beforeImage = document.getElementById('c').toDataURL(); const before = capture();
      window.__renderAt(13.6); window.__renderAt(25.916666666666668); window.__renderAt(46.770834);
      const afterImage = document.getElementById('c').toDataURL(); const after = capture();
      const points = [];
      let maximum = 0;
      for (let index = 0; index < before.length; index++) {
        const difference = Math.abs(before[index] - after[index]);
        maximum = Math.max(maximum, difference);
        if (difference > 1 && points.length < 24) points.push({ x: Math.floor(index / 4) % 1920, y: Math.floor(index / 4 / 1920), difference });
      }
      samples.push({ variant, maximum, points, beforeImage, afterImage });
      mesh.visible = true; if (seams) seams.visible = true; leaves.visible = true;
    }
    return samples;
  });
  mkdirSync(directory, { recursive: true });
  for (const sample of result) {
    for (const phase of ['beforeImage', 'afterImage']) {
      writeFileSync(resolve(directory, `${sample.variant}-${phase}.png`), Buffer.from(sample[phase].split(',')[1], 'base64'));
      delete sample[phase];
    }
  }
  writeFileSync(resolve(directory, 'diagnostic.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ directory, result }));
} finally { await browser?.close(); await server.close(); }
