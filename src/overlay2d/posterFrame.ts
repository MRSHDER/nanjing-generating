import type { Frame } from '../engine/beat';
import type { OverlayMask } from './boot';
import { drawSubtitle } from './subtitles';

export function posterChapter(frame: Frame) {
  const chapters = {
    boot: ['01 / 09', 'NANJING'], lock: ['02 / 09', 'GLASS / ORIGIN'],
    drop1: ['03 / 09', 'MING CITY WALL'], glitch: ['04 / 09', 'ALGORITHM VIEW'],
    youth: ['05 / 09', frame.lt < 7.5 ? 'PLANE TREES' : 'YANGTZE RIVER BRIDGE'],
    gen: ['06 / 09', 'PURPLE MOUNTAIN'], build: ['07 / 09', 'TOWARD EACH OTHER'],
    drop2: ['08 / 09', frame.lt < 20 / 3 ? 'TOWARD EACH OTHER' : 'QINHUAI RIVER'],
    outro: ['09 / 09', 'NANJING / TOGETHER'],
  };
  const entry = chapters[frame.section];
  return { number: entry[0]!, name: entry[1]!, subtitle: null };
}

export function drawPosterFrame(masks: OverlayMask[], frame: Frame) {
  const canvas = masks.find(mask => !mask.tint && mask.role === 'foreground' && (mask.layer ?? 'front') === 'front')?.canvas;
  if (!canvas) return;
  const context = canvas.getContext('2d')!;
  const chapter = posterChapter(frame);
  const margin = 72, right = 1848, bottom = 1008;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.strokeStyle = '#ffffff'; context.fillStyle = '#ffffff';
  context.globalAlpha = 0.28; context.lineWidth = 1;
  context.setLineDash([]);
  context.beginPath();
  for (const [horizontal, vertical] of [[margin, margin], [right, margin], [right, bottom], [margin, bottom]]) {
    const signX = horizontal === margin ? 1 : -1, signY = vertical === margin ? 1 : -1;
    context.moveTo(horizontal! + 18 * signX, vertical!);
    context.lineTo(horizontal!, vertical!);
    context.lineTo(horizontal!, vertical! + 18 * signY);
  }
  context.moveTo(margin, 126); context.lineTo(right, 126);
  context.moveTo(margin, 954); context.lineTo(right, 954);
  context.stroke();
  context.globalAlpha = 0.58;
  context.font = '500 17px Inter, sans-serif';
  context.fillText(`${chapter.number}   ${chapter.name}`, 98, 101);
  context.font = '13px Consolas, monospace';
  context.textAlign = 'right';
  context.fillText(`${frame.lt.toFixed(2)}s  /  ${String(frame.frame).padStart(4, '0')}   N / J`, right - 26, 991);
  context.restore();
  // 中英双语版式文字：普通卡画在这里（foreground）；05–08 号底托卡由 main.ts → drawSubtitleLabels → 合成器 tPlate/tLabel/tRule 叠加（Claude 2026-10-17）
  drawSubtitle(context, frame.t);
}
