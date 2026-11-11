import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const folder = `reference/process-codex/${new Date().toISOString().replace(/[:.]/g, '-')}-cinema-player`;
mkdirSync(folder, { recursive: true });
const hashes = () => Object.fromEntries(readdirSync('src', { recursive: true }).filter(name => name.endsWith('.ts')).map(name => [name, createHash('sha256').update(readFileSync(`src/${name}`)).digest('hex')]));
const before = hashes();
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/out/preview/index.html`);
  await page.locator('#fullscreen').waitFor({ timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('#live')?.contentWindow?.__ready && !document.querySelector('#toggle').disabled, undefined, { timeout: 120000 });
  const frame = page.frameLocator('#live');
  const identity = await page.locator('#live').evaluate(element => {
    element.contentWindow.__cinemaIdentity = 'same-renderer';
    return element.contentWindow.document.getElementById('c').toDataURL();
  });
  assert.ok(identity.length > 1000);
  const player = await page.locator('#player').boundingBox();
  assert.ok(player.y < 180 && player.y + player.height <= 1000, 'Player and controls must fit on the desktop first screen');
  const fitSamples = [];
  async function checkFit(mode) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const sample = await page.evaluate(() => {
      const player = document.getElementById('player'), screen = document.querySelector('.screen'), frame = document.getElementById('live');
      const rect = element => { const bounds = element.getBoundingClientRect(); return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; };
      return { viewport: [innerWidth, innerHeight], player: rect(player), playerInnerWidth: player.clientWidth, screen: rect(screen), controls: rect(document.querySelector('.transport')), childViewport: [frame.contentWindow.innerWidth, frame.contentWindow.innerHeight], canvas: rect(frame.contentDocument.getElementById('c')) };
    });
    fitSamples.push({ mode, ...sample });
    await page.screenshot({ path: resolve(folder, `${mode}-${sample.viewport.join('x')}.png`) });
    assert.ok(Math.abs(sample.screen.width - sample.playerInnerWidth) < 1.5, `${mode}: screen width must fill player, no one-sided black block`);
    assert.ok(Math.abs(sample.canvas.x * 2 + sample.canvas.width - sample.childViewport[0]) < 2, `${mode}: horizontal letterboxing must be symmetric`);
    assert.ok(Math.abs(sample.canvas.y * 2 + sample.canvas.height - sample.childViewport[1]) < 2, `${mode}: vertical letterboxing must be symmetric`);
    assert.ok(Math.abs(sample.canvas.width / sample.canvas.height - 16 / 9) < 0.005, `${mode}: do not stretch film`);
    if (mode === 'normal') assert.ok(Math.abs(sample.screen.width / sample.screen.height - 16 / 9) < 0.005, 'Normal player must retain 16:9 frame');
    else {
      assert.ok(Math.abs(sample.player.height - sample.viewport[1]) < 2, 'Fullscreen player must fill viewport height');
      assert.ok(Math.abs(sample.controls.y + sample.controls.height - sample.viewport[1]) < 2, 'Fullscreen controls must touch viewport bottom');
    }
  }
  for (const viewport of [{ width: 1920, height: 900 }, { width: 2560, height: 1350 }, { width: 2560, height: 1600 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    await checkFit('normal');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-time="85"]').click();
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#live').contentDocument.getElementById('seek').value) - 85) < 1 / 30);
  await page.locator('#toggle').click();
  await page.waitForFunction(() => document.querySelector('#toggle').getAttribute('aria-pressed') === 'true');
  await page.locator('#toggle').click();
  await page.waitForFunction(() => document.querySelector('#toggle').getAttribute('aria-pressed') === 'false');
  await page.locator('#timeline').evaluate(element => { element.value = '40'; element.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => Math.abs(Number(document.querySelector('#live').contentDocument.getElementById('seek').value) - 40) < 1 / 30);
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'player');
  assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'true');
  for (const viewport of [{ width: 2560, height: 1600 }, { width: 1920, height: 1080 }, { width: 1440, height: 1000 }]) {
    await page.setViewportSize(viewport);
    await checkFit('fullscreen');
  }
  const fullscreenBounds = await page.locator('#player').boundingBox(), controlsBounds = await page.locator('.transport').boundingBox();
  assert.ok(Math.abs(fullscreenBounds.y + fullscreenBounds.height - controlsBounds.y - controlsBounds.height) < 2, 'Fullscreen controls must sit at the bottom without unused space');
  await page.screenshot({ path: resolve(folder, 'fullscreen.png') });
  assert.equal(await page.locator('#live').evaluate(element => element.contentWindow.__cinemaIdentity), 'same-renderer');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await page.locator('#fullscreen').getAttribute('aria-pressed'), 'false');
  await frame.locator('body').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.fullscreenElement?.id === 'player');
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.evaluate(() => { document.getElementById('player').requestFullscreen = async () => { throw Error('Denied for fallback test'); }; });
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => document.body.classList.contains('cinema-mode'));
  await checkFit('fallback');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.body.classList.contains('cinema-mode'));
  assert.equal(await page.locator('details[open]').count(), 0);
  await page.locator('#archives summary').click();
  assert.equal(await page.locator('#archives[open]').count(), 1);
  await page.locator('#archives summary').click();
  mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: resolve(folder, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout must not overflow horizontally');
  await page.screenshot({ path: resolve(folder, 'mobile.png'), fullPage: true });
  assert.deepEqual(hashes(), before, 'Film source must not change');
  assert.deepEqual(errors, []);
  writeFileSync(resolve(folder, 'report.json'), JSON.stringify({ nativeFullscreen: true, fullscreenFallback: true, noRendererReload: true, playPause: true, seek: true, sceneJump: true, keyboardFullscreen: true, mobile: true, filmSourceUnchanged: true, fitSamples, errors }, null, 2));
  console.log(JSON.stringify({ folder, passed: true, errors }));
} finally { await browser?.close(); await server.close(); }
