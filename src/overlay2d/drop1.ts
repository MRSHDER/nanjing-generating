// 城墙爆发段二维层（32 拍，墨黑底）。2026-10-12 用户要求“平面背景服务三维主体”、少文字后由 Claude 重写（原版为 Codex 的海报版式）。
//
// 背景就是城墙所在的空间，按城墙这一帧的真实镜头投影（Layer3D.backgroundCamera）：
//   - 地面：一直铺到远处的砖缝线（城墙站在砖地上，镜头推拉时地面透视跟着变）
//   - 墙后：城市轮廓剪影（近）+ 紫金山山脊（远）+ 地平线
//   - 城门洞的轴线：穿越城门时地面接着往前铺；最后 4 拍砖缝透红光时，这条轴线随底鼓闪红
// 不画文字、页眉页脚。三维城墙按 subjectRegion（全画面）居中。
import { Vector3, type PerspectiveCamera } from 'three';
import { OVERLAY_HEIGHT, OVERLAY_WIDTH, type BootFrame } from './boot';
import { createStage, line3, fill3, inOut, clamp01, ZIJIN_RIDGE, type P3 } from './stage';
import { PALETTE } from '../engine/palette.glsl';

export const DROP1_BEATS = 32;
// 2026-10-17 Claude（用户：地板是方的，空间也是方的，字要跟方形的墙垂直，不要绕成圆柱）：
// 背景字贴在一个方盒子的四面平墙上，half 是盒子半宽（与原圆柱在四个正方向上的半径一致）。
export const WALL_BACKGROUND_TEXT = { z: -6, top: 55, bottom: 0, width: 180, half: 140, walls: 4, entryBeat: 1, exitBeat: 32 };

// 方盒子的第 wall 面（0 后墙、1 右墙、2 前墙、3 左墙）：u∈[0,1] 沿墙从右读到左的方向与阅读方向一致，不镜像。
function boxWallPoint(wall: number, u: number): [number, number] {
  const { z, half: h } = WALL_BACKGROUND_TEXT;
  switch (wall) {
    case 0: return [-h + 2 * h * u, z - h];
    case 1: return [h, z - h + 2 * h * u];
    case 2: return [h - 2 * h * u, z + h];
    default: return [-h, z + h - 2 * h * u];
  }
}

function projectedTypography(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, camera: PerspectiveCamera, wall: number) {
  const columns = 16, rows = 10;
  const project = (horizontal: number, vertical: number) => {
    const layout = WALL_BACKGROUND_TEXT;
    const [wx, wz] = boxWallPoint(wall, horizontal / canvas.width);
    const point = new Vector3(wx, layout.top - vertical * (layout.top - layout.bottom) / canvas.height, wz);
    if (point.clone().applyMatrix4(camera.matrixWorldInverse).z > -camera.near) return null;
    point.project(camera);
    return [(point.x * 0.5 + 0.5) * OVERLAY_WIDTH, (0.5 - point.y * 0.5) * OVERLAY_HEIGHT];
  };
  const triangle = (source: number[][]) => {
    const projected = source.map(point => project(point[0]!, point[1]!));
    if (projected.some(point => point === null)) return;
    const destination = projected as number[][];
    if (destination.every(point => point[0]! < 0) || destination.every(point => point[0]! > OVERLAY_WIDTH) || destination.every(point => point[1]! < 0) || destination.every(point => point[1]! > OVERLAY_HEIGHT)) return;
    const origin = source[0]!, first = source[1]!, second = source[2]!;
    const horizontalFirst = first[0]! - origin[0]!, verticalFirst = first[1]! - origin[1]!;
    const horizontalSecond = second[0]! - origin[0]!, verticalSecond = second[1]! - origin[1]!;
    const determinant = horizontalFirst * verticalSecond - horizontalSecond * verticalFirst;
    const screenFirst = destination[1]!, screenSecond = destination[2]!, screenOrigin = destination[0]!;
    const matrix = [
      ((screenFirst[0]! - screenOrigin[0]!) * verticalSecond - (screenSecond[0]! - screenOrigin[0]!) * verticalFirst) / determinant,
      ((screenFirst[1]! - screenOrigin[1]!) * verticalSecond - (screenSecond[1]! - screenOrigin[1]!) * verticalFirst) / determinant,
      ((screenSecond[0]! - screenOrigin[0]!) * horizontalFirst - (screenFirst[0]! - screenOrigin[0]!) * horizontalSecond) / determinant,
      ((screenSecond[1]! - screenOrigin[1]!) * horizontalFirst - (screenFirst[1]! - screenOrigin[1]!) * horizontalSecond) / determinant,
    ];
    context.save();
    context.beginPath();
    destination.forEach((point, index) => index ? context.lineTo(point[0]!, point[1]!) : context.moveTo(point[0]!, point[1]!));
    context.closePath();
    context.clip();
    context.transform(matrix[0]!, matrix[1]!, matrix[2]!, matrix[3]!, screenOrigin[0]! - matrix[0]! * origin[0]! - matrix[2]! * origin[1]!, screenOrigin[1]! - matrix[1]! * origin[0]! - matrix[3]! * origin[1]!);
    context.drawImage(canvas, 0, 0);
    context.restore();
  };
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const left = column / columns * canvas.width, right = (column + 1) / columns * canvas.width;
    const top = row / rows * canvas.height, bottom = (row + 1) / rows * canvas.height;
    triangle([[left, top], [right, top], [left, bottom]]);
    triangle([[right, top], [right, bottom], [left, bottom]]);
  }
}

export function getDrop1Layout(localBeat: number) {
  const beat = Number.isFinite(localBeat) ? localBeat : 0;
  return {
    size: [OVERLAY_WIDTH, OVERLAY_HEIGHT] as [number, number],
    subjectRegion: [0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT] as [number, number, number, number], // 背景服务主体：城墙居中
    entryBrickCenter: [960, 817] as [number, number], // = 锁定段 getLockLayout().brickCenter（红砖落在城中心的位置）
    shotGroup: Math.min(3, Math.max(0, Math.floor(beat / 8))),
  };
}

const H = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// 城市轮廓：墙后 40–70 米一排高低不一的方块（示意，不对应具体建筑）
const SKYLINE: { x: number; w: number; h: number; z: number }[] = Array.from({ length: 46 }, (_, i) => ({
  x: -90 + i * 4 + H(i) * 2,
  w: 2.2 + H(i + 7) * 2.5,
  h: 2.5 + Math.pow(H(i + 3), 2) * 11,
  z: -40 - H(i + 11) * 30,
}));

export function createDrop1Overlay(_fontFamily = '"Noto Sans SC", Arial, sans-serif', enabled = true) {
  const stage = createStage();
  const textCanvas = document.createElement('canvas');
  textCanvas.width = OVERLAY_WIDTH;
  textCanvas.height = OVERLAY_HEIGHT;
  const projectedCanvas = document.createElement('canvas');
  projectedCanvas.width = OVERLAY_WIDTH;
  projectedCanvas.height = OVERLAY_HEIGHT;
  const projectedContext = projectedCanvas.getContext('2d')!;
  let textReady = false;

  function render(input: BootFrame, camera?: PerspectiveCamera) {
    stage.clear();
    projectedContext.setTransform(1, 0, 0, 1, 0, 0);
    projectedContext.globalCompositeOperation = 'source-over';
    projectedContext.globalAlpha = 1;
    projectedContext.clearRect(0, 0, OVERLAY_WIDTH, OVERLAY_HEIGHT);
    const beat = input.localBeat;
    if (!Number.isFinite(beat) || beat < 0 || beat >= DROP1_BEATS || !camera) return;
    const grid = stage.ctx('behind', 'muted');
    const light = stage.ctx('behind', 'foreground');
    const red = stage.ctx('behind', 'signal');
    const intro = inOut(beat / 1.5);
    const kick = clamp01(input.kick ?? 0);
    const presentationBeat = (input.presentationBeat ?? beat) + 1e-9;
    if (enabled && presentationBeat >= WALL_BACKGROUND_TEXT.entryBeat && presentationBeat < WALL_BACKGROUND_TEXT.exitBeat) {
      if (!textReady) {
        const text = textCanvas.getContext('2d')!;
        text.fillStyle = '#ffffff';
        text.font = '900 475px Inter';
        text.letterSpacing = '-9.5px';
        text.fillText('MING CITY', 96, 448);
        text.font = '900 610px Inter';
        text.letterSpacing = '-12.2px';
        text.fillText('WALL', 96, 1024);
        text.font = '900 24px monospace';
        text.letterSpacing = '0px';
        text.fillText('1366—1393', 880, 535);
        text.font = `500 24px ${_fontFamily}`;
        Array.from('明城墙').forEach((character, index) => text.fillText(character, 1060, 504 + index * 28));
        textReady = true;
      }
      projectedContext.globalAlpha = 0.30;
      for (let wall = 0; wall < WALL_BACKGROUND_TEXT.walls; wall++) projectedTypography(projectedContext, textCanvas, camera, wall);
      projectedContext.globalCompositeOperation = 'destination-out';
      projectedContext.fillStyle = '#ffffff';
      for (const building of SKYLINE) fill3(projectedContext, camera, [[building.x, 0, building.z], [building.x + building.w, 0, building.z], [building.x + building.w, building.h, building.z], [building.x, building.h, building.z]], 1);
      projectedContext.globalCompositeOperation = 'source-over';
    }

    // 地面砖缝：横向（平行于城墙）每 1.6 米一条，纵向每 3.2 米一条；远处渐淡
    for (let i = 0; i < 70; i++) {
      const z = 30 - i * 1.6;
      const a = 0.32 * intro * Math.exp(-Math.max(0, -z) / 70) * (i % 5 === 0 ? 1.6 : 1);
      line3(grid, camera, [[-60, 0, z], [60, 0, z]], a, i % 5 === 0 ? 1.6 : 1);
    }
    for (let j = -18; j <= 18; j++) {
      const x = j * 3.2;
      line3(grid, camera, [[x, 0, 30], [x, 0, -80]], 0.22 * intro * (j % 4 === 0 ? 1.5 : 1), j % 4 === 0 ? 1.5 : 1);
    }

    // 墙后的城市轮廓（剪影 + 顶边亮线）
    for (const b of SKYLINE) {
      const pts: P3[] = [[b.x, 0, b.z], [b.x + b.w, 0, b.z], [b.x + b.w, b.h, b.z], [b.x, b.h, b.z]];
      fill3(grid, camera, pts, 0.28 * intro);
      line3(light, camera, [[b.x, b.h, b.z], [b.x + b.w, b.h, b.z]], 0.22 * intro, 1.4);
    }
    // 紫金山山脊（远）
    const ridge: P3[] = ZIJIN_RIDGE.map(([t, h]) => [-40 + t * 200, h * 26, -170]);
    if (camera.position.y < 20) fill3(grid, camera, [[-40, 0, -170], ...ridge, [160, 0, -170]], 0.2 * intro);
    if (camera.position.y < 20) line3(light, camera, ridge, 0.3 * intro, 1.6);
    // 地平线
    line3(light, camera, [[-800, 0, -420], [800, 0, -420]], 0.35 * intro, 1.4);

    // 城门洞的轴线：从门洞一直向前、向后延伸；最后 4 拍随底鼓闪红
    const crack = inOut((beat - 28) / 2);
    line3(grid, camera, [[0, 0.01, 30], [0, 0.01, -90]], 0.45 * intro, 2.5);
    if (crack > 0.01) {
      line3(red, camera, [[0, 0.01, 30], [0, 0.01, -90]], crack * (0.45 + 0.55 * kick), 5);
      for (const x of [-2.2, 2.2]) line3(red, camera, [[x, 0.01, 6], [x, 0.01, -14]], crack * 0.6 * (0.4 + 0.6 * kick), 3);
    }
  }

  const masks = enabled ? [...stage.masks, { canvas: projectedCanvas, role: 'foreground' as const, layer: 'behind' as const, tint: PALETTE.red }] : stage.masks;
  return { masks, render };
}
