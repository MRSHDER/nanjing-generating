import * as THREE from 'three';

export function createPosterArtwork(title: string, annotation: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048; canvas.height = 512;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.font = '900 210px Inter, sans-serif';
  const available = 1936, measured = context.measureText(title).width;
  context.save();
  context.translate(56, 0);
  context.scale(Math.min(1, available / measured), 1);
  context.fillText(title, 0, 295);
  context.restore();
  context.font = '500 42px "Noto Sans SC", sans-serif';
  context.fillText(annotation, 62, 405);
  context.lineWidth = 2; context.strokeStyle = '#ffffff';
  context.beginPath(); context.moveTo(56, 450); context.lineTo(1992, 450); context.stroke();
  return canvas;
}

export function createPosterTypography(title: string, annotation: string, width: number, height: number, color: THREE.Color, opacity: number) {
  const canvas = createPosterArtwork(title, annotation);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.userData.posterTypography = title;
  return mesh;
}

export function placeUprightPoster(mesh: THREE.Mesh<THREE.PlaneGeometry>, camera: THREE.PerspectiveCamera, horizontal: number, vertical: number, distance: number, fraction: number) {
  const forward = camera.getWorldDirection(new THREE.Vector3());
  const ray = new THREE.Vector3(horizontal, vertical, 0.5).unproject(camera).sub(camera.position).normalize();
  mesh.position.copy(camera.position).addScaledVector(ray, distance / Math.max(0.01, ray.dot(forward)));
  const facing = camera.position.clone().sub(mesh.position);
  mesh.rotation.set(0, Math.atan2(facing.x, facing.z), 0);
  const width = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * fraction;
  mesh.scale.setScalar(width / mesh.geometry.parameters.width);
  mesh.updateMatrixWorld(true);
}
