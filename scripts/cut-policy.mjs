import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DETECTION = Object.freeze({ fps: 30, width: 160, height: 90, minimumDifference: 12, madMultiplier: 8, madScale: 1.4826 });
export const REVIEW_BOUNDARIES = Object.freeze([6.67, 13.33, 26.67, 36.67, 53.33, 60, 66.67, 83.33]);

export function loadCutPolicy(root = PROJECT_ROOT) {
  const structure = JSON.parse(readFileSync(resolve(root, 'music/structure.json'), 'utf8'));
  const source = readFileSync(resolve(root, 'src/three/glitch.ts'), 'utf8');
  const beat = 60 / structure.bpm;
  const section = id => {
    const entry = structure.sections.find(value => value.id === id);
    if (!entry) throw Error(`Missing section: ${id}`);
    return entry.startBar * structure.beatsPerBar * beat;
  };
  const declaration = /const\s+FLASH_WINDOWS\s*:[^=]+?=\s*(\[[\s\S]*?\]);/.exec(source);
  if (!declaration) throw Error('Cannot establish exact FLASH_WINDOWS from src/three/glitch.ts');
  const table = declaration[1].replace(/\/\/[^\n\r]*/g, '').replace(/,\s*]/g, ']');
  const windows = JSON.parse(table);
  const youthSource = readFileSync(resolve(root, 'src/three/youthMotion.ts'), 'utf8');
  const inserts = [...youthSource.matchAll(/\{ beat: ([\d.]+), duration: ([\d.]+), shot: '([A-Za-z]+)' \}/g)].map(match => ({ beat: Number(match[1]), duration: Number(match[2]), shot: match[3] }));
  const bridgeBeats = [16, 20, 21, 23, 25, 26, 28, 30, 32, 34];
  if (inserts.length !== bridgeBeats.length || inserts.some((shot, index) => shot.beat !== bridgeBeats[index] || shot.duration <= 0 || shot.beat + shot.duration !== (bridgeBeats[index + 1] ?? 40))) throw Error('Uncertain youth shot policy');
  if (windows.length !== 6 || windows.some(window => window.length !== 2 || !window.every(Number.isFinite) || window[0] >= window[1])) throw Error('Uncertain flash policy: expected six exact beat windows');
  if (!/const\s+second\s*=\s*flash\.u\s*>=\s*0\.5/.test(source) || !/raw\s*=\s*f\.lt\s*\/\s*BEAT/.test(source)) throw Error('Flash midpoint or real-time clock changed; review policy');
  const allowed = [
    { time: section('lock') + 14.25 * beat, label: '球→砖' },
    { time: section('drop2'), label: '一点爆开' },
    { time: section('outro'), label: '片尾进入' },
    { time: section('outro') + 1.5, label: '球→印章' },
    { time: section('drop1') + beat, label: '红色远景字幕墙进入' },
    { time: section('drop1') + 32 * beat, label: '红色远景字幕墙离开' },
    { time: section('youth'), label: '算法凝视接青年' },
    ...inserts.map(shot => ({ time: section('youth') + shot.beat * beat, label: `青年镜头 ${shot.shot}` })),
    ...Array.from({ length: 9 }, (_, index) => ({ time: section('drop2') + 8 * beat + index * beat, label: `闪回拍点 ${index}` })),
  ];
  const flashTimes = windows.map(([start, end], index) => {
    const entry = { index: index + 1, startBeat: start, endBeat: end, start: section('glitch') + start * beat, middle: section('glitch') + (start + end) * beat / 2, end: section('glitch') + end * beat };
    for (const phase of ['start', 'middle', 'end']) allowed.push({ time: entry[phase], label: `闪屏 ${entry.index} ${phase}` });
    return entry;
  });
  const reviewedContinuous = [
    { start: 6.3, end: 6.5, label: '坐标推进连续变换', review: 'Claude 2026-10-14 18:40' },
    { start: 13.33, end: 13.54, label: '砖下洇墨连续变换', review: 'Claude 2026-10-14 18:40' },
    { start: 26.3, end: 26.5, label: '穿门推进连续变换', review: 'Claude 2026-10-14 18:40' },
    { start: 60.4, end: 65.5, label: '蓄力隧道底鼓灰白脉冲', review: 'Claude 2026-10-14 18:40' },
  ];
  return { beat, fps: DETECTION.fps, total: structure.bars * structure.beatsPerBar * beat, boundaries: [...REVIEW_BOUNDARIES], allowed: allowed.sort((first, second) => first.time - second.time), reviewedContinuous, flashTimes, provenance: { timing: 'music/structure.json; src/engine/beat.ts BEAT = 60 / BPM', flashes: 'src/three/glitch.ts FLASH_WINDOWS; raw=f.lt/BEAT; second=flash.u>=0.5', glitchSha256: createHash('sha256').update(source).digest('hex') } };
}

export function meanGrayDifference(previous, current) {
  if (!previous.length || previous.length !== current.length) throw Error('Invalid grayscale frame sizes');
  let total = 0;
  for (let index = 0; index < current.length; index++) total += Math.abs(current[index] - previous[index]);
  return total / current.length;
}

export function detectCuts(frames, policy, settings = DETECTION) {
  const median = values => {
    const sorted = [...values].sort((first, second) => first - second);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : 0;
  };
  const differences = frames.slice(1).map(frame => frame.difference);
  if (differences.some(value => !Number.isFinite(value) || value < 0)) throw Error('Invalid frame differences');
  const center = median(differences);
  const mad = median(differences.map(value => Math.abs(value - center)));
  const threshold = Math.max(settings.minimumDifference, center + settings.madMultiplier * settings.madScale * mad);
  const anomalies = frames.filter(frame => frame.index > 0 && frame.difference > threshold).map(frame => {
    const matches = policy.allowed.filter(cut => cut.time > frame.previousTime - 0.0011 && cut.time <= frame.time + 0.0011);
    const reviews = (policy.reviewedContinuous ?? []).filter(review => frame.time >= review.start && frame.time <= review.end);
    return { ...frame, status: matches.length ? 'allowed' : reviews.length ? 'reviewed-continuous' : 'UNEXPECTED', matches, reviews };
  });
  return { median: center, mad, threshold, minimumDifference: settings.minimumDifference, madMultiplier: settings.madMultiplier, anomalies, allowedCount: anomalies.filter(entry => entry.status === 'allowed').length, reviewedCount: anomalies.filter(entry => entry.status === 'reviewed-continuous').length, unexpectedCount: anomalies.filter(entry => entry.status === 'UNEXPECTED').length };
}

export function stripFrames(time, frameCount, fps = DETECTION.fps) {
  const first = Math.max(0, Math.floor((time - 0.5) * fps + 1e-7));
  const last = Math.min(frameCount - 1, Math.ceil((time + 0.5) * fps - 1e-7));
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
}
