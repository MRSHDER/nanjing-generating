import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const beatSeconds = 60 / 144;
const directory = resolve(`out/combined/youth-speed/${new Date().toISOString().replace(/[:.]/g, '-')}`);
const source = readFileSync('src/three/rollingBall.ts', 'utf8').replace(/^import .*;\r?$/gm, '');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText.replace(/^export /gm, '');
const context = { BEAT: beatSeconds, Math };
runInNewContext(`${compiled}\nresult = { rollingBallPose, BALL_RADIUS, BALL_ENTRY };`, context);
const { rollingBallPose: pose, BALL_RADIUS: radius, BALL_ENTRY: entry } = context.result;
for (const boundary of [16, 17.5, 21.5, 32, 40]) {
  const before = pose(boundary - 0.0001), after = pose(boundary + 0.0001);
  assert(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z) < 0.03, `position jumps at beat ${boundary}`);
}
assert.equal(pose(0).x, entry.x);
assert.equal(pose(0).y, entry.floor + radius);
assert.equal(pose(0).z, 0);
const samples = Array.from({ length: 1601 }, (_, index) => {
  const localBeat = index / 40;
  const current = pose(localBeat);
  assert.equal(current.angle, -current.distance / radius);
  assert(Math.abs(current.y - current.floor - radius) < 1e-8);
  assert(Math.abs((current.y - current.ground) / Math.sqrt(1 + current.slope ** 2) - radius) < 1e-8, 'sphere penetrates inclined road');
  assert(current.speed > 0 && Number.isFinite(current.speed));
  if (localBeat > 0 && localBeat < 40) {
    const previous = pose(localBeat - 0.0001), next = pose(localBeat + 0.0001);
    const speed = Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z) / (0.0002 * beatSeconds);
    assert(Math.abs(current.speed - speed) < 0.02, 'speed disagrees with actual trajectory');
  }
  return { time: (88 + localBeat) * beatSeconds, ...current };
});
for (const boundary of [17.5, 21.5, 32]) {
  const previous = pose(boundary - 0.001), next = pose(boundary + 0.001);
  assert(Math.abs(previous.speed - next.speed) < 0.1, 'speed jumps at phrase boundary');
}
assert(pose(26).speed > pose(4).speed * 3, 'bridge must be genuinely fast');
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'speed.json'), JSON.stringify(samples));
const path = samples.map((sample, index) => `${index ? 'L' : 'M'}${40 + (sample.time - 36.6666666667) * 54},${320 - sample.speed * 3.4}`).join(' ');
writeFileSync(resolve(directory, 'speed.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="380"><rect width="100%" height="100%" fill="#f2eee5"/><path d="M40 30V320H1000" fill="none" stroke="#222"/><path d="${path}" fill="none" stroke="#df3025" stroke-width="3"/><g font-family="sans-serif" font-size="18" fill="#222"><text x="40" y="25">Speed (m/s): continuous, no beat-by-beat walking pulse</text><text x="40" y="350">36.67s</text><text x="435" y="350">44s: tunnel exit</text><text x="900" y="350">53.33s</text></g></svg>`);
console.log('PASS: continuous trajectory / speed, grounded, distance-driven spin');
if (process.argv.includes('--pure-only')) process.exit(0);
const times = [37, 40, 43, 44, 45, 47, 48, 49, 51, 52.5];
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
  const result = await page.evaluate(async times => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { YOUTH_INSERTS } = await import('/src/three/youthMotion.ts');
    const { sectionRange, frameAt, BEAT } = await import('/src/engine/beat.ts');
    const { rollingBallPose } = await import('/src/three/rollingBall.ts');
    const youth = await getLayer3D('youth', null);
    const take = time => {
      window.__renderAt(time);
      const pose = rollingBallPose(frameAt(time).lt / BEAT);
      if (youth.ball.position.distanceTo({ x: pose.x, y: pose.y, z: pose.z }) > 1e-7) throw Error('rendered ball deviates from route');
      const glass = youth.ball.children[0].material;
      if (glass.metalness !== 0 || glass.transmission < 0.99) throw Error('ball became metallic');
      const inTunnel = time < 43.95;
      if (inTunnel && youth.trail.visible) throw Error('slow tunnel ball has a trail');
      if (time === 48 && !youth.trail.visible) throw Error('high speed red trail missing');
      const position = youth.trail.geometry.attributes.position;
      if (youth.trail.visible) {
        const head = position.count - 2;
        if (Math.abs((position.getX(head) + position.getX(head + 1)) / 2 - pose.x) > 0.0001) throw Error('trail head detached');
        for (let index = 0; index < position.count; index++) if (position.getY(index) < pose.ground || position.getY(index) > pose.ground + 0.1) throw Error('trail not on bridge deck');
      }
      return { time, image: document.getElementById('c').toDataURL(), cameraDistance: youth.cam.position.distanceTo(youth.ball.position), trail: youth.trail.visible, speed: pose.speed };
    };
    if (youth.tunnel.userData.wutong.trees.length !== 28) throw Error('shared Wutong model missing');
    const inserts = YOUTH_INSERTS.map(shot => ({ ...shot, time: sectionRange('youth').start + (shot.beat + shot.duration / 2) * BEAT }));
    const samples = [...new Set([...times, ...inserts.map(shot => shot.time)])].map(take);
    const deterministic = [...samples].reverse().every(sample => { window.__renderAt(49); return take(sample.time).image === sample.image; });
    return { samples, inserts, deterministic };
  }, times);
  assert.deepEqual(errors, []);
  assert(result.deterministic);
  assert.equal(result.inserts.length, 3);
  for (const sample of result.samples) {
    writeFileSync(resolve(directory, `t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  writeFileSync(resolve(directory, 'verification.json'), JSON.stringify(result, null, 2));
  writeFileSync(resolve(directory, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>青年速度与镜头</title><style>body{background:#171717;color:#eee;font:18px sans-serif}section{max-width:1280px;margin:24px auto}img{width:100%}</style><section><img src="speed.svg"></section>${result.samples.map(sample => `<section>${sample.time.toFixed(3)}s · ${sample.speed.toFixed(1)}m/s · distance ${sample.cameraDistance.toFixed(1)}<img src="t${sample.time.toFixed(3)}.png"></section>`).join('')}`);
  console.log(JSON.stringify({ passed: true, frames: result.samples.length, deterministic: result.deterministic, inserts: result.inserts }));
} finally { await browser?.close(); await server.close(); }
