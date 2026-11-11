import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const output = resolve('out/combined/qinhuai-refined');
const baseline = process.argv.includes('--baseline');
const beforeColor = process.argv.includes('--before-color');
const times = [73.5, 73.78, 75, 76.4];
const colorTimes = [68.5, 73.5, 73.78, 75, 76.4, 78, 80.2, 82.5];
if (beforeColor) {
  mkdirSync(resolve(output, 'before-color'), { recursive: true });
  for (const time of times) {
    const target = resolve(output, 'before-color', `t${time.toFixed(2)}.png`);
    if (!existsSync(target)) copyFileSync(resolve(output, `t${time.toFixed(2)}.png`), target);
  }
}
const flashbackTimes = [70.05, 70.6, 71.1, 71.45, 71.75, 72.2, 72.6, 73.1];
const protectedTimes = [66.8, 67, 68, 69.5, 70.05, 70.2, 70.39, 71.1, 71.75, 72, 72.6, 80, 81.4, 82.5, 83.3];
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 90000 });
  let result = await page.evaluate(async ({ times, protectedTimes }) => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt, sectionRange, BEAT } = await import('/src/engine/beat.ts');
    const drop = await getLayer3D('drop2', null);
    const lock = await getLayer3D('lock', null);
    const snapshot = time => {
      window.__renderAt(time);
      return {
        time, pose: drop.ballPose(frameAt(time)), visible: drop.ball.visible,
        targetVisible: drop.meetingTarget.visible, native: Boolean(drop.recapBall),
        position: drop.ball.position.toArray(), rotation: drop.ball.rotation.toArray(), scale: drop.ball.scale.toArray(),
        camera: { position: drop.cam.position.toArray(), quaternion: drop.cam.quaternion.toArray(), up: drop.cam.up.toArray(), fov: drop.cam.fov },
        beam: drop.beamsB.map(beam => ({ visible: beam.mesh.visible, head: beam.head.position.toArray(), intensity: beam.mesh.material.uniforms.uI.value })),
        effectsVisible: [drop.orb.visible, drop.riverSparks.visible, drop.riverRing.visible, ...drop.beamsB.map(beam => beam.head.visible)],
        banksVisible: drop.banks.visible, image: document.getElementById('c').toDataURL(),
      };
    };
    const protectedSamples = protectedTimes.map(snapshot);
    window.__renderAt(71.1);
    if (!lock.globe.visible || drop.ball.visible || drop.recapBall !== lock.globe) throw Error('native lock single ball changed');
    const riverSamples = times.map(snapshot);
    const model = drop.qinhuai;
    const detail = model ? {
      houses: model.houses, lights: model.lights.map(light => ({ position: light.pos.toArray(), color: light.color.toArray(), kind: light.kind })),
      bridge: model.bridge, halfWidth: model.halfWidth,
      meshes: model.group.children.length,
      triangles: model.group.children.reduce((total, mesh) => total + (mesh.geometry?.index?.count ?? mesh.geometry?.attributes.position?.count ?? 0) / 3, 0),
    } : null;
    return { riverSamples, protectedSamples, detail, cuts: [sectionRange('drop2').start, sectionRange('drop2').end, sectionRange('outro').start, BEAT] };
  }, { times, protectedTimes });
  result = JSON.parse(JSON.stringify(result));
  mkdirSync(output, { recursive: true });
  for (const sample of result.riverSamples) {
    if (!beforeColor) writeFileSync(resolve(output, `${baseline ? 'before' : 't'}${sample.time.toFixed(2)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  for (const sample of result.protectedSamples) delete sample.image;
  assert.deepEqual(errors, [], 'browser errors');
  if (baseline) {
    writeFileSync(resolve(output, 'baseline.json'), JSON.stringify(result, null, 2));
    console.log('Baseline captured; checking old version against refined requirements.');
  }
  for (const sample of result.riverSamples) {
    assert.equal(sample.visible, false, `Qinhuai must have no ball or distant point at ${sample.time}s`);
    assert.equal(sample.targetVisible, false, `Qinhuai must have no meeting target at ${sample.time}s`);
    assert.equal(sample.native, false);
    assert(sample.beam.every(beam => !beam.visible), 'river must have no beam');
    assert(sample.effectsVisible.every(visible => !visible), 'river must have no glow point, ring or particles');
  }
  assert(result.detail, 'refined Qinhuai model missing');
  assert(result.detail.halfWidth < 8, 'river remains too wide');
  assert(result.detail.houses.length >= 24, 'insufficient waterfront depth');
  assert(new Set(result.detail.houses.map(house => house.width.toFixed(2))).size > 8, 'identical houses');
  assert(result.detail.houses.some(house => house.storeys === 2), 'no two storey house');
  assert(result.detail.lights.some(light => light.kind === 'window') && result.detail.lights.some(light => light.kind === 'lantern'), 'missing soft paper windows or red lanterns');
  assert(result.detail.bridge.radius > 4 && result.detail.bridge.z < -40, 'missing distant arch');
  assert.equal(result.detail.meshes, 14, 'merged model draw calls changed');
  assert(result.detail.triangles < 180000, 'geometry exceeds budget');
  const old = JSON.parse(readFileSync(resolve(output, 'baseline.json'), 'utf8'));
  assert.deepEqual(result.cuts, old.cuts, 'music or section cut changed');
  for (const sample of result.protectedSamples) {
    const original = old.protectedSamples.find(previous => previous.time === sample.time);
    assert.equal(JSON.stringify(sample.pose), JSON.stringify(original.pose), `protected protagonist pose at ${sample.time}s`);
    assert.equal(sample.visible, original.visible, `protected protagonist visibility at ${sample.time}s`);
    assert.equal(sample.targetVisible, original.targetVisible);
    if (sample.time < 70 || sample.time >= 76.667) assert.deepEqual(sample.camera, original.camera, `protected camera at ${sample.time}s`);
    assert.deepEqual(sample.beam, original.beam, `beam choreography at ${sample.time}s`);
    assert.equal(sample.banksVisible, original.banksVisible, 'bank exit changed');
  }
  const colorCheck = await page.evaluate(async colorTimes => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { PALETTE } = await import('/src/engine/palette.glsl.ts');
    const drop = await getLayer3D('drop2', null);
    const paperTone = tint => {
      const neutralSpread = Math.max(...tint) - Math.min(...tint);
      const ratios = tint.map((value, index) => value / PALETTE.paper[index]);
      return neutralSpread < 0.00001 || Math.max(...ratios) - Math.min(...ratios) < 0.00001;
    };
    const materials = drop.qinhuai.group.children.map(mesh => ({ name: mesh.name, style: mesh.material.uniforms.uStyle.value, color: mesh.material.uniforms.uColor.value.toArray() }));
    const invalidMaterials = materials.filter(material => material.style !== 4 && !paperTone(material.color));
    const invalidLights = drop.qinhuai.lights.filter(light => light.kind !== 'lantern' && !paperTone(light.color.toArray())).map(light => light.kind);
    const canvas = document.getElementById('c');
    const scratch = document.createElement('canvas');
    scratch.width = canvas.width; scratch.height = canvas.height;
    const context = scratch.getContext('2d', { willReadFrequently: true });
    const frames = [];
    for (const time of colorTimes) {
      window.__renderAt(time);
      context.drawImage(canvas, 0, 0);
      const pixels = context.getImageData(0, 0, scratch.width, scratch.height).data;
      let forbidden = 0, red = 0, softWhite = 0, dark = 0;
      let top = 0, horizon = 0, skyPixels = 0;
      for (let vertical = 0; vertical < scratch.height; vertical++) for (let horizontal = 0; horizontal < scratch.width; horizontal++) {
        const offset = (vertical * scratch.width + horizontal) * 4;
        const [first, second, third] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
        const spread = Math.max(first, second, third) - Math.min(first, second, third);
        const isRed = first - second > 12 && first - second > 1.6 * Math.max(0, second - third) && second >= third - 5;
        if (isRed && spread > 28) red++;
        else if (spread > 28) forbidden++;
        if (Math.min(first, second, third) > 150 && spread < 28) softWhite++;
        if (Math.max(first, second, third) < 60) dark++;
        if (horizontal >= 800 && horizontal < 1120 && vertical >= 10 && vertical < 100) { top += (first + second + third) / 3; skyPixels++; }
        if (horizontal >= 800 && horizontal < 1120 && vertical >= 280 && vertical < 370) horizon += (first + second + third) / 3;
      }
      frames.push({ time, forbidden, fraction: forbidden / (scratch.width * scratch.height), red, softWhite, dark, skyTop: top / skyPixels, skyHorizon: horizon / skyPixels, image: canvas.toDataURL() });
    }
    return { materials, invalidMaterials, invalidLights, frames, paper: PALETTE.paper };
  }, colorTimes);
  mkdirSync(resolve(output, beforeColor ? 'before-color' : 'after-color'), { recursive: true });
  for (const sample of colorCheck.frames) {
    const target = resolve(output, beforeColor ? 'before-color' : 'after-color', `t${sample.time.toFixed(2)}.png`);
    if (!beforeColor || !existsSync(target)) writeFileSync(target, Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  writeFileSync(resolve(output, beforeColor ? 'before-color-verification.json' : 'color-verification.json'), JSON.stringify(colorCheck, null, 2));
  assert.deepEqual(colorCheck.invalidMaterials, [], 'non paper or ink material remains');
  assert.deepEqual(colorCheck.invalidLights, [], 'colored window or bridge light remains');
  for (const sample of colorCheck.frames) assert(sample.fraction < 0.0005, `non paper/ink/red pixels remain at ${sample.time}s: ${sample.forbidden}`);
  for (const sample of colorCheck.frames.filter(sample => times.includes(sample.time))) {
    assert(sample.red > 1000 && sample.softWhite > 1000, 'red lanterns or soft paper light lost');
    assert(sample.skyHorizon > sample.skyTop + 3 && sample.skyHorizon < 85, 'sky must be a dark ink gradient');
  }
  const determinism = await page.evaluate(async ({ times, flashbackTimes }) => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const drop = await getLayer3D('drop2', null);
    const youth = await getLayer3D('youth', null);
    for (const time of [70.6, 71.45, 72.2, 73.1]) {
      window.__renderAt(time);
      if (drop.recapBall !== youth.protagonist() || !drop.recapBall.visible || drop.ball.visible) throw Error(`native youth single ball changed at ${time}`);
    }
    const rows = [];
    for (const time of [...times, ...flashbackTimes, 67, 68.5, 73.333334, 76.39, 76.62, 78, 82.5, 83.333334]) {
      window.__renderAt(time);
      const first = document.getElementById('c').toDataURL();
      window.__renderAt(time);
      const repeated = document.getElementById('c').toDataURL();
      if (first !== repeated) throw Error(`repeat pixels differ at ${time}`);
      for (const other of [20.5, 81.8, 71.1, 83.5, 73.5]) window.__renderAt(other);
      window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error(`random access pixels differ at ${time}`);
      if (time >= 73.333334 && time < 76.666667 && (drop.ball.visible || drop.meetingTarget.visible)) throw Error('ball returned after seeking');
      if (drop.river.overrideMaterial !== null) throw Error('normal override leaked');
      rows.push({ time, identicalPixels: true, image: flashbackTimes.includes(time) ? first : undefined });
    }
    return rows;
  }, { times, flashbackTimes });
  for (const sample of determinism) {
    if (sample.image) writeFileSync(resolve(output, `flashback-${sample.time.toFixed(2)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  assert.deepEqual(errors, []);
  const cameras = result.riverSamples.map(sample => sample.camera.position);
  assert(cameras.every(position => position[1] >= 0.6 && position[1] < 1.4), 'camera is not near water');
  assert(cameras[0][2] - cameras[3][2] > 0 && cameras[0][2] - cameras[3][2] < 4, 'camera does not drift slowly forward');
  const sources = ['src/three/qinhuaiScene.ts', 'src/three/drop2.ts', 'src/overlay2d/drop2.ts'].map(path => readFileSync(path, 'utf8'));
  assert(sources.every(source => !source.includes('Math.random') && !source.includes('Date.now')), 'non deterministic time or seed');
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, colorCheck, determinism, browserErrors: errors }, null, 2));
  writeFileSync(resolve(output, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>Qinhuai ink and paper</title><style>body{background:#111;color:#eee;font:18px sans-serif;margin:24px}section{display:inline-block;width:48%;margin:1%;vertical-align:top}img{width:100%}</style><h1>Before color / ink and paper</h1>${colorTimes.map(time => `<section><p>Before ${time}s</p><img src="before-color/t${time.toFixed(2)}.png"></section><section><p>After ${time}s</p><img src="after-color/t${time.toFixed(2)}.png"></section>`).join('')}<h1>All eight flashbacks</h1>${flashbackTimes.map(time => `<section><p>${time}s</p><img src="flashback-${time.toFixed(2)}.png"></section>`).join('')}`);
  console.log(JSON.stringify({ output, houses: result.detail.houses.length, meshes: result.detail.meshes, triangles: result.detail.triangles, protectedFrames: result.protectedSamples.length, determinism, browserErrors: errors }));
} finally {
  await browser?.close();
  await server.close();
}
