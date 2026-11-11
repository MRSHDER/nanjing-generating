import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../engine/palette.glsl';
import { lin } from './env';

export interface QinhuaiLight {
  pos: THREE.Vector3;
  color: THREE.Color;
  strength: number;
  kind: 'lantern' | 'window' | 'bridge';
}

export interface QinhuaiHouse {
  width: number;
  height: number;
  depth: number;
  storeys: number;
  side: number;
  z: number;
}

const seedValue = (seed: number) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};

const SURFACE_VERTEX = `
varying vec3 vWorld, vNormal;
varying vec2 vUv;
void main() {
  vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

const SURFACE_FRAGMENT = `
uniform vec3 uColor;
uniform float uStyle;
uniform float uFade;
varying vec3 vWorld, vNormal;
varying vec2 vUv;
void main() {
  vec3 normal = normalize(vNormal);
  float moon = 0.56 + 0.44 * max(0.0, dot(normal, normalize(vec3(-0.35, 0.8, 0.45))));
  vec3 color = uColor * moon;
  if (uStyle == 1.0) {
    float course = floor(vWorld.y / 0.24);
    float horizontal = abs(normal.x) > 0.5 ? vWorld.z : vWorld.x;
    vec2 cell = vec2(horizontal / 0.72 + mod(course, 2.0) * 0.5, vWorld.y / 0.24);
    vec2 seam = abs(fract(cell) - 0.5);
    vec2 feather = max(fwidth(cell) * 0.7, vec2(0.016));
    float mortar = max(smoothstep(0.48 - feather.x, 0.48, seam.x), smoothstep(0.47 - feather.y, 0.47, seam.y));
    float grain = fract(sin(dot(floor(cell), vec2(41.7, 19.3))) * 4375.9);
    color *= (0.88 + 0.2 * grain) * (1.0 - 0.58 * mortar);
  } else if (uStyle == 2.0) {
    float tile = abs(fract(vUv.y * 3.6) - 0.5);
    float ridge = smoothstep(0.36, 0.49, tile);
    float course = 1.0 - smoothstep(0.02, 0.07, abs(fract(vUv.x * 4.4) - 0.5));
    color *= 0.7 + 0.35 * ridge - 0.18 * course;
  } else if (uStyle == 3.0) {
    color *= 0.88 + 0.12 * sin(vWorld.y * 24.0 + sin(vWorld.z * 13.0));
  } else if (uStyle == 4.0) {
    float ribs = pow(0.5 + 0.5 * cos(vUv.x * 12.0 * 6.283185), 12.0);
    float center = sin(vUv.y * 3.14159);
    color = uColor * (0.42 + 0.65 * center) * (1.0 - 0.38 * ribs);
    color += uColor * pow(center, 3.0) * 0.08;
  } else if (uStyle == 5.0) {
    color = uColor;
  }
  float haze = exp(-max(0.0, -vWorld.z - 22.0) * 0.006);
  gl_FragColor = vec4(mix(vec3(0.003), mix(vec3(0.011), color, haze), uFade), 1.0);
}
`;

export function createQinhuaiScene() {
  const group = new THREE.Group();
  group.name = 'qinhuai-waterfront';
  const halfWidth = 6.8;
  const bridge = { radius: 6.4, z: -72, spring: 0.12, thickness: 0.78 };
  const houses: QinhuaiHouse[] = [];
  const lights: QinhuaiLight[] = [];
  const buckets = new Map<string, { material: THREE.ShaderMaterial; geometry: THREE.BufferGeometry[] }>();
  const inkTone = (value: number) => new THREE.Color(value, value, value);
  const material = (name: string, tint: THREE.Color, style = 0) => {
    buckets.set(name, {
      material: new THREE.ShaderMaterial({
        vertexShader: SURFACE_VERTEX, fragmentShader: SURFACE_FRAGMENT, side: THREE.DoubleSide,
        uniforms: { uColor: { value: tint }, uStyle: { value: style }, uFade: { value: 1 } },
      }), geometry: [],
    });
  };
  material('plaster', lin(PALETTE.paper).multiplyScalar(0.22));
  material('plaster-warm', lin(PALETTE.paper).multiplyScalar(0.15));
  material('plaster-cool', inkTone(0.158));
  material('stone', inkTone(0.12), 1);
  material('stone-caps', inkTone(0.175));
  material('roof', inkTone(0.033), 2);
  material('ridge', inkTone(0.063));
  material('timber', inkTone(0.035), 3);
  material('wood-gold', inkTone(0.075), 3);
  material('lantern', lin(PALETTE.red).multiplyScalar(1.16), 4);
  material('brass', inkTone(0.15));
  material('window', lin(PALETTE.paper).multiplyScalar(0.75), 5);
  material('window-soft', lin(PALETTE.paper).multiplyScalar(0.48), 5);
  material('moon', lin(PALETTE.paper).multiplyScalar(0.26), 5);

  const push = (name: string, geometry: THREE.BufferGeometry) => {
    const normalized = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    normalized.deleteAttribute('color');
    if (!normalized.attributes.uv) normalized.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(normalized.attributes.position!.count * 2), 2));
    buckets.get(name)!.geometry.push(normalized);
  };
  const box = (name: string, dimensions: [number, number, number], position: [number, number, number], rotation = 0) => {
    const geometry = new THREE.BoxGeometry(...dimensions);
    geometry.rotateZ(rotation).translate(...position);
    push(name, geometry);
  };
  const rod = (name: string, start: [number, number, number], end: [number, number, number], radius: number, segments = 6) => {
    const first = new THREE.Vector3(...start), last = new THREE.Vector3(...end);
    const direction = last.clone().sub(first);
    const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), segments);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    geometry.translate(...first.add(last).multiplyScalar(0.5).toArray() as [number, number, number]);
    push(name, geometry);
  };
  const extrude = (name: string, shape: THREE.Shape, depth: number, position: [number, number, number], rotation = 0) => {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 36 });
    geometry.rotateY(rotation).translate(...position);
    push(name, geometry);
  };
  const addLight = (kind: QinhuaiLight['kind'], position: [number, number, number], tint: THREE.Color, strength: number) => {
    lights.push({ pos: new THREE.Vector3(...position), color: tint.clone(), strength, kind });
  };
  const lantern = (position: [number, number, number], size: number) => {
    const [horizontal, vertical, longitudinal] = position;
    const body = new THREE.SphereGeometry(size, 20, 14).scale(1, 1.32, 1);
    body.translate(...position);
    push('lantern', body);
    for (const cap of [-1, 1]) {
      const lid = new THREE.CylinderGeometry(size * 0.56, size * 0.6, size * 0.13, 16);
      lid.translate(horizontal, vertical + cap * size * 1.22, longitudinal);
      push('brass', lid);
    }
    rod('timber', [horizontal, vertical + size * 1.3, longitudinal], [horizontal, vertical + size * 2.5, longitudinal], 0.012);
    for (let strand = 0; strand < 3; strand++) {
      const offset = (strand - 1) * size * 0.12;
      rod('brass', [horizontal + offset, vertical - size * 1.25, longitudinal], [horizontal + offset * 1.7, vertical - size * 2.2, longitudinal], 0.009);
    }
    addLight('lantern', position, lin(PALETTE.red), size * 1.25);
  };

  for (const side of [-1, 1]) {
    box('stone', [1.65, 1.06, 130], [side * (halfWidth + 0.825), 0.47, -45]);
    box('stone-caps', [1.94, 0.17, 130], [side * (halfWidth + 0.83), 1.04, -45]);
    box('stone', [9, 0.25, 130], [side * (halfWidth + 5.5), 1, -45]);
    for (let post = 0; post < 69; post++) {
      const longitudinal = 17 - post * 1.85;
      const horizontal = side * (halfWidth + 0.22);
      box('stone-caps', [0.18, 0.72, 0.18], [horizontal, 1.48, longitudinal]);
      box('stone-caps', [0.27, 0.1, 0.27], [horizontal, 1.89, longitudinal]);
      box('stone-caps', [0.11, 0.11, 1.76], [horizontal, 1.67, longitudinal - 0.92]);
      box('stone', [0.085, 0.1, 1.76], [horizontal, 1.29, longitudinal - 0.92]);
    }
    let longitudinal = 11 + (side > 0 ? 1.8 : 0);
    for (let index = 0; index < 20; index++) {
      const seed = index * 11.3 + (side > 0 ? 317 : 129);
      const width = 4.5 + seedValue(seed) * 3.4;
      const depth = 3.1 + seedValue(seed + 1) * 3;
      const storeys = index % 6 === (side > 0 ? 2 : 4) ? 2 : 1;
      const height = (storeys === 2 ? 5.1 : 2.65) + seedValue(seed + 2) * 0.8;
      const base = 1.15;
      const facade = side * (halfWidth + 2.15 + seedValue(seed + 3) * 0.3);
      const center = facade + side * depth / 2;
      const wallMaterial = ['plaster', 'plaster-warm', 'plaster-cool'][index % 3]!;
      houses.push({ width, depth, height, storeys, side, z: longitudinal });
      box(wallMaterial, [depth, height, width], [center, base + height / 2, longitudinal]);
      box('stone', [depth + 0.12, 0.38, width + 0.1], [center, base + 0.19, longitudinal]);
      box('timber', [0.16, 0.14, width + 0.06], [facade - side * 0.09, base + height - 0.16, longitudinal]);

      const roofHalf = depth / 2 + 0.55;
      const roofHeight = 1.05 + depth * 0.075;
      const roofTop = base + height;
      const roofY = (horizontal: number, length: number) => {
        const slope = Math.abs(horizontal) / roofHalf;
        return roofTop + roofHeight * Math.pow(1 - slope, 1.65) + 0.22 * Math.pow(slope, 7) + 0.18 * Math.pow(Math.abs(length) / (width / 2 + 0.38), 6);
      };
      const vertices: number[] = [], coordinates: number[] = [];
      for (let slope = 0; slope < 12; slope++) {
        for (let length = 0; length < 6; length++) {
          const near = -roofHalf + slope / 12 * roofHalf * 2;
          const far = -roofHalf + (slope + 1) / 12 * roofHalf * 2;
          const first = -(width / 2 + 0.38) + length / 6 * (width + 0.76);
          const last = -(width / 2 + 0.38) + (length + 1) / 6 * (width + 0.76);
          for (const [horizontal, lengthwise] of [[near, first], [far, first], [far, last], [near, first], [far, last], [near, last]]) {
            vertices.push(center + horizontal!, roofY(horizontal!, lengthwise!), longitudinal + lengthwise!);
            coordinates.push(horizontal!, lengthwise!);
          }
        }
      }
      const roof = new THREE.BufferGeometry();
      roof.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      roof.setAttribute('uv', new THREE.Float32BufferAttribute(coordinates, 2));
      roof.computeVertexNormals();
      push('roof', roof);
      rod('ridge', [center, roofTop + roofHeight + 0.09, longitudinal - width / 2], [center, roofTop + roofHeight + 0.09, longitudinal + width / 2], 0.065, 10);
      for (const edge of [-1, 1]) {
        const horizontal = center + edge * roofHalf;
        box('timber', [0.12, 0.14, width + 0.76], [horizontal, roofTop + 0.1, longitudinal]);
        for (let bracket = 0; bracket < Math.floor(width / 1.1); bracket++) {
          const lengthwise = longitudinal - width / 2 + 0.45 + bracket * 1.1;
          rod('wood-gold', [horizontal - edge * 0.5, roofTop - 0.35, lengthwise], [horizontal - edge * 0.05, roofTop + 0.05, lengthwise], 0.055);
        }
      }
      if (index % 3 !== 1) {
        for (const end of [-1, 1]) {
          const profile = new THREE.Shape();
          profile.moveTo(-depth / 2 - 0.12, 0);
          profile.lineTo(-depth / 2 - 0.12, 0.57);
          profile.lineTo(-depth * 0.3, 0.57);
          profile.lineTo(-depth * 0.3, 1.09);
          profile.lineTo(-depth * 0.12, 1.09);
          profile.lineTo(-depth * 0.12, roofHeight + 0.4);
          profile.lineTo(depth * 0.12, roofHeight + 0.4);
          profile.lineTo(depth * 0.12, 1.09);
          profile.lineTo(depth * 0.3, 1.09);
          profile.lineTo(depth * 0.3, 0.57);
          profile.lineTo(depth / 2 + 0.12, 0.57);
          profile.lineTo(depth / 2 + 0.12, 0);
          profile.closePath();
          const endZ = longitudinal + end * (width / 2 - 0.1);
          extrude(wallMaterial, profile, 0.2, [center, roofTop, endZ]);
          for (const tier of [-1, 1]) {
            box('ridge', [depth * 0.2, 0.12, 0.31], [center + tier * depth * 0.405, roofTop + 0.6, endZ + 0.1]);
            box('ridge', [depth * 0.2, 0.12, 0.31], [center + tier * depth * 0.205, roofTop + 1.12, endZ + 0.1]);
          }
          box('ridge', [depth * 0.28, 0.12, 0.32], [center, roofTop + roofHeight + 0.43, endZ + 0.1]);
        }
      }

      const bays = Math.max(3, Math.floor(width / 1.45));
      const porch = facade - side * 1.05;
      for (let bay = 0; bay < bays; bay++) {
        const lengthwise = longitudinal - width / 2 + (bay + 0.5) * width / bays;
        const windowWidth = Math.min(1.04, width / bays - 0.25);
        for (let floor = 0; floor < storeys; floor++) {
          const windowY = base + 1.43 + floor * 2.45;
          const lit = seedValue(seed + bay * 3 + floor * 19) > 0.22;
          box('timber', [0.1, 1.39, windowWidth + 0.15], [facade - side * 0.055, windowY, lengthwise]);
          box(lit ? (bay % 2 ? 'window-soft' : 'window') : 'roof', [0.022, 1.18, windowWidth], [facade - side * 0.115, windowY, lengthwise]);
          for (let mullion = 0; mullion < 4; mullion++) box('timber', [0.045, 1.27, 0.036], [facade - side * 0.145, windowY, lengthwise - windowWidth / 2 + mullion * windowWidth / 3]);
          for (let cross = 0; cross < 5; cross++) box('timber', [0.045, 0.036, windowWidth], [facade - side * 0.149, windowY - 0.56 + cross * 0.28, lengthwise]);
          if (lit) addLight('window', [facade - side * 0.16, windowY, lengthwise], lin(PALETTE.paper).multiplyScalar(bay % 2 ? 0.48 : 0.75), 0.22);
        }
        rod('timber', [porch, base, lengthwise], [porch, base + Math.min(height, 3.1) - 0.16, lengthwise], 0.062, 8);
        box('timber', [1.12, 0.12, 0.11], [(facade + porch) / 2, base + 2.7, lengthwise]);
      }
      box('timber', [0.14, 0.14, width - 0.13], [porch, base + Math.min(height, 3.1) - 0.1, longitudinal]);
      box('wood-gold', [0.47, 0.09, width - 0.26], [porch + side * 0.14, base + 0.47, longitudinal]);
      rod('wood-gold', [porch - side * 0.05, base + 0.94, longitudinal - width / 2 + 0.2], [porch - side * 0.05, base + 0.94, longitudinal + width / 2 - 0.2], 0.034);
      for (let spindle = 0; spindle < Math.floor(width / 0.34); spindle++) {
        const lengthwise = longitudinal - width / 2 + 0.22 + spindle * 0.34;
        rod('timber', [porch + side * 0.15, base + 0.13, lengthwise], [porch + side * 0.15, base + 0.5, lengthwise], 0.024);
        rod('wood-gold', [porch + side * 0.25, base + 0.52, lengthwise], [porch - side * 0.05, base + 0.94, lengthwise], 0.022);
      }
      if (storeys === 2) {
        box('roof', [1.33, 0.14, width + 0.4], [facade - side * 0.55, base + 3, longitudinal], side * 0.09);
        box('timber', [0.14, 0.16, width], [facade - side * 0.8, base + 3.78, longitudinal]);
        for (let spindle = 0; spindle < Math.floor(width / 0.55); spindle++) box('timber', [0.055, 0.75, 0.055], [facade - side * 0.8, base + 3.43, longitudinal - width / 2 + 0.2 + spindle * 0.55]);
      }
      const count = index % 4 === 0 ? 4 : index % 3 === 0 ? 1 : 2;
      for (let lamp = 0; lamp < count; lamp++) {
        const lengthwise = longitudinal - width * 0.38 + (lamp + 0.5) / count * width * 0.76;
        lantern([porch - side * 0.1, base + Math.min(height, 3.1) - 0.66, lengthwise], 0.16 + seedValue(seed + lamp * 7) * 0.095);
      }
      longitudinal -= width + 0.3 + seedValue(seed + 8) * 0.75;
    }
  }

  const arch = new THREE.Shape();
  const outer = bridge.radius + bridge.thickness;
  arch.moveTo(-outer, bridge.spring);
  arch.absarc(0, bridge.spring, outer, Math.PI, 0, true);
  arch.lineTo(bridge.radius, bridge.spring);
  arch.absarc(0, bridge.spring, bridge.radius, 0, Math.PI, false);
  arch.closePath();
  extrude('stone', arch, 2.6, [0, 0, bridge.z - 1.3]);
  for (let voussoir = 0; voussoir <= 32; voussoir++) {
    const angle = voussoir / 32 * Math.PI;
    rod('stone-caps', [Math.cos(angle) * bridge.radius, bridge.spring + Math.sin(angle) * bridge.radius, bridge.z + 1.32], [Math.cos(angle) * outer, bridge.spring + Math.sin(angle) * outer, bridge.z + 1.32], 0.018);
  }
  for (let step = -12; step <= 12; step++) {
    const horizontal = step * 0.62;
    const height = bridge.spring + Math.sqrt(Math.max(0, outer * outer - Math.min(Math.abs(horizontal), outer) ** 2));
    box('stone-caps', [0.66, 0.2, 3.1], [horizontal, height + 0.09, bridge.z]);
    if (step % 2 === 0) {
      for (const edge of [-1, 1]) {
        box('stone-caps', [0.17, 0.65, 0.17], [horizontal, height + 0.43, bridge.z + edge * 1.4]);
        const nextX = horizontal + 1.24;
        const nextY = bridge.spring + Math.sqrt(Math.max(0, outer * outer - Math.min(Math.abs(nextX), outer) ** 2));
        rod('stone-caps', [horizontal, height + 0.72, bridge.z + edge * 1.4], [nextX, nextY + 0.72, bridge.z + edge * 1.4], 0.045);
      }
    }
  }
  for (const side of [-1, 1]) {
    box('stone', [2.6, 1.4, 3.2], [side * (bridge.radius + 0.7), 0.65, bridge.z]);
    lantern([side * 5.4, 5.9, bridge.z + 1.45], 0.25);
    box('moon', [0.08, 0.23, 0.45], [side * 5.9, 0.3, bridge.z + 1.35]);
    addLight('bridge', [side * 5.9, 0.3, bridge.z + 1.35], lin(PALETTE.paper).multiplyScalar(0.26), 0.35);
  }

  const boat = { x: 4.72, z: -32 };
  const hull = new THREE.Shape();
  hull.moveTo(-0.67, 0.28);
  hull.lineTo(-0.44, 0.03);
  hull.lineTo(0.44, 0.03);
  hull.lineTo(0.67, 0.28);
  hull.closePath();
  extrude('timber', hull, 5.2, [boat.x, 0, boat.z - 2.6]);
  box('wood-gold', [1.22, 0.13, 4.9], [boat.x, 0.3, boat.z]);
  box('roof', [1.55, 0.14, 3.45], [boat.x, 1.6, boat.z], 0.1);
  for (const lengthwise of [-1.35, 0, 1.35]) {
    for (const edge of [-1, 1]) rod('wood-gold', [boat.x + edge * 0.51, 0.32, boat.z + lengthwise], [boat.x + edge * 0.51, 1.56, boat.z + lengthwise], 0.035);
  }
  box('window-soft', [0.02, 0.65, 2.25], [boat.x + 0.5, 0.98, boat.z]);
  for (const lengthwise of [-1.2, 1.2]) lantern([boat.x - 0.56, 1.27, boat.z + lengthwise], 0.115);

  for (const [name, bucket] of buckets) {
    const merged = mergeGeometries(bucket.geometry, false)!;
    bucket.geometry.forEach(geometry => geometry.dispose());
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = `qinhuai-${name}`;
    group.add(mesh);
  }
  const setFade = (fade: number) => {
    for (const bucket of buckets.values()) bucket.material.uniforms.uFade!.value = fade;
  };
  return { group, houses, lights, halfWidth, bridge, setFade };
}
