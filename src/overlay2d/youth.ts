import { BEAT, type Frame } from '../engine/beat';
import { OVERLAY_HEIGHT, OVERLAY_WIDTH, type OverlayMask, type OverlayRole } from './boot';
import type { PerspectiveCamera } from 'three';
import { youthInkBackdrop } from './youthInk';

export const YOUTH_BEATS = 40;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => 1 - Math.pow(1 - clamp(value), 3);

export function getYouthLayout(frame: Frame) {
  const beat = frame.lt / BEAT;
  return {
    size: [OVERLAY_WIDTH, OVERLAY_HEIGHT] as [number, number],
    subjectRegion: [750, 180, 1080, 760] as [number, number, number, number],
    titleRegion: beat < 32 ? [72, 175, 390, 200] : [805, 70, 310, 120],
    cardsRegion: [72, 510, 570, 295] as [number, number, number, number],
    localBeat: beat,
    text: beat < 16 ? '青年' : beat < 32 ? '来' : '南京',
  };
}

export function createYouthOverlay(fontFamily = '"Noto Sans SC", Arial, sans-serif') {
  const masks: OverlayMask[] = [];
  const contexts = new Map<string, CanvasRenderingContext2D>();
  const backing = document.createElement('canvas');
  backing.width = OVERLAY_WIDTH;
  backing.height = OVERLAY_HEIGHT;
  const backingContext = backing.getContext('2d')!;
  for (const layer of ['behind', 'front'] as const) {
    for (const role of ['muted', 'signal', 'foreground'] as OverlayRole[]) {
      const canvas = document.createElement('canvas');
      canvas.width = OVERLAY_WIDTH;
      canvas.height = OVERLAY_HEIGHT;
      masks.push({ layer, role, canvas });
      contexts.set(`${layer}/${role}`, canvas.getContext('2d')!);
    }
  }

  function text(context: CanvasRenderingContext2D, value: string, pixelX: number, pixelY: number, size: number, opacity = 1) {
    context.save();
    context.globalAlpha = clamp(opacity);
    context.font = `900 ${size}px ${fontFamily}`;
    context.fillText(value, pixelX, pixelY);
    context.restore();
  }

  function line(context: CanvasRenderingContext2D, points: number[][], width = 2, opacity = 1) {
    context.save();
    context.globalAlpha = clamp(opacity);
    context.lineWidth = width;
    context.beginPath();
    for (const [index, point] of points.entries()) {
      if (index === 0) context.moveTo(point[0]!, point[1]!);
      else context.lineTo(point[0]!, point[1]!);
    }
    context.stroke();
    context.restore();
  }

  function render(frame: Frame, camera?: PerspectiveCamera) {
    backingContext.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    for (const context of contexts.values()) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#ffffff';
    }
    if (frame.section !== 'youth' || !Number.isFinite(frame.t) || !Number.isFinite(frame.lt) || frame.t < frame.sectionStart || frame.t >= frame.sectionEnd || frame.lt < 0 || frame.lt / BEAT >= YOUTH_BEATS) return;
    const layout = getYouthLayout(frame);
    const beat = layout.localBeat;
    const grid = contexts.get('behind/muted')!;
    const ink = contexts.get('behind/foreground')!;
    const red = contexts.get('behind/signal')!;
    const front = contexts.get('front/foreground')!;
    const detail = contexts.get('front/muted')!;
    const accent = contexts.get('front/signal')!;
    const pair = Math.floor(beat / 2);
    const settle = ease((beat % 2) / 0.4);
    const outro = 1 - ease((beat - 36) / 2);

    // 2026-10-13 用户选定“纸上白描”：背景改为梧桐大道 / 留白江面（Claude，youthInk.ts）；原 youthBackdrop 保留在 spatial.ts 未删
    youthInkBackdrop(frame, camera, grid, ink);
    // 2026-10-12 用户要求少文字（Claude 按用户指示删去信息卡、青年 / 来 / 南京大字、说明小字和宁字印框；镜头联动背景保留）
    void red; void front; void detail; void accent; void pair; void settle; void outro; void line; void text;
  }

  return { masks, backing, render };
}
