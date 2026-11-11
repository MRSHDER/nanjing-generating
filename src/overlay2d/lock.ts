// 锁定段二维层（16 拍，米白底）。2026-10-12 用户要求“平面背景服务三维主体”、少文字后由 Claude 重写（原版为 Codex 的海报版式）。
//
// “地图变成空间”：一张抽象的南京地图（长江、明城墙环、秦淮河、经纬细线）
//   0–4 拍   正对镜头，像一张平面地图，线条逐条描出来
//   4–8 拍   向后倒下，变成玻璃球脚下的地面；跟着玻璃球的旋转一起转
//   8–12 拍  定住：玻璃球悬在城墙环正上方，透过玻璃球看到被折射的地图
//   12 / 14 拍（“南”“京”两次重击）城墙环、城中心依次闪红；14–16 拍城中心的红色方块就是下一段的第一块砖
// 没有页眉页脚、没有大字。全部按共享镜头投影（Layer3D.backgroundCamera），镜头不动时也保持与玻璃球同一空间。
import type { PerspectiveCamera } from 'three';
import { BEAT, type Frame } from '../engine/beat';
import { type BootFrame } from './boot';
import { flowBeat } from './rhythm';
import { createStage, line3, fill3, partial, inOut, ease, CITY_WALL, YANGTZE, QINHUAI, XUANWU, STREETS, zijinContour, type P3 } from './stage';

/** 版式：玻璃球、砖块的屏幕位置（三维锁定层与城墙层按这里对齐）。 */
export function getLockLayout(frame: Frame) {
  const beat = flowBeat(frame.lt / BEAT);
  const move = ease((beat - 8) / 2);
  return {
    sphereCenter: [960, 470 - 10 * move] as [number, number],
    sphereRadius: 190 + 20 * move,
    safeRegion: [560, 170, 800, 640] as [number, number, number, number],
    brickCenter: [960, 817] as [number, number], // = 地图平放后城中心的屏幕位置（见 mapPoint 的 pivot）
    brickSize: [240, 120] as [number, number],
  };
}

// 地图平面的放置：k = 0 正对镜头（立在 30 米外），k = 1 平放成地面（城中心在玻璃球正下方）
const SPIN = (beat: number) => 2.4 * (1 - inOut((beat - 6) / 4)) * inOut((beat - 3) / 3) + 0.08 * Math.max(0, beat - 10);
function mapPoint(u: number, v: number, k: number, yaw: number): P3 {
  // 先绕 x 轴倒下（v 轴从“向上”变成“向里”），再绕竖直轴转
  const a = -Math.PI / 2 * k;
  const x0 = u, y0 = v * Math.cos(a), z0 = v * Math.sin(a);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const x1 = x0 * cy + z0 * sy, z1 = -x0 * sy + z0 * cy;
  const pivot: P3 = [0, -2.2 * k, -30 + 14 * k];
  const s = 1;
  return [pivot[0] + x1 * s, pivot[1] + y0 * s, pivot[2] + z1 * s];
}

export function createLockOverlay(_fontFamily = '"Noto Sans SC", Arial, sans-serif') {
  const stage = createStage();

  function render(input: BootFrame, frame: Frame, camera?: PerspectiveCamera) {
    stage.clear();
    if (!Number.isFinite(input.localBeat) || input.localBeat < 0 || input.localBeat >= 16 || !camera) return;
    const beat = flowBeat(input.localBeat);
    const grid = stage.ctx('behind', 'muted');
    const ink = stage.ctx('behind', 'foreground');
    const red = stage.ctx('behind', 'signal');
    const k = inOut((beat - 4) / 4);
    const yaw = SPIN(beat);
    const M = (pts: [number, number][]): P3[] => pts.map(([u, v]) => mapPoint(u, v, k, yaw));
    const segment = (points: [number, number][], amount: number): [number, number][] => partial(points.map(([horizontal, vertical]) => [horizontal, vertical, 0] as P3), amount).map(([horizontal, vertical]) => [horizontal, vertical]);
    const draw = (start: number, dur: number) => ease((beat - Math.floor(start)) / dur);
    const fadeEnd = 1 - inOut(((input.presentationBeat ?? beat) - 15) / 1);

    // 经纬细线（与玻璃球上的经纬线呼应）
    for (let i = -8; i <= 8; i++) {
      line3(grid, camera, M(partial([[i * 2, -10], [i * 2, 12]].map(([u, v]) => [u!, v!, 0] as P3), draw(0, 2.5)).map(([u, v]) => [u, v] as [number, number])), 0.5 * fadeEnd, 1.5);
    }
    for (let j = -5; j <= 6; j++) {
      line3(grid, camera, M(partial([[-16, j * 2], [16, j * 2]].map(([u, v]) => [u!, v!, 0] as P3), draw(0.3, 2.5)).map(([u, v]) => [u, v] as [number, number])), 0.5 * fadeEnd, 1.5);
    }
    // 长江：一条宽带（填充）+ 两岸线
    const river = YANGTZE;
    const bankA = river.map(([u, v]) => [u, v + 1.1] as [number, number]);
    const bankB = river.map(([u, v]) => [u, v - 1.1] as [number, number]);
    const rDraw = draw(0.5, 3);
    fill3(grid, camera, M([...segment(bankA, rDraw), ...segment(bankB, rDraw).reverse()]), 0.55 * fadeEnd);
    line3(ink, camera, M(segment(bankA, rDraw)), 0.7 * fadeEnd, 2.5);
    line3(ink, camera, M(segment(bankB, rDraw)), 0.7 * fadeEnd, 2.5);
    // 明城墙环
    const wDraw = draw(1.2, 3);
    line3(ink, camera, M(segment([...CITY_WALL, CITY_WALL[0]!], wDraw)), 0.95 * fadeEnd, 6);
    // 秦淮河
    line3(grid, camera, M(segment(QINHUAI, draw(2, 2.5))), 0.95 * fadeEnd, 4);
    // 玄武湖、城内道路、城东紫金山等高线
    fill3(grid, camera, M(XUANWU), 0.7 * draw(2.2, 1.2) * fadeEnd);
    line3(ink, camera, M([...XUANWU, XUANWU[0]!]), 0.5 * draw(2.2, 1.2) * fadeEnd, 1.5);
    STREETS.forEach((st, i) => line3(grid, camera, M(partial(st.map(([u, v]) => [u, v, 0] as P3), draw(2.6 + i * 0.15, 1)).map(([u, v]) => [u, v] as [number, number])), 0.9 * fadeEnd, 2));
    for (let c = 0; c < 5; c++) {
      const ring = zijinContour(c);
      const d = draw(2.8 + c * 0.2, 1.4);
      line3(ink, camera, M(segment([...ring, ring[0]!], d)), (0.35 + 0.1 * c) * fadeEnd, 1.6);
    }

    // “南”（12 拍）：城墙环闪红。原“京”（14 拍）城中心红方块已删（用户 10-13 01:33）；红砖改由三维的砖在城中心落地
    if (beat >= 12) line3(red, camera, M(segment([...CITY_WALL, CITY_WALL[0]!], draw(12, 2))), 0.7 * fadeEnd, 5);
    // 城中心的定位十字（8–12 拍，玻璃球锁定时）
    const lockOn = inOut((beat - 8) / 0.8) * (1 - inOut((beat - 11.5) / 0.5));
    if (lockOn > 0.01) {
      const L = 1.4;
      const arms = [[[-L, 0], [-0.5, 0]], [[0.5, 0], [L, 0]], [[0, -L], [0, -0.5]], [[0, 0.5], [0, L]]] as [number, number][][];
      for (const [index, [a, b]] of arms.entries()) {
        line3(red, camera, M(segment([a!, b!] as [number, number][], draw(8 + index * 0.5, 0.5))), 0.85 * lockOn, 3);
      }
    }
  }

  return { masks: stage.masks, render };
}
