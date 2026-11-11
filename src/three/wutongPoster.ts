import * as THREE from 'three';
import { BALL_ENTRY } from './rollingBall';
import { createPosterTypography } from './posterTypography';

export const WUTONG_POSTER = Object.freeze({ title: 'PLANE TREES', annotation: '1928 · 梧桐', depth: -10, heightAboveRoad: 2.2, width: 4.2, height: 1.05, opacity: 0.65 });

export function createWutongPoster(space: 'glitch' | 'youth', color: THREE.Color) {
  const definition = WUTONG_POSTER;
  const mesh = createPosterTypography(definition.title, definition.annotation, definition.width, definition.height, color, definition.opacity);
  if (space === 'glitch') {
    mesh.position.set(0, BALL_ENTRY.floor + definition.heightAboveRoad, definition.depth);
  } else {
    mesh.position.set(BALL_ENTRY.x - definition.depth, BALL_ENTRY.floor + definition.heightAboveRoad, 0);
    mesh.rotation.y = -Math.PI / 2;
  }
  mesh.userData.sharedWutongPoster = true;
  return mesh;
}
