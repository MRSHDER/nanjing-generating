import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const times = [54, 55.5, 57, 58.5, 67, 68.5, 70, 70.5, 82.5];
const output = resolve('out/combined/landscape-meeting');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.PREVIEW_URL ?? `http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 90000 });
  const result = await page.evaluate(async times => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt, sectionRange, BEAT } = await import('/src/engine/beat.ts');
    const { genHeight, genLayout } = await import('/src/three/gen.ts');
    const { DROP2_BALL_EXIT, DROP2_SHOTS } = await import('/src/three/drop2.ts');
    const { outroFinalePose } = await import('/src/three/outro.ts');
    const { buildBallPose } = await import('/src/three/build.ts');
    const gen = await getLayer3D('gen', null);
    const drop = await getLayer3D('drop2', null);
    const canvas = document.getElementById('c');
    if (Math.abs(genHeight(0, 0) - 1.95) > 1e-9 || genLayout(14 * BEAT).roll !== 1) throw Error('terrain shape or roll timing changed');
    const terrainFill = gen.terrain.fragmentShader.slice(gen.terrain.fragmentShader.lastIndexOf('void main()'));
    if (terrainFill.includes('C_PURPLE *') || terrainFill.includes('C_PLANE *')) throw Error('colored terrain fill remains');
    if (drop.sparks || drop.scene.children.some(child => child.isPoints)) throw Error('random opening cloud remains');
    if (DROP2_SHOTS.map(shot => shot.beat).join(',') !== '0,8,16,24,32') throw Error('shot cuts changed');
    const frames = [];
    for (const time of times) {
      window.__renderAt(time);
      const first = canvas.toDataURL();
      const sample = document.createElement('canvas');
      sample.width = canvas.width;
      sample.height = canvas.height;
      const sampling = sample.getContext('2d', { willReadFrequently: true });
      sampling.drawImage(canvas, 0, 0);
      const firstPixels = sampling.getImageData(0, 0, sample.width, sample.height).data;
      let pose = null;
      if (time >= sectionRange('drop2').start) {
        pose = drop.ballPose(frameAt(time));
        const primary = drop.recapBall ?? drop.ball;
        if (!primary.visible || primary.name !== 'glass-protagonist') throw Error(`protagonist missing at ${time}`);
        if (drop.recapBall && drop.ball.visible) throw Error(`duplicate protagonist at ${time}`);
        if (pose.x < pose.radius || pose.x > 1920 - pose.radius || pose.y < pose.radius || pose.y > 1080 - pose.radius) throw Error(`protagonist outside frame at ${time}`);
        if (time === 68.5 && (!drop.meetingTarget.visible || Math.abs(pose.x - pose.target.x) < 100)) throw Error('meeting actors not distinguishable');
      }
      window.__renderAt(82.5);
      window.__renderAt(54);
      window.__renderAt(time);
      let quantizationDifferences = 0;
      if (first !== canvas.toDataURL()) {
        sampling.drawImage(canvas, 0, 0);
        const repeatedPixels = sampling.getImageData(0, 0, sample.width, sample.height).data;
        let count = 0, maximum = 0, minimumX = 1920, minimumY = 1080, maximumX = 0, maximumY = 0;
        for (let index = 0; index < firstPixels.length; index++) {
          const difference = Math.abs(firstPixels[index] - repeatedPixels[index]);
          if (difference) {
            count++;
            maximum = Math.max(maximum, difference);
            const pixel = Math.floor(index / 4);
            minimumX = Math.min(minimumX, pixel % sample.width);
            maximumX = Math.max(maximumX, pixel % sample.width);
            minimumY = Math.min(minimumY, Math.floor(pixel / sample.width));
            maximumY = Math.max(maximumY, Math.floor(pixel / sample.width));
          }
        }
        if (maximum > 1 || count > 32) return { failure: `frame depends on render history at ${time}`, count, maximum, bounds: [minimumX, minimumY, maximumX, maximumY], first, repeated: canvas.toDataURL() };
        quantizationDifferences = count;
      }
      frames.push({ time, ball: pose, deterministic: true, quantizationDifferences });
    }
    const start = drop.ballPose(frameAt(sectionRange('drop2').start));
    if (start.x !== 960 || start.y !== 540 || start.radius !== 28) throw Error('build entry mismatch');
    const end = drop.ballPose(frameAt(sectionRange('drop2').end - 1e-8));
    for (const key of ['x', 'y', 'radius', 'angle']) if (Math.abs(end[key] - DROP2_BALL_EXIT[key]) > 0.01) throw Error(`outro handoff mismatch: ${key}`);
    window.__renderAt(sectionRange('drop2').end - 1e-8);
    const renderedCenter = drop.ball.position.clone().project(drop.ballCamera);
    const actualExit = {
      x: (renderedCenter.x * 0.5 + 0.5) * 1920,
      y: (0.5 - renderedCenter.y * 0.5) * 1080,
      radius: drop.ball.scale.x * 1.25 * 1080 / (24 * Math.tan(Math.PI / 9)),
      angle: drop.ball.rotation.z,
    };
    for (const key of ['x', 'y', 'radius', 'angle']) if (Math.abs(actualExit[key] - DROP2_BALL_EXIT[key]) > 0.01) throw Error(`rendered exit mismatch: ${key}`);
    const outroEntry = outroFinalePose(0).ball;
    for (const key of ['x', 'y', 'radius', 'angle']) if (Math.abs(end[key] - outroEntry[key]) > 0.01) throw Error(`actual outro entry mismatch: ${key}`);
    const buildExit = buildBallPose(16 - 1e-8);
    if (Math.abs(start.x - buildExit.center[0]) > 0.01 || Math.abs(start.y - buildExit.center[1]) > 0.01 || Math.abs(start.radius - buildExit.radius) > 0.01) throw Error('actual build exit mismatch');
    const anchors = drop.anchors(frameAt(82.5));
    const landing = drop.ballPose(frameAt(82.5));
    if (!anchors.ripple || Math.abs(anchors.ripple[0] - landing.x) > 0.01 || Math.abs(anchors.ripple[1] - landing.y) > 0.01) throw Error('ripple center differs from ball landing');
    return { frames, buildEntry: start, buildExit, outroHandoff: end, actualExit, outroEntry, rippleCenter: anchors.ripple, openingParticles: 0 };
  }, times);
  mkdirSync(output, { recursive: true });
  if (result.failure) {
    for (const key of ['first', 'repeated']) writeFileSync(resolve(output, `diagnostic-${key}.png`), Buffer.from(result[key].split(',')[1], 'base64'));
    throw Error(`${result.failure}: ${JSON.stringify({ count: result.count, maximum: result.maximum, bounds: result.bounds })}`);
  }
  for (const time of times) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  writeFileSync(resolve(output, 'gallery.html'), `<!doctype html><meta charset="utf-8"><title>Landscape and meeting</title><style>body{background:#111;color:#eee;font:18px sans-serif;margin:24px}section{display:inline-block;width:48%;margin:1%}img{width:100%}</style>${times.map(time => `<section><p>${time}s</p><a href="t${time.toFixed(2)}.png"><img src="t${time.toFixed(2)}.png"></a></section>`).join('')}`);
  console.log(JSON.stringify({ output, ...result, browserErrors: errors }));
} finally {
  await browser?.close();
  await server.close();
}
