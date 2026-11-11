import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve } from 'node:path';

const duration = Number(process.env.PREVIEW_DURATION ?? 90);
const frameRate = 30;
const width = 1280, height = 720;
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(/[^0-9]/g, '');
const directory = resolve('out/preview');
const filename = `nanjing-preview-${stamp}.webm`;
if (existsSync(resolve(directory, 'index.html'))) copyFileSync(resolve(directory, 'index.html'), resolve(directory, `index-before-${stamp}.html`));
const packets = [];
let audioHeader;
const integer = value => {
  let number = BigInt(value);
  const bytes = [];
  do { bytes.unshift(Number(number & 255n)); number >>= 8n; } while (number);
  return Buffer.from(bytes);
};
const size = value => {
  const number = BigInt(value);
  let length = 1;
  while (number >= (1n << BigInt(7 * length)) - 1n) length++;
  const bytes = Buffer.alloc(length);
  let encoded = number | (1n << BigInt(7 * length));
  for (let index = length - 1; index >= 0; index--) { bytes[index] = Number(encoded & 255n); encoded >>= 8n; }
  return bytes;
};
const element = (id, data) => {
  const payload = Array.isArray(data) ? Buffer.concat(data) : data;
  return Buffer.concat([Buffer.from(id, 'hex'), size(payload.length), payload]);
};
const numberElement = (id, value) => element(id, integer(value));
const textElement = (id, value) => element(id, Buffer.from(value));
const floatElement = (id, value) => { const data = Buffer.alloc(8); data.writeDoubleBE(value); return element(id, data); };
const mux = () => {
  const header = element('1a45dfa3', [numberElement('4286', 1), numberElement('42f7', 1), numberElement('42f2', 4), numberElement('42f3', 8), textElement('4282', 'webm'), numberElement('4287', 4), numberElement('4285', 2)]);
  const info = element('1549a966', [numberElement('2ad7b1', 1000000), floatElement('4489', duration * 1000), textElement('4d80', 'Nanjing offline WebCodecs'), textElement('5741', 'Nanjing offline WebCodecs')]);
  const opus = audioHeader ?? Buffer.from('4f707573486561640102380180bb0000000000', 'hex');
  const tracks = element('1654ae6b', [
    element('ae', [numberElement('d7', 1), numberElement('73c5', 1), numberElement('83', 1), numberElement('9c', 0), textElement('86', 'V_VP9'), numberElement('23e383', Math.round(1e9 / frameRate)), element('e0', [numberElement('b0', width), numberElement('ba', height)])]),
    element('ae', [numberElement('d7', 2), numberElement('73c5', 2), numberElement('83', 2), numberElement('9c', 0), textElement('86', 'A_OPUS'), element('63a2', opus), numberElement('56aa', opus.readUInt16LE(10) / 48000 * 1e9), numberElement('56bb', 80000000), element('e1', [floatElement('b5', 48000), numberElement('9f', 2)])]),
  ]);
  packets.sort((left, right) => left.timestamp - right.timestamp || left.track - right.track);
  const audioDelay = opus.readUInt16LE(10) / 48000 * 1e6;
  for (const packet of packets) if (packet.track === 2) packet.timestamp += audioDelay;
  packets.sort((left, right) => left.timestamp - right.timestamp || left.track - right.track);
  const clusters = [];
  const cues = [];
  let base = -1, blocks = [], offset = info.length + tracks.length;
  const flush = () => {
    if (!blocks.length) return;
    const cluster = element('1f43b675', [numberElement('e7', base), ...blocks]);
    cues.push(element('bb', [numberElement('b3', base), element('b7', [numberElement('f7', 1), numberElement('f1', offset)])]));
    clusters.push(cluster); offset += cluster.length; blocks = [];
  };
  for (const packet of packets) {
    const time = Math.round(packet.timestamp / 1000);
    const clusterTime = Math.max(0, Math.floor(time / 1000) * 1000);
    if (clusterTime !== base) { flush(); base = clusterTime; }
    const block = Buffer.alloc(4);
    block[0] = 0x80 | packet.track;
    block.writeInt16BE(time - base, 1);
    block[3] = packet.key ? 0x80 : 0;
    blocks.push(element('a3', Buffer.concat([block, packet.data])));
  }
  flush();
  return Buffer.concat([header, element('18538067', [info, tracks, ...clusters, element('1c53bb6b', cues)])]);
};

const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(600000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.exposeFunction('receivePacket', packet => {
    if (packet.header) audioHeader = Buffer.from(packet.header, 'base64');
    else packets.push({ ...packet, data: Buffer.from(packet.data, 'base64') });
  });
  await page.exposeFunction('exportProgress', value => console.log(`Rendered ${value}/${Math.round(duration * frameRate)} frames`));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=${2 / 3}&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  await page.evaluate(async ({ duration, frameRate, width, height }) => {
    const base64 = bytes => {
      let result = '';
      for (let index = 0; index < bytes.length; index += 32768) result += String.fromCharCode(...bytes.subarray(index, index + 32768));
      return btoa(result);
    };
    let pending = [], failure;
    const output = track => (chunk, metadata) => {
      const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
      pending.push(window.receivePacket({ track, timestamp: chunk.timestamp, key: chunk.type === 'key', data: base64(bytes) }));
      if (track === 2 && metadata?.decoderConfig?.description) pending.push(window.receivePacket({ header: base64(new Uint8Array(metadata.decoderConfig.description)) }));
    };
    const videoConfig = { codec: 'vp09.00.10.08', width, height, framerate: frameRate, bitrate: 4000000, hardwareAcceleration: 'prefer-software' };
    if (!(await VideoEncoder.isConfigSupported(videoConfig)).supported) throw Error('VP9 encoding unavailable');
    const encoder = new VideoEncoder({ output: output(1), error: error => { failure = error; } });
    encoder.configure(videoConfig);
    const canvas = document.getElementById('c');
    const frames = Math.round(duration * frameRate);
    for (let index = 0; index < frames; index++) {
      window.__renderAt(index / frameRate);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1e6 / frameRate), duration: Math.round(1e6 / frameRate) });
      encoder.encode(frame, { keyFrame: index % frameRate === 0 }); frame.close();
      if (index % frameRate === frameRate - 1) {
        await encoder.flush(); await Promise.all(pending); pending = [];
        if (failure) throw failure;
        if ((index + 1) % 300 === 0) await window.exportProgress(index + 1);
      }
    }
    await encoder.flush(); encoder.close(); await Promise.all(pending); pending = [];
    const context = new OfflineAudioContext(2, Math.round(duration * 48000), 48000);
    const decoded = await context.decodeAudioData(await (await fetch('/out/music/score.wav')).arrayBuffer());
    const source = context.createBufferSource(); source.buffer = decoded; source.connect(context.destination); source.start();
    const sound = await context.startRendering();
    const audioConfig = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 };
    if (!(await AudioEncoder.isConfigSupported(audioConfig)).supported) throw Error('Opus encoding unavailable');
    const audio = new AudioEncoder({ output: output(2), error: error => { failure = error; } }); audio.configure(audioConfig);
    for (let offset = 0; offset < sound.length; offset += 960) {
      const count = Math.min(960, sound.length - offset), data = new Float32Array(count * 2);
      for (let channel = 0; channel < 2; channel++) data.set(sound.getChannelData(channel).subarray(offset, offset + count), channel * count);
      const frame = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: count, numberOfChannels: 2, timestamp: Math.round(offset / 48000 * 1e6), data });
      audio.encode(frame); frame.close();
      if (offset % (960 * 100) === 0) { await new Promise(resolve => setTimeout(resolve, 0)); await Promise.all(pending); pending = []; if (failure) throw failure; }
    }
    await audio.flush(); audio.close(); await Promise.all(pending);
    if (failure) throw failure;
  }, { duration, frameRate, width, height });
  if (errors.length) throw Error(errors.join('; '));
  if (packets.filter(packet => packet.track === 1).length !== Math.round(duration * frameRate)) throw Error('video frame count mismatch');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, filename), mux());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/out/preview/${filename}`);
  const playback = await page.evaluate(async () => {
    const video = document.querySelector('video');
    await new Promise((resolve, reject) => { if (video.readyState >= 1) resolve(); else { video.onloadedmetadata = resolve; video.onerror = () => reject(Error('export cannot be decoded')); } });
    video.pause();
    const context = new AudioContext();
    const decoded = await context.decodeAudioData(await (await fetch(location.href)).arrayBuffer());
    let energy = 0;
    const samples = decoded.getChannelData(0);
    for (let index = 0; index < samples.length; index += 48) energy += samples[index] ** 2;
    await context.close();
    return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, decodedAudioSeconds: decoded.duration, audioEnergy: energy / (samples.length / 48) };
  });
  if (playback.width !== width || playback.height !== height || Math.abs(playback.duration - duration) > 0.1) throw Error(`bad metadata: ${JSON.stringify(playback)}`);
  if (playback.audioEnergy < 1e-7 || Math.abs(playback.decodedAudioSeconds - duration) > 0.1) throw Error(`export soundtrack is silent or incomplete: ${JSON.stringify(playback)}`);
  const report = { filename, ...playback, frameRate, frames: packets.filter(packet => packet.track === 1).length, audioPackets: packets.filter(packet => packet.track === 2).length, audio: 'Opus stereo 48kHz', deterministicTimeline: true, errors };
  writeFileSync(resolve(directory, filename.replace('.webm', '.json')), JSON.stringify(report, null, 2));
  if (duration === 90) writeFileSync(resolve(directory, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>南京，正在生成 · 全片预览</title><style>body{margin:0;background:#151515;color:#eee;font:18px Arial,sans-serif}main{max-width:1280px;margin:32px auto;padding:0 20px}video{width:100%;display:block;background:#000}a{color:#efb664}p{line-height:1.7}</style><main><h1>南京，正在生成 · 90秒预览</h1><video controls preload="metadata" poster="../combined/full-review/t43.50.png" src="${filename}"></video><p>1280×720 · 30fps · 2700帧 · VP9 / Opus · 原配乐</p><p><a href="${filename}" download>下载全片</a> · <a href="../combined/full-review/gallery.html">关键帧核对画廊</a> · <a href="../combined/ink-palette/overview.html">九段色彩总览</a> · <a href="../combined/cut-check/index.html">全片跳变自查</a> · <a href="../combined/wall-typography/approved.html">红色远景字幕墙定稿</a> · <a href="${filename.replace('.webm', '.json')}">导出验证</a></p><p>这一版供审核节奏与转场，尚非参赛终版。</p></main>`);
  if (duration === 90 && (process.env.REVIEW_DIRECTORY || process.env.WALL_REVIEW_DIRECTORY)) {
    const player = resolve(directory, 'index.html');
    let html = readFileSync(player, 'utf8');
    if (process.env.REVIEW_DIRECTORY) html = html.replaceAll('../combined/full-review', `../combined/${process.env.REVIEW_DIRECTORY}`);
    if (process.env.WALL_REVIEW_DIRECTORY) html = html.replace('../combined/wall-typography/approved.html', `../combined/${process.env.WALL_REVIEW_DIRECTORY}/gallery.html`).replace('红色远景字幕墙定稿', '城墙环绕文字背景');
    writeFileSync(player, html);
  }
  console.log(JSON.stringify(report));
} finally { await browser?.close(); await server.close(); }
