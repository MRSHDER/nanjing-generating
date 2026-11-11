import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve('out/combined/qinhuai-arrival');
const times = [73.5, 76.8, 77.6, 77.9, 78.1, 78.125, 78.2, 78.3, 78.4];
const protectedTimes = [78.8, 80, 80.4, 81.6, 82.5, 83.3, 84.833];
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const result = await page.evaluate(async ({ times, protectedTimes }) => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt } = await import('/src/engine/beat.ts');
    const drop = await getLayer3D('drop2', null);
    const sample = time => {
      window.__renderAt(time);
      return {
        time, pose: drop.ballPose(frameAt(time)), ball: drop.ball.visible, target: drop.meetingTarget.visible || Boolean(drop.arrivalTarget?.visible),
        camera: [drop.cam.position.toArray(), drop.cam.quaternion.toArray(), drop.cam.fov],
        effects: [drop.orb.visible, drop.riverRing.visible, drop.riverSparks.visible, ...drop.beamsB.flatMap(beam => [beam.mesh.visible, beam.head.visible])],
        lights: drop.water.material.uniforms.uNLight.value,
        image: document.getElementById('c').toDataURL(),
      };
    };
    const samples = times.map(sample);
    const protectedSamples = protectedTimes.map(sample).map(({ image, ...state }) => state);
    const replay = [...times].reverse().map(time => {
      window.__renderAt(84.9);
      return sample(time);
    });
    return { samples, protectedSamples, deterministic: samples.every(original => JSON.stringify(original) === JSON.stringify(replay.find(value => value.time === original.time))) };
  }, { times, protectedTimes });
  mkdirSync(directory, { recursive: true });
  for (const sample of result.samples) {
    writeFileSync(resolve(directory, `${process.argv.includes('--baseline') ? 'before-' : ''}t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  if (process.argv.includes('--baseline')) writeFileSync(resolve(directory, 'baseline.json'), JSON.stringify(result, null, 2));
  assert.deepEqual(errors, []);
  for (const sample of result.samples.filter(value => value.time < 78.125)) {
    assert.equal(sample.ball, false, `unexpected ball at ${sample.time}s`);
    assert.equal(sample.target, false);
    assert.equal(sample.pose.radius, 0);
    assert(sample.effects.every(value => !value), `unexpected protagonist glow/trail at ${sample.time}s`);
    assert(sample.lights <= 25, 'protagonist added a water light');
  }
  for (const sample of result.samples.filter(value => value.time >= 78.125 && value.time < 78.333333)) {
    assert(sample.ball && sample.target, `two balls missing at ${sample.time}s`);
    assert(sample.pose.y < 540 && sample.pose.target.y < 540, 'arrival must be above river, not along banks');
  }
  assert.equal(result.samples.find(value => value.time === 78.4).target, false);
  assert(result.deterministic, 'out-of-order rendering changed result');
  const baseline = JSON.parse(readFileSync(resolve(directory, 'baseline.json'), 'utf8'));
  assert.equal(JSON.stringify(result.protectedSamples), JSON.stringify(baseline.protectedSamples), 'protected fall or finale choreography changed');
  writeFileSync(resolve(directory, 'verification.json'), JSON.stringify(result, null, 2));
  writeFileSync(resolve(directory, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>秦淮纯享与登场</title><style>body{background:#171717;color:#eee;font:18px sans-serif}img{width:100%}section{max-width:1280px;margin:24px auto}</style>${times.map(time => `<section>${time}s<img src="t${time.toFixed(3)}.png"></section>`).join('')}`);
  console.log(JSON.stringify({ passed: true, deterministic: result.deterministic, protectedFrames: protectedTimes.length, gallery: resolve(directory, 'gallery.html') }));
} finally {
  await browser?.close();
  await server.close();
}
