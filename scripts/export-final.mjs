import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { muxFinalMp4 } from './final-mp4.mjs';
import { checkFinalExport } from './check-final-export.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preview = process.env.PREVIEW_MP4 === '1';
const config = {
  duration: Number(process.env.FINAL_DURATION ?? 90),
  start: Number(process.env.FINAL_START ?? 0),
  frameRate: Number(process.env.FINAL_FPS ?? 30),
  width: preview ? 1280 : 1920,
  height: preview ? 720 : 1080,
  videoBitrate: Number(process.env.FINAL_VIDEO_BITRATE ?? 12000000),
  audioBitrate: 192000,
  maxBytes: 500000000,
};
if (![30, 60].includes(config.frameRate)) throw Error('FINAL_FPS must be 30 or 60');
if (!Number.isFinite(config.duration) || config.duration <= 0 || config.duration > 90 || Math.abs(config.duration * config.frameRate - Math.round(config.duration * config.frameRate)) > 1e-6) throw Error('FINAL_DURATION must contain an exact number of frames and be at most 90 seconds');
if (!Number.isFinite(config.start) || config.start < 0 || config.start + config.duration > 90) throw Error('FINAL_START + FINAL_DURATION must be within the 90-second timeline');
if (!Number.isSafeInteger(config.videoBitrate) || config.videoBitrate < 1000000) throw Error('FINAL_VIDEO_BITRATE must be an integer of at least 1000000');
const estimated90Bytes = Math.ceil(90 * (config.videoBitrate + config.audioBitrate) / 8 * 1.02);
if (estimated90Bytes > config.maxBytes) throw Error('Requested bitrate exceeds the 90-second size budget');
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(/[^0-9]/g, '');
const filename = resolve(root, process.env.FINAL_OUTPUT ?? `out/final/nanjing-final-${stamp}-${config.frameRate}fps.mp4`);
if (!filename.toLowerCase().endsWith('.mp4')) throw Error('FINAL_OUTPUT must end in .mp4');
const tracks = { video: { kind: 'video', packets: [] }, audio: { kind: 'audio', packets: [] } };
let packetBytes = 0;
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, watch: null }, logLevel: 'error' });
let browser;
let evidence;
const errors = [];
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling'] });
  const page = await browser.newPage({ viewport: { width: config.width, height: config.height } });
  page.setDefaultTimeout(600000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.exposeFunction('receiveFinalPacket', packet => {
    const track = tracks[packet.track];
    if (packet.description) track.description = Buffer.from(packet.description, 'base64');
    if (packet.data) {
      const data = Buffer.from(packet.data, 'base64');
      packetBytes += data.length;
      if (packetBytes > config.maxBytes) throw Error('Encoded packets exceeded the 500MB limit');
      track.packets.push({ timestamp: packet.timestamp, key: packet.key, data });
    }
  });
  await page.exposeFunction('finalProgress', value => console.log(`Rendered ${value}/${Math.round(config.duration * config.frameRate)} frames`));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=${config.width / 1920}&ui=0`);
  await page.waitForFunction(() => window.__ready === true, undefined, { timeout: 120000 });
  evidence = await page.evaluate(async config => {
    const canvas = document.getElementById('c');
    const hidden = element => !element || getComputedStyle(element).display === 'none' || getComputedStyle(element).visibility === 'hidden' || element.getClientRects().length === 0;
    const uiHidden = ['controls', 'status', 'ui', 'play', 'seek'].every(id => hidden(document.getElementById(id)));
    if (!uiHidden || canvas.width !== config.width || canvas.height !== config.height) throw Error('Canvas size or hidden-UI check failed');
    if (window.__movie.duration < config.start + config.duration) throw Error('Export exceeds implemented timeline');
    const base64 = bytes => {
      let result = '';
      for (let index = 0; index < bytes.length; index += 32768) result += String.fromCharCode(...bytes.subarray(index, index + 32768));
      return btoa(result);
    };
    let pending = [];
    let failure;
    const output = track => (chunk, metadata) => {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      const packet = { track, timestamp: chunk.timestamp, key: chunk.type === 'key', data: base64(bytes) };
      if (metadata?.decoderConfig?.description) packet.description = base64(new Uint8Array(metadata.decoderConfig.description));
      pending.push(window.receiveFinalPacket(packet));
    };
    const settle = async encoder => {
      await encoder.flush();
      await Promise.all(pending);
      pending = [];
      if (failure) throw failure;
    };
    const videoConfig = { codec: config.frameRate === 60 ? 'avc1.64002a' : 'avc1.640028', width: config.width, height: config.height, framerate: config.frameRate, bitrate: config.videoBitrate, bitrateMode: 'constant', latencyMode: 'realtime', hardwareAcceleration: 'prefer-software', avc: { format: 'avc' } };
    const audioConfig = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: config.audioBitrate };
    if (!(await VideoEncoder.isConfigSupported(videoConfig)).supported) throw Error('H.264 WebCodecs encoder is unavailable');
    if (!(await AudioEncoder.isConfigSupported(audioConfig)).supported) throw Error('AAC WebCodecs encoder is unavailable');
    const encoder = new VideoEncoder({ output: output('video'), error: error => { failure = error; } });
    try {
      encoder.configure(videoConfig);
      const frames = Math.round(config.duration * config.frameRate);
      for (let index = 0; index < frames; index++) {
        window.__renderAt(config.start + index / config.frameRate);
        const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1e6 / config.frameRate), duration: Math.round((index + 1) * 1e6 / config.frameRate) - Math.round(index * 1e6 / config.frameRate) });
        try { encoder.encode(frame, { keyFrame: index % (config.frameRate * 2) === 0 }); }
        finally { frame.close(); }
        if ((index + 1) % config.frameRate === 0) {
          await settle(encoder);
          await window.finalProgress(index + 1);
        }
      }
      await settle(encoder);
    } finally { if (encoder.state !== 'closed') encoder.close(); }
    const context = new OfflineAudioContext(2, Math.round(config.duration * 48000), 48000);
    const response = await fetch('/out/music/score.wav');
    if (!response.ok) throw Error('Soundtrack could not be loaded');
    const decoded = await context.decodeAudioData(await response.arrayBuffer());
    if (decoded.duration + 1 / 48000 < config.start + config.duration) throw Error('Soundtrack is shorter than the export');
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.start(0, config.start, config.duration);
    const sound = await context.startRendering();
    const audio = new AudioEncoder({ output: output('audio'), error: error => { failure = error; } });
    try {
      audio.configure(audioConfig);
      for (let offset = 0; offset < sound.length; offset += 1024) {
        const count = Math.min(1024, sound.length - offset);
        const data = new Float32Array(count * 2);
        for (let channel = 0; channel < 2; channel++) data.set(sound.getChannelData(channel).subarray(offset, offset + count), channel * count);
        const frame = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: count, numberOfChannels: 2, timestamp: Math.round(offset / 48000 * 1e6), data });
        try { audio.encode(frame); } finally { frame.close(); }
        if (offset % (1024 * 100) === 0) { await new Promise(resolve => setTimeout(resolve, 0)); await Promise.all(pending); pending = []; if (failure) throw failure; }
      }
      await settle(audio);
    } finally { if (audio.state !== 'closed') audio.close(); }
    return { videoConfig, audioConfig, uiHidden, captureSource: 'VideoFrame(#c), canvas only', deterministicTimeline: true, sourceAudio: '/out/music/score.wav', start: config.start, sourceAudioDuration: decoded.duration, canvas: { width: canvas.width, height: canvas.height } };
  }, config);
  if (errors.length) throw Error(errors.join('; '));
  const mp4 = muxFinalMp4(config, tracks.video, tracks.audio);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, mp4, { flag: 'wx' });
  writeFileSync(`${filename}.export.json`, JSON.stringify({ ...evidence, ...config, filename, bytes: mp4.length, estimated90Bytes, videoFrames: tracks.video.packets.length, audioPackets: tracks.audio.packets.length, errors }, null, 2), { flag: 'wx' });
} finally {
  await browser?.close();
  await server.close();
}
const report = await checkFinalExport(filename, { duration: config.duration, frameRate: config.frameRate, width: config.width, height: config.height });
console.log(JSON.stringify({ filename, estimated90Bytes, ...report }, null, 2));
