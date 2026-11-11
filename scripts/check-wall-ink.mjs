import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('out/combined/wall-ink');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.PREVIEW_URL ?? `http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const registry = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/three/index.ts'))?.name;
    const { getLayer3D } = await import(registry ?? '/src/three/index.ts');
    const { DROP1_SHOTS } = await import('/src/three/drop1.ts');
    const layer = await getLayer3D('drop1', null);
    if (!layer.masonryStyle || layer.masonryStyle.strength.value > 0.5) throw Error('procedural joints still as bright as front brick outlines');
    if (layer.masonryStyle.topSize.value.x < 1.2 || layer.masonryStyle.topSize.value.y < 1.6) throw Error('top paving still too dense');
    window.__renderAt(15.8);
    for (const mesh of [layer.wallCore, layer.wings, layer.platform]) {
      const normal = layer.normalMats.get(mesh.material);
      if (!normal?.userData.masonryJoints) throw Error('near masonry masses have no joint shading');
    }
    const { Object3D, Matrix4, Vector3 } = await import('/node_modules/three/build/three.module.js');
    const constructionChecks = [];
    for (const time of [13.6, 14.4, 15.8, 17.4, 18.3]) {
      window.__renderAt(time);
      const beat = (time - 40 / 3) * 144 / 60;
      if (time < 15 && layer.cam.position.z > 12) throw Error('opening camera still too distant');
      const pose = new Object3D();
      let airborne = 0;
      for (const brick of layer.bricks) {
        layer.place(brick, beat, pose);
        if (pose.scale.y === 0) continue;
        if (brick.seed >= 120000 && pose.position.y > brick.pos.y + 0.001) throw Error('extension bricks still fall from sky');
        if (brick.seed < 50000 && beat < brick.land) {
          airborne++;
          if (pose.position.y - brick.pos.y > 2.01) throw Error('front bricks still fall from excessive height');
        }
      }
      if (airborne > 76) throw Error('more than two front rows airborne');
      const matrix = new Matrix4();
      const position = new Vector3(), scale = new Vector3();
      for (let index = 0; index < layer.battlements.count; index++) {
        layer.battlements.getMatrixAt(index, matrix);
        scale.setFromMatrixScale(matrix);
        if (scale.y === 0 && (scale.x !== 0 || scale.z !== 0)) throw Error('unbuilt battlements still draw floating horizontal faces');
      }
      layer.wings.getMatrixAt(0, matrix);
      position.setFromMatrixPosition(matrix); scale.setFromMatrixScale(matrix);
      if (position.y + scale.y / 2 > layer.wallClip.constant + 0.001) throw Error('bare extension core taller than masonry');
      constructionChecks.push({ time, airborne, extensionHeight: position.y + scale.y / 2 });
    }
    if (!layer.inkPass || !layer.rtN || layer.skyPass) throw Error('dark ink renderer missing or old sky remains');
    const redRatio = layer.bricks.filter(brick => brick.kind === 1).length / layer.bricks.length;
    if (redRatio < 0.01 || redRatio > 0.02) throw Error('red brick proportion outside 1–2%');
    if (layer.bricks.length + layer.battlements.count > 5000) throw Error('brick budget exceeded');
    if (DROP1_SHOTS.filter(shot => shot.beat >= 16).map(shot => shot.beat).join(',') !== '16,24,26,28,30') throw Error('recap shot times changed');
    const snapshots = [];
    for (const time of [13.6, 14, 14.4, 15.8, 16.6, 17.4, 18.3, 19.9, 24, 26.2]) {
      window.__renderAt(time);
      const material = layer.wallCore.material;
      if (material.isMeshNormalMaterial || !material.clippingPlanes?.length) throw Error('normal pass failed to restore wall clipping material');
      const cached = layer.normalMats.get(material);
      if (cached?.clippingPlanes !== material.clippingPlanes) throw Error('normal pass dropped clipping plane');
      const first = document.getElementById('c').toDataURL();
      window.__renderAt(25.6); window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error('ink frame not deterministic');
      snapshots.push(first);
    }
    window.__renderAt(15.8);
    const localBeat = (15.8 - 40 / 3) * 144 / 60;
    const visibleLanded = layer.bricks.filter(brick => {
      const screen = brick.pos.clone().project(layer.cam);
      return brick.land < localBeat && Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1 && screen.z < 1;
    }).length;
    if (visibleLanded < 80) throw Error('15.8s camera misses constructed wall');
    const arcBrick = layer.bricks.find(brick => brick.seed >= 80000 && brick.seed < 90000);
    const pose = new Object3D();
    layer.place(arcBrick, arcBrick.land - 0.175, pose);
    if (pose.position.y - arcBrick.pos.y > 0.66) throw Error('arch suspended too high');
    layer.meshes[0].geometry.computeBoundingBox();
    const bounds = layer.meshes[0].geometry.boundingBox;
    if ((bounds.max.z - bounds.min.z) * pose.scale.z < 0.4) throw Error('black gaps between arch slices');
    return { constructionChecks, redRatio, bricks: layer.bricks.length, visibleLandedAt15_8: visibleLanded, archFallLimited: true, archDepthClosed: true, clippingPreserved: true, materialsRestored: true, deterministic: true, frameCount: snapshots.length };
  });
  mkdirSync(output, { recursive: true });
  for (const time of [13.6, 14, 14.4, 15.8, 16.6, 17.4, 18.3, 19.9, 24, 26.2]) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  await page.setViewportSize({ width: 1920, height: 720 });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/out/combined/wall-ink/gallery.html`);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1920));
  await page.screenshot({ path: resolve(output, 'contact-sheet.png'), fullPage: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/out/combined/wall-ink/construction-gallery.html`);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1920));
  await page.screenshot({ path: resolve(output, 'construction-contact-sheet.png'), fullPage: true });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/out/combined/wall-ink/masonry-gallery.html`);
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth === 1920));
  await page.screenshot({ path: resolve(output, 'masonry-contact-sheet.png'), fullPage: true });
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
