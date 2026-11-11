import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'out/combined/opening-steps');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?ui=0&scale=0.5`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const { steppedBeat, flowBeat, openingBeat } = await import('/src/overlay2d/rhythm.ts');
    const { createBootOverlay } = await import('/src/overlay2d/boot.ts');
    const { createLockOverlay } = await import('/src/overlay2d/lock.ts');
    const { default: LockLayer, lockCut } = await import('/src/three/lock.ts');
    const { frameAt, BEAT } = await import('/src/engine/beat.ts');
    const { PerspectiveCamera } = await import('/node_modules/three/build/three.module.js');
    const boot = createBootOverlay(); const lock = createLockOverlay(); const layer = new LockLayer();
    const camera = new PerspectiveCamera(30, 1920 / 1080, 0.1, 100);
    camera.lookAt(0, 0, -1); camera.updateMatrixWorld(true);
    const digest = overlay => overlay.masks.map(mask => mask.canvas.toDataURL()).join('');
    for (let beat = 0; beat < 14; beat++) {
      if (steppedBeat(beat + 0.3) !== steppedBeat(beat + 0.9)) throw Error('no beat hold');
      boot.render({ localBeat: beat + 0.3, kick: 0 }); const first = digest(boot);
      boot.render({ localBeat: beat + 0.9, kick: 1 }); if (first !== digest(boot)) throw Error('boot bounces or changes during hold');
    }
    if (openingBeat(6 / BEAT - 0.000001) - openingBeat(6 / BEAT) > 0.0001) throw Error('six-second seam jumps');
    if (flowBeat(0.3) === flowBeat(0.9)) throw Error('lock still holds each beat');
    const slow = flowBeat(0.05) - flowBeat(0);
    const fast = flowBeat(1.05) - flowBeat(1);
    if (fast < slow * 3) throw Error('speed modulation missing');
    for (let beat = 0; beat < 14; beat++) {
      const firstFrame = frameAt((16 + beat + 0.3) * BEAT);
      const secondFrame = frameAt((16 + beat + 0.9) * BEAT);
      lock.render({localBeat: beat + 0.3}, firstFrame, camera); const map = digest(lock);
      lock.render({localBeat: beat + 0.9}, secondFrame, camera); if (map === digest(lock)) throw Error('map still holds each beat');
      if (beat < 14) {
        const firstState = layer.state(firstFrame); const secondState = layer.state(secondFrame);
        if (firstState.rotY === secondState.rotY) throw Error('sphere still holds each beat');
      }
    }
    if (!lockCut(15.149).showSphere || !lockCut(15.15).showBrick) throw Error('speed cut changed');
    for (const time of [0.8, 2.9, 3.4, 5.8, 7.5, 9.6, 11.9, 12.93, 12.99]) {
      window.__renderAt(time); const first = document.getElementById('c').toDataURL(); window.__renderAt(18); window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error('combined random-access differs');
    }
    return { firstSixSecondsPreserved: true, kickIndependent: true, continuousSpeedVariation: true, speedCutPreserved: true, deterministic: true, eightBeatsSeconds: 8 * BEAT };
  });
  mkdirSync(output, { recursive: true });
  for (const time of [0.8, 2.9, 3.4, 5.8, 7.5, 9.6, 11.9, 12.93, 12.99]) {
    const data = await page.evaluate(time => { window.__renderAt(time); return document.getElementById('c').toDataURL().split(',')[1]; }, time);
    writeFileSync(resolve(output, `t${time.toFixed(2)}.png`), Buffer.from(data, 'base64'));
  }
  if (errors.length) throw Error(errors.join('; '));
  if (process.argv.includes('--video')) {
    const video = await page.evaluate(async () => {
      const audio = new Audio('/out/music/score.wav');
      const context = new AudioContext();
      const source = context.createMediaElementSource(audio);
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      const stream = document.getElementById('c').captureStream(30);
      destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
      const chunks = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = reject; });
      let animation;
      try {
        window.__renderAt(0);
        await context.resume();
        recorder.start();
        await audio.play();
        const tick = () => {
          window.__renderAt(Math.min(13.45, audio.currentTime));
          if (audio.currentTime >= 13.45) { audio.pause(); recorder.stop(); }
          else animation = requestAnimationFrame(tick);
        };
        tick(); await stopped;
        return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(';base64,')[1]); reader.onerror = reject; reader.readAsDataURL(new Blob(chunks, { type: recorder.mimeType })); });
      } finally {
        cancelAnimationFrame(animation); audio.pause();
        if (recorder.state !== 'inactive') recorder.stop();
        stream.getTracks().forEach(track => track.stop());
        source.disconnect(); await context.close();
      }
    });
    writeFileSync(resolve(output, 'opening-stepped-v3.webm'), Buffer.from(video, 'base64'));
    result.reviewVideo = 'opening-stepped-v3.webm';
    result.reviewDuration = 13.45;
  }
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
