const unsigned = (value, length = 4) => {
  const data = Buffer.alloc(length);
  data.writeUIntBE(value, 0, length);
  return data;
};
const zeros = length => Buffer.alloc(length);
const box = (type, ...parts) => {
  const payload = Buffer.concat(parts);
  return Buffer.concat([unsigned(payload.length + 8), Buffer.from(type), payload]);
};
const full = (type, flags, ...parts) => box(type, unsigned(flags), ...parts);
const descriptor = (tag, payload) => {
  let length = payload.length;
  const bytes = [length & 127];
  while ((length >>= 7)) bytes.unshift((length & 127) | 128);
  return Buffer.concat([Buffer.from([tag, ...bytes]), payload]);
};
const matrix = Buffer.from('000100000000000000000000000000000001000000000000000000000000000040000000', 'hex');
const movieScale = 48000;

function sampleTable(track, offset, { width, height, frameRate, audioBitrate }) {
  const video = track.kind === 'video';
  const entry = video
    ? box('avc1', zeros(6), unsigned(1, 2), zeros(16), unsigned(width, 2), unsigned(height, 2), unsigned(0x00480000), unsigned(0x00480000), zeros(4), unsigned(1, 2), zeros(32), unsigned(24, 2), unsigned(65535, 2), box('avcC', track.description))
    : box('mp4a', zeros(6), unsigned(1, 2), zeros(8), unsigned(2, 2), unsigned(16, 2), zeros(4), unsigned(movieScale * 65536), full('esds', 0,
      descriptor(3, Buffer.concat([unsigned(2, 2), zeros(1), descriptor(4, Buffer.concat([
        Buffer.from([0x40, 0x15]), zeros(3), unsigned(audioBitrate), unsigned(audioBitrate), descriptor(5, track.description),
      ])), descriptor(6, Buffer.from([2]))]))));
  const duration = video ? 1000 : 1024;
  const sync = video ? [full('stss', 0, unsigned(track.packets.filter(packet => packet.key).length), ...track.packets.flatMap((packet, index) => packet.key ? [unsigned(index + 1)] : []))] : [];
  return box('stbl', full('stsd', 0, unsigned(1), entry),
    full('stts', 0, unsigned(1), unsigned(track.packets.length), unsigned(duration)),
    full('stsc', 0, unsigned(1), unsigned(1), unsigned(track.packets.length), unsigned(1)),
    full('stsz', 0, zeros(4), unsigned(track.packets.length), ...track.packets.map(packet => unsigned(packet.data.length))),
    full('stco', 0, unsigned(1), unsigned(offset)), ...sync);
}

function mediaTrack(track, id, offset, config) {
  const video = track.kind === 'video';
  const targetDuration = Math.round(config.duration * movieScale);
  const mediaScale = video ? config.frameRate * 1000 : movieScale;
  const mediaDuration = track.packets.length * (video ? 1000 : 1024);
  const delay = video ? 0 : Math.max(0, Math.round(-track.packets[0].timestamp * movieScale / 1e6));
  if (!video && mediaDuration - delay < targetDuration) throw Error('AAC packets do not cover the requested duration');
  const header = full('tkhd', 7, zeros(8), unsigned(id), zeros(4), unsigned(targetDuration), zeros(8), zeros(4), unsigned(video ? 0 : 0x0100, 2), zeros(2), matrix, unsigned(video ? config.width * 65536 : 0), unsigned(video ? config.height * 65536 : 0));
  const edit = box('edts', full('elst', 0, unsigned(1), unsigned(targetDuration), unsigned(delay), unsigned(1, 2), zeros(2)));
  const handler = full('hdlr', 0, zeros(4), Buffer.from(video ? 'vide' : 'soun'), zeros(12), Buffer.from(video ? 'VideoHandler\0' : 'SoundHandler\0'));
  const data = box('dinf', full('dref', 0, unsigned(1), full('url ', 1)));
  const mediaHeader = video ? full('vmhd', 1, zeros(8)) : full('smhd', 0, zeros(4));
  return box('trak', header, edit, box('mdia',
    full('mdhd', 0, zeros(8), unsigned(mediaScale), unsigned(mediaDuration), unsigned(0x55c4, 2), zeros(2)),
    handler, box('minf', mediaHeader, data, sampleTable(track, offset, config))));
}

export function muxFinalMp4(config, video, audio) {
  for (const track of [video, audio]) {
    if (!track.description?.length || !track.packets.length) throw Error(`Missing ${track.kind} codec configuration or packets`);
    if (track.packets.some((packet, index) => index > 0 && packet.timestamp <= track.packets[index - 1].timestamp)) throw Error(`${track.kind} packet reordering is unsupported; use realtime encoding`);
  }
  if (video.packets.length !== Math.round(config.duration * config.frameRate)) throw Error('Video frame count mismatch');
  if (!video.packets[0].key) throw Error('Video must start with a key frame');
  const fileType = box('ftyp', Buffer.from('isom'), unsigned(512), Buffer.from('isomiso2avc1mp41'));
  const header = full('mvhd', 0, zeros(8), unsigned(movieScale), unsigned(Math.round(config.duration * movieScale)), unsigned(0x00010000), unsigned(0x0100, 2), zeros(10), matrix, zeros(24), unsigned(3));
  const movie = (videoOffset, audioOffset) => box('moov', header, mediaTrack(video, 1, videoOffset, config), mediaTrack(audio, 2, audioOffset, config));
  const videoBytes = video.packets.reduce((total, packet) => total + packet.data.length, 0);
  const videoOffset = fileType.length + movie(0, 0).length + 8;
  const metadata = movie(videoOffset, videoOffset + videoBytes);
  const mediaBytes = videoBytes + audio.packets.reduce((total, packet) => total + packet.data.length, 0);
  const totalBytes = fileType.length + metadata.length + 8 + mediaBytes;
  if (totalBytes > config.maxBytes) throw Error(`MP4 exceeds ${config.maxBytes} bytes: ${totalBytes}`);
  return Buffer.concat([fileType, metadata, unsigned(mediaBytes + 8), Buffer.from('mdat'), ...video.packets.map(packet => packet.data), ...audio.packets.map(packet => packet.data)], totalBytes);
}
