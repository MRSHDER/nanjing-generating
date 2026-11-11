import { Vector3, type Mesh, type PerspectiveCamera, type PlaneGeometry, type MeshBasicMaterial } from 'three';
import { OVERLAY_WIDTH as WIDTH, OVERLAY_HEIGHT as HEIGHT } from './boot';

export function paintUprightPoster(context: CanvasRenderingContext2D, mesh: Mesh<PlaneGeometry, MeshBasicMaterial>, camera: PerspectiveCamera, opacity = 1) {
  const canvas = mesh.material.map!.image as HTMLCanvasElement;
  mesh.updateMatrixWorld(true);
  const project = (horizontal: number, vertical: number) => {
    const point = new Vector3((horizontal / canvas.width - 0.5) * mesh.geometry.parameters.width, (0.5 - vertical / canvas.height) * mesh.geometry.parameters.height, 0).applyMatrix4(mesh.matrixWorld);
    if (point.clone().applyMatrix4(camera.matrixWorldInverse).z >= -camera.near) return null;
    point.project(camera);
    return [(point.x * 0.5 + 0.5) * WIDTH, (0.5 - point.y * 0.5) * HEIGHT];
  };
  context.save();
  context.globalAlpha *= opacity * mesh.material.opacity;
  const triangle = (source: number[][]) => {
    const points = source.map(point => project(point[0]!, point[1]!));
    if (points.some(point => !point)) return;
    const [origin, first, second] = points as [number[], number[], number[]];
    const [input, inputFirst, inputSecond] = source as [number[], number[], number[]];
    const dx = inputFirst[0]! - input[0]!, dy = inputFirst[1]! - input[1]!;
    const ex = inputSecond[0]! - input[0]!, ey = inputSecond[1]! - input[1]!;
    const determinant = dx * ey - ex * dy;
    const scaleX = ((first[0]! - origin[0]!) * ey - (second[0]! - origin[0]!) * dy) / determinant;
    const skewY = ((first[1]! - origin[1]!) * ey - (second[1]! - origin[1]!) * dy) / determinant;
    const skewX = ((second[0]! - origin[0]!) * dx - (first[0]! - origin[0]!) * ex) / determinant;
    const scaleY = ((second[1]! - origin[1]!) * dx - (first[1]! - origin[1]!) * ex) / determinant;
    context.save(); context.beginPath();
    context.moveTo(origin[0]!, origin[1]!); context.lineTo(first[0]!, first[1]!); context.lineTo(second[0]!, second[1]!);
    context.closePath(); context.clip();
    context.transform(scaleX, skewY, skewX, scaleY, origin[0]! - scaleX * input[0]! - skewX * input[1]!, origin[1]! - skewY * input[0]! - scaleY * input[1]!);
    context.drawImage(canvas, 0, 0); context.restore();
  };
  for (let row = 0; row < 4; row++) for (let column = 0; column < 16; column++) {
    const left = column / 16 * canvas.width, right = (column + 1) / 16 * canvas.width;
    const top = row / 4 * canvas.height, bottom = (row + 1) / 4 * canvas.height;
    triangle([[left, top], [right, top], [left, bottom]]);
    triangle([[right, top], [right, bottom], [left, bottom]]);
  }
  context.restore();
}
