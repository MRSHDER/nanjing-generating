import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('out/combined/city-wall');
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
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { DROP1_SHOTS } = await import('/src/three/drop1.ts');
    const { frameAt, sectionRange, BEAT } = await import('/src/engine/beat.ts');
    const { Raycaster, Vector3 } = await import('/node_modules/three/build/three.module.js');
    const layer = await getLayer3D('drop1', null);
    if (!layer.wallCore || !layer.battlements || !layer.gateTower || !layer.wings) throw Error('complete city-wall structures missing');
    if (layer.bricks.length + layer.battlements.count > 5000) throw Error('brick budget exceeded');
    if (DROP1_SHOTS.map(shot => shot.beat).join(',') !== '0,3,5,7,9,11,13,16,24,26,28,30') throw Error('shot boundaries changed');
    const rings = layer.bricks.filter(brick => brick.rotZ !== 0 && brick.seed >= 80000 && brick.seed < 90000);
    const frontRing = rings.filter(brick => Math.abs(brick.pos.z + 0.2) < 1e-7);
    if (Math.max(...frontRing.map(brick => brick.land)) - Math.min(...frontRing.map(brick => brick.land)) < 1) throw Error('arch still falls as one floating ring');
    if (Math.max(...rings.map(brick => brick.land)) > 15.5) throw Error('arch misses completion beat');
    window.__renderAt(sectionRange('drop1').start + 0.01);
    if (layer.gateTower.visible || layer.wings.visible || layer.battlements.visible) throw Error('new structures present at first frame');
    window.__renderAt(sectionRange('drop1').start + 16 * BEAT);
    layer.scene.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(0, 2.1, 10), new Vector3(0, 0, -1), 0, 23);
    const obstacles = ray.intersectObjects([layer.wallCore, layer.gateTower, layer.wings, layer.battlements], true);
    if (obstacles.length) throw Error('gate passage blocked');
    const anchors = layer.anchors(frameAt(sectionRange('drop1').start + 16 * BEAT));
    if (!anchors.gateCenter || !anchors.firstBrick) throw Error('gate anchors removed');
    const captureMilliseconds = [];
    for (const time of [14.6, 16.3, 17.9, 19.5, 22, 25.2]) {
      const start = performance.now();
      window.__renderAt(time);
      const first = document.getElementById('c').toDataURL();
      captureMilliseconds.push(performance.now() - start);
      window.__renderAt(24.9); window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error('city wall depends on playback order');
    }
    return { bricks: layer.bricks.length, battlementBlocks: layer.battlements.count, clearGatePassage: true, staggeredArch: true, shotTimesPreserved: true, deterministic: true, captureMilliseconds };
  });
  mkdirSync(output, { recursive: true });
  for (const time of [14.6, 16.3, 17.9, 18.2, 19.5, 22, 23.6, 24.2, 25.9]) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
