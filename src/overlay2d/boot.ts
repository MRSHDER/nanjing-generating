import { openingBeat, openingFlow } from './rhythm';
import { BEAT } from '../engine/beat';

export const OVERLAY_WIDTH = 1920;
export const OVERLAY_HEIGHT = 1080;
export const BOOT_BEATS = 16;

export type OverlayRole = 'foreground' | 'muted' | 'signal';

export interface BootFrame {
  localBeat: number;
  presentationBeat?: number;
  kick?: number;
}

export interface OverlayMask {
  role: OverlayRole;
  canvas: HTMLCanvasElement;
  layer?: 'behind' | 'front';
  tint?: [number, number, number];
}

export interface BootOverlay {
  masks: OverlayMask[];
  render: (frame: BootFrame) => void;
}

const limit = (value: number) => Math.max(0, Math.min(1, value));
const reveal = (beat: number, start: number, length = 0.5) => limit((beat - start) / length);
const settle = (value: number) => 1 - (1 - limit(value)) ** 3;

export function bootDegreePose(beat: number, fontFamily = 'Arial, "Microsoft YaHei", sans-serif') {
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = `900 252px ${fontFamily}`;
  const prefix = context.measureText('32.06').width;
  const glyph = context.measureText('°');
  const radius = (glyph.actualBoundingBoxLeft + glyph.actualBoundingBoxRight) / 2;
  const source = [115 + prefix + (glyph.actualBoundingBoxRight - glyph.actualBoundingBoxLeft) / 2, 500 + (glyph.actualBoundingBoxDescent - glyph.actualBoundingBoxAscent) / 2];
  const progress = limit(beat - 15);
  const travel = progress * progress * (3 - 2 * progress);
  const center = [source[0]! + (960 - source[0]!) * travel, source[1]! + (470 - source[1]!) * travel];
  const size = radius + (190 - radius) * travel;
  return { source, center, radius: size, zoom: size / radius, foregroundZoom: 1 / (1 - (59 / 60) * travel), progress };
}

export function createBootOverlay(fontFamily = 'Arial, "Microsoft YaHei", sans-serif'): BootOverlay {
  const masks: OverlayMask[] = [];
  const contexts = {} as Record<OverlayRole, CanvasRenderingContext2D>;
  const roles: OverlayRole[] = ['muted', 'signal', 'foreground'];

  for (const role of roles) {
    const canvas = document.createElement('canvas');
    canvas.width = OVERLAY_WIDTH;
    canvas.height = OVERLAY_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('二维遮罩需要 Canvas 2D 支持');
    masks.push({ role, canvas });
    contexts[role] = context;
  }

  function text(context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, opacity = 1, weight = 700) {
    context.save();
    context.globalAlpha = limit(opacity);
    context.font = `${weight} ${size}px ${fontFamily}`;
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
    context.restore();
  }

  function line(context: CanvasRenderingContext2D, points: number[][], width: number, opacity = 1) {
    context.save();
    context.globalAlpha = limit(opacity);
    context.lineWidth = width;
    context.beginPath();
    points.forEach(([x, y], index) => index === 0 ? context.moveTo(x!, y!) : context.lineTo(x!, y!));
    context.stroke();
    context.restore();
  }

  function render(frame: BootFrame) {
    for (const role of roles) {
      const context = contexts[role];
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#ffffff';
      context.setLineDash([]);
    }

    if (!Number.isFinite(frame.localBeat) || frame.localBeat < 0 || frame.localBeat >= BOOT_BEATS) return;
    const beat = openingBeat(frame.localBeat);

    const foreground = contexts.foreground;
    const muted = contexts.muted;
    const signal = contexts.signal;
    const presentationBeat = frame.presentationBeat ?? frame.localBeat;
    if (presentationBeat >= 15) {
      const pose = bootDegreePose(presentationBeat, fontFamily);
      for (const context of Object.values(contexts)) context.setTransform(pose.foregroundZoom, 0, 0, pose.foregroundZoom, pose.center[0]! - pose.source[0]! * pose.foregroundZoom, pose.center[1]! - pose.source[1]! * pose.foregroundZoom);
    }
    const entrance = settle(reveal(beat, 0, 0.4));
    const beatIndex = Math.floor(beat);
    const bar = Math.floor(beat / 4);

    line(muted, [[72, 152], [1848, 152]], 2, 0.65 * entrance);
    line(muted, [[72, 940], [1848, 940]], 2, 0.65 * entrance);
    text(foreground, 'N / J', 72, 124, 54, entrance, 900);
    text(muted, '32.0603 N / 118.7969 E', 285, 119, 22, entrance);
    text(foreground, `${String(bar + 1).padStart(2, '0')} / 04`, 1600, 122, 48, entrance, 900);
    text(muted, 'NANJING', 72, 994, 25, entrance);
    text(muted, `${String(beatIndex + 1).padStart(2, '0')} / 16`, 1700, 994, 25, entrance);

    for (let tick = 0; tick < 16; tick++) {
      const context = tick <= beatIndex ? signal : muted;
      context.save();
      context.globalAlpha = entrance * (tick === beatIndex ? 1 : 0.55);
      context.fillRect(555 + tick * 50, 974, 36, tick % 4 === 0 ? 15 : 8);
      context.restore();
    }

    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 12; column++) {
        const appear = reveal(beat, 1 + Math.floor((column + row) / 3), 0.4);
        const x = 180 + column * 142;
        const y = 228 + row * 118;
        line(muted, [[x - 6, y], [x + 6, y]], 1.5, appear * 0.35);
        line(muted, [[x, y - 6], [x, y + 6]], 1.5, appear * 0.35);
      }
    }

    const scanProgress = Math.min(1, (beatIndex + 1) / 8);
    const scanWidth = 1580 * scanProgress;
    const scanY = 530;
    if (beat < 8) {
      line(foreground, [[960 - scanWidth / 2, scanY], [960 + scanWidth / 2, scanY]], 3, entrance);
      const sweep = 960 + scanWidth / 2;
      line(signal, [[sweep, scanY - 32], [sweep, scanY + 32]], 7, reveal(beat, 1));
      for (let tick = 0; tick < 20; tick++) {
        const x = 170 + tick * 83;
        if (Math.abs(x - 960) > scanWidth / 2) continue;
        line(muted, [[x, scanY - 8], [x, scanY + 8]], 2, 0.85);
      }
    }

    if (beat >= 4 && beat < 12) {
      const entry = settle(reveal(beat, 4, 0.6));
      const targetX = 960;
      const targetY = 530;
      const arm = 96;
      signal.save();
      signal.translate(targetX, targetY);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [cornerIndex, [horizontal, vertical]] of corners.entries()) {
        if (beatIndex < 4 + cornerIndex) continue;
        const x = horizontal! * arm;
        const y = vertical! * arm;
        line(signal, [[x - horizontal! * 32, y], [x, y], [x, y - vertical! * 32]], 8, entry);
      }
      signal.fillRect(-6, -6, 12, 12);
      signal.restore();
      text(foreground, '32.06°N', 125, 350, 82, entry, 900);
      text(foreground, '118.79°E', 1250, 795, 82, entry, 900);
      text(muted, `${String(beatIndex + 1).padStart(2, '0')}`, 1600, 345, 54, entry);
    }

    if (beat >= 8 && beat < 12) {
      const stripe = Math.floor((beat - 8) / 2);
      const offset = stripe === 0 ? 180 : 1410;
      signal.save();
      signal.globalAlpha = 0.8 * settle(reveal(beat, 8, 0.3));
      signal.fillRect(offset, 400, 330, 28);
      signal.fillRect(offset, 438, 165, 12);
      signal.restore();
      text(foreground, 'NANJING', stripe === 0 ? 1150 : 170, 650, 108, 1, 900);
    }

    if (beat >= 12) {
      const entry = settle(reveal(beat, 12, 0.7));
      const latitude = '32.06°N';
      const longitude = '118.79°E';
      foreground.save();
      foreground.beginPath();
      foreground.rect(90, 190, 1725, 705);
      foreground.clip();
      text(foreground, latitude.slice(0, Math.min(latitude.length, (beatIndex - 11) * 4)), 115, 500, 252, entry, 900);
      if (frame.localBeat >= 6 / BEAT) {
        foreground.save();
        foreground.font = `900 252px ${fontFamily}`;
        const startWidth = foreground.measureText(longitude.slice(0, 4)).width;
        const fullWidth = foreground.measureText(longitude).width;
        foreground.beginPath();
        foreground.rect(395, 580, startWidth + (fullWidth - startWidth) * openingFlow(frame.localBeat), 250);
        foreground.clip();
        text(foreground, longitude, 395, 790, 252, entry, 900);
        foreground.restore();
      } else if (beatIndex >= 14) text(foreground, longitude.slice(0, Math.min(longitude.length, (beatIndex - 13) * 4)), 395, 790, 252, entry, 900);
      foreground.restore();
      const signalWidth = frame.localBeat >= 6 / BEAT ? 230 + 980 * (2 + openingFlow(frame.localBeat)) / 3 : 230 + 980 * (beatIndex - 12) / 3;
      signal.fillRect(125, 544, signalWidth, 16);
      signal.fillRect(1760, 238, 42, 42);
      text(muted, 'NANJING', 124, 855, 35, entry, 900);
      if (beat >= 15) {
        line(signal, [[115, 238], [115, 205], [1760, 205]], 5, settle(reveal(beat, 15, 0.18)));
      }
    }
  }

  const draw = render;
  return { masks, render(frame) {
    draw(frame);
    const beat = frame.presentationBeat ?? frame.localBeat;
    if (beat < 15) return;
    const pose = bootDegreePose(beat, fontFamily);
    const foreground = contexts.foreground;
    foreground.clearRect(pose.source[0]! - 40, pose.source[1]! - 40, 80, 80);
    for (const context of Object.values(contexts)) context.setTransform(1, 0, 0, 1, 0, 0);
    foreground.save();
    foreground.lineWidth = 18 * (1 - pose.progress) + 2 * pose.progress;
    foreground.beginPath();
    foreground.arc(pose.center[0]!, pose.center[1]!, pose.radius, 0, Math.PI * 2);
    foreground.stroke();
    foreground.restore();
  } };
}
