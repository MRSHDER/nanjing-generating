import * as THREE from 'three';
import { createPosterTypography, placeUprightPoster } from '../three/posterTypography';
import { paintUprightPoster } from './uprightPoster';
import { glitchFlashAt, glitchScene } from '../three/glitch';
import { BEAT, type Frame } from '../engine/beat';
import { createWutongPoster } from '../three/wutongPoster';

export function createEnvironmentPosters() {
  const posters = new Map<number, ReturnType<typeof createPosterTypography>[]>();
  const create = (title: string, annotation: string, width: number, height: number, opacity = 0.42) => createPosterTypography(title, annotation, width, height, new THREE.Color(0xffffff), opacity);
  const initialize = () => {
    posters.set(4, [createWutongPoster('glitch', new THREE.Color(0xffffff))]);
    const camera = new THREE.PerspectiveCamera(35, 1920 / 1080, 0.1, 100);
    camera.position.set(-8.95, -1.55, 8.4); camera.lookAt(1.6, -0.25, -1); camera.updateMatrixWorld(true);
    const bridge = create('YANGTZE RIVER BRIDGE', '1968 · 南京长江大桥', 4, 1, 0.34);
    placeUprightPoster(bridge, camera, 0.18, 0.64, 32, 0.7);
    posters.set(1, [bridge]);
    camera.position.set(0.35, -1.75, 6.4); camera.lookAt(0, 1.6, -8); camera.updateMatrixWorld(true);
    const steps = create('ZHONGSHAN MAUSOLEUM', '1926—1929 · 中山陵', 4, 1, 0.36);
    placeUprightPoster(steps, camera, 0.02, 0.64, 32, 0.64);
    posters.set(2, [steps]);
    const lanterns = create('QINHUAI RIVER', '秦淮河 · 夫子庙', 7.8, 1.95, 0.43);
    lanterns.position.set(0, -1.1, -8);
    posters.set(3, [lanterns]);
  };
  const render = (frame: Frame, camera: THREE.PerspectiveCamera, behind: CanvasRenderingContext2D, front: CanvasRenderingContext2D) => {
    if (!posters.size) initialize();
    const rawBeat = frame.lt / BEAT, flash = glitchFlashAt(rawBeat);
    const scene = glitchScene(rawBeat);
    const displayed = flash && flash.u >= 0.5 && scene < 5 ? scene + 1 : scene;
    if (!flash && (displayed === 3 || displayed === 4)) return;
    for (const mesh of posters.get(displayed) ?? []) paintUprightPoster(behind, mesh, camera);
  };
  return { render, posters };
}
