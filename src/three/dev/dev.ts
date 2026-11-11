// 三维层测试页（Claude 自用，不是正式播放器；正式预览由 Codex 的 main.ts 负责）。
// 打开：http://localhost:5173/src/three/dev/index.html?s=boot&t=3.2&scale=0.5
// 只渲染三维层 + 后期，不含二维文字。空格播放（带配乐），←/→ 跳 1 拍，,/. 逐帧。
import { createRenderer, makeRT } from '../../engine/gl';
import { Post } from '../../engine/post';
import { frameAt, sectionRange, BEAT, TOTAL, type SectionId } from '../../engine/beat';
import { getLayer3D, type Layer3D } from '../index';
import { Compositor } from '../../engine/compositor';
import { createLockOverlay } from '../../overlay2d/lock';
import { createDrop1Overlay } from '../../overlay2d/drop1';
import '@fontsource/noto-sans-sc/900.css';

const q = new URLSearchParams(location.search);
const section = (q.get('s') ?? 'boot') as SectionId;
const lab = q.get('lab');
const scale = parseFloat(q.get('scale') ?? '1');
const range = sectionRange(section);
let t = q.has('t') ? parseFloat(q.get('t')!) : range.start;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const r = createRenderer(canvas, { scale });
const post = new Post(r);
const rt3D = makeRT();
const audio = new Audio('/out/music/score.wav');
let layer: Layer3D | null = null;

// 锁定段：按 Codex 播放器同样的流程合成（后层海报 → 三维折射 → stage3D → 前层 → finish），只读调用 Codex 的模块
const compositor = new Compositor(r);
const lockOverlay = createLockOverlay();
const drop1Overlay = createDrop1Overlay();
const only3D = q.get('only3d') === '1';

function renderAt(time: number) {
  t = time;
  const f = frameAt(time);
  if (!layer) return;
  const overlay = section === 'lock' ? lockOverlay : section === 'drop1' ? drop1Overlay : null;
  if (overlay && !lab) {
    const paper = section === 'lock';
    if (section === 'lock') lockOverlay.render({ localBeat: f.lt / BEAT, kick: f.env.kick }, f);
    else drop1Overlay.render({ localBeat: f.lt / BEAT, kick: f.env.kick });
    const poster = compositor.poster(overlay.masks, paper);
    const p = layer.render(r, f, rt3D, { poster: poster.texture }) ?? {};
    const base = post.stage3D(rt3D, p);
    const composed = only3D ? base : compositor.front(overlay.masks, paper, base.texture);
    post.finish(composed, { ...p, grain: 0, vignette: 0 }, null, f.frame);
    ui.textContent = `${section}  t=${time.toFixed(3)}  拍=${((time - range.start) / BEAT).toFixed(2)}`;
    return;
  }
  const p = layer.render(r, f, rt3D) ?? {};
  const out = post.stage3D(rt3D, p);
  post.finish(out, p, null, f.frame);
  ui.textContent = `${section}  t=${time.toFixed(3)}  拍=${((time - range.start) / BEAT).toFixed(2)}`;
}

function loop() {
  if (!audio.paused) {
    renderAt(audio.currentTime);
    if (audio.currentTime >= range.end) audio.currentTime = range.start;
  }
  requestAnimationFrame(loop);
}

addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    if (audio.paused) { audio.currentTime = t; audio.play(); } else audio.pause();
    e.preventDefault();
  }
  const step = e.key === 'ArrowRight' ? BEAT : e.key === 'ArrowLeft' ? -BEAT : e.key === '.' ? 1 / 60 : e.key === ',' ? -1 / 60 : 0;
  if (step) renderAt(Math.min(TOTAL - 1e-3, Math.max(0, t + step)));
});

declare global { interface Window { __ready?: boolean; __renderAt?: (t: number) => void; __anchors?: (t: number) => unknown } }

await document.fonts.load('900 640px "Noto Sans SC"', '南京NANJING0123456789.°/NE');
await document.fonts.ready;

const LABS: Record<string, () => Promise<{ default: new () => Layer3D }>> = {
  glass: () => import('../lab/glass'),
};
const loadLayer = lab && LABS[lab]
  ? LABS[lab]!().then(async (m) => { const l = new m.default(); await l.init(r); return l; })
  : getLayer3D(section, r);

loadLayer.then((l) => {
  layer = l;
  window.__renderAt = renderAt;
  window.__anchors = (time: number) => layer?.anchors?.(frameAt(time)) ?? null;
  renderAt(t);
  window.__ready = true;
  requestAnimationFrame(loop);
});
