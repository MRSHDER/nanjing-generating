import { playbackProfile, AudioFramePacer, type PlaybackQuality } from './engine/playback';
import * as THREE from 'three';
import '@fontsource/noto-sans-sc/900.css';
import '@fontsource/noto-sans-sc/500.css';
import '@fontsource/inter/latin-900.css';
import { BEAT, BPM, FPS, frameAt, glitchTime, sectionRange, type SectionId } from './engine/beat';
import { createRenderer, makeRT } from './engine/gl';
import { Post, type PostParams } from './engine/post';
import { Compositor } from './engine/compositor';
import { createBootOverlay } from './overlay2d/boot';
import { createLockOverlay, getLockLayout } from './overlay2d/lock';
import { createDrop1Overlay, getDrop1Layout } from './overlay2d/drop1';
import { createGlitchOverlay, getGlitchLayout } from './overlay2d/glitch';
import { createYouthOverlay, getYouthLayout } from './overlay2d/youth';
import { createGenOverlay, getGenLayout } from './overlay2d/gen';
import { createBuildOverlay } from './overlay2d/build';
import { createDrop2Overlay } from './overlay2d/drop2';
import { AIGC_DISCLOSURE, createOutroOverlay } from './overlay2d/outro';
import { getLayer3D, type Layer3D } from './three';
import { lockBrickExitAnchor } from './three/lock';
import { youthGenNight } from './three/youthGenTransition';
import { drawPosterFrame } from './overlay2d/posterFrame';
import { SUBTITLE_GLYPHS, drawSubtitleLabels, subtitleAt } from './overlay2d/subtitles';
const labelCanvas = () => Object.assign(document.createElement('canvas'), { width: 1920, height: 1080 });
const subtitleLabels = { plate: labelCanvas(), text: labelCanvas(), rule: labelCanvas(), revision: 0 };
let cachedSubtitle: ReturnType<typeof subtitleAt> = null;
import { IMPLEMENTED_2D, IMPLEMENTED_END } from './timeline';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const play = document.getElementById('play') as HTMLButtonElement;
const seek = document.getElementById('seek') as HTMLInputElement;
const status = document.getElementById('status')!;
const params = new URLSearchParams(location.search);
window.__posterVariant = params.get('wutong') === 'portal' ? 'portal' : 'road';
const qualityParam = params.get('quality');
const quality: PlaybackQuality = qualityParam === 'smooth' || qualityParam === 'original' ? qualityParam : 'auto';
const mobileDevice = matchMedia('(pointer: coarse)').matches || innerWidth <= 700 || (navigator.maxTouchPoints > 1 && /Macintosh|iPad|iPhone|Android/.test(navigator.userAgent));
const profile = playbackProfile({ quality, mobile: mobileDevice, viewportWidth: innerWidth, explicitScale: params.has('scale') ? Number(params.get('scale')) : null });
const renderer = createRenderer(canvas, profile);
const qualitySelect = document.getElementById('quality') as HTMLSelectElement;
qualitySelect.value = quality;
qualitySelect.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('quality', qualitySelect.value);
  url.searchParams.set('t', String(audio.paused ? currentTime : audio.currentTime));
  url.searchParams.delete('scale');
  location.replace(url.href);
});
const framePacer = new AudioFramePacer();
let lastUiUpdate = -Infinity;
const post = new Post(renderer);
const compositor = new Compositor(renderer);
const portalCompositor = new Compositor(renderer);
const portalTarget = makeRT();
const portalOverlay = createGlitchOverlay();
const target3D = makeRT();
const boot = createBootOverlay();
const lock = createLockOverlay();
  const drop1 = createDrop1Overlay();
const glitch = createGlitchOverlay();
const youth = createYouthOverlay();
const gen = createGenOverlay();
const build = createBuildOverlay();
const drop2 = createDrop2Overlay();
const outro = createOutroOverlay();
const audio = new Audio(new URL('out/music/score.wav', document.baseURI).href);
let recordingContext: AudioContext | undefined;
let recordingSource: MediaElementAudioSourceNode | undefined;
let recordingActive = false;
let recordedFrames = 0;
audio.preload = 'auto';
audio.addEventListener('error', () => { status.textContent = '配乐加载失败，请刷新页面重试。'; });
seek.max = String(IMPLEMENTED_END - 1 / FPS);
if (params.get('ui') === '0') document.body.classList.add('hide-ui');

await document.fonts.load('900 640px "Noto Sans SC"', '南京，的宁正在生成中中华门三瓮四砖文共筑未来创作字样非原意象示视觉进度实际任务状态数据青年来斯代码设计想法信息真实简历上下公铁路空间测绘长江大桥紫金山地形ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.°/·%→');
await document.fonts.ready;
await document.fonts.load('500 20px "Noto Sans SC"', `${AIGC_DISCLOSURE}明城墙`);
await document.fonts.load('900 400px Inter', 'MING CITY WALL1366—1393');
await document.fonts.load('500 42px "Noto Sans SC"', '1928 · 梧桐秦淮河灯笼街夫子庙南京长江大桥中山陵紫金山');
await document.fonts.load('900 60px "Noto Sans SC"', SUBTITLE_GLYPHS); // 中英双语版式文字（Claude 2026-10-17）
await document.fonts.load('500 15px "Noto Sans SC"', SUBTITLE_GLYPHS);
const layers = new Map<SectionId, Layer3D | null>();
for (const section of IMPLEMENTED_2D) {
  if (section !== 'boot') layers.set(section, await getLayer3D(section, renderer));
}
const requestedTime = Number(params.get('t') ?? 0);
let currentTime = Number.isFinite(requestedTime) ? Math.max(0, Math.min(IMPLEMENTED_END - 1 / FPS, requestedTime)) : 0;

function prepare(time: number) {
  if (!Number.isFinite(time)) throw new Error('时间必须为有限数字');
  const originalFrame = frameAt(Math.max(0, Math.min(IMPLEMENTED_END - 1 / FPS, time)));
  const visualFrame = frameAt(Math.max(originalFrame.sectionStart, glitchTime(originalFrame.t)));
  const frame = originalFrame.section === 'glitch' ? originalFrame : visualFrame;
  const localBeat = frame.lt / BEAT;
  const input = { localBeat, presentationBeat: (originalFrame.t - frame.sectionStart) / BEAT, kick: frame.env.kick };
  const layer = layers.get(frame.section) ?? null;
  const cameraFrame = frame.section === 'drop1' && originalFrame.lt / BEAT >= 30 ? originalFrame : frame;
  const backgroundCamera = layer?.backgroundCamera?.(cameraFrame);
  if (frame.section === 'boot') boot.render(input);
  else if (frame.section === 'lock') lock.render(input, frame, backgroundCamera);
  else if (frame.section === 'drop1') drop1.render(input, backgroundCamera);
  else if (frame.section === 'glitch') glitch.render(frame, backgroundCamera);
  else if (frame.section === 'youth') youth.render(frame, backgroundCamera);
  else if (frame.section === 'gen') gen.render(frame, backgroundCamera);
  else if (frame.section === 'build') build.render();
  else if (frame.section === 'drop2') drop2.render(frame, backgroundCamera);
  else if (frame.section === 'outro') outro.render(frame);
  else throw new Error(`尚未实现二维段落 ${frame.section}`);
  const masks = frame.section === 'boot' ? boot.masks : frame.section === 'lock' ? lock.masks : frame.section === 'drop1' ? drop1.masks : frame.section === 'glitch' ? glitch.masks : frame.section === 'youth' ? youth.masks : frame.section === 'gen' ? gen.masks : frame.section === 'build' ? build.masks : frame.section === 'drop2' ? drop2.masks : outro.masks;
  const paper = frame.section === 'youth' || frame.section === 'gen' ? 1 - youthGenNight(frame.t) : frame.section === 'boot' || frame.paper;
  drawPosterFrame(masks, originalFrame);
  return { frame, visualFrame, masks, paper, layer: layers.get(frame.section) ?? null };
}

export function renderAt(time: number) {
  const { frame, visualFrame, masks, paper, layer } = prepare(time);
  const brickAnchor = lockBrickExitAnchor();
  const inkSpread = frame.section === 'drop1' && frame.lt < BEAT / 2 ? { center: [brickAnchor[0], brickAnchor[1] + 72] as [number, number], progress: Math.max(0, frame.lt / (BEAT / 2)) } : undefined;
  const poster = compositor.poster(masks, inkSpread ? true : paper, inkSpread);
  let portal: THREE.Texture | undefined;
  let wallCamera: THREE.PerspectiveCamera | undefined;
  if (frame.section === 'drop1' && frame.lt / BEAT >= 30 && layer?.backgroundCamera) {
    wallCamera = layer.backgroundCamera(frameAt(time));
    const camera = wallCamera.clone();
    camera.position.add(new THREE.Vector3(0, -2.1, 31.05));
    camera.updateMatrixWorld(true);
    const next = frameAt(sectionRange('glitch').start);
    portalOverlay.render(next, camera);
    const behind = portalCompositor.poster(portalOverlay.masks, true);
    layers.get('glitch')!.render(renderer, next, portalTarget, { poster: behind.texture, camera });
    portal = portalCompositor.front(portalOverlay.masks, true, portalTarget.texture, portalOverlay.backing).texture;
  }
  let background = poster;
  let effects: PostParams = { exposure: 1, grain: 0, vignette: 0, flash: 0, fade: 0 };
  if (layer) {
    effects = { ...effects, ...layer.render(renderer, frame, target3D, { poster: poster.texture, presentationTime: time, portal, camera: wallCamera }), fade: 0 };
    background = post.stage3D(target3D, effects);
  }
  const backing = frame.section === 'glitch' ? glitch.backing : frame.section === 'youth' ? youth.backing : frame.section === 'gen' ? gen.backing : undefined;
  // 中英双语版式文字（Claude 2026-10-17）：三张独立遮罩，合成器固定配色叠在最上层
  const subtitle = subtitleAt(time);
  const platedSubtitle = subtitle?.plated ? subtitle : null;
  if (platedSubtitle && platedSubtitle !== cachedSubtitle) {
    for (const label of [subtitleLabels.plate, subtitleLabels.text, subtitleLabels.rule]) {
      const context = label.getContext('2d')!;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, 1920, 1080);
    }
    drawSubtitleLabels(subtitleLabels.plate.getContext('2d')!, subtitleLabels.text.getContext('2d')!, subtitleLabels.rule.getContext('2d')!, time);
    cachedSubtitle = platedSubtitle;
    subtitleLabels.revision++;
  }
  const composed = compositor.front(masks, inkSpread ? true : paper, background.texture, backing, inkSpread, platedSubtitle ? subtitleLabels : undefined);
  post.finish(composed, effects, null, visualFrame.frame);
  if (recordingActive) recordedFrames++;
}

function refresh(forceUi = true) {
  renderAt(currentTime);
  const now = performance.now();
  if (!forceUi && now - lastUiUpdate < 250) return;
  lastUiUpdate = now;
  seek.value = String(currentTime);
  play.textContent = audio.paused ? '播放' : '暂停';
  const frame = frameAt(currentTime);
  const names: Partial<Record<SectionId, string>> = { boot: '已选定开场版式', lock: '玻璃球 × 二维海报', drop1: '三维城墙 × 南京背景板', glitch: '数据点云 × 生成中版式', youth: '青年与大桥 × 南京背景板', gen: '地形等高线 × 南京背景板', build: '城市网格隧道', drop2: '双向奔赴 × 秦淮河', outro: '同心圆 → 红砖印章' };
  ui.textContent = `${currentTime.toFixed(2)} / ${IMPLEMENTED_END.toFixed(2)} 秒 · ${BPM} BPM · ${names[frame.section] ?? frame.section}`;
}

async function toggle() {
  framePacer.reset();
  if (!audio.paused) audio.pause();
  else {
    if (currentTime >= IMPLEMENTED_END - 1 / FPS) currentTime = 0;
    audio.currentTime = currentTime;
    try { await audio.play(); } catch { status.textContent = '音乐未能播放，请点击播放重试。'; }
  }
  refresh();
}

function goTo(time: number) {
  framePacer.reset();
  audio.pause();
  currentTime = Math.max(0, Math.min(IMPLEMENTED_END - 1 / FPS, time));
  audio.currentTime = currentTime;
  refresh();
}

audio.addEventListener('ended', () => {
  currentTime = IMPLEMENTED_END - 1 / FPS;
  framePacer.reset();
  refresh();
});
document.addEventListener('visibilitychange', () => framePacer.reset());
play.addEventListener('click', () => void toggle());
seek.addEventListener('input', () => goTo(Number(seek.value)));
addEventListener('keydown', event => {
  if ((event.target as HTMLElement).matches('button, input, select')) return;
  if (event.code === 'Space') { event.preventDefault(); void toggle(); }
  else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    event.preventDefault();
    goTo(currentTime + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? BEAT : 1 / FPS));
  } else if (event.key === '.') goTo(currentTime + 1 / FPS);
  else if (event.key === ',') goTo(currentTime - 1 / FPS);
});

function loop() {
  if (!audio.paused && (!document.hidden || recordingActive) && framePacer.shouldRender(audio.currentTime, recordingActive ? FPS : profile.fps)) {
    // Audio is the master clock. Drop late visual frames instead of slowing the film.
    currentTime = Math.min(audio.currentTime, IMPLEMENTED_END - 1 / FPS);
    const reachedEnd = audio.currentTime >= IMPLEMENTED_END;
    if (reachedEnd) audio.pause();
    refresh(reachedEnd);
  }
  requestAnimationFrame(loop);
}

declare global {
  interface Window {
    __posterVariant?: 'road' | 'portal';
    __ready?: boolean;
    __renderAt?: (time: number) => void;
    __movie?: {
      duration: number;
      threeReady: boolean;
      sections: SectionId[];
      recording: { renderedFrames: number; duration: number };
      scene: (time: number) => { section: SectionId; localBeat: number; visualBeat: number; layerTime: number; has3D: boolean; paper: boolean | number; anchors: Record<string, [number, number] | null> | null };
      poster: (time: number) => THREE.Texture;
      layout: (time: number) => ReturnType<typeof getLockLayout> | ReturnType<typeof getDrop1Layout> | ReturnType<typeof getGlitchLayout> | ReturnType<typeof getYouthLayout> | ReturnType<typeof getGenLayout> | null;
      record: () => Promise<string>;
    };
  }
}

window.__renderAt = renderAt;
window.__movie = {
  duration: IMPLEMENTED_END,
  threeReady: Boolean(layers.get('lock')),
  sections: IMPLEMENTED_2D,
  recording: { renderedFrames: 0, duration: 0 },
  scene(time) {
    renderAt(time);
    const { frame, visualFrame, layer, paper } = prepare(time);
    return { section: frame.section, localBeat: frame.lt / BEAT, visualBeat: visualFrame.lt / BEAT, layerTime: frame.t, has3D: Boolean(layer), paper, anchors: layer?.anchors?.(frame) ?? null };
  },
  poster(time) {
    const { masks, paper } = prepare(time);
    return compositor.poster(masks, paper).texture;
  },
  layout(time) {
    const { frame } = prepare(time);
    return frame.section === 'lock' ? getLockLayout(frame) : frame.section === 'drop1' ? getDrop1Layout(frame.lt / BEAT) : frame.section === 'glitch' ? getGlitchLayout(frame) : frame.section === 'youth' ? getYouthLayout(frame) : frame.section === 'gen' ? getGenLayout(frame) : null;
  },
  async record() {
    if (recordingActive) throw new Error('已有录制正在进行');
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(value => MediaRecorder.isTypeSupported(value));
    if (!mimeType) throw new Error('浏览器不支持带声音的 WebM');
    audio.pause();
    audio.currentTime = 0;
    currentTime = 0;
    refresh();
    recordingContext ??= new AudioContext();
    if (!recordingSource) {
      recordingSource = recordingContext.createMediaElementSource(audio);
      recordingSource.connect(recordingContext.destination);
    }
    let destination: MediaStreamAudioDestinationNode | undefined;
    let stream: MediaStream | undefined;
    let activeRecorder: MediaRecorder | undefined;
    let connected = false;
    let playbackTimer: ReturnType<typeof setInterval> | undefined;
    recordedFrames = 0;
    recordingActive = true;
    try {
      const destinationNode = destination = recordingContext.createMediaStreamDestination();
      recordingSource.connect(destinationNode);
      connected = true;
      const captureStream = stream = canvas.captureStream(30);
      for (const track of destinationNode.stream.getAudioTracks()) captureStream.addTrack(track);
      const recorder = activeRecorder = new MediaRecorder(captureStream, { mimeType, videoBitsPerSecond: 8000000 });
      const chunks: BlobPart[] = [];
      const recording = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error('录制失败'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });
      const playback = (async () => {
        await recordingContext.resume();
        recorder.start();
        await audio.play();
        await new Promise<void>((resolve, reject) => {
          const deadline = performance.now() + 180000;
          playbackTimer = setInterval(() => {
            if (audio.currentTime >= IMPLEMENTED_END || audio.ended) resolve();
            else if (audio.error || performance.now() >= deadline) reject(new Error('音乐载入失败或录制超时'));
          }, 25);
        });
      })();
      await Promise.race([playback, recording.then(() => { throw new Error('录制意外提前结束'); })]);
      audio.pause();
      recorder.stop();
      const blob = await recording;
      this.recording = { renderedFrames: recordedFrames, duration: audio.currentTime };
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result);
          const marker = ';base64,';
          const offset = result.indexOf(marker);
          if (offset < 0) reject(new Error('录制数据格式不正确'));
          else resolve(result.slice(offset + marker.length));
        };
        reader.onerror = () => reject(new Error('录制数据读取失败'));
        reader.readAsDataURL(blob);
      });
    } finally {
      if (playbackTimer !== undefined) clearInterval(playbackTimer);
      audio.pause();
      if (activeRecorder && activeRecorder.state !== 'inactive') activeRecorder.stop();
      stream?.getTracks().forEach(track => track.stop());
      destination?.stream.getTracks().forEach(track => track.stop());
      if (connected && destination) recordingSource.disconnect(destination);
      recordingActive = false;
    }
  },
};

play.disabled = false;
qualitySelect.disabled = false;
status.textContent = `v3 配乐 · ${BPM} BPM · 全片 90 秒已组合（二维背景随三维镜头），尚非终版。`;
refresh();
window.__ready = true;
requestAnimationFrame(loop);
