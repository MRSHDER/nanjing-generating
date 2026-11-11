import { BOOT_BEATS, createBootOverlay, OVERLAY_HEIGHT, OVERLAY_WIDTH } from './boot';
import type { OverlayRole } from './boot';
import '@fontsource/noto-sans-sc/900.css';
import { createDrop1Overlay, DROP1_BEATS, getDrop1Layout } from './drop1';

const params = new URLSearchParams(location.search);
const section = params.get('section') === 'drop1' ? 'drop1' : 'boot';
const requestedBpm = Number(params.get('bpm') ?? (section === 'drop1' ? 144 : 128));
const BPM = Number.isFinite(requestedBpm) && requestedBpm > 0 ? requestedBpm : 144;
const beats = section === 'drop1' ? DROP1_BEATS : BOOT_BEATS;
const DURATION = beats * 60 / BPM;
const canvas = document.getElementById('overlay-preview') as HTMLCanvasElement;
const context = canvas.getContext('2d')!;
const play = document.getElementById('play') as HTMLButtonElement;
const seek = document.getElementById('seek') as HTMLInputElement;
const timeLabel = document.getElementById('time')!;
const theme = document.getElementById('theme') as HTMLSelectElement;
const layer = document.getElementById('layer') as HTMLSelectElement;
const overlay = section === 'drop1' ? createDrop1Overlay() : createBootOverlay();
const tinted = document.createElement('canvas');
tinted.width = OVERLAY_WIDTH;
tinted.height = OVERLAY_HEIGHT;
const tintContext = tinted.getContext('2d')!;
const palettes: Record<string, Record<OverlayRole | 'background', string>> = {
  paper: { background: '#eee9df', foreground: '#0a0a0b', muted: '#8a8780', signal: '#e2382b' },
  dark: { background: '#0a0a0b', foreground: '#eee9df', muted: '#8a8780', signal: '#e2382b' },
};

let currentTime = 0;
let playing = false;
let previousTime: number | undefined;

if (params.get('export') === '1') document.body.classList.add('export');
theme.value = params.get('theme') === 'dark' || (section === 'drop1' && params.get('theme') !== 'paper') ? 'dark' : 'paper';
layer.value = params.get('layer') === 'behind' ? 'behind' : 'all';
seek.max = String(DURATION - 1 / 60);
document.querySelector('h1')!.textContent = `南京，正在生成 · ${section === 'drop1' ? '城墙二维背景板' : '二维开场'}`;
document.querySelector('header span')!.textContent = `${BPM} BPM 演示 / ${DURATION.toFixed(2)} 秒 / 无声素材预览`;

function drawAt(time: number) {
  if (!Number.isFinite(time)) throw new Error('预览时间必须是有限数字');
  const palette = palettes[theme.value]!;
  const localBeat = time * BPM / 60;
  const beatPhase = localBeat - Math.floor(localBeat);
  overlay.render({ localBeat, kick: Math.exp(-beatPhase * 12) });
  context.fillStyle = palette.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const mask of overlay.masks) {
    if (layer.value !== 'all' && (mask.layer ?? 'front') !== layer.value) continue;
    tintContext.globalCompositeOperation = 'source-over';
    tintContext.clearRect(0, 0, tinted.width, tinted.height);
    tintContext.drawImage(mask.canvas, 0, 0);
    tintContext.globalCompositeOperation = 'source-in';
    tintContext.fillStyle = palette[mask.role];
    tintContext.fillRect(0, 0, tinted.width, tinted.height);
    context.drawImage(tinted, 0, 0);
  }
}

function refresh() {
  drawAt(currentTime);
  seek.value = String(currentTime);
  timeLabel.textContent = `${currentTime.toFixed(2)} / ${DURATION.toFixed(2)} 秒`;
  play.textContent = playing ? '暂停' : '播放';
}

function toggle() {
  if (currentTime >= DURATION - 1 / 60) currentTime = 0;
  playing = !playing;
  previousTime = undefined;
  refresh();
}

play.addEventListener('click', toggle);
seek.addEventListener('input', () => {
  playing = false;
  currentTime = Math.min(DURATION - 1 / 60, Number(seek.value));
  refresh();
});
theme.addEventListener('change', refresh);
layer.addEventListener('change', refresh);
addEventListener('keydown', (event) => {
  if ((event.target as HTMLElement).matches('input, select, button')) return;
  if (event.code === 'Space') {
    event.preventDefault();
    toggle();
  } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    playing = false;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    currentTime = Math.min(DURATION - 1 / 60, Math.max(0, currentTime + direction / 60));
    refresh();
  }
});

function loop(timestamp: number) {
  if (playing && previousTime !== undefined) {
    currentTime += (timestamp - previousTime) / 1000;
    if (currentTime >= DURATION) {
      currentTime = DURATION - 1 / 60;
      playing = false;
    }
    refresh();
  }
  previousTime = timestamp;
  requestAnimationFrame(loop);
}

declare global {
  interface Window {
    __overlayPreview?: {
      ready: boolean;
      duration: number;
      section: string;
      beats: number;
      bpm: number;
      layers: { layer: string; role: string }[];
      layoutAt: (beat: number) => ReturnType<typeof getDrop1Layout> | null;
      drawAt: typeof drawAt;
      masksAt: (beat: number) => string[];
      playFromStart: () => void;
    };
  }
}

await document.fonts.load('900 205px "Noto Sans SC"', '南京宁正在生成中华门三瓮四砖文共筑未来创作字样非原意象示ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/·');
await document.fonts.ready;
const requestedTime = Number(params.get('t') ?? '0');
currentTime = Math.max(0, Math.min(DURATION - 1 / 60, Number.isFinite(requestedTime) ? requestedTime : 0));
refresh();
window.__overlayPreview = {
  ready: true,
  duration: DURATION,
  section,
  beats,
  bpm: BPM,
  layers: overlay.masks.map(mask => ({ layer: mask.layer ?? 'front', role: mask.role })),
  layoutAt: beat => section === 'drop1' ? getDrop1Layout(beat) : null,
  drawAt,
  masksAt(beat: number) {
    overlay.render({ localBeat: beat, kick: 0 });
    return overlay.masks.map(mask => mask.canvas.toDataURL());
  },
  playFromStart() {
    currentTime = 0;
    playing = true;
    previousTime = undefined;
    refresh();
  },
};
requestAnimationFrame(loop);
