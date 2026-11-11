import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
const output = resolve('out/combined/glass-protagonist');
const source = readFileSync('src/three/glitch.ts', 'utf8');
if (source.includes('FIGURE_STAND') || source.includes('figureShape()')) throw Error('glitch still contains the old human shape');
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.PREVIEW_URL ?? `http://127.0.0.1:${server.httpServer.address().port}/?scale=0.5&ui=0`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const registryUrl = performance.getEntriesByType('resource').find(entry => entry.name.includes('/src/three/index.ts'))?.name;
    const { getLayer3D } = await import(registryUrl ?? '/src/three/index.ts');
    const { sectionRange } = await import('/src/engine/beat.ts');
    const { rollingBallPose, BALL_RADIUS } = await import('/src/three/rollingBall.ts');
    const youth = await getLayer3D('youth', null);
    const glitch = await getLayer3D('glitch', null);
    if (!youth.ball || !glitch.ball) throw Error('glass protagonist missing');
    if (youth.rig || youth.headRing || youth.wheels) throw Error('human or bicycle remains');
    for (let beat = 0; beat <= 40; beat += 0.125) {
      const pose = rollingBallPose(beat);
      const next = rollingBallPose(beat + 0.001);
      if (pose.y !== pose.floor + BALL_RADIUS) throw Error('ball floats or bounces');
      if (next.distance <= pose.distance) throw Error('ball stops or reverses');
      if (Math.abs(pose.angle + pose.distance / BALL_RADIUS) > 1e-10) throw Error('ball slides without rolling');
    }
    window.__renderAt(36.6);
    if (!glitch.ball.visible || glitch.strokes.visible) throw Error('handoff still forms a person');
    const entry = glitch.ball.position.toArray();
    window.__renderAt(sectionRange('youth').start + 1e-8);
    if (entry.some((value, index) => Math.abs(value - youth.ball.position.toArray()[index]) > 1e-6)) throw Error('ball jumps at handoff');
    for (const time of [36.6, 37, 40, 42, 45.3, 47, 49, 51]) {
      window.__renderAt(time);
      if (time > 36.667) {
        const pose = rollingBallPose((time - sectionRange('youth').start) / (60 / 144));
        if (youth.ball.position.y !== pose.y || youth.ball.scale.toArray().some(value => value !== 1)) throw Error('rendered sphere floats or changes size');
        const screen = youth.ball.position.clone().project(youth.cam);
        if (Math.abs(screen.x) > 0.95 || Math.abs(screen.y) > 0.95 || screen.z > 1) throw Error('protagonist outside frame');
      }
      const first = document.getElementById('c').toDataURL();
      window.__renderAt(38.2); window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error('rolling frame not deterministic');
      if (time > 36.667 && !youth.ball.visible) throw Error('ball missing from shot');
    }
    return { noHumanOrBike: true, grounded: true, noSlip: true, matchedHandoff: true, deterministic: true };
  });
  mkdirSync(output, { recursive: true });
  for (const time of [34.87, 35.5, 36.46, 36.6, 38, 40.3, 42.5, 45.3, 47, 49, 51]) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
