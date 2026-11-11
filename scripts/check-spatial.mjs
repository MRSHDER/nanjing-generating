import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?ui=0&scale=0.5`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 60000 });
  const result = await page.evaluate(async () => {
    const { PerspectiveCamera } = await import('/node_modules/three/build/three.module.js');
    const { projectPath } = await import('/src/overlay2d/spatial.ts');
    const { createYouthOverlay } = await import('/src/overlay2d/youth.ts');
    const { createGenOverlay } = await import('/src/overlay2d/gen.ts');
    const { frameAt } = await import('/src/engine/beat.ts');
    const camera = new PerspectiveCamera(42, 1920 / 1080, 0.1, 9000);
    camera.position.set(0, 5, 20);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const projected = projectPath([[-2, 0, 0], [2, 0, 0]], camera);
    if (projected.length !== 2 || projected.some(point => point.some(value => !Number.isFinite(value)))) throw Error('projection invalid');
    const hidden = projectPath([[-2, 5, 30], [2, 5, 30]], camera);
    if (hidden.length) throw Error('behind-camera path visible');
    const crossing = projectPath([[-2, 0, 0], [2, 5, 30]], camera);
    if (crossing.some(point => point.some(value => !Number.isFinite(value) || Math.abs(value) > 2000))) throw Error('clip failed');
    const youth = createYouthOverlay();
    const gen = createGenOverlay();
    const digest = overlay => overlay.masks.filter(mask => mask.layer === 'behind').map(mask => mask.canvas.toDataURL()).join('');
    for (const [overlay, time] of [[youth, 43.6], [gen, 55.5]]) {
      const frame = frameAt(time);
      overlay.render(frame, camera);
      const first = digest(overlay);
      camera.position.x += 6;
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      overlay.render(frame, camera);
      if (first === digest(overlay)) throw Error('background ignores actual camera');
      if (overlay.backing.getContext('2d').getImageData(0, 0, 1920, 1080).data.some(value => value !== 0)) throw Error('permanent panel backing remains');
      camera.position.x -= 6;
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      overlay.render(frame, camera);
      if (first !== digest(overlay)) throw Error('camera projection not deterministic');
    }
    return { cameraDriven: true, clipped: true, deterministic: true, noPermanentPanels: true };
  });
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
