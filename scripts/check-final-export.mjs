import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

function boxes(data, start = 0, end = data.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) throw Error('Truncated MP4 box header');
    const size = data.readUInt32BE(offset);
    if (size < 8 || offset + size > end) throw Error('Invalid MP4 box size');
    result.push({ type: data.toString('ascii', offset + 4, offset + 8), start: offset + 8, end: offset + size, size });
    offset += size;
  }
  return result;
}
const child = (data, parent, type) => {
  const found = boxes(data, parent.start, parent.end).find(entry => entry.type === type);
  if (!found) throw Error(`Missing ${type} box`);
  return found;
};

function inspect(data) {
  const top = boxes(data);
  const movie = top.find(entry => entry.type === 'moov');
  const media = top.find(entry => entry.type === 'mdat');
  if (!top.some(entry => entry.type === 'ftyp') || !movie || !media || movie.start > media.start) throw Error('Expected fast-start MP4');
  const movieHeader = child(data, movie, 'mvhd');
  const duration = data.readUInt32BE(movieHeader.start + 16) / data.readUInt32BE(movieHeader.start + 12);
  const tracks = boxes(data, movie.start, movie.end).filter(entry => entry.type === 'trak').map(track => {
    const trackHeader = child(data, track, 'tkhd');
    const trackMedia = child(data, track, 'mdia');
    const handler = child(data, trackMedia, 'hdlr');
    const kind = data.toString('ascii', handler.start + 8, handler.start + 12);
    const mediaHeader = child(data, trackMedia, 'mdhd');
    const scale = data.readUInt32BE(mediaHeader.start + 12);
    const table = child(data, child(data, trackMedia, 'minf'), 'stbl');
    const descriptions = child(data, table, 'stsd');
    if (data.readUInt32BE(descriptions.start + 4) !== 1) throw Error('Expected one codec per track');
    const entry = boxes(data, descriptions.start + 8, descriptions.end)[0];
    const times = child(data, table, 'stts');
    let frames = 0;
    let ticks = 0;
    for (let index = 0; index < data.readUInt32BE(times.start + 4); index++) {
      const count = data.readUInt32BE(times.start + 8 + index * 8);
      frames += count;
      ticks += count * data.readUInt32BE(times.start + 12 + index * 8);
    }
    const sizes = child(data, table, 'stsz');
    if (data.readUInt32BE(sizes.start + 8) !== frames || data.readUInt32BE(sizes.start + 4) !== 0) throw Error('Invalid sample sizes');
    const chunks = child(data, table, 'stco');
    const chunkMap = child(data, table, 'stsc');
    if (data.readUInt32BE(chunks.start + 4) !== 1 || data.readUInt32BE(chunkMap.start + 4) !== 1 || data.readUInt32BE(chunkMap.start + 12) !== frames) throw Error('Unexpected chunk layout');
    const offset = data.readUInt32BE(chunks.start + 8);
    let sampleBytes = 0;
    for (let index = 0; index < frames; index++) sampleBytes += data.readUInt32BE(sizes.start + 12 + index * 4);
    if (offset < media.start || offset + sampleBytes > media.end) throw Error('Samples outside media payload');
    const result = { kind, codec: entry.type, samples: frames, duration: ticks / scale, frameRate: frames * scale / ticks, sampleBytes, offset };
    if (kind === 'vide') {
      result.width = data.readUInt16BE(entry.start + 24);
      result.height = data.readUInt16BE(entry.start + 26);
      const avc = child(data, { start: entry.start + 78, end: entry.end }, 'avcC');
      result.codecString = `avc1.${data.subarray(avc.start + 1, avc.start + 4).toString('hex')}`;
      if (data.readUInt32BE(trackHeader.end - 8) / 65536 !== result.width || data.readUInt32BE(trackHeader.end - 4) / 65536 !== result.height) throw Error('Track dimensions disagree');
    } else if (kind === 'soun') {
      result.channels = data.readUInt16BE(entry.start + 16);
      result.sampleRate = data.readUInt32BE(entry.start + 24) / 65536;
      const esds = child(data, { start: entry.start + 28, end: entry.end }, 'esds');
      const descriptors = data.subarray(esds.start + 4, esds.end);
      let description;
      const scan = (start, end) => {
        let cursor = start;
        while (cursor < end) {
          const tag = descriptors[cursor++];
          let length = 0;
          let value;
          do { value = descriptors[cursor++]; length = length * 128 + (value & 127); } while (value & 128);
          const next = cursor + length;
          if (next > end) throw Error('Invalid audio descriptor');
          if (tag === 3) scan(cursor + 3, next);
          if (tag === 4) { if (descriptors[cursor] !== 0x40) throw Error('Expected MPEG-4 audio'); scan(cursor + 13, next); }
          if (tag === 5) description = descriptors.subarray(cursor, next);
          cursor = next;
        }
      };
      scan(0, descriptors.length);
      if (!description || description[0] >> 3 !== 2) throw Error('Expected AAC-LC AudioSpecificConfig');
      result.codecString = 'mp4a.40.2';
    }
    return result;
  });
  return { duration, tracks, fastStart: true };
}

export async function checkFinalExport(filename, options = {}) {
  filename = resolve(filename);
  const bytes = statSync(filename).size;
  if (bytes > 500000000) throw Error('File exceeds the 500MB limit');
  const metadata = inspect(readFileSync(filename));
  const video = metadata.tracks.find(track => track.kind === 'vide');
  const audio = metadata.tracks.find(track => track.kind === 'soun');
  const duration = options.duration ?? Number(process.env.FINAL_DURATION ?? 90);
  const frameRate = options.frameRate ?? Number(process.env.FINAL_FPS ?? 30);
  const expectedWidth = options.width ?? 1920, expectedHeight = options.height ?? 1080;
  if (metadata.tracks.length !== 2 || !video || !audio || video.codec !== 'avc1' || audio.codec !== 'mp4a') throw Error('Expected exactly H.264 and AAC tracks');
  if (video.width !== expectedWidth || video.height !== expectedHeight || video.frameRate !== frameRate || ![30, 60].includes(frameRate) || video.samples !== Math.round(duration * frameRate)) throw Error('Video dimensions, frame rate, or frame count mismatch');
  if (audio.sampleRate !== 48000 || audio.channels !== 2 || Math.abs(metadata.duration - duration) > 1 / 48000) throw Error('Audio format or movie duration mismatch');
  const evidence = JSON.parse(readFileSync(`${filename}.export.json`, 'utf8'));
  if (!evidence.uiHidden || evidence.captureSource !== 'VideoFrame(#c), canvas only' || evidence.errors.length || evidence.videoFrames !== video.samples || evidence.bytes !== bytes) throw Error('Canvas-only export evidence is missing or inconsistent');
  const server = createServer((request, response) => {
    if (request.url === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><link rel="icon" href="data:,"><video preload="auto" src="/movie.mp4"></video>');
      return;
    }
    if (request.url !== '/movie.mp4') { response.writeHead(404); response.end(); return; }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), bytes - 1) : bytes - 1;
    if (start > end || start >= bytes) { response.writeHead(416, { 'Content-Range': `bytes */${bytes}` }); response.end(); return; }
    response.writeHead(range ? 206 : 200, { 'Content-Type': 'video/mp4', 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes}` } : {}) });
    createReadStream(filename, { start, end }).pipe(response);
  });
  let browser;
  let playback;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    playback = await page.evaluate(async ({ duration, codecString }) => {
      const video = document.querySelector('video');
      await new Promise((resolve, reject) => {
        if (video.readyState >= 2) resolve();
        else { video.onloadeddata = resolve; video.onerror = () => reject(Error('MP4 video decode failed')); }
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const samples = [];
      for (const time of [0, Math.min(duration / 2, duration - 1 / 30), Math.max(0, duration - 1 / 30)]) {
        if (Math.abs(video.currentTime - time) > 1e-7) await new Promise((resolve, reject) => { video.onseeked = resolve; video.onerror = () => reject(Error('MP4 seek failed')); video.currentTime = time; });
        context.drawImage(video, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let minimum = 255;
        let maximum = 0;
        for (let index = 0; index < pixels.length; index += 64) { minimum = Math.min(minimum, pixels[index]); maximum = Math.max(maximum, pixels[index]); }
        samples.push({ time, minimum, maximum });
      }
      const audioContext = new AudioContext({ sampleRate: 48000 });
      let decoded;
      try { decoded = await audioContext.decodeAudioData(await (await fetch('/movie.mp4')).arrayBuffer()); }
      finally { await audioContext.close(); }
      const channelEnergy = [];
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const data = decoded.getChannelData(channel);
        let energy = 0;
        for (let index = 0; index < data.length; index++) energy += data[index] ** 2;
        channelEnergy.push(energy / data.length);
      }
      return { width: video.videoWidth, height: video.videoHeight, duration: video.duration, decodedAudioSeconds: decoded.duration, decodedAudioChannels: decoded.numberOfChannels, channelEnergy, samples, browserCodecSupport: video.canPlayType(`video/mp4; codecs="${codecString}, mp4a.40.2"`) };
    }, { duration, codecString: video.codecString });
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
  if (playback.width !== expectedWidth || playback.height !== expectedHeight || Math.abs(playback.duration - duration) > 0.05 || Math.abs(playback.decodedAudioSeconds - duration) > 0.05 || playback.decodedAudioChannels !== 2 || playback.channelEnergy.some(energy => energy < 1e-7) || !playback.browserCodecSupport || playback.samples.every(sample => sample.maximum - sample.minimum < 5)) throw Error(`Playback verification failed: ${JSON.stringify(playback)}`);
  const report = { filename, bytes, maxBytes: 500000000, withinSizeLimit: true, ...metadata, playback, uiHidden: evidence.uiHidden, captureSource: evidence.captureSource, verifiedAt: new Date().toISOString() };
  writeFileSync(`${filename}.check.json`, JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw Error('Usage: node scripts/check-final-export.mjs <movie.mp4>; set FINAL_DURATION / FINAL_FPS for a sample');
  console.log(JSON.stringify(await checkFinalExport(process.argv[2]), null, 2));
}
