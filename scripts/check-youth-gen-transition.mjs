import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const baseline = process.argv.includes('--baseline');
const wired = process.argv.includes('--preview-wiring');
const directory = resolve('out/combined/youth-gen-transition');
const label = baseline ? 'baseline' : wired ? 'wired' : 'current';
const parentWiringPresent = /\byouthGenNight\(/.test(readFileSync('src/main.ts', 'utf8'));
const protectedPaths = ['src/main.ts', 'src/three/index.ts', 'src/engine/compositor.ts', 'music/structure.json', 'music/events.json', 'out/music/score.wav', '../PROGRESS.md', '../VISUAL_TASKS.md', '../CLAUDE_HANDOFF.md'];
const protectedHashes = Object.fromEntries(protectedPaths.filter(existsSync).map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const baselineReportPath = resolve(directory, 'baseline-verification.json');
const baselineReport = !baseline && existsSync(baselineReportPath) ? JSON.parse(readFileSync(baselineReportPath, 'utf8')) : null;
const baselineHandoff = baselineReport ? [59.5, 59.99, 60].map(time => ({ time, image: `data:image/png;base64,${readFileSync(resolve(directory, `baseline-t${time.toFixed(3)}.png`)).toString('base64')}` })) : [];
const previewPlugin = {
  name: 'youth-gen-wiring-preview',
  enforce: 'pre',
  transform(source, id) {
    if (!wired) return;
    if (id.endsWith('/src/main.ts')) {
      if (/\byouthGenNight\(/.test(source)) return;
      return `import { youthGenNight } from './three/youthGenTransition';\n${source}`.replace(
        "const paper = frame.section === 'boot' || frame.paper;",
        "const paper = frame.section === 'youth' || frame.section === 'gen' ? 1 - youthGenNight(frame.t) : frame.section === 'boot' || frame.paper;",
      );
    }
    if (id.endsWith('/src/engine/compositor.ts')) {
      return source.replace('uniforms.uPaper!.value = paper ? 1 : 0;', "uniforms.uPaper!.value = typeof paper === 'number' ? paper : paper ? 1 : 0;");
    }
  },
};
const server = await createServer({ plugins: [previewPlugin], server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 }).catch(error => {
    throw new Error(`${error.message}; browser errors: ${errors.join('; ') || 'none'}`);
  });
  const result = await page.evaluate(async ({ wired, baseline, baselineHandoff, parentWiringPresent }) => {
    const { frameAt, sectionRange, BEAT, TOTAL } = await import('/src/engine/beat.ts');
    const { getLayer3D } = await import('/src/three/index.ts');
    const { Vector3, Matrix4, Vector4 } = await import('/node_modules/three/build/three.module.js');
    const { youthCurve } = await import('/src/three/youth.ts');
    const youth = await getLayer3D('youth', null);
    const gen = await getLayer3D('gen', null);
    const boundary = sectionRange('gen').start;
    const failures = [];
    const check = (condition, message) => { if (!condition) failures.push(message); };
    const beforeFrame = { ...frameAt(boundary - 1e-7), lt: boundary - sectionRange('youth').start };
    const afterFrame = frameAt(boundary);
    const before = youth.backgroundCamera(beforeFrame);
    const after = gen.backgroundCamera(afterFrame);
    const cameraJump = before.position.distanceTo(after.position);
    const cameraAngle = before.quaternion.angleTo(after.quaternion);
    check(cameraJump < 1e-5 && cameraAngle < 1e-6 && Math.abs(before.fov - after.fov) < 1e-7, `camera resets at 53.33s: ${cameraJump.toFixed(3)} units / ${cameraAngle.toFixed(3)} radians`);
    const ascent = [-0.25, -0.1, 0, 0.1, 0.25].map(offset => {
      const frame = frameAt(boundary + offset);
      const camera = (offset < 0 ? youth : gen).backgroundCamera(frame);
      const direction = camera.getWorldDirection(new Vector3());
      return { offset, height: camera.position.y, pitch: Math.asin(-direction.y) };
    });
    check(ascent.every((sample, index) => index === 0 || sample.height > ascent[index - 1].height), 'camera does not continue ascending across the boundary');
    check(ascent.every(sample => sample.pitch > 0.6), 'camera is not looking down during ascent');
    check(ascent.every((sample, index) => index === 0 || sample.pitch > ascent[index - 1].pitch), 'camera tilt reverses during the boundary ascent');
    const derivativeStep = 1e-4;
    const cameraBefore = youth.backgroundCamera(frameAt(boundary - derivativeStep));
    const cameraAfter = gen.backgroundCamera(frameAt(boundary + derivativeStep));
    const velocityBefore = before.position.clone().sub(cameraBefore.position).divideScalar(derivativeStep);
    const velocityAfter = cameraAfter.position.clone().sub(after.position).divideScalar(derivativeStep);
    const velocityJump = velocityBefore.distanceTo(velocityAfter);
    check(velocityJump < 0.2, `camera velocity jumps ${velocityJump.toFixed(3)} units/s`);
    const nightSamples = [];
    let maximumCurveJump = null;
    if (!baseline) {
      const { youthGenNight, youthGenLine } = await import('/src/three/youthGenTransition.ts');
      for (const [offset, expected] of [[-BEAT / 2, 0], [0, 0.5], [BEAT / 2, 1]]) {
        const night = youthGenNight(boundary + offset);
        nightSamples.push({ offset, night });
        check(Math.abs(night - expected) < 1e-10, `night transition is not one continuous beat at ${offset}s`);
      }
      check(youthGenNight(40) === 0 && youthGenNight(60) === 1, 'night transition leaks into another section');
      check(youthGenLine(boundary - BEAT) < 1e-10 && youthGenLine(boundary) === 1, 'leaf-to-line transformation does not settle before terrain formation');
      check(youth.protagonist() === youth.ball, 'youth protagonist getter no longer returns the shared ball');
      window.__renderAt(boundary);
      const contours = gen.world.children.find(mesh => mesh.geometry?.attributes.aYouth);
      const attributes = contours.geometry.attributes;
      check(attributes.aCurve.count === 9 * 161 * 2, 'terrain no longer receives nine complete leaf curves');
      maximumCurveJump = 0;
      for (let curve = 0; curve < 9; curve++) {
        for (let sample = 0; sample <= 160; sample++) {
          const index = (curve * 161 + sample) * 2;
          const along = attributes.aAlong.getX(index);
          const expected = youthCurve(curve, along, boundary - sectionRange('youth').start);
          const projected = new Vector4(attributes.position.getX(index), attributes.position.getY(index), attributes.position.getZ(index), 1).applyMatrix4(contours.matrixWorld).applyMatrix4(gen.camera.matrixWorldInverse).applyMatrix4(gen.camera.projectionMatrix);
          projected.x += 0.1 * projected.w; projected.y -= 0.3 * projected.w;
          const phase = along * 3.1 + curve * 0.9;
          const youthY = attributes.aYouth.getY(index) + 0.13 * (Math.sin(phase + gen.contours.uniforms.uYouthPhase.value) - Math.sin(phase + gen.contours.uniforms.uYouthStart.value));
          const form = gen.contours.uniforms.uForm.value;
          const actual = [attributes.aYouth.getX(index) * (1 - form) + projected.x / projected.w * form, youthY * (1 - form) + projected.y / projected.w * form];
          maximumCurveJump = Math.max(maximumCurveJump, Math.hypot((actual[0] - expected[0]) * 960, (actual[1] - expected[1]) * 540));
        }
      }
      check(maximumCurveJump < 0.001, `leaf curves jump ${maximumCurveJump.toFixed(4)} screen pixels`);
    }
    const images = [];
    const offsets = [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5];
    for (const offset of offsets) {
      const time = boundary + offset;
      window.__renderAt(time);
      images.push({ offset, time, image: document.getElementById('c').toDataURL() });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 480; canvas.height = 270;
    const context = canvas.getContext('2d');
    const pixelsAt = time => {
      window.__renderAt(time);
      context.drawImage(document.getElementById('c'), 0, 0, 480, 270);
      return context.getImageData(0, 0, 480, 270).data;
    };
    const luminance = pixels => {
      let sum = 0;
      for (let index = 0; index < pixels.length; index += 4) sum += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
      return sum / (pixels.length / 4);
    };
    const boundaryLuminanceJump = Math.abs(luminance(pixelsAt(boundary - 1e-5)) - luminance(pixelsAt(boundary)));
    if (wired || parentWiringPresent || baseline) check(boundaryLuminanceJump < 4, `paper flips to ink in one frame: ${boundaryLuminanceJump.toFixed(2)} display levels`);
    const seekDifferences = [];
    for (const time of [boundary - 0.25, boundary, boundary + 0.1, boundary + 0.5, 59.99]) {
      const first = pixelsAt(time);
      window.__renderAt(38);
      const second = pixelsAt(time);
      let difference = 0;
      for (let index = 0; index < first.length; index++) difference = Math.max(difference, Math.abs(first[index] - second[index]));
      seekDifferences.push({ time, difference });
      check(difference <= 1, `seek order changes ${time}s by ${difference} levels`);
    }
    window.__renderAt(boundary - 1e-5);
    const matrix = new Matrix4();
    const leafWidths = [];
    for (let index = 0; index < youth.leaves.count; index++) {
      youth.leaves.getMatrixAt(index, matrix);
      leafWidths.push(Math.hypot(...matrix.elements.slice(0, 3)));
    }
    check(Math.max(...leafWidths) < 0.002, 'leaf silhouettes still hard-cut into continuous contours');
    check(TOTAL === 90 && sectionRange('build').start === 60, 'music duration or gen-to-build boundary changed');
    const handoff = [];
    const handoffDifferences = [];
    for (const time of [59.5, 59.99, 60]) {
      window.__renderAt(time);
      handoff.push({ time, image: document.getElementById('c').toDataURL() });
      const reference = baselineHandoff.find(sample => sample.time === time);
      if (reference) {
        const currentImage = new Image(); currentImage.src = handoff.at(-1).image; await currentImage.decode();
        context.drawImage(currentImage, 0, 0, 480, 270);
        const current = context.getImageData(0, 0, 480, 270).data;
        const image = new Image(); image.src = reference.image; await image.decode();
        context.drawImage(image, 0, 0, 480, 270);
        const original = context.getImageData(0, 0, 480, 270).data;
        let sum = 0, changed = 0;
        for (let index = 0; index < current.length; index++) {
          const difference = Math.abs(current[index] - original[index]);
          sum += difference;
          if (difference) changed++;
        }
        const mean = sum / current.length;
        handoffDifferences.push({ time, mean, changed });
        const { PALETTE } = await import('/src/engine/palette.glsl.ts');
        const paletteUpdated = PALETTE.gold.every((value, index) => value === PALETTE.paper[index]);
        if (!paletteUpdated) check(mean < 0.01, `gen-to-build handoff differs from original at ${time}s by ${mean.toFixed(4)} mean levels`);
      }
    }
    const strip = document.createElement('canvas');
    strip.width = 7 * 480; strip.height = 294;
    const stripContext = strip.getContext('2d');
    for (const [index, sample] of images.entries()) {
      const image = new Image(); image.src = sample.image; await image.decode();
      stripContext.drawImage(image, index * 480, 24, 480, 270);
      stripContext.fillStyle = '#ffffff'; stripContext.font = '16px sans-serif';
      stripContext.fillText(`${sample.offset > 0 ? '+' : ''}${sample.offset}s / ${sample.time.toFixed(3)}s`, index * 480 + 12, 18);
    }
    return { boundary, cameraJump, cameraAngle, velocityJump, maximumCurveJump, nightSamples, ascent, boundaryLuminanceJump, seekDifferences, handoffDifferences, failures, images, handoff, strip: strip.toDataURL(), parentWiringRequired: !parentWiringPresent, wiringSimulated: wired };
  }, { wired, baseline, baselineHandoff, parentWiringPresent });
  mkdirSync(directory, { recursive: true });
  for (const sample of [...result.images, ...result.handoff]) {
    writeFileSync(resolve(directory, `${label}-t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  writeFileSync(resolve(directory, `${label}-strip.png`), Buffer.from(result.strip.split(',')[1], 'base64'));
  delete result.strip;
  result.protectedHashes = protectedHashes;
  if (baselineReport) {
    result.protectedChanges = protectedPaths.filter(path => baselineReport.protectedHashes[path] !== protectedHashes[path]);
    const lockedChanges = result.protectedChanges.filter(path => path.startsWith('music/') || path.startsWith('out/music/'));
    if (lockedChanges.length) result.failures.push(`locked music changed: ${lockedChanges.join(', ')}`);
    result.sharedDocumentUpdates = result.protectedChanges.filter(path => path.startsWith('../'));
  }
  result.browserErrors = errors;
  if (errors.length) result.failures.push(...errors);
  writeFileSync(resolve(directory, `${label}-verification.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, protectedHashes: undefined }));
  if (result.failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await server.close();
}
