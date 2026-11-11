import * as THREE from 'three';

export function createDryBrushTexture() {
  const width = 512, height = 128;
  const pixels = new Uint8Array(width * height * 4);
  const noise = (seed: number) => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  for (let horizontal = 0; horizontal < width; horizontal++) for (let vertical = 0; vertical < height; vertical++) {
    const age = horizontal / (width - 1), across = vertical / (height - 1);
    const edge = Math.abs(across * 2 - 1);
    const margin = 0.86 + 0.1 * noise(Math.floor(horizontal / 6)) + 0.03 * Math.sin(horizontal * 0.39);
    const fibre = noise(Math.floor(vertical / 2) * 67 + Math.floor(horizontal / 38));
    const grain = noise(horizontal * 97 + vertical * 37);
    const gap = fibre > 0.88 && grain > 0.18 && age < 0.92;
    const alpha = Math.max(0, Math.min(1, (margin - edge) * 24)) * (gap ? 0.06 : 0.62 + 0.38 * grain) * Math.min(1, age * 5);
    const offset = (vertical * width + horizontal) * 4;
    pixels.set([255, 255, 255, Math.round(alpha * 255)], offset);
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
