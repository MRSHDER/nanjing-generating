// 从主播放器（index.html / main.ts）取合成静帧（Claude 自用验收工具）。
//   node src/three/dev/shoot-main.mjs --t 7.5,12 --out /tmp/x [--scale 0.5]
// 也可视频：node src/three/dev/shoot-main.mjs video --from 60 --to 66.67 --out out.mp4 [--fps 30]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const mode = args[0] === 'video' ? 'video' : 'stills';
const scale = parseFloat(opt('scale', '0.5'));
const out = resolve(opt('out', '/tmp/main'));
const server = await createServer({ server: { port: 5199, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Math.round(1920 * scale), height: Math.round(1080 * scale) } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('[error]', m.text()); });
await page.goto(`http://localhost:${server.config.server.port}/index.html?ui=0&scale=${scale}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
const grab = (t) => page.evaluate((time) => { window.__renderAt(time); return document.getElementById('c').toDataURL('image/png'); }, t);
if (mode === 'stills') {
  mkdirSync(out, { recursive: true });
  for (const t of opt('t', '10').split(',').map(Number)) {
    const png = await grab(t);
    writeFileSync(resolve(out, `main-${t.toFixed(2)}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  console.log('saved', out);
} else {
  mkdirSync(dirname(out), { recursive: true });
  const fps = parseFloat(opt('fps', '30')), t0 = parseFloat(opt('from', '0')), t1 = parseFloat(opt('to', '10'));
  const n = Math.round((t1 - t0) * fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-ss', String(t0), '-t', String(t1 - t0), '-i', resolve('out/music/score.wav'),
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-shortest', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < n; i++) {
    const png = await grab(t0 + i / fps);
    ff.stdin.write(Buffer.from(png.split(',')[1], 'base64'));
    if (i % 60 === 0) console.log(`frame ${i}/${n}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log('saved', out);
}
await browser.close();
await server.close();
