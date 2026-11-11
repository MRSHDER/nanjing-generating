// 青年段“纸上白描”的二维背景（Claude，2026-10-13 用户选定白描方向后新增；替代原先的灰色立面方块）。
// 全部按青年段这一帧的真实镜头投影：
//   0–16 拍  梧桐大道：人物身后一排梧桐（树干分叉 + 淡墨树冠轮廓），地面线，远山一抹淡墨
//   16–40 拍 长江：江面留白，只画几笔水纹；两岸岸线；远处紫金山山脊（淡墨）；地平线
// 墨线 = foreground，淡墨面 = muted（纸底时由合成器上色为墨黑 / 城墙灰）。
import type { PerspectiveCamera } from 'three';
import { BEAT, type Frame } from '../engine/beat';
import { line3, fill3, inOut, clamp01, ZIJIN_RIDGE, type P3 } from './stage';
import { youthGenNight } from '../three/youthGenTransition';
import { BALL_ENTRY } from '../three/rollingBall';

const H = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export function youthInkBackdrop(frame: Frame, cam: PerspectiveCamera | undefined, wash: CanvasRenderingContext2D, ink: CanvasRenderingContext2D) {
  if (!cam) return;
  const b = frame.lt / BEAT;
  if (b < 17.5) return;
  const ground = BALL_ENTRY.floor - 41.2;
  // 长江（米）：江面留白，几笔水纹
  const exit = (1 - inOut((b - 35) / 3)) * (1 - youthGenNight(frame.t));
  for (let i = 0; i < 46; i++) {
    const z = -40 - Math.pow(H(i + 3), 1.4) * 900, x = -900 + H(i + 7) * 1800, len = 30 + H(i + 9) * 120;
    const wob = Math.sin(frame.lt * 0.8 + i) * 3;
    line3(ink, cam, [[x, ground, z + wob], [x + len * 0.5, ground, z + wob + 2], [x + len, ground, z + wob]], 0.35 * exit * clamp01(1.2 - (-z) / 1000), 1.5);
  }
  for (const side of [-1, 1]) {
    const bank: P3[] = Array.from({ length: 24 }, (_, i) => { const x = -2400 + i * 200; return [x, ground, side * (640 + 95 * Math.sin(x / 420))] as P3; });
    line3(ink, cam, bank, 0.35 * exit, 2);
  }
  const ridge: P3[] = ZIJIN_RIDGE.map(([t, h]) => [-1500 + t * 4200, h * 380 + ground, -2600]);
  fill3(wash, cam, [[-1500, ground, -2600], ...ridge, [2700, ground, -2600]], 0.08 * exit);
  line3(ink, cam, ridge, 0.3 * exit, 1.6);
  line3(ink, cam, [[-6000, ground, -4000], [6000, ground, -4000]], 0.3 * exit, 1.2);
}
