import * as THREE from 'three';
import { PALETTE } from '../engine/palette.glsl';

type Point = [number, number, number];
type Segment = { a: Point; b: Point; red: number };
type ContourEdge = { a: Point; b: Point; normals: Point[] };
type Part = { kind: 'wood' | 'white' | 'canopy'; layer?: number; geometry: THREE.BufferGeometry; edges: ContourEdge[] };
export type WutongTree = {
  side: number;
  x: number;
  z: number;
  h: number;
  height: number;
  forkHeight: number;
  whiteHeight: number;
  rootRadius: number;
  forkRadius: number;
  root: Point;
  fork: Point;
};
export type WutongModel = { ground: number; trees: WutongTree[]; skeleton: Segment[]; parts: Part[] };

const hash = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const cache = new Map<number, WutongModel>();

function contourEdges(geometry: THREE.BufferGeometry): ContourEdge[] {
  const positions = geometry.getAttribute('position');
  const edges = new Map<string, ContourEdge>();
  const pointAt = (index: number): Point => [positions.getX(index), positions.getY(index), positions.getZ(index)];
  for (let offset = 0; offset < positions.count; offset += 3) {
    const points = [pointAt(offset), pointAt(offset + 1), pointAt(offset + 2)];
    const normal = new THREE.Vector3().subVectors(new THREE.Vector3(...points[1]!), new THREE.Vector3(...points[0]!))
      .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...points[2]!), new THREE.Vector3(...points[0]!))).normalize().toArray() as Point;
    for (let index = 0; index < 3; index++) {
      const start = points[index]!, end = points[(index + 1) % 3]!;
      const keys = [start.join(','), end.join(',')].sort();
      const key = keys.join('|');
      const edge = edges.get(key);
      if (edge) edge.normals.push(normal);
      else edges.set(key, { a: start, b: end, normals: [normal] });
    }
  }
  return [...edges.values()];
}

function rod(start: Point, end: Point, radiusStart: number, radiusEnd: number): THREE.BufferGeometry {
  const direction = new THREE.Vector3(...end).sub(new THREE.Vector3(...start));
  const geometry = new THREE.CylinderGeometry(radiusEnd, radiusStart, direction.length(), 6, 1).toNonIndexed();
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  geometry.applyQuaternion(rotation).translate((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function crown(ground: number, side: number, depth: number, seed: number, row: number, layer: number, cluster: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const positions = geometry.getAttribute('position');
  const lobeSeed = seed + layer * 101 + cluster * 37;
  const opening = row % 4 === 2 || row % 4 === 3;
  const widths = [1.55, 1.4, 1.2];
  const centers = [3.35, 2.1, 0.58];
  const heights = [4.15, 4.75, 5.25];
  const skylight = cluster === 2 && row >= 1 && row <= 3;
  const width = widths[cluster]! * [0.62, 0.83, 1.04][layer]! * (skylight ? 0.7 : 1);
  const thickness = 0.36 + layer * 0.1 + hash(lobeSeed + 6) * 0.16;
  const length = cluster === 2 && opening ? 1.28 : 1.65 + layer * 0.38 + hash(lobeSeed + 7) * 0.25;
  const centerX = side * (centers[cluster]! + (skylight ? 0.55 : 0) + (hash(lobeSeed + 1) - 0.5) * 0.56);
  const centerY = ground + heights[cluster]! + layer * 0.5 + (hash(lobeSeed + 2) - 0.5) * 0.52;
  const centerZ = depth + (hash(lobeSeed + 3) - 0.5) * (cluster === 2 ? 0.16 : 0.9);
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const across = positions.getX(vertex), vertical = positions.getY(vertex), along = positions.getZ(vertex);
    const wobble = 0.85 + hash(lobeSeed + across * 17 + vertical * 31 + along * 43) * 0.3;
    positions.setXYZ(vertex, centerX + across * width * wobble, centerY + vertical * thickness * wobble, centerZ + along * length * wobble);
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const colors: number[] = [];
  for (let vertex = 0; vertex < positions.count; vertex += 3) {
    const facet = hash(lobeSeed + vertex * 1.7);
    const light = 0.7 + Math.max(0, normals.getY(vertex)) * 0.3 + facet * 0.3;
    const tone = [0.46, 0.82, 1.24][layer]! * light;
    for (let corner = 0; corner < 3; corner++) colors.push(...PALETTE.plane.map(value => value * tone));
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export function createWutongModel(ground: number): WutongModel {
  const model: WutongModel = { ground, trees: [], skeleton: [], parts: [] };
  const addPart = (kind: Part['kind'], geometry: THREE.BufferGeometry, layer?: number) => model.parts.push({ kind, layer, geometry, edges: contourEdges(geometry) });
  const addBranch = (start: Point, end: Point, radiusStart: number, radiusEnd: number, kind: Part['kind'] = 'wood') => {
    model.skeleton.push({ a: start, b: end, red: 0 });
    addPart(kind, rod(start, end, radiusStart, radiusEnd));
  };
  for (const side of [-1, 1]) {
    for (let row = 0; row < 14; row++) {
      const seed = row * 19 + (side + 1) * 71;
      const depth = 1.7 - row * 3.8 + (side > 0 ? 0.3 : 0);
      const height = 4.95 + hash(seed + 4) * 0.65;
      const forkHeight = height * (0.64 + hash(seed + 9) * 0.025);
      const whiteHeight = 1.6 + hash(seed + 2) * 0.15;
      const rootRadius = 0.24 + 0.04 * hash(seed + 8);
      const forkRadius = rootRadius * 0.55;
      const root: Point = [side * (3.3 + hash(seed + 6) * 0.13), ground, depth];
      const fork: Point = [root[0] - side * (0.38 + hash(seed) * 0.12), ground + forkHeight, depth - 0.12];
      const fraction = whiteHeight / forkHeight;
      const band: Point = root.map((value, axis) => value + (fork[axis]! - value) * fraction) as Point;
      const bandRadius = rootRadius + (forkRadius - rootRadius) * fraction;
      model.trees.push({ side, x: root[0], z: depth, h: height, height, forkHeight, whiteHeight, rootRadius, forkRadius, root, fork });
      addBranch(root, band, rootRadius, bandRadius, 'white');
      addBranch(band, fork, bandRadius, forkRadius);
      for (const lane of [-1.4, -0.45, 0.45, 1.4]) {
        const elbow: Point = [side * (1.75 + hash(seed + lane * 5) * 0.65), ground + 3.95 + hash(seed + lane * 7) * 0.55, depth + lane * (0.65 + hash(seed + lane) * 0.45)];
        const tip: Point = [side * (0.25 + hash(seed + lane * 11) * 1.35), ground + 5.25 + hash(seed + lane * 3) * 0.65, depth + lane * (1.0 + hash(seed + 5) * 0.5)];
        addBranch(fork, elbow, forkRadius * (0.68 + hash(seed + lane) * 0.16), 0.065);
        addBranch(elbow, tip, 0.065, 0.027);
        const twig: Point = [elbow[0] + side * (0.15 + hash(seed + lane * 13) * 0.6), ground + 4.9 + hash(seed + lane * 17) * 0.7, elbow[2] + lane * 0.55];
        addBranch(elbow, twig, 0.038, 0.018);
      }
      for (let layer = 0; layer < 3; layer++) {
        for (let cluster = 0; cluster < 3; cluster++) {
          addPart('canopy', crown(ground, side, depth, seed, row, layer, cluster), layer);
        }
      }
    }
  }
  for (const side of [-1, 1]) model.skeleton.push({ a: [side * 2.4, ground, 6], b: [side * 2.4, ground, -55], red: 0 });
  for (let depth = 5; depth > -30; depth -= 2) model.skeleton.push({ a: [0, ground + 0.008, depth], b: [0, ground + 0.008, depth - 0.9], red: 1 });
  return model;
}

export function getWutongModel(ground: number): WutongModel {
  if (!cache.has(ground)) cache.set(ground, createWutongModel(ground));
  return cache.get(ground)!;
}

export function wutongContours(model: WutongModel, camera: THREE.Camera): Float32Array {
  const positions: number[] = [];
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  for (const part of model.parts) {
    for (const edge of part.edges) {
      const toward: Point = [eye.x - (edge.a[0] + edge.b[0]) / 2, eye.y - (edge.a[1] + edge.b[1]) / 2, eye.z - (edge.a[2] + edge.b[2]) / 2];
      let front = false, back = false;
      for (const normal of edge.normals) {
        const facing = normal[0] * toward[0] + normal[1] * toward[1] + normal[2] * toward[2];
        front ||= facing >= 0;
        back ||= facing < 0;
      }
      if (edge.normals.length === 1 || front && back) positions.push(...edge.a, ...edge.b);
    }
  }
  return new Float32Array(positions);
}
