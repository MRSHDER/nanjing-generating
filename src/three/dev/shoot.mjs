// 三维层取帧（Claude 自用；正式导出由 Codex 的 scripts/render.mjs 负责）。
//   静帧：node src/three/dev/shoot.mjs stills --s boot --t 0.5,2,4 --out out/three/boot [--scale 0.5]
//   视频：node src/three/dev/shoot.mjs video  --s boot --fps 30 --out out/three/boot.mp4 [--scale 0.5]
// 浏览器：默认用本机 Chrome；CHROME_PATH 可指定；云端无显卡时自动用软件渲染（SwiftShader）。
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const section = opt('s', 'boot');
const scale = parseFloat(opt('scale', '1'));
const out = resolve(opt('out', `out/three/${section}${mode === 'video' ? '.mp4' : ''}`));

const S = JSON.parse(readFileSync(resolve('music/structure.json'), 'utf8'));
const BAR = (60 / S.bpm) * S.beatsPerBar;
const sec = S.sections.find((x) => x.id === section);
const t0 = sec.startBar * BAR, t1 = (sec.startBar + sec.bars) * BAR;

// 关闭热更新与文件监听：渲染途中改动源文件不会让页面刷新、中断长时间渲染
const server = await createServer({ server: { port: 5198, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const lab = opt('lab', '');
const url = `http://localhost:${server.config.server.port}/src/three/dev/index.html?s=${section}&scale=${scale}${lab ? `&lab=${lab}` : ''}`;
const launch = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch({
  headless: true, ...launch,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: Math.round(1920 * scale), height: Math.round(1080 * scale) } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error(`[${m.type()}]`, m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });

const grab = (t) => page.evaluate((time) => { window.__renderAt(time); return document.getElementById('c').toDataURL('image/png'); }, t);

if (mode === 'stills') {
  mkdirSync(out, { recursive: true });
  const ts = opt('t', '0.5,1.5,3,5,7').split(',').map(Number);
  for (const lt of ts) {
    const png = await grab(t0 + lt);
    const f = resolve(out, `${lab || section}-${lt.toFixed(2)}.png`);
    writeFileSync(f, Buffer.from(png.split(',')[1], 'base64'));
    console.log('saved', f);
  }
} else if (mode === 'video') {
  mkdirSync(dirname(out), { recursive: true });
  const fps = parseFloat(opt('fps', '30'));
  const n = Math.round((t1 - t0) * fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
    '-ss', String(t0), '-t', String(t1 - t0), '-i', resolve('out/music/score.wav'),
    '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '192k', '-shortest', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const started = Date.now();
  for (let i = 0; i < n; i++) {
    const png = await grab(t0 + i / fps);
    ff.stdin.write(Buffer.from(png.split(',')[1], 'base64'));
    if (i % 30 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - started) / 1000 / (i + 1)).toFixed(2)} s/帧`);
  }
  ff.stdin.end();
  await new Promise((res) => ff.on('close', res));
  console.log('saved', out);
}
await browser.close();
await server.close();
