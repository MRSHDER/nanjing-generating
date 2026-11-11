import { BEAT, type Frame } from '../engine/beat';
import { OVERLAY_HEIGHT, OVERLAY_WIDTH, type OverlayMask, type OverlayRole } from './boot';
import type { PerspectiveCamera } from 'three';
import { genBackdrop } from './spatial';
import { genBackdropCamera, youthGenNight } from '../three/youthGenTransition';

export const GEN_BEATS = 16;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const ease = (value: number) => 1 - Math.pow(1 - clamp(value), 3);

export function getGenLayout(frame: Frame) {
  const beat = frame.lt / BEAT;
  return {
    size: [OVERLAY_WIDTH, OVERLAY_HEIGHT] as [number, number],
    localBeat: beat,
    titleRegion: [72, 135, 410, 140] as [number, number, number, number],
    subjectRegion: [250, 340, 1450, 650] as [number, number, number, number],
    ringCenter: [1056, 702] as [number, number],
  };
}

export function createGenOverlay(fontFamily = '"Noto Sans SC", Arial, sans-serif') {
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

  function render(frame: Frame, camera?: PerspectiveCamera) {
    backingContext.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    for (const context of contexts.values()) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#ffffff';
      context.setLineDash([]);
    }
    if (frame.section !== 'gen' || !Number.isFinite(frame.t) || !Number.isFinite(frame.lt) || frame.t < frame.sectionStart || frame.t >= frame.sectionEnd || frame.lt < 0 || frame.lt / BEAT >= GEN_BEATS) return;
    const beat = frame.lt / BEAT;
    const exit = 1 - ease((beat - 12) / 2);
    const detail = contexts.get('front/muted')!;
    const front = contexts.get('front/foreground')!;
    const grid = contexts.get('behind/muted')!;
    const accent = contexts.get('front/signal')!;
    genBackdrop(frame, camera ? genBackdropCamera(camera) : undefined, grid);
    grid.save();
    grid.globalAlpha = 1 - 0.75 * youthGenNight(frame.t);
    grid.globalCompositeOperation = 'destination-out';
    grid.fillRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    grid.restore();
    // 2026-10-12 用户要求少文字（Claude 按用户指示删去“正在生成”、说明小字和宁字印框；背景等高线保留）
    void detail; void front; void accent; void exit; void text;
  }

  return { masks, backing, render };
}
