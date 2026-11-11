import { createHash } from 'node:crypto';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argumentsList = process.argv.slice(2);
const mode = argumentsList[0] ?? 'stills';
const option = (name, fallback) => {
  const index = argumentsList.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = argumentsList[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} 需要一个值`);
  return value;
};
if (!['stills', 'video'].includes(mode)) throw new Error('模式应为 stills 或 video');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const structure = JSON.parse(readFileSync(resolve(root, 'music/structure.json'), 'utf8'));
const musicEvents = JSON.parse(readFileSync(resolve(root, 'music/events.json'), 'utf8'));
const glitchSection = structure.sections.find(section => section.id === 'glitch');
const glitchStart = glitchSection.startBar * structure.beatsPerBar * 60 / structure.bpm;
const through = option('through', 'gen');
if (!['glitch', 'youth', 'gen'].includes(through)) throw new Error('through 应为 glitch、youth 或 gen');
const videoFilename = `opening-through-${through}-v${structure.version}.webm`;
const expectedEnd = (() => {
  const section = structure.sections.find(section => section.id === through);
  return (section.startBar + section.bars) * structure.beatsPerBar * 60 / structure.bpm;
})();
const output = resolve(option('out', resolve(root, 'out/combined')));
const scale = Number(option('scale', '1'));
if (!Number.isFinite(scale) || scale <= 0 || scale > 2) throw new Error('scale 需要在 0–2 之间');
const times = option('t', '0.5,3,6.45,7.1,9.5,11.8,12.8,13.2,13.4,15,17.55,20.15,24.5,26.5,26.7,27.9,28.25,28.4,29.6,31.0,31.6,32.1,34.1,34.9,35.8,36.5,36.7,37.5,40.2,43.6,45.8,47.3,49.1,50.3,51.5,53.1,53.34,53.9,54.6,55.5,56.8,57.9,58.8,59.8').split(',').map(Number);
if (times.some(value => !Number.isFinite(value) || value < 0)) throw new Error('取帧时间不合法');
const failures = [];
let recording = null;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
let browser;

try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('无法确定本机预览地址');
  browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--enable-unsafe-swiftshader'],
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.goto(`http://127.0.0.1:${address.port}/?ui=0&scale=${scale}`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 60000 });
  const implemented = await page.evaluate(() => ({ duration: window.__movie.duration, sections: window.__movie.sections }));
  if (Math.abs(implemented.duration - expectedEnd) > 1e-6 || !implemented.sections?.includes(through)) throw new Error(`主播放器尚未完整接入 ${through} 段`);
  if (argumentsList.includes('--fault-check') || argumentsList.includes('--setup-fault-check')) {
    const setupFault = argumentsList.includes('--setup-fault-check');
    const fault = await page.evaluate(async setupFault => {
      const NativeRecorder = window.MediaRecorder;
      let tracks = [];
      window.MediaRecorder = class extends NativeRecorder {
        constructor(stream, options) {
          super(stream, options);
          tracks = stream.getTracks();
          if (setupFault) throw new Error('录制初始化失败');
        }
        start() {
          super.start();
          setTimeout(() => this.dispatchEvent(new Event('error')), 50);
        }
      };
      const started = performance.now();
      try {
        const result = await Promise.race([
          window.__movie.record().then(() => 'unexpected success', error => error.message),
          new Promise(resolve => setTimeout(() => resolve('cleanup timed out'), 2000)),
        ]);
        return { result, elapsed: performance.now() - started, stopped: tracks.every(track => track.readyState === 'ended') };
      } finally {
        window.MediaRecorder = NativeRecorder;
      }
    }, setupFault);
    if (fault.result !== (setupFault ? '录制初始化失败' : '录制失败') || fault.elapsed >= 2000 || !fault.stopped) throw new Error(`录制错误未及时清理：${JSON.stringify(fault)}`);
    console.log(`录制异常及时停止并清理通过：${Math.round(fault.elapsed)}ms`);
  }
  const getFrame = time => page.evaluate(value => {
    window.__renderAt(value);
    return document.getElementById('c').toDataURL('image/png').split(',')[1];
  }, time);
  const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
  const testTimes = [3, 9.5, 15, 20.15, 24.5, 28.4, 29.6, 31, 34.4, 36.5, 37.5, 43.6, 47.3, 50.3, 53.4, 55.5, 58.4, 59.8].filter(time => time < expectedEnd);
  for (const time of testTimes) {
    const first = await getFrame(time);
    await getFrame(time > 13.3 ? 7.1 : 20.15);
    const repeated = await getFrame(time);
    if (digest(first) !== digest(repeated)) throw new Error(`乱序渲染产生不同画面：${time} 秒`);
  }
  const lockGap = structure.sections.find(section => section.id === 'drop1').startBar * structure.beatsPerBar * 60 / structure.bpm - 0.1;
  const gapFrame = await getFrame(lockGap);
  const gapVisible = await page.evaluate(async source => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let index = 0; index < pixels.length; index += 4) if (Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) > 30) visible++;
    return visible > canvas.width * canvas.height * 0.1;
  }, gapFrame);
  if (!gapVisible) throw new Error('锁定至城墙的静音交接丢失画面');
  const gapRepeated = await getFrame(lockGap - 0.04);
  if (digest(gapFrame) !== digest(gapRepeated)) throw new Error('静音处没有同步冻结画面');
  const glitchWindows = musicEvents.stutter.filter(([start]) => start >= glitchStart && start < expectedEnd);
  for (const [start, end] of glitchWindows) {
    const time = start + (end - start) * 0.65;
    const mapping = await page.evaluate(async time => {
      const { BEAT, glitchTime, sectionRange } = await import('/src/engine/beat.ts');
      const scene = window.__movie.scene(time);
      const layout = window.__movie.layout(time);
      const expectedBeat = (glitchTime(time) - sectionRange('glitch').start) / BEAT;
      return { layerTime: scene.layerTime, visualBeat: scene.visualBeat, layoutBeat: layout.localBeat, expectedBeat };
    }, time);
    if (Math.abs(mapping.layerTime - time) > 1e-8 || Math.abs(mapping.visualBeat - mapping.expectedBeat) > 1e-8 || Math.abs(mapping.layoutBeat - mapping.expectedBeat) > 1e-8) throw new Error('故障时间被重复映射或两层不同步');
  }
  for (const [start, end] of musicEvents.gap.filter(([start]) => start >= glitchStart && start < expectedEnd)) {
    const first = await getFrame(start + (end - start) * 0.25);
    const repeated = await getFrame(start + (end - start) * 0.75);
    if (digest(first) !== digest(repeated)) throw new Error(`故障段静音没有冻结：${start}`);
  }
  const maskChecks = await page.evaluate(async start => {
    const { frameAt, BEAT } = await import('/src/engine/beat.ts');
    const { createGlitchOverlay } = await import('/src/overlay2d/glitch.ts');
    const overlay = createGlitchOverlay();
    const read = () => [...overlay.masks.map(mask => mask.canvas), overlay.backing].map(canvas => canvas.toDataURL());
    overlay.render(frameAt(start + 2));
    const valid = read();
    overlay.render(frameAt(start + BEAT));
    const introFinished = overlay.masks.find(mask => mask.layer === 'behind' && mask.role === 'foreground').canvas.getContext('2d').getImageData(1200, 4, 1, 1).data[3] === 0;
    overlay.render(frameAt(start - BEAT));
    const blank = read();
    const outside = [];
    for (const beat of [24, 25]) {
      overlay.render({ ...frameAt(start), t: start + beat * BEAT, lt: beat * BEAT });
      outside.push(read());
    }
    overlay.render({ ...frameAt(start), t: Number.NaN, lt: Number.NaN });
    const invalid = read();
    let transparent = true;
    for (const canvas of [...overlay.masks.map(mask => mask.canvas), overlay.backing]) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) { transparent = false; break; }
    }
    return { valid, blank, outside, invalid, transparent, introFinished, layers: overlay.masks.map(mask => `${mask.layer}/${mask.role}`) };
  }, glitchStart);
  if (!maskChecks.transparent || maskChecks.layers.length !== 6 || new Set(maskChecks.layers).size !== 6 || digest(maskChecks.valid) === digest(maskChecks.blank) || digest(maskChecks.invalid) !== digest(maskChecks.blank) || maskChecks.outside.some(masks => digest(masks) !== digest(maskChecks.blank))) throw new Error('故障六层、底托或边界检查失败');
  if (!maskChecks.introFinished) throw new Error('入场黑色切片没有及时退场');
  const extraMaskSections = ['youth', 'gen'].filter(section => implemented.sections.includes(section));
  for (const section of extraMaskSections) {
    const checks = await page.evaluate(async section => {
      const { frameAt, sectionRange, BEAT } = await import('/src/engine/beat.ts');
      const module = await import(`/src/overlay2d/${section}.ts`);
      const factory = section === 'youth' ? module.createYouthOverlay : module.createGenOverlay;
      const overlay = factory();
      const range = sectionRange(section);
      const read = () => [...overlay.masks.map(mask => mask.canvas), overlay.backing].map(canvas => canvas.toDataURL());
      overlay.render(frameAt(range.start + 2));
      const valid = read();
      overlay.render(frameAt(range.start - BEAT));
      const blank = read();
      const outside = [];
      for (const time of [range.end, range.end + BEAT]) {
        overlay.render({ ...frameAt(range.start), t: time, lt: time - range.start });
        outside.push(read());
      }
      overlay.render({ ...frameAt(range.start), t: Number.NaN, lt: Number.NaN });
      return { valid, blank, outside, invalid: read(), layers: overlay.masks.map(mask => `${mask.layer}/${mask.role}`) };
    }, section);
    if (checks.layers.length !== 6 || new Set(checks.layers).size !== 6 || digest(checks.valid) === digest(checks.blank) || digest(checks.invalid) !== digest(checks.blank) || checks.outside.some(masks => digest(masks) !== digest(checks.blank))) throw new Error(`${section} 遮罩或底托边界检查失败：${JSON.stringify({ layers: checks.layers.length, active: digest(checks.valid) !== digest(checks.blank), invalidBlank: digest(checks.invalid) === digest(checks.blank), outsideBlank: checks.outside.map(masks => digest(masks) === digest(checks.blank)) })}`);
  }
  const integration = await page.evaluate(() => {
    const texture = window.__movie.poster(11.5);
    return {
      duration: window.__movie.duration,
      sections: window.__movie.sections,
      glassReady: window.__movie.threeReady,
      posterColorSpace: texture.colorSpace,
      layout: window.__movie.layout(11.5),
      glitchPosterColorSpace: window.__movie.poster(32.1).colorSpace,
      extraPosterSpaces: [44, 55.5].filter(time => time < window.__movie.duration).map(time => window.__movie.poster(time).colorSpace),
      scenes: [3, 9.5, 15, 20.15, 29.6, 36.5, 43.6, 50.3, 55.5].filter(time => time < window.__movie.duration).map(time => window.__movie.scene(time)),
    };
  });
  if (integration.posterColorSpace !== 'srgb-linear') throw new Error('海报没有保持线性颜色空间');
  if (integration.glitchPosterColorSpace !== 'srgb-linear') throw new Error('故障海报没有保持线性颜色空间');
  if (integration.extraPosterSpaces.some(value => value !== 'srgb-linear')) throw new Error('新增海报没有保持线性颜色空间');
  if (!integration.scenes.filter(scene => scene.section !== 'boot').every(scene => scene.has3D)) throw new Error('锁定或城墙缺少三维层');
  if (times.some(time => time >= integration.duration)) throw new Error('取帧时间超出已实现段落');
  mkdirSync(output, { recursive: true });
  for (const time of times) {
    const encoded = await getFrame(time);
    writeFileSync(resolve(output, `t${time.toFixed(2).padStart(5, '0')}.png`), Buffer.from(encoded, 'base64'));
  }
  console.log('静帧、乱序渲染及海报颜色检查通过。');
  if (mode === 'video') {
    const encoded = await page.evaluate(() => window.__movie.record());
    const video = Buffer.from(encoded, 'base64');
    if (video.length < 10000 || !video.includes(Buffer.from('A_OPUS')) || !['V_VP9', 'V_VP8'].some(codec => video.includes(Buffer.from(codec)))) {
      throw new Error('录制文件缺少有效视频或声音轨道');
    }
    writeFileSync(resolve(output, videoFilename), video);
    recording = await page.evaluate(() => window.__movie.recording);
  }
  if (failures.length) throw new Error(failures.join('\n'));
  const report = {
    ...integration,
    randomAccessDeterministic: true,
    silenceFreezeVisible: true,
    glitchTimeMappedOnce: true,
    glitchSilenceFrozen: true,
    glitchMasksAndBackingTransparentOutside: true,
    extraMasksValidated: extraMaskSections,
    browserErrors: failures,
    width: Math.round(1920 * scale), height: Math.round(1080 * scale),
    sampleMusic: `v${structure.version} / ${structure.bpm} BPM / 已锁定音乐拍点`,
    recording,
    video: mode === 'video' ? videoFilename : null,
    limitation: '有声 WebM 为实时录制审查样片，正式逐帧 60fps 导出尚未完成',
  };
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }, null, 2));
} finally {
  if (browser) await browser.close();
  await server.close();
}
