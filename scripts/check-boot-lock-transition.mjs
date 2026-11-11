import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const output = resolve('out/combined/boot-lock-transition');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const { bootDegreePose } = await import('/src/overlay2d/boot.ts');
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt, sectionRange } = await import('/src/engine/beat.ts');
    const lock = await getLayer3D('lock', null);
    const boundary = sectionRange('lock').start;
    const degree = bootDegreePose(16);
    window.__renderAt(boundary);
    if (!lock.entryRing?.visible || lock.glass.visible) throw Error('degree contour is not carried into the lock entry');
    const center = lock.anchors(frameAt(boundary)).sphereCenter;
    if (Math.hypot(center[0] - degree.center[0], center[1] - degree.center[1]) > 0.01 || degree.radius !== 190) throw Error('degree-to-ball landing mismatch');
    const samples = [];
    for (const offset of [-0.5, -0.25, -0.1, 0, 0.1, 0.25, 0.5]) {
      const time = boundary + offset;
      window.__renderAt(time);
      samples.push({ time, image: document.getElementById('c').toDataURL() });
    }
    return { degree, center, samples };
  });
  mkdirSync(output, { recursive: true });
  for (const sample of result.samples) {
    writeFileSync(resolve(output, `t${sample.time.toFixed(3)}.png`), Buffer.from(sample.image.split(',')[1], 'base64'));
    delete sample.image;
  }
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, degree: result.degree, center: result.center }));
} finally {
  await browser?.close();
  await server.close();
}
