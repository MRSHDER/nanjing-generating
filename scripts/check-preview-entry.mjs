import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expected = process.argv[2];
if (!expected) throw Error('Usage: node scripts/check-preview-entry.mjs <preview filename>');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.PREVIEW_ENTRY ?? 'http://127.0.0.1:5187/out/preview/index.html');
  const result = await page.evaluate(async expected => {
    const video = document.querySelector('video');
    if (!video) throw Error('Preview player missing');
    if (video.readyState < 1) await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(Error('Preview cannot decode')); });
    if (!video.currentSrc.endsWith(expected) || Math.abs(video.duration - 90) > 0.05) throw Error('Preview entry is stale or duration is incorrect');
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const samples = [];
    for (const time of [6.67, 13.33, 22.25, 22.75, 23.333334, 26.67, 33.7, 53.33, 71.1, 74, 76.39, 88.5]) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error(`Cannot seek to ${time}s`)), 15000);
        video.onseeked = () => { clearTimeout(timer); resolve(); };
        video.currentTime = time;
      });
      context.drawImage(video, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let minimum = 255, maximum = 0;
      for (let index = 0; index < pixels.length; index += 28) {
        minimum = Math.min(minimum, pixels[index]);
        maximum = Math.max(maximum, pixels[index]);
      }
      if (maximum - minimum < 5) throw Error(`Blank preview frame at ${time}s`);
      samples.push({ time, minimum, maximum });
    }
    return { filename: expected, currentSrc: video.currentSrc, duration: video.duration, width: video.videoWidth, height: video.videoHeight, samples };
  }, expected);
  if (errors.length) throw Error(errors.join('; '));
  writeFileSync(resolve('out/preview/entry-verification.json'), JSON.stringify({ ...result, errors }, null, 2));
  console.log(JSON.stringify({ ...result, errors }));
} finally {
  await browser.close();
}
