import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const output = resolve(`reference/process-codex/${new Date().toISOString().replace(/[:.]/g, '-')}-outro-long-turn`);
const beat = 60 / 144;
const outroStart = 200 * beat;
const screenshotTimes = [65.5, 66.5, 83.5, 85.5, 88.5, 84.2, 84.6, 84.8, 84.9, 85, 85.1, 85.4, 86.5, 87, 87.5, 89.9];
mkdirSync(output, { recursive: true });

function pureExports(file, names, globals = {}) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const selected = source.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement)) return names.includes(statement.name?.text);
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source)));
  }).map(statement => statement.getText(source).replace(/^export\s+/, '')).join('\n');
  const compiled = ts.transpileModule(`${selected}\nresult = { ${names.join(', ')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { W: 1920, H: 1080, BEAT: beat, ...globals };
  runInNewContext(compiled, context);
  return context.result;
}

const buildPure = pureExports('src/three/build.ts', ['clamp01', 'inOut', 'buildCenter', 'buildBallPose'], { GEN_CENTER: [1056, 702] });
const drop2Pure = pureExports('src/three/drop2.ts', ['DROP2_BALL_EXIT']);
const outroPure = pureExports('src/three/outro.ts', ['clamp01', 'inOut', 'outroLightReveal', 'outroWordPose', 'outroFinalePose'], drop2Pure);
for (let sample = 0; sample <= 2000; sample++) {
  const seconds = sample / 300;
  assert(!(outroPure.outroFinalePose(seconds / beat).ball.visible && outroPure.outroLightReveal(seconds).visible), 'glass ball overlaps revealed word');
}
assert.equal(JSON.stringify(outroPure.outroFinalePose(0).ball).replace(',"visible":true', ''), JSON.stringify(drop2Pure.DROP2_BALL_EXIT));
const initialPose = JSON.stringify(outroPure.outroWordPose(1.6));
assert.equal(JSON.stringify(outroPure.outroWordPose(4 * beat)), initialPose);
assert.notEqual(JSON.stringify(outroPure.outroWordPose(4 * beat + 0.4)), '{"pitch":0,"yaw":0}');
assert.notEqual(JSON.stringify(outroPure.outroWordPose(4 * beat + 2.4)), '{"pitch":0,"yaw":0}');
assert.equal(JSON.stringify(outroPure.outroWordPose(10 * beat)), '{"pitch":0,"yaw":0}');
let overshoot = 0;
for (let sample = 0; sample <= 2500; sample++) {
  const pose = outroPure.outroWordPose(4 * beat + sample / 1000);
  if (pose.yaw < 0) overshoot = Math.max(overshoot, -pose.yaw, Math.abs(pose.pitch));
}
assert(overshoot > 0 && overshoot <= 2 * Math.PI / 180);
for (const localBeat of [0, 0.4, 2.4, 3.599999, 3.6, 4, 8, 15.999]) {
  const pose = outroPure.outroFinalePose(localBeat);
  assert.notEqual(pose.ball.visible, pose.sealVisible);
  assert.equal(pose.ball.angle, -12 - (pose.ball.x - 960) / pose.ball.radius);
  if (localBeat >= 2.4) assert.equal(pose.ball.x, 960);
  if (localBeat >= 4) assert.equal(pose.ringFade, 0);
}
for (let sample = 0; sample <= 240; sample++) assert.equal(outroPure.outroFinalePose(sample / 100).ball.x, 960);
for (const localSeconds of [0.87, 1.5, 3, 6.6]) assert.equal(outroPure.outroLightReveal(localSeconds).fill, 1);
for (const localBeat of [13.2, 15.5, 16]) {
  assert.equal(buildPure.buildBallPose(localBeat).radius, 28);
  assert.equal(JSON.stringify(buildPure.buildBallPose(localBeat).center), '[960,540]');
}
for (const time of [10 * beat, 5, 6.6]) assert.equal(JSON.stringify(outroPure.outroWordPose(time)), '{"pitch":0,"yaw":0}');
writeFileSync(resolve(output, 'pure-verification.json'), JSON.stringify({ pureFunctions: true, turnSeconds: 6 * beat, overshootDegrees: overshoot * 180 / Math.PI, ballSealExclusive: true, noSlip: true, ringsStopAt: 85, buildHandoff: { center: [960, 540], radius: 28 } }, null, 2));
console.log('Pure finale functions passed');
if (process.argv.includes('--pure-only')) process.exit(0);

const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.PREVIEW_URL ?? `http://127.0.0.1:${server.httpServer.address().port}/?ui=0&scale=${process.env.FINALE_SCALE ?? 0.5}`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 90000 });
  const result = await page.evaluate(async ({ screenshotTimes, outroStart, beat }) => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt, sectionRange } = await import('/src/engine/beat.ts');
    const { outroFinalePose, outroWordPose } = await import('/src/three/outro.ts');
    const { drop2RippleRadii } = await import('/src/three/drop2.ts');
    const build = await getLayer3D('build', null);
    const outro = await getLayer3D('outro', null);
    const drop2 = await getLayer3D('drop2', null);
    const Vector3 = build.ball.position.constructor;
    window.__renderAt(88.5);
    const projectedBounds = mesh => {
      mesh.geometry.computeBoundingBox();
      const bounds = mesh.geometry.boundingBox;
      const points = [];
      for (const horizontal of [bounds.min.x, bounds.max.x]) for (const vertical of [bounds.min.y, bounds.max.y]) for (const depth of [bounds.min.z, bounds.max.z]) {
        const point = new Vector3(horizontal, vertical, depth).applyMatrix4(mesh.matrixWorld).project(outro.cam);
        points.push([(point.x * 0.5 + 0.5) * 1920, (0.5 - point.y * 0.5) * 1080]);
      }
      return { left: Math.min(...points.map(point => point[0])), right: Math.max(...points.map(point => point[0])), top: Math.min(...points.map(point => point[1])), bottom: Math.max(...points.map(point => point[1])) };
    };
    const sealBounds = projectedBounds(outro.brick), wordBounds = projectedBounds(outro.glassWord);
    const caption = document.createElement('canvas').getContext('2d');
    caption.font = '500 30px "Noto Sans SC", Arial, sans-serif'; caption.letterSpacing = '4px';
    const captionRight = 960 + caption.measureText('来斯南京 · 青AI的宁').width / 2;
    const sealWidth = sealBounds.right - sealBounds.left;
    const captionGap = sealBounds.left - captionRight;
    if (sealWidth < 45 || sealWidth > 65 || captionGap < 0 || captionGap > 60 || sealBounds.top - wordBounds.bottom < sealWidth || Math.abs((sealBounds.top + sealBounds.bottom) / 2 - 975) > 24) throw Error(`seal is not grouped with caption: ${JSON.stringify({ sealBounds, wordBounds, captionRight, captionGap })}`);
    const { createOutroOverlay } = await import('/src/overlay2d/outro.ts');
    const overlay = createOutroOverlay(); overlay.render(frameAt(89));
    const signal = overlay.masks.find(mask => mask.layer === 'behind' && mask.role === 'signal').canvas;
    if (signal.getContext('2d').getImageData(0, 0, signal.width, signal.height).data.some((value, index) => index % 4 === 3 && value > 0)) throw Error('duplicate red seal frame remains');
    const canvas = document.getElementById('c');
    const require = (condition, message) => { if (!condition) throw Error(message); };
    const captures = [];
    const states = [];
    const settled = new Set();
    let topMargin = Infinity;
    let quantizationDifferences = 0;
    for (const time of screenshotTimes) {
      window.__renderAt(time);
      if (time < 70) {
        require(build.ball.visible && build.ball.name === 'glass-protagonist', 'build shared glass sphere missing');
        const center = build.ball.getWorldPosition(new Vector3()).project(build.cam);
        require(Math.abs(center.x) < 1e-8 && Math.abs(center.y) < 1e-8, 'build handoff is not screen center');
        require(build.ball.children[1].isLineSegments, 'build globe lines missing');
      } else {
        const localSeconds = time - outroStart;
        const localBeat = localSeconds / beat;
        const pose = outroFinalePose(localBeat);
        require(outro.ball.visible === pose.ball.visible && outro.brick.visible === pose.sealVisible, 'ball/seal visibility differs from pure pose');
        require(!(outro.ball.visible && outro.brick.visible), 'ball and seal overlap');
        require(!(outro.ball.visible && outro.glassWord.visible), 'ball and word overlap');
        require(outro.ball.name === 'glass-protagonist' && outro.ball.children[1].isLineSegments, 'outro shared glass sphere missing');
        const wordPose = outroWordPose(localSeconds);
        require(outro.glassWord.rotation.x === wordPose.pitch && outro.glassWord.rotation.y === wordPose.yaw, 'rendered word turn differs from pure curve');
        require(outro.wordReveal.uWordFill.value === 1, 'hollow outline reveal remains');
        require(outro.glassWord.material.transmission === 1, 'transparent glass material changed');
        require(outro.disc.rotation.x === 0 && outro.disc.rotation.y === 0, 'rings tilt against word turn');
        if (localBeat >= 4) require(outro.rings.every(ring => !ring.visible) && outro.impactRings.every(ring => !ring.visible), 'rings keep moving during word turn');
        if (time >= 87.5) {
          require(outro.glassWord.rotation.x === 0 && outro.glassWord.rotation.y === 0, 'word does not settle at exact zero');
          settled.add(outro.glassWord.rotation.toArray().join(','));
        }
        const bounds = outro.glassWord.geometry.boundingBox;
        for (const horizontal of [bounds.min.x, bounds.max.x]) {
          for (const vertical of [bounds.min.y, bounds.max.y]) {
            for (const depth of [bounds.min.z, bounds.max.z]) {
              const point = new Vector3(horizontal, vertical, depth).applyMatrix4(outro.glassWord.matrixWorld).project(outro.cam);
              const screenY = (1 - point.y) * 540;
              topMargin = Math.min(topMargin, screenY);
              require(screenY >= 48 && screenY <= 1032 && Math.abs(point.x) <= 0.95, 'word exceeds safe frame');
            }
          }
        }
        states.push({ time, ballVisible: outro.ball.visible, sealVisible: outro.brick.visible, pitch: wordPose.pitch, yaw: wordPose.yaw });
      }
      const first = canvas.toDataURL();
      if (time === 84.2 || time === 84.9) {
        const sampleCanvas = document.createElement('canvas');
        sampleCanvas.width = canvas.width;
        sampleCanvas.height = canvas.height;
        const context = sampleCanvas.getContext('2d');
        context.drawImage(canvas, 0, 0);
        const pixel = context.getImageData(Math.round(1150 / 1920 * canvas.width), Math.round(900 / 1080 * canvas.height), 1, 1).data;
        require(pixel[0] - pixel[2] >= 6, 'neutral rectangular artifact covers paper during reveal');
      }
      window.__renderAt(time < 70 ? 88.5 : 65.5);
      window.__renderAt(83.5);
      window.__renderAt(time);
      const repeated = canvas.toDataURL();
      if (first !== repeated) {
        const pixels = await Promise.all([first, repeated].map(async source => {
          const image = new Image(); image.src = source; await image.decode();
          const scratch = document.createElement('canvas'); scratch.width = canvas.width; scratch.height = canvas.height;
          const context = scratch.getContext('2d'); context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, scratch.width, scratch.height).data;
        }));
        let count = 0, maximum = 0;
        for (let index = 0; index < pixels[0].length; index++) {
          const difference = Math.abs(pixels[0][index] - pixels[1][index]);
          if (difference) count++;
          maximum = Math.max(maximum, difference);
        }
        require(maximum <= 1 && count <= 64, `unordered frame mismatch at ${time}: ${count} channels, max ${maximum}`);
        quantizationDifferences += count;
      }
      captures.push({ time, data: first.split(',')[1] });
    }
    window.__renderAt(outroStart);
    const drop2ExitFrame = { ...frameAt(outroStart), section: 'drop2', lt: 40 * beat, sectionStart: sectionRange('drop2').start };
    const exitPose = drop2.ballPose(drop2ExitFrame);
    const entryPose = outroFinalePose(0).ball;
    for (const component of ['x', 'y', 'radius', 'angle']) require(Math.abs(exitPose[component] - entryPose[component]) < 1e-6, `drop2/outro ${component} handoff discontinuity`);
    const initialDrop2Frame = frameAt(sectionRange('drop2').start);
    const initialDrop2Pose = drop2.ballPose(initialDrop2Frame);
    require(initialDrop2Pose.x === 960 && initialDrop2Pose.y === 540 && initialDrop2Pose.radius === 28, 'build/drop2 handoff discontinuity');
    const previousRadii = drop2RippleRadii(40);
    require(outro.rings.length === previousRadii.length, 'ripple count discontinuity');
    outro.rings.forEach((ring, index) => {
      const edge = new Vector3(ring.scale.x, 0, 0).project(outro.cam);
      require(Math.abs(edge.x * 960 - previousRadii[index]) < 1e-6, 'ripple radius discontinuity');
    });
    const sealScales = new Set();
    for (const time of [84.833334, 85.5, 88.5, 89.9]) {
      window.__renderAt(time);
      require(outro.brick.visible && !outro.ball.visible, 'hard swap failed');
      sealScales.add(outro.brick.scale.toArray().join(','));
    }
    require(sealScales.size === 1, 'seal deforms');
    require(settled.size === 1, 'word drifts after settling');
    return { captures, states, topMargin, titleClearance: sealBounds.top - wordBounds.bottom, captionGap, projectedSealWidth: sealBounds.right - sealBounds.left, quantizationDifferences, unorderedPixelsIdentical: quantizationDifferences === 0, inheritedRippleRadii: previousRadii, fixedSealScale: true, drop2ExitPose: exitPose, bothBallHandoffsMatched: true, screenshotResolution: [canvas.width, canvas.height] };
  }, { screenshotTimes, outroStart, beat });
  for (const capture of result.captures) writeFileSync(resolve(output, `t${capture.time.toFixed(2)}.png`), Buffer.from(capture.data, 'base64'));
  delete result.captures;
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify({ ...result, browserErrors: errors }, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
