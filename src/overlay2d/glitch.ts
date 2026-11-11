// 数据故障段二维层（24 拍，米白底）。2026-10-12 用户要求“平面背景服务三维主体”、少文字后由 Claude 重写（原版为 Codex 的“生成中 / 百分比”版式）。
//
// 背景只做点云所在空间的“结构线”，按故障段这一帧的真实镜头投影；切片 / 静音时与三维一起卡住（共享 glitchTime）：
//   0–2.5 拍  砖阵的外框与行列刻度（城墙被“扫描”成阵列）
//   0.3–2.5 拍 红色扫描线从左扫到右（扫过的砖变成数据方块）；2.5 拍第一次闪屏起，三维每小节换一个南京（见 three/glitch.ts）
//   19.5–24 拍 玻璃球从上方落下（10-13 用户改版，去掉了四张回顾小片）：落地后脚下出现地面线和一段淡影，地面线向右延伸（青年段球向右滚）
// 一直都有一层很淡的地面透视网格，点云始终站在同一个空间里。没有文字、百分比和页眉页脚。
import type { PerspectiveCamera } from 'three';
import { BEAT, glitchTime, type Frame } from '../engine/beat';
import { OVERLAY_HEIGHT, OVERLAY_WIDTH } from './boot';
import { createStage, line3, fill3, inOut, clamp01, type P3 } from './stage';
import { FIGURE_ANCHOR } from '../three/figure';
import { glitchScanX } from '../three/glitch';
import { createEnvironmentPosters } from './environmentPosters';

export const GLITCH_BEATS = 24;
const BW = 0.8, BH = 0.38, AC = 20, AR = 12; // 与三维 glitch.ts 的砖阵一致
const FLOOR = FIGURE_ANCHOR.y; // 人物脚底所在的地面高度

export function getGlitchLayout(frame: Frame) {
  const visualTime = glitchTime(frame.t);
  const localBeat = (visualTime - frame.sectionStart) / BEAT;
  return {
    size: [OVERLAY_WIDTH, OVERLAY_HEIGHT] as [number, number],
    visualTime,
    localBeat,
    phase: localBeat < 4 ? 'array' : localBeat < 12 ? 'scatter' : localBeat < 20 ? 'data' : 'figure',
  };
}

export function createGlitchOverlay(_fontFamily = '"Noto Sans SC", Arial, sans-serif') {
  const stage = createStage();
  const posters = createEnvironmentPosters();
  // 主播放器会把 backing 画布传给合成器（前层文字底托）；本版没有前层文字，保持透明
  const backing = document.createElement('canvas');
  backing.width = OVERLAY_WIDTH;
  backing.height = OVERLAY_HEIGHT;

  function render(frame: Frame, camera?: PerspectiveCamera) {
    stage.clear();
    if (frame.section !== 'glitch' || !camera) return;
    const { localBeat: b } = getGlitchLayout(frame);
    if (!Number.isFinite(b) || b < 0 || b >= GLITCH_BEATS) return;
    const grid = stage.ctx('behind', 'muted');
    const ink = stage.ctx('behind', 'foreground');
    const red = stage.ctx('behind', 'signal');
    posters.render(frame, camera, ink, stage.ctx('front', 'foreground'));

    // 地面透视网格（一直在，很淡）
    for (let i = 0; i < 26; i++) line3(grid, camera, [[-40, FLOOR, 6 - i * 2], [40, FLOOR, 6 - i * 2]], 0.6 * Math.exp(-i / 14), 1.5);
    for (let j = -12; j <= 12; j++) line3(grid, camera, [[j * 2.4, FLOOR, 6], [j * 2.4, FLOOR, -50]], 0.45, 1.5);

    // 0–4 拍：砖阵外框 + 行列刻度
    const arr = b < 2.5 ? inOut(b / 1.2) : 0;
    if (arr > 0.01) {
      const hw = ((AC - 1) / 2) * BW * 1.02 + BW * 0.75, hh = ((AR - 1) / 2) * BH * 1.3 + BH * 0.9;
      const c = 0.9;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = sx! * hw, y = sy! * hh;
        line3(ink, camera, [[x - sx! * c, y, 0], [x, y, 0], [x, y - sy! * c, 0]], arr, 3);
      }
      for (let i = 0; i < AC; i++) {
        const x = (i - (AC - 1) / 2) * BW * 1.02;
        line3(grid, camera, [[x, hh + 0.15, 0], [x, hh + 0.45, 0]], 0.8 * arr, 1.5);
        line3(grid, camera, [[x, -hh - 0.15, 0], [x, -hh - 0.45, 0]], 0.8 * arr, 1.5);
      }
      for (let r = 0; r < AR; r++) {
        const y = (r - (AR - 1) / 2) * BH * 1.3;
        line3(grid, camera, [[-hw - 0.15, y, 0], [-hw - 0.5, y, 0]], 0.8 * arr, 1.5);
      }
    }

    // 0.3–3.5 拍：红色扫描线从左扫到右（扫过的砖变成数据方块）
    const scanOn = inOut((b - 0.2) / 0.3) * (1 - inOut((b - 2.2) / 0.25)) * (b < 2.5 ? 1 : 0);
    if (scanOn > 0.01) {
      const x = glitchScanX(b);
      line3(red, camera, [[x, -3.4, 0.3], [x, 3.4, 0.3]], 0.95 * scanOn, 4);
      for (let k = 1; k <= 3; k++) line3(red, camera, [[x - k * 0.18, -3.2, 0.3], [x - k * 0.18, 3.2, 0.3]], 0.25 * scanOn / k, 2);
    }

    // 21.5 拍球落地起：球下的地面线 + 淡影；地面线向右延伸（下一段球向右滚）
    const fig = inOut((b - 21.3) / 1.2);
    if (fig > 0.01) {
      const fx = FIGURE_ANCHOR.x, s = FIGURE_ANCHOR.scale;
      const shadow: P3[] = Array.from({ length: 24 }, (_, i) => { const a = (i / 24) * Math.PI * 2; return [fx + Math.cos(a) * 0.9 * s, FLOOR, Math.sin(a) * 0.35 * s] as P3; });
      fill3(ink, camera, shadow, 0.12 * fig);
      line3(ink, camera, [[fx - 6, FLOOR, 0], [fx + 6 + 20 * inOut((b - 22) / 2), FLOOR, 0]], 0.75 * fig, 2.5);
      line3(red, camera, [[fx + 1.2, FLOOR, 0], [fx + 1.2 + 14 * inOut((b - 22.5) / 1.5), FLOOR, 0]], fig * clamp01((b - 22.5) / 0.3), 4);
    }
  }

  return { masks: stage.masks, backing, render };
}
