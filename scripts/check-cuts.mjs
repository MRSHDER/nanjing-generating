import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { resolve, basename, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { PROJECT_ROOT, DETECTION, loadCutPolicy, detectCuts, stripFrames } from './cut-policy.mjs';

function mp4Packets(data) {
  const boxes = (start, end) => {
    const entries = [];
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) throw Error('Truncated MP4');
      let size = data.readUInt32BE(offset);
      const type = data.toString('ascii', offset + 4, offset + 8);
      let header = 8;
      if (size === 1) { size = Number(data.readBigUInt64BE(offset + 8)); header = 16; }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end) throw Error('Invalid MP4 box');
      entries.push({ type, start: offset + header, end: offset + size });
      offset += size;
    }
    return entries;
  };
  const child = (parent, type) => {
    const entry = boxes(parent.start, parent.end).find(value => value.type === type);
    if (!entry) throw Error(`Missing MP4 ${type}`);
    return entry;
  };
  const movie = child({ start: 0, end: data.length }, 'moov');
  const track = boxes(movie.start, movie.end).filter(entry => entry.type === 'trak').find(entry => {
    const handler = child(child(entry, 'mdia'), 'hdlr');
    return data.toString('ascii', handler.start + 8, handler.start + 12) === 'vide';
  });
  if (!track) throw Error('Missing video track');
  const media = child(track, 'mdia');
  const header = child(media, 'mdhd');
  const scale = data.readUInt32BE(header.start + (data[header.start] === 1 ? 20 : 12));
  const table = child(child(media, 'minf'), 'stbl');
  if (boxes(table.start, table.end).some(entry => entry.type === 'ctts')) throw Error('MP4 composition offsets need explicit demux support');
  const description = child(table, 'stsd');
  const codec = boxes(description.start + 8, description.end)[0];
  if (codec.type !== 'avc1') throw Error(`Unsupported MP4 video: ${codec.type}`);
  const avc = child({ start: codec.start + 78, end: codec.end }, 'avcC');
  const sizes = child(table, 'stsz');
  const fixedSize = data.readUInt32BE(sizes.start + 4);
  const count = data.readUInt32BE(sizes.start + 8);
  const times = child(table, 'stts');
  const durations = [];
  for (let index = 0; index < data.readUInt32BE(times.start + 4); index++) {
    const amount = data.readUInt32BE(times.start + 8 + index * 8);
    const duration = data.readUInt32BE(times.start + 12 + index * 8);
    for (let sample = 0; sample < amount; sample++) durations.push(duration);
  }
  if (durations.length !== count) throw Error('MP4 timing count mismatch');
  const entries = boxes(table.start, table.end);
  const offsets = entries.find(entry => ['stco', 'co64'].includes(entry.type));
  if (!offsets) throw Error('Missing MP4 chunk offsets');
  const mapping = child(table, 'stsc');
  const mappings = Array.from({ length: data.readUInt32BE(mapping.start + 4) }, (_, index) => ({ first: data.readUInt32BE(mapping.start + 8 + index * 12), count: data.readUInt32BE(mapping.start + 12 + index * 12), description: data.readUInt32BE(mapping.start + 16 + index * 12) }));
  const sync = entries.find(entry => entry.type === 'stss');
  const keys = sync ? new Set(Array.from({ length: data.readUInt32BE(sync.start + 4) }, (_, index) => data.readUInt32BE(sync.start + 8 + index * 4) - 1)) : null;
  const packets = [];
  let ticks = 0;
  for (let chunk = 1; chunk <= data.readUInt32BE(offsets.start + 4); chunk++) {
    let offset = offsets.type === 'co64' ? Number(data.readBigUInt64BE(offsets.start + 8 + (chunk - 1) * 8)) : data.readUInt32BE(offsets.start + 8 + (chunk - 1) * 4);
    const map = mappings.findLast(entry => entry.first <= chunk);
    if (!map || map.description !== 1) throw Error('Uncertain MP4 chunk mapping');
    for (let sample = 0; sample < map.count; sample++) {
      const index = packets.length;
      const size = fixedSize || data.readUInt32BE(sizes.start + 12 + index * 4);
      if (index >= count || offset + size > data.length) throw Error('MP4 sample outside file');
      packets.push({ offset, size, timestamp: Math.round(ticks * 1e6 / scale), key: keys ? keys.has(index) : true });
      ticks += durations[index];
      offset += size;
    }
  }
  if (packets.length !== count) throw Error('MP4 sample count mismatch');
  return { config: { codec: `avc1.${data.subarray(avc.start + 1, avc.start + 4).toString('hex')}`, description: [...data.subarray(avc.start, avc.end)] }, packets };
}

function webmPackets(data) {
  const vint = (offset, keepMarker = false) => {
    if (offset >= data.length || !data[offset]) throw Error('Invalid WebM integer');
    let length = 1;
    while (!(data[offset] & (0x80 >> (length - 1)))) length++;
    if (length > 8 || offset + length > data.length) throw Error('Invalid WebM integer length');
    let value = BigInt(keepMarker ? data[offset] : data[offset] & ((0x80 >> (length - 1)) - 1));
    for (let index = 1; index < length; index++) value = value * 256n + BigInt(data[offset + index]);
    return { length, value: Number(value), unknown: !keepMarker && value === (1n << BigInt(7 * length)) - 1n };
  };
  const elements = (start, end) => {
    const entries = [];
    for (let offset = start; offset < end;) {
      const id = vint(offset, true);
      const size = vint(offset + id.length);
      const begin = offset + id.length + size.length;
      const finish = size.unknown ? end : begin + size.value;
      if (finish > end || finish <= offset) throw Error('Invalid WebM element');
      entries.push({ id: id.value, start: begin, end: finish });
      offset = finish;
    }
    return entries;
  };
  const integer = entry => {
    let value = 0;
    for (let index = entry.start; index < entry.end; index++) value = value * 256 + data[index];
    return value;
  };
  const segment = elements(0, data.length).find(entry => entry.id === 0x18538067);
  if (!segment) throw Error('Missing WebM segment');
  const entries = elements(segment.start, segment.end);
  const info = entries.find(entry => entry.id === 0x1549a966);
  const scaleEntry = info && elements(info.start, info.end).find(entry => entry.id === 0x2ad7b1);
  const scale = scaleEntry ? integer(scaleEntry) : 1000000;
  const tracks = entries.find(entry => entry.id === 0x1654ae6b);
  if (!tracks) throw Error('Missing WebM tracks');
  const video = elements(tracks.start, tracks.end).filter(entry => entry.id === 0xae).map(entry => elements(entry.start, entry.end)).find(fields => integer(fields.find(entry => entry.id === 0x83)) === 1);
  if (!video) throw Error('Missing WebM video');
  const track = integer(video.find(entry => entry.id === 0xd7));
  const codecEntry = video.find(entry => entry.id === 0x86);
  const codec = data.toString('utf8', codecEntry.start, codecEntry.end);
  if (!['V_VP9', 'V_VP8'].includes(codec)) throw Error(`Unsupported WebM codec: ${codec}`);
  const packets = [];
  for (const cluster of entries.filter(entry => entry.id === 0x1f43b675)) {
    const blocks = elements(cluster.start, cluster.end);
    const clock = blocks.find(entry => entry.id === 0xe7);
    if (!clock) throw Error('Missing WebM cluster clock');
    const base = integer(clock);
    if (blocks.some(entry => entry.id === 0xa0)) throw Error('WebM BlockGroup needs explicit demux support');
    for (const block of blocks.filter(entry => entry.id === 0xa3)) {
      const number = vint(block.start);
      if (number.value !== track) continue;
      const offset = block.start + number.length;
      const flags = data[offset + 2];
      if (flags & 6) throw Error('Laced WebM video needs explicit demux support');
      packets.push({ timestamp: Math.round((base + data.readInt16BE(offset)) * scale / 1000), key: !!(flags & 128), offset: offset + 3, size: block.end - offset - 3 });
    }
  }
  return { config: { codec: codec === 'V_VP9' ? 'vp09.00.10.08' : 'vp8' }, packets };
}

export function resolvePreview(input, root = PROJECT_ROOT) {
  if (input) {
    const candidates = isAbsolute(input) ? [input] : [resolve(root, input), resolve(root, 'out/preview', input)];
    const filename = candidates.find(existsSync);
    if (!filename) throw Error(`Video not found: ${input}`);
    return resolve(filename);
  }
  const index = resolve(root, 'out/preview/index.html');
  const html = readFileSync(index, 'utf8');
  const videoTag = /<video\b[^>]*>[\s\S]*?<\/video>/i.exec(html)?.[0];
  const source = videoTag && /\bsrc\s*=\s*["']([^"']+\.webm(?:[?#][^"']*)?)["']/i.exec(videoTag)?.[1];
  if (!source || /^(?:[a-z]+:|\/\/)/i.test(source)) throw Error('Preview index must reference a local WebM');
  const filename = resolve(dirname(index), decodeURIComponent(source.split(/[?#]/)[0].replace(/&amp;/g, '&')));
  if (!existsSync(filename)) throw Error(`Preview index video missing: ${filename}`);
  return filename;
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export async function checkCuts(input, options = {}) {
  const filename = resolvePreview(input);
  const policy = loadCutPolicy();
  const bytes = readFileSync(filename);
  const demux = bytes.subarray(0, 4).toString('hex') === '1a45dfa3' ? webmPackets(bytes) : mp4Packets(bytes);
  const frameCount = demux.packets.length;
  if (!frameCount || (!options.sample && frameCount !== Math.round(policy.total * policy.fps))) throw Error(`Expected ${policy.total * policy.fps} frames at 30fps; found ${frameCount}. Use --sample only for short smoke clips.`);
  for (let index = 0; index < frameCount; index++) if (Math.abs(demux.packets[index].timestamp / 1e6 - index / policy.fps) > 0.0011) throw Error(`Uncertain 30fps timing at frame ${index}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = resolve(PROJECT_ROOT, 'out/combined/cut-check', `${stamp}-${basename(filename).replace(/[^a-zA-Z0-9_-]/g, '_')}`);
  mkdirSync(resolve(directory, 'frames'), { recursive: true });
  const server = createServer((request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">'); return; }
    if (request.url !== '/video') { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Length', statSync(filename).size);
    response.setHeader('Content-Type', filename.toLowerCase().endsWith('.webm') ? 'video/webm' : 'video/mp4');
    createReadStream(filename).pipe(response);
  });
  let browser;
  try {
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.exposeFunction('saveCutImage', (name, png) => {
      if (!/^(?:frames\/frame-\d+|strip-\d+)\.png$/.test(name)) throw Error('Invalid output image path');
      writeFileSync(resolve(directory, name), Buffer.from(png.split(',')[1], 'base64'));
    });
    await page.exposeFunction('cutProgress', count => console.log(`Decoded ${count}/${frameCount}`));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const frames = await page.evaluate(async ({ demux, settings }) => {
      window.cutBytes = new Uint8Array(await (await fetch('/video')).arrayBuffer());
      window.cutThumbnails = [];
      const canvas = document.createElement('canvas');
      canvas.width = settings.width;
      canvas.height = settings.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      const result = [];
      let previous;
      let failure;
      let dimensions;
      const config = { ...demux.config };
      if (config.description) config.description = new Uint8Array(config.description);
      if (!(await VideoDecoder.isConfigSupported(config)).supported) throw Error('Chrome cannot decode this video codec');
      window.decodeCutFrames = async output => {
        failure = undefined;
        const decoder = new VideoDecoder({ output: frame => {
          try { output(frame); } catch (error) { failure = error; } finally { frame.close(); }
        }, error: error => { failure = error; } });
        decoder.configure(config);
        try {
          for (const packet of demux.packets) {
            while (decoder.decodeQueueSize > 12 && !failure) await new Promise(accept => setTimeout(accept, 1));
            if (failure) throw failure;
            decoder.decode(new EncodedVideoChunk({ type: packet.key ? 'key' : 'delta', timestamp: packet.timestamp, data: window.cutBytes.subarray(packet.offset, packet.offset + packet.size) }));
          }
          await decoder.flush();
          if (failure) throw failure;
        } finally { if (decoder.state !== 'closed') decoder.close(); }
      };
      await window.decodeCutFrames(frame => {
        const index = result.length;
        if (index >= demux.packets.length || frame.timestamp !== demux.packets[index].timestamp) throw Error(`Missing, duplicate or reordered decoded frame ${index}`);
        dimensions ??= { width: frame.displayWidth, height: frame.displayHeight };
        if (frame.displayWidth !== dimensions.width || frame.displayHeight !== dimensions.height) throw Error('Decoded video dimensions changed');
        context.drawImage(frame, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const gray = new Float32Array(canvas.width * canvas.height);
        let difference = 0;
        for (let index = 0; index < gray.length; index++) {
          const offset = index * 4;
          gray[index] = pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722;
          if (previous) difference += Math.abs(gray[index] - previous[index]);
        }
        const time = frame.timestamp / 1e6;
        result.push({ index, time, nominalTime: index / settings.fps, previousTime: index ? result[index - 1].time : null, difference: index ? difference / gray.length : null });
        previous = gray;
        window.cutThumbnails.push(canvas.toDataURL('image/png'));
        if ((index + 1) % 300 === 0) window.cutProgress(index + 1);
      });
      if (result.length !== demux.packets.length) throw Error(`Chrome decoded ${result.length} of ${demux.packets.length} frames`);
      window.cutDimensions = dimensions;
      return { entries: result, dimensions };
    }, { demux, settings: DETECTION });
    const detection = detectCuts(frames.entries, policy);
    const duration = frameCount / policy.fps;
    const strips = [
      ...policy.boundaries.filter(time => time < duration).map(time => ({ time, status: 'boundary', label: `边界 ${time.toFixed(2)}s` })),
      ...detection.anomalies.map(entry => ({ time: entry.time, status: entry.status, label: `${entry.status} ${entry.time.toFixed(6)}s Δ=${entry.difference.toFixed(3)}`, anomalyFrame: entry.index })),
    ].map((entry, index) => ({ ...entry, image: `strip-${index}.png`, indices: stripFrames(entry.time, frameCount), columns: options.rows === 2 ? 16 : 32 }));
    const captureIndices = [...new Set(strips.flatMap(strip => strip.indices))];
    const evidence = await page.evaluate(async ({ captureIndices, strips }) => {
      const targets = new Set(captureIndices);
      const canvas = document.createElement('canvas');
      canvas.width = window.cutDimensions.width;
      canvas.height = window.cutDimensions.height;
      const context = canvas.getContext('2d');
      const pending = [];
      let index = 0;
      if (targets.size) await window.decodeCutFrames(frame => {
        if (targets.has(index)) {
          context.drawImage(frame, 0, 0);
          pending.push(window.saveCutImage(`frames/frame-${index}.png`, canvas.toDataURL('image/png')));
        }
        index++;
      });
      await Promise.all(pending);
      if (targets.size && index !== window.cutThumbnails.length) throw Error('Evidence pass lost frames');
      for (const strip of strips) {
        const columns = Math.min(strip.columns, strip.indices.length);
        const rows = Math.ceil(strip.indices.length / columns);
        const image = document.createElement('canvas');
        image.width = columns * 160;
        image.height = rows * 112;
        const drawing = image.getContext('2d');
        drawing.fillStyle = '#171717';
        drawing.fillRect(0, 0, image.width, image.height);
        for (let position = 0; position < strip.indices.length; position++) {
          const frameIndex = strip.indices[position];
          const thumbnail = new Image();
          thumbnail.src = window.cutThumbnails[frameIndex];
          await thumbnail.decode();
          const left = position % columns * 160;
          const top = Math.floor(position / columns) * 112;
          drawing.drawImage(thumbnail, left, top, 160, 90);
          drawing.fillStyle = strip.status === 'UNEXPECTED' ? '#ff5555' : '#f5f0e7';
          drawing.font = '12px monospace';
          drawing.fillText(`${(frameIndex / 30).toFixed(4)}s #${frameIndex}`, left + 3, top + 105);
        }
        await window.saveCutImage(strip.image, image.toDataURL('image/png'));
        strip.width = image.width;
        strip.height = image.height;
        strip.frameCount = strip.indices.length;
      }
      return strips;
    }, { captureIndices, strips });
    const report = { filename, checkedAt: new Date().toISOString(), decoding: 'Chrome WebCodecs; every encoded video packet; ordered timestamp and frame-count verification; no frame seeking', frameCount, fps: policy.fps, duration, dimensions: frames.dimensions, sample: !!options.sample, settings: DETECTION, policy, ...detection, frames: frames.entries, strips: evidence };
    writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
    const videoUrl = isAbsolute(relative(directory, filename)) ? pathToFileURL(filename).href : relative(directory, filename).split(/[\\/]/).map(part => encodeURIComponent(part)).join('/');
    const sections = `<p>已审核连续变换 / 节拍脉冲：${detection.reviewedCount} 帧；单独归类，非允许硬切。检测阈值不变，全部候选仍保留逐帧证据。</p>` + evidence.map((strip, index) => {
      const columns = Math.min(strip.columns, strip.indices.length);
      const areas = strip.indices.map((frameIndex, position) => {
        const left = position % columns * 160;
        const top = Math.floor(position / columns) * 112;
        return `<area shape="rect" coords="${left},${top},${left + 160},${top + 112}" href="frames/frame-${frameIndex}.png" target="_blank" alt="${frameIndex / 30}s frame ${frameIndex}" title="${frameIndex / 30}s · 原尺寸截图">`;
      }).join('');
      return `<section class="${strip.status}"><h2>${escapeHtml(strip.label)} · ${strip.frameCount}帧 <button data-time="${strip.time}">播放此处</button></h2><p><a href="${strip.image}" target="_blank">完整PNG ${strip.width}×${strip.height}</a> · 每帧可点击打开 ${frames.dimensions.width}×${frames.dimensions.height} 原尺寸截图</p><div class="strip"><img src="${strip.image}" width="${strip.width}" height="${strip.height}" usemap="#strip${index}" alt="${escapeHtml(strip.label)}"><map name="strip${index}">${areas}</map></div></section>`;
    }).join('\n');
    writeFileSync(resolve(directory, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>预览逐帧切点自查</title><style>body{background:#171717;color:#f5f0e7;font:16px sans-serif;margin:24px}a{color:#b8dcff}video{width:100%;max-width:1280px}section{border-top:1px solid #555;padding:16px 0}.UNEXPECTED,.UNEXPECTED a{color:#ff5555}.strip{overflow-x:auto}img{max-width:none;display:block}button{cursor:pointer}</style><h1>逐帧切点自查</h1><p>${escapeHtml(basename(filename))} · ${frameCount}帧 · 30fps · ${frames.dimensions.width}×${frames.dimensions.height}${options.sample ? ' · SAMPLE：仅短片冒烟' : ''}</p><p>allowed=${detection.allowedCount} · <strong class="UNEXPECTED">UNEXPECTED=${detection.unexpectedCount}</strong> · threshold=${detection.threshold.toFixed(4)} · median=${detection.median.toFixed(4)} · MAD=${detection.mad.toFixed(4)} · <a href="report.json">全部逐帧差值及精确允许表 JSON</a></p><p>异常是需人工审核的候选；连续边界不自动允许。时间标签是30fps帧序列，精确解码时间见JSON。点击缩略帧打开源视频原尺寸截图，未放大为1080p。</p><video id="video" controls preload="metadata" src="${escapeHtml(videoUrl)}"></video>${sections}<script>document.querySelectorAll('button[data-time]').forEach(button=>button.addEventListener('click',()=>{const video=document.getElementById('video');video.currentTime=Number(button.dataset.time);video.scrollIntoView({behavior:'smooth'});video.play().catch(()=>{});}));</script></html>`);
    if (!options.sample) writeFileSync(resolve(PROJECT_ROOT, 'out/combined/cut-check/index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${basename(directory)}/index.html"><a href="${basename(directory)}/index.html">最新全片逐帧检查</a>`);
    return { report: resolve(directory, 'report.json'), html: resolve(directory, 'index.html'), frameCount, allowedCount: detection.allowedCount, reviewedCount: detection.reviewedCount, unexpectedCount: detection.unexpectedCount, threshold: detection.threshold, anomalies: detection.anomalies };
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(accept => server.close(accept));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log('Usage: node scripts/check-cuts.mjs [previewfilename.webm|fullpath.mp4] [--sample] [--rows=2]\nDefault: local WebM referenced by out/preview/index.html; 90s, 30fps, 2700 decoded frames.\nOutput: out/combined/cut-check/<run>/index.html and report.json; UNEXPECTED candidates do not fail the CLI.');
    } else {
      const input = args.find(value => !value.startsWith('--'));
      if (args.filter(value => !value.startsWith('--')).length > 1 || args.some(value => value.startsWith('--') && !['--sample', '--rows=2'].includes(value))) throw Error('Unknown arguments; use --help');
      console.log(JSON.stringify(await checkCuts(input, { sample: args.includes('--sample'), rows: args.includes('--rows=2') ? 2 : 1 }), null, 2));
    }
  } catch (error) {
    console.error(`CUT CHECK ERROR: ${error.stack ?? error}`);
    process.exitCode = 1;
  }
}
