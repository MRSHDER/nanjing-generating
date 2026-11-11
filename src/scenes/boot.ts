import type { Scene } from '../engine/scene';
import { W, H } from '../engine/scene';
import { C, FONT, rgba } from '../engine/palette';
import { clamp, ease, hash2, prog, smoothstep, stepIdx } from '../engine/util';

// 00:00–00:06｜城市启动
// 黑屏 → 一条白线展开 → 坐标网格生长 → 网格单元“生成” → 金色坐标点定位 → 字幕。
// 全部是 t 的纯函数。

const CX = W / 2;
const CY = H / 2;
const CELL = 80;
const COLS = 12; // 中心向两侧各 12 列
const ROWS = 6; // 中心向上下各 6 行
const SAFE = 96; // 标题安全边距

// 南京坐标（用于标注）；画面上的定位点放在网格中偏左上，像地图上的一个点。
const MARK = { x: CX - CELL * 2, y: CY - CELL * 1 };

const LINE1 = '城市，是被看见的地方。';
const LINE2 = '也是被重新生成的地方。';

function typed(text: string, t: number, t0: number, cps: number) {
  const n = Math.floor(clamp((t - t0) * cps, 0, text.length));
  return text.slice(0, n);
}

function mono(ctx: CanvasRenderingContext2D, size: number, color: string, alpha = 1) {
  ctx.font = `${size}px ${FONT.mono}`;
  ctx.fillStyle = rgba(color, alpha);
  ctx.textBaseline = 'alphabetic';
}

function drawGrid(ctx: CanvasRenderingContext2D, lt: number) {
  // 竖线：从中线向上下生长，离中心越远出现越晚
  for (let k = -COLS; k <= COLS; k++) {
    const delay = 1.3 + Math.abs(k) * 0.05;
    const g = prog(lt, delay, delay + 0.9, ease.outCubic);
    if (g <= 0) continue;
    const x = CX + k * CELL;
    const half = ROWS * CELL * g;
    ctx.strokeStyle = rgba(C.warm, k === 0 ? 0.35 : 0.13);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 0.5, CY - half);
    ctx.lineTo(x + 0.5, CY + half);
    ctx.stroke();
  }
  // 横线：从中线向左右生长
  for (let j = -ROWS; j <= ROWS; j++) {
    const delay = 1.5 + Math.abs(j) * 0.08;
    const g = prog(lt, delay, delay + 1.0, ease.outCubic);
    if (g <= 0 || j === 0) continue;
    const y = CY + j * CELL;
    const half = COLS * CELL * g;
    ctx.strokeStyle = rgba(C.warm, 0.11);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CX - half, y + 0.5);
    ctx.lineTo(CX + half, y + 0.5);
    ctx.stroke();
  }
}

// 网格单元逐个“生成”：越靠近中心偏左上的区域越先亮，形成一团不规则的城市块。
function drawCells(ctx: CanvasRenderingContext2D, lt: number) {
  const p = prog(lt, 2.4, 4.4, ease.inOutCubic);
  if (p <= 0) return;
  const flick = stepIdx(lt, 12);
  for (let i = -COLS; i < COLS; i++) {
    for (let j = -ROWS; j < ROWS; j++) {
      const cx = i + 0.5;
      const cy = j + 0.5;
      // 到定位点的“距离”决定城市块形状
      const d = Math.hypot((cx + 2) / 9, (cy + 1) / 4.2);
      const bias = hash2(i, j, 7) * 0.35;
      const threshold = d * 0.85 + bias; // 越小越早亮
      const on = smoothstep(threshold - 0.08, threshold + 0.05, p * 1.25);
      if (on <= 0) continue;
      const base = d < 1 ? 0.13 : 0.022;
      const tw = 0.6 + 0.4 * hash2(i, j, flick); // 闪烁，按 12fps 跳变
      const x = CX + i * CELL;
      const y = CY + j * CELL;
      // 少数单元带紫金色，像灯光亮起
      const tint = hash2(i, j, 31) > 0.86 ? C.gold : hash2(i, j, 53) > 0.93 ? C.purple : C.warm;
      ctx.fillStyle = rgba(tint, base * on * tw * (tint === C.warm ? 1 : 2.4));
      ctx.fillRect(x + 2, y + 2, CELL - 3, CELL - 3);
    }
  }
}

function drawCenterLine(ctx: CanvasRenderingContext2D, lt: number) {
  const g = prog(lt, 0.35, 1.5, ease.outExpo);
  if (g <= 0) return;
  const half = g * COLS * CELL;
  ctx.save();
  ctx.shadowColor = rgba(C.warm, 0.8);
  ctx.shadowBlur = 14;
  ctx.strokeStyle = rgba(C.warm, 0.95);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(CX - half, CY);
  ctx.lineTo(CX + half, CY);
  ctx.stroke();
  ctx.restore();
  // 刻度
  ctx.strokeStyle = rgba(C.warm, 0.6);
  ctx.lineWidth = 1;
  for (let k = -COLS; k <= COLS; k++) {
    if (Math.abs(k * CELL) > half) continue;
    const h = k % 4 === 0 ? 12 : 6;
    ctx.beginPath();
    ctx.moveTo(CX + k * CELL + 0.5, CY - h);
    ctx.lineTo(CX + k * CELL + 0.5, CY + h);
    ctx.stroke();
  }
}

function drawMarker(ctx: CanvasRenderingContext2D, lt: number) {
  const a = prog(lt, 3.3, 3.8, ease.outCubic);
  if (a <= 0) return;
  const { x, y } = MARK;
  // 十字准线：从定位点伸向画面边缘
  const cross = prog(lt, 3.3, 4.1, ease.outExpo);
  ctx.strokeStyle = rgba(C.gold, 0.55 * a);
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, lerpTo(y, CY - ROWS * CELL, cross));
  ctx.moveTo(x, y);
  ctx.lineTo(lerpTo(x, CX - COLS * CELL, cross), y);
  ctx.stroke();
  ctx.setLineDash([]);
  // 扩散圆环
  for (let r = 0; r < 3; r++) {
    const ph = (((lt - 3.3) * 0.7 + r / 3) % 1 + 1) % 1;
    ctx.strokeStyle = rgba(C.gold, (1 - ph) * 0.55 * a);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 8 + ph * 74, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 点
  ctx.save();
  ctx.shadowColor = rgba(C.gold, 1);
  ctx.shadowBlur = 22;
  ctx.fillStyle = rgba(C.gold, a);
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 标注
  mono(ctx, 20, C.gold, a);
  ctx.fillText('NANJING', x + 22, y - 18);
  mono(ctx, 16, C.wall, a);
  ctx.fillText('32.0603°N  118.7969°E', x + 22, y + 6);
}

function lerpTo(a: number, b: number, k: number) {
  return a + (b - a) * k;
}

function drawHud(ctx: CanvasRenderingContext2D, lt: number) {
  const a = prog(lt, 0.8, 1.4, ease.outCubic);
  if (a <= 0) return;
  // 左上：坐标，逐字输出
  mono(ctx, 18, C.wall, a);
  ctx.fillText(typed('LAT  32.0603 N', lt, 1.0, 22), SAFE, SAFE + 18);
  ctx.fillText(typed('LON 118.7969 E', lt, 1.25, 22), SAFE, SAFE + 44);
  // 右上：时间戳 hh:mm:ss:ff（60fps）
  const total = Math.floor(lt * 60 + 1e-6);
  const ff = total % 60;
  const ss = Math.floor(total / 60) % 60;
  const p2 = (n: number) => String(n).padStart(2, '0');
  mono(ctx, 18, C.wall, a);
  ctx.textAlign = 'right';
  ctx.fillText(`T+00:00:${p2(ss)}:${p2(ff)}`, W - SAFE, SAFE + 18);
  ctx.fillText(typed('STATE  BOOT → GENERATE', lt, 1.6, 28), W - SAFE, SAFE + 44);
  ctx.textAlign = 'left';
}

function drawSubtitle(ctx: CanvasRenderingContext2D, lt: number) {
  const size = 54;
  ctx.font = `500 ${size}px ${FONT.serif}`;
  ctx.textBaseline = 'alphabetic';
  const lines: Array<[string, number]> = [
    [LINE1, 3.9],
    [LINE2, 4.85],
  ];
  const baseY = H - SAFE - 104;
  lines.forEach(([text, t0], li) => {
    const y = baseY + li * 78;
    let x = SAFE;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const w = ctx.measureText(ch).width;
      const a = prog(lt, t0 + i * 0.06, t0 + i * 0.06 + 0.35, ease.outCubic);
      if (a > 0) {
        const rise = (1 - a) * 14;
        // “生成”两字用金色强调
        const hot = li === 1 && (i === 5 || i === 6);
        ctx.fillStyle = rgba(hot ? C.gold : C.warm, a);
        ctx.fillText(ch, x, y + rise);
      }
      x += w;
    }
  });
}

export const boot: Scene = {
  id: 'boot',
  start: 0,
  end: 6,
  draw(ctx, _t, lt) {
    // 背景与轻微推近
    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, W, H);

    const zoom = 1 + 0.035 * ease.outCubic(clamp(lt / 6));
    ctx.save();
    ctx.translate(CX, CY);
    ctx.scale(zoom, zoom);
    ctx.translate(-CX, -CY);

    drawGrid(ctx, lt);
    drawCells(ctx, lt);
    drawCenterLine(ctx, lt);
    drawMarker(ctx, lt);
    ctx.restore();

    drawHud(ctx, lt);
    drawSubtitle(ctx, lt);

    // 暗角
    const v = ctx.createRadialGradient(CX, CY, H * 0.45, CX, CY, H * 1.05);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    // 开场淡入
    const fade = 1 - prog(lt, 0, 0.35);
    if (fade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fade})`;
      ctx.fillRect(0, 0, W, H);
    }
  },
};
