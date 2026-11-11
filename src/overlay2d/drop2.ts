// 双向奔赴段二维层（40 拍，墨黑底）。Claude 新增（2026-10-12，用户要求“平面背景服务三维主体”、少文字）。
//   0–8 拍   两束光螺旋接近时，身后慢慢描出明城墙环和长江；第 7 拍两束光相遇的一瞬，城墙环闪红——它们在南京相遇
//   8–16 拍  回收镜头用各段自己的背景，这里不画
//   16–40 拍 秦淮河：远岸的城市轮廓和紫金山山脊，按河面镜头投影（只在水面以上露出）
// 不画主题字（用户：少文字）。全部按双向奔赴这一帧的真实镜头投影（Layer3D.backgroundCamera）。
import type { PerspectiveCamera } from 'three';
import { BEAT, type Frame } from '../engine/beat';
import { createStage, line3, inOut, ease, CITY_WALL, YANGTZE, ZIJIN_RIDGE, type P3 } from './stage';

export function createDrop2Overlay() {
  const stage = createStage();

  function render(frame: Frame, camera?: PerspectiveCamera) {
    stage.clear();
    const b = frame.lt / BEAT;
    if (frame.section !== 'drop2' || !camera || !Number.isFinite(b) || b < 0 || b >= 40) return;
    const grid = stage.ctx('behind', 'muted');
    const light = stage.ctx('behind', 'foreground');
    const red = stage.ctx('behind', 'signal');

    if (b < 8) {
      // 城墙环与长江，放在光束身后的竖直平面上（z = -10）
      const S = 1.9;
      const P = (pts: [number, number][]): P3[] => pts.map(([u, v]) => [u * S, v * S * 0.8 - 1.2, -10]);
      const draw = ease((b - 1) / 5);
      const wall = CITY_WALL.slice(0, Math.max(2, Math.round(CITY_WALL.length * draw)));
      line3(grid, camera, P(draw >= 1 ? [...CITY_WALL, CITY_WALL[0]!] : wall), 0.75, 3);
      const river = YANGTZE.slice(0, Math.max(2, Math.round(YANGTZE.length * ease((b - 1.5) / 5))));
      line3(grid, camera, P(river.map(([u, v]) => [u, v + 1.1] as [number, number])), 0.45, 2);
      line3(grid, camera, P(river.map(([u, v]) => [u, v - 1.1] as [number, number])), 0.45, 2);
      const meet = b >= 7 ? Math.exp(-(b - 7) * 2.5) : 0;
      if (meet > 0.01) line3(red, camera, P([...CITY_WALL, CITY_WALL[0]!]), meet, 7);
      return;
    }
    if (b < 16) return;

    // 秦淮河远岸：城市轮廓 + 紫金山（34 拍起镜头升到正上方，远岸自然出画）
    const vis = inOut((b - 16) / 1) * (1 - inOut((b - 34) / 2));
    const ridge: P3[] = ZIJIN_RIDGE.map(([t, h]) => [-200 + t * 700, h * 32, -520]);
    line3(light, camera, ridge, 0.065 * vis, 0.9);
    line3(grid, camera, ridge.map(([horizontal, vertical, depth]) => [horizontal - 35, vertical * 0.72, depth - 65]), 0.05 * vis, 0.8);
  }

  return { masks: stage.masks, render };
}
