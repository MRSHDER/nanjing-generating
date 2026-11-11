import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const argumentsList = process.argv.slice(2);
const outputIndex = argumentsList.indexOf('--out');
if (outputIndex >= 0 && (!argumentsList[outputIndex + 1] || argumentsList[outputIndex + 1].startsWith('--'))) {
  throw new Error('--out 需要一个输出目录');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(outputIndex >= 0 ? argumentsList[outputIndex + 1] : resolve(root, 'preview/overlay2d'));
const recordVideo = argumentsList.includes('--video');
const sectionIndex = argumentsList.indexOf('--section');
const section = sectionIndex >= 0 ? argumentsList[sectionIndex + 1] : 'boot';
if (!['boot', 'drop1'].includes(section)) throw new Error('section 应为 boot 或 drop1');
const beats = section === 'drop1' ? 32 : 16;
const failures = [];
let posterColorSpace = null;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
let browser;

function digest(values) {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('无法确定预览端口');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${address.port}/overlay-preview.html?export=1&section=${section}`);
  await page.waitForFunction(() => window.__overlayPreview?.ready === true);
  const details = await page.evaluate(() => ({ section: window.__overlayPreview.section, beats: window.__overlayPreview.beats, bpm: window.__overlayPreview.bpm, layers: window.__overlayPreview.layers, layout: window.__overlayPreview.layoutAt(10) }));
  if (details.section !== section || details.beats !== beats) throw new Error('预览尚未实现所选段落或拍数');
  if (section === 'drop1' && (details.layers.length !== 6 || new Set(details.layers.map(mask => `${mask.layer}/${mask.role}`)).size !== 6)) throw new Error('城墙缺少完整的前后层遮罩');

  const first = await page.evaluate(() => window.__overlayPreview.masksAt(9.25));
  await page.evaluate(() => window.__overlayPreview.masksAt(14.75));
  const repeated = await page.evaluate(() => window.__overlayPreview.masksAt(9.25));
  if (digest(first) !== digest(repeated)) throw new Error('乱序取帧后画面发生变化');

  const blank = await page.evaluate(() => window.__overlayPreview.masksAt(-1));
  for (const beat of [beats, beats + 1]) {
    const outside = await page.evaluate(value => window.__overlayPreview.masksAt(value), beat);
    if (digest(outside) !== digest(blank)) throw new Error(`越界 ${beat} 拍未清空遮罩`);
  }
  const invalid = await page.evaluate(() => window.__overlayPreview.masksAt(Number.NaN));
  if (digest(invalid) !== digest(blank)) throw new Error('非法时间未清空遮罩');
  const transparent = await page.evaluate(async endBeat => {
    const masks = window.__overlayPreview.masksAt(endBeat);
    for (const source of masks) {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) return false;
      }
    }
    return true;
  }, beats);
  if (!transparent || digest(first) === digest(blank)) throw new Error('遮罩透明性或有效内容检查失败');

  mkdirSync(output, { recursive: true });
  const shots = [];
  for (const theme of ['paper', 'dark']) {
    await page.selectOption('#theme', theme, { force: true });
    for (const time of (section === 'drop1' ? [1, 5, 10, 17, 23, 29, 31].map(beat => beat * 60 / details.bpm) : [0.5, 2.3, 4.8, 6.8, 7.2])) {
      const encoded = await page.evaluate(value => {
        window.__overlayPreview.drawAt(value);
        return document.getElementById('overlay-preview').toDataURL('image/png').split(',')[1];
      }, time);
      const filename = `${theme}-${time.toFixed(2)}.png`;
      writeFileSync(resolve(output, filename), Buffer.from(encoded, 'base64'));
      shots.push(filename);
    }
  }

  if (section === 'drop1') {
    await page.selectOption('#theme', 'dark', { force: true });
    await page.selectOption('#layer', 'behind', { force: true });
    for (const beat of [1, 10, 17, 29]) {
      const encoded = await page.evaluate(value => {
        window.__overlayPreview.drawAt(value * 60 / window.__overlayPreview.bpm);
        return document.getElementById('overlay-preview').toDataURL('image/png').split(',')[1];
      }, beat);
      const filename = `behind-beat${String(beat).padStart(2, '0')}.png`;
      writeFileSync(resolve(output, filename), Buffer.from(encoded, 'base64'));
      shots.push(filename);
    }
    await page.selectOption('#layer', 'all', { force: true });
    const poster = await page.evaluate(async () => {
      const [{ Compositor }, { createRenderer }, { createDrop1Overlay }, { Post }] = await Promise.all([
        import('/src/engine/compositor.ts'), import('/src/engine/gl.ts'), import('/src/overlay2d/drop1.ts'), import('/src/engine/post.ts'),
      ]);
      const canvas = document.createElement('canvas');
      const renderer = createRenderer(canvas, { scale: 0.5 });
      const compositor = new Compositor(renderer);
      const post = new Post(renderer);
      const overlay = createDrop1Overlay();
      overlay.render({ localBeat: 10, kick: 0 });
      const target = compositor.poster(overlay.masks, false);
      post.finish(target, { exposure: 1, grain: 0, vignette: 0, flash: 0, fade: 0 }, null, 0);
      const result = { colorSpace: target.texture.colorSpace, image: canvas.toDataURL('image/png').split(',')[1] };
      compositor.dispose();
      renderer.dispose();
      return result;
    });
    if (poster.colorSpace !== 'srgb-linear') throw new Error('城墙背景纹理没有保持线性空间');
    posterColorSpace = poster.colorSpace;
    writeFileSync(resolve(output, 'linear-poster-beat10.png'), Buffer.from(poster.image, 'base64'));
    shots.push('linear-poster-beat10.png');
  }

  if (recordVideo) {
    await page.selectOption('#theme', section === 'drop1' ? 'dark' : 'paper', { force: true });
    const movie = await page.evaluate(async () => {
      const canvas = document.getElementById('overlay-preview');
      const stream = canvas.captureStream(30);
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
        .find(candidate => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) throw new Error('浏览器不支持 WebM 录制');
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 10000000 });
      const chunks = [];
      const video = await new Promise((resolveVideo, rejectVideo) => {
        const timeout = setTimeout(() => {
          recorder.stop();
          rejectVideo(new Error('样片录制超时'));
        }, 25000);
        recorder.ondataavailable = event => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => {
          clearTimeout(timeout);
          rejectVideo(new Error('样片录制失败'));
        };
        recorder.onstop = () => {
          clearTimeout(timeout);
          resolveVideo(new Blob(chunks, { type: mimeType }));
        };
        window.__overlayPreview.playFromStart();
        recorder.start();
        setTimeout(() => recorder.stop(), window.__overlayPreview.duration * 1000 + 150);
      });
      stream.getTracks().forEach(track => track.stop());
      return await new Promise((resolveBase64, rejectBase64) => {
        const reader = new FileReader();
        reader.onerror = rejectBase64;
        reader.onload = () => resolveBase64(String(reader.result).slice(String(reader.result).indexOf(';base64,') + 8));
        reader.readAsDataURL(video);
      });
    });
    const encoded = Buffer.from(movie, 'base64');
    if (encoded.length < 10000 || !['V_VP9', 'V_VP8'].some(codec => encoded.includes(Buffer.from(codec)))) throw new Error('录制文件不包含有效视频');
    writeFileSync(resolve(output, `${section}-overlay.webm`), encoded);
  }

  if (failures.length) throw new Error(failures.join('\n'));
  const report = {
    ...details,
    posterColorSpace,
    randomAccessDeterministic: true,
    outsideRangeTransparent: true,
    invalidBeatTransparent: true,
    browserErrors: failures,
    dimensions: [1920, 1080],
    shots,
    video: recordVideo ? `${section}-overlay.webm` : null,
    limitation: '独立二维、无声、实时录制审查样片；未合成三维和正式配乐',
  };
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  if (browser) await browser.close();
  await server.close();
}
