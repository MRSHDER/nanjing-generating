import { Matrix4, Vector4, type PerspectiveCamera } from 'three';
import { BEAT, type Frame } from '../engine/beat';

type WorldPoint = [number, number, number];
type ScreenPoint = [number, number];
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function projectPath(points: WorldPoint[], camera: PerspectiveCamera, closed = false): ScreenPoint[] {
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  let polygon = points.map(point => new Vector4(...point, 1).applyMatrix4(matrix));
  const planes = [
    (point: Vector4) => point.w + point.x, (point: Vector4) => point.w - point.x,
    (point: Vector4) => point.w + point.y, (point: Vector4) => point.w - point.y,
    (point: Vector4) => point.w + point.z, (point: Vector4) => point.w - point.z,
  ];
  for (const distance of planes) {
    const clipped: Vector4[] = [];
    for (let index = 0; index < polygon.length; index++) {
      const current = polygon[index]!;
      const previous = polygon[(index + polygon.length - 1) % polygon.length]!;
      const currentDistance = distance(current);
      const previousDistance = distance(previous);
      if (closed || index > 0) {
        if ((currentDistance >= 0) !== (previousDistance >= 0)) clipped.push(previous.clone().lerp(current, previousDistance / (previousDistance - currentDistance)));
      }
      if (currentDistance >= 0) clipped.push(current);
    }
    polygon = clipped;
  }
  return polygon.filter(point => point.w > 0).map(point => [(point.x / point.w + 1) * 960, (1 - point.y / point.w) * 540]);
}

function stroke(context: CanvasRenderingContext2D, points: WorldPoint[], camera: PerspectiveCamera, opacity: number, width = 1.5) {
  for (let index = 1; index < points.length; index++) {
    const segment = projectPath([points[index - 1]!, points[index]!], camera);
    if (segment.length < 2) continue;
    context.globalAlpha = clamp(opacity);
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(...segment[0]!);
    context.lineTo(...segment[1]!);
    context.stroke();
  }
}

function fill(context: CanvasRenderingContext2D, points: WorldPoint[], camera: PerspectiveCamera, opacity: number) {
  const polygon = projectPath(points, camera, true);
  if (polygon.length < 3) return;
  context.globalAlpha = clamp(opacity);
  context.beginPath();
  context.moveTo(...polygon[0]!);
  for (const point of polygon.slice(1)) context.lineTo(...point);
  context.closePath();
  context.fill();
}

export function youthBackdrop(frame: Frame, camera: PerspectiveCamera | undefined, muted: CanvasRenderingContext2D, foreground: CanvasRenderingContext2D) {
  if (!camera) return;
  const beat = frame.lt / BEAT;
  const exit = 1 - clamp((beat - 35) / 3);
  if (beat < 16) {
    for (let index = -8; index <= 12; index++) {
      const horizontal = index * 2.8;
      fill(muted, [[horizontal, -0.6, -5], [horizontal + 1.5, -0.6, -5], [horizontal + 1.5, 4 + index % 3 * 0.4, -5], [horizontal, 4 + index % 3 * 0.4, -5]], camera, 0.065);
      stroke(muted, [[horizontal, -0.6, -5], [horizontal, 3.5, -5]], camera, 0.2);
    }
    for (let index = 0; index < 6; index++) {
      const depth = -2 - index * 2;
      stroke(foreground, [[-35, -0.7, depth], [35, -0.7, depth]], camera, 0.07, 2);
    }
    return;
  }
  for (const side of [-1, 1]) {
    const bank: WorldPoint[] = [];
    for (let index = 0; index <= 24; index++) {
      const horizontal = -2400 + index * 200;
      bank.push([horizontal, 0, side * (640 + 95 * Math.sin(horizontal / 420))]);
    }
    fill(muted, [...bank, [2400, 0, side * 3500], [-2400, 0, side * 3500]], camera, 0.18 * exit);
    stroke(foreground, bank, camera, 0.13 * exit);
    for (let district = 0; district < 34; district++) {
      const horizontal = -2500 + district * 150;
      const depth = side * (980 + 65 * Math.sin(district * 1.7));
      const height = 35 + 55 * (0.5 + 0.5 * Math.sin(district * 2.37));
      fill(muted, [[horizontal, 0, depth], [horizontal + 65, 0, depth], [horizontal + 65, height, depth], [horizontal, height, depth]], camera, 0.24 * exit);
      stroke(foreground, [[horizontal, height, depth], [horizontal + 65, height, depth]], camera, 0.075 * exit);
    }
  }
  for (let index = 0; index < 25; index++) {
    const depth = -540 + index * 44;
    const phase = frame.lt * 0.6 + index * 1.7;
    const start = -2000 + (index % 4) * 140;
    const points: WorldPoint[] = [];
    for (let sample = 0; sample <= 16; sample++) points.push([start + sample * 250, -0.5, depth + Math.sin(sample * 0.7 + phase) * 5]);
    stroke(muted, points, camera, (0.07 + 0.025 * frame.env.kick) * exit);
  }
}

export function genBackdrop(frame: Frame, camera: PerspectiveCamera | undefined, muted: CanvasRenderingContext2D) {
  if (!camera) return;
  const beat = frame.lt / BEAT;
  const opacity = clamp(beat / 3) * (1 - clamp((beat - 11) / 3));
  for (let contour = 0; contour < 9; contour++) {
    const points: WorldPoint[] = [];
    for (let sample = 0; sample <= 96; sample++) {
      const angle = sample / 96 * Math.PI * 2;
      const radius = 10.7 + contour * 0.75 + 0.35 * Math.sin(angle * 3 + contour * 0.3);
      points.push([Math.cos(angle) * radius, -0.35, Math.sin(angle) * radius * 0.64]);
    }
    stroke(muted, points, camera, 0.18 * opacity);
  }
}
