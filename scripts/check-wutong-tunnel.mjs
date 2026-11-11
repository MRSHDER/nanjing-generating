import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const output = resolve(process.argv[2] ?? 'out/combined/wutong-tunnel');
const source = readFileSync('src/three/glitch.ts', 'utf8');
const poseSource = source.slice(source.indexOf('function poseAt'), source.indexOf('/** 第 6 小节的四张回顾小片')).replace(/case 0: return .*?;\r?\n/, 'case 0: return { pos: [Math.sin(b * 0.25) * 0.8, Math.cos(b * 0.2) * 0.3, 18.5], look: [0, 0, 0] };\n');
const flashSource = source.slice(source.indexOf('const FLASH_WINDOWS'), source.indexOf('const LINE_VERT'));
assert.equal(createHash('sha256').update(poseSource).digest('hex'), 'af713a26f9d6c683ae66120999a82e13631440b6526921b55260d435c393cd78', 'camera path changed');
assert.equal(createHash('sha256').update(flashSource).digest('hex'), 'cccc99cc4f493909370f315729d5e2bcdbcdb1cf086ffc78f04af59e88433b97', 'flash windows changed');
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?scale=1&ui=0`);
  await page.waitForFunction(() => window.__ready, undefined, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const { getLayer3D } = await import('/src/three/index.ts');
    const { frameAt, BEAT } = await import('/src/engine/beat.ts');
    const { glitchBinaryAt } = await import('/src/three/glitch.ts');
    const { FIGURE_ANCHOR } = await import('/src/three/figure.ts');
    const layer = await getLayer3D('glitch', null);
    const ground = FIGURE_ANCHOR.y;
    const roots = new Set();
    const skeleton = layer.shapes[4].p;
    for (let offset = 0; offset < skeleton.length; offset += 6) {
      if (Math.abs(skeleton[offset + 1] - ground) < 1e-5 && skeleton[offset + 4] > ground + 0.01) roots.add(`${skeleton[offset].toFixed(3)},${skeleton[offset + 2].toFixed(3)}`);
    }
    if (roots.size !== 28) throw Error(`wutong tree density: expected 28 roots, found ${roots.size}`);
    const { createWutongModel, getWutongModel, wutongContours } = await import('/src/three/wutongModel.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const model = layer.models[4].userData.wutong;
    if (!model || model !== getWutongModel(ground) || layer.models[4] !== layer.solids[4] || layer.models[3] !== layer.solids[3]) throw Error('shared solid model interface missing');
    const foliageParts = model.parts.filter(part => part.kind === 'canopy');
    const foliageLayers = [...new Set(foliageParts.map(part => part.layer))].sort();
    if (foliageLayers.join(',') !== '0,1,2') throw Error('canopy layering missing: expected three geometric ink layers');
    const layerMetrics = foliageLayers.map(level => {
      const parts = foliageParts.filter(part => part.layer === level);
      const heights = [], luminances = [], undersides = [];
      for (const part of parts) {
        const positions = part.geometry.getAttribute('position');
        const colors = part.geometry.getAttribute('color');
        if (!colors) throw Error('canopy has no facet shading');
        let minimum = Infinity;
        for (let vertex = 0; vertex < positions.count; vertex++) {
          heights.push(positions.getY(vertex));
          minimum = Math.min(minimum, positions.getY(vertex));
          const red = colors.getX(vertex), green = colors.getY(vertex), blue = colors.getZ(vertex);
          if (Math.max(red, green, blue) - Math.min(red, green, blue) > 0.035) throw Error('canopy facet is not an ink shade');
          luminances.push(red * 0.2126 + green * 0.7152 + blue * 0.0722);
        }
        undersides.push(minimum);
      }
      const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
      return { height: mean(heights), luminance: mean(luminances), lowerEdgeRange: Math.max(...undersides) - Math.min(...undersides) };
    });
    for (let level = 0; level < layerMetrics.length; level++) {
      if (layerMetrics[level].lowerEdgeRange < 0.7) throw Error('canopy underside is too even');
      if (level && (layerMetrics[level].height < layerMetrics[level - 1].height + 0.2 || layerMetrics[level].luminance < layerMetrics[level - 1].luminance * 1.15)) throw Error('canopy must become higher and brighter through three layers');
    }
    for (const side of [-1, 1]) {
      const trees = model.trees.filter(tree => tree.side === side);
      if (trees.length !== 14) throw Error('expected 14 trees on each side');
      for (const tree of trees) {
        if (tree.whiteHeight < 1.5 || tree.whiteHeight > 1.8) throw Error('white trunk band is not human height');
        if (tree.rootRadius < 0.2 || tree.rootRadius > 0.3 || tree.forkRadius >= tree.rootRadius) throw Error('trunk is not thick and tapered');
        if (tree.forkHeight / tree.height < 0.61 || tree.forkHeight / tree.height > 0.71) throw Error('tree forks outside two-thirds height');
        if (Math.abs(tree.fork[0]) >= Math.abs(tree.root[0])) throw Error('trunk does not lean toward road');
        const branches = model.skeleton.filter(segment => segment.a.every((value, axis) => value === tree.fork[axis]));
        if (branches.length < 4) throw Error('tree has fewer than four main forks into the canopy');
        for (const branch of branches) {
          const twigs = model.skeleton.filter(segment => segment.a.every((value, axis) => value === branch.b[axis]));
          if (twigs.length < 2 || twigs.every(segment => segment.b[1] < ground + 4.8)) throw Error('main branch does not bifurcate into the canopy');
        }
      }
    }
    const canopyMesh = layer.models[4].getObjectByName('wutong-canopy');
    const canopyBounds = new THREE.Box3().setFromObject(canopyMesh);
    if (canopyBounds.min.x > -3.3 || canopyBounds.max.x < 3.3 || canopyBounds.min.z > -45) throw Error('canopy does not span the avenue');
    const ray = new THREE.Raycaster();
    let canopySamples = 0, skySamples = 0;
    const skyDepths = new Set();
    for (let depth = 0; depth >= -45; depth -= 0.75) {
      for (const across of [-1.7, 0, 1.7]) {
        ray.set(new THREE.Vector3(across, ground + 2, depth), new THREE.Vector3(0, 1, 0));
        canopySamples++;
        if (!ray.intersectObject(canopyMesh).length) { skySamples++; skyDepths.add(depth); }
      }
    }
    if (skySamples < 3 || skyDepths.size < 3) throw Error('canopy has no scattered sky openings');
    if (skySamples / canopySamples > 0.25) throw Error('sky openings break the canopy tunnel');
    const roadMarks = model.skeleton.filter(segment => segment.red === 1);
    const expectedMarks = [];
    for (let depth = 5; depth > -30; depth -= 2) expectedMarks.push({ a: [0, ground + 0.008, depth], b: [0, ground + 0.008, depth - 0.9], red: 1 });
    if (JSON.stringify(roadMarks) !== JSON.stringify(expectedMarks)) throw Error('red road centerline changed');
    for (const segment of model.skeleton) {
      for (const endpoint of [segment.a, segment.b]) {
        let found = false;
        for (let offset = 0; offset < skeleton.length && !found; offset += 3) found = endpoint.every((value, axis) => Math.abs(value - skeleton[offset + axis]) < 1e-5);
        if (!found) throw Error('shared branch endpoint is absent from structure lines');
      }
    }
    const liesOnSegment = (point, segment) => {
      const direction = segment.b.map((value, axis) => value - segment.a[axis]);
      const squaredLength = direction.reduce((total, value) => total + value * value, 0);
      const progress = direction.reduce((total, value, axis) => total + value * (point[axis] - segment.a[axis]), 0) / squaredLength;
      return progress >= -1e-5 && progress <= 1 + 1e-5 && point.every((value, axis) => Math.abs(value - segment.a[axis] - direction[axis] * progress) < 1e-5);
    };
    for (let offset = 0; offset < skeleton.length; offset += 6) {
      const start = Array.from(skeleton.slice(offset, offset + 3)), end = Array.from(skeleton.slice(offset + 3, offset + 6));
      if (!model.skeleton.some(segment => liesOnSegment(start, segment) && liesOnSegment(end, segment))) throw Error('structure stroke leaves the shared branch geometry');
    }
    ray.set(new THREE.Vector3(0, ground + 1.7, 4), new THREE.Vector3(0, 0, -1));
    if (ray.intersectObject(layer.models[4], true).length) throw Error('bright tunnel mouth is blocked');
    const repeated = createWutongModel(ground);
    if (JSON.stringify(repeated.trees) !== JSON.stringify(model.trees)) throw Error('tree generation is not deterministic');
    for (let index = 0; index < model.parts.length; index++) {
      for (const attribute of ['position', 'normal', 'color']) {
        const first = model.parts[index].geometry.attributes[attribute]?.array;
        const second = repeated.parts[index].geometry.attributes[attribute]?.array;
        if (!!first !== !!second || first?.some((value, vertex) => value !== second[vertex])) throw Error(`${attribute} generation is not deterministic`);
      }
    }
    const cameras = [];
    const visibleSky = [];
    const snapshots = [];
    for (const time of [33.4, 33.7, 34.5]) {
      window.__renderAt(time);
      const camera = layer.backgroundCamera(frameAt(time));
      cameras.push({ time, position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov });
      const expectedZ = { '33.4': 6.12, '33.7': 5.76, '34.5': 5.175 }[String(time)];
      if (Math.abs(camera.position.x - 0.6) > 1e-9 || Math.abs(camera.position.y + 1.05) > 1e-9 || Math.abs(camera.position.z - expectedZ) > 1e-9 || camera.fov !== 35) throw Error('wutong camera changed');
      let openings = 0;
      const visibleLayers = [0, 0, 0];
      const trianglesByLayer = foliageParts.flatMap(part => Array.from({ length: part.geometry.getAttribute('position').count / 3 }, () => part.layer));
      for (let horizontal = -0.45; horizontal <= 0.45; horizontal += 0.03) {
        for (let vertical = 0.3; vertical <= 0.96; vertical += 0.03) {
          ray.setFromCamera(new THREE.Vector2(horizontal, vertical), camera);
          const hit = ray.intersectObject(canopyMesh)[0];
          if (!hit) openings++;
          else visibleLayers[trianglesByLayer[hit.faceIndex]]++;
        }
      }
      if (openings < 5) throw Error(`sky openings are hidden from the original camera at ${time}`);
      if (visibleLayers.some(count => count < 3)) throw Error(`one canopy layer is hidden from the original camera at ${time}`);
      visibleSky.push({ time, openings, visibleLayers });
      const expected = layer.stateOf(frameAt(time));
      if (time === 34.5 && (!expected.flash || expected.shape !== 4 || layer.solids[4].visible || !layer.canopyLines.visible)) throw Error('34.5s does not show wutong structure lines');
      if (time < 34 && (!layer.solids[4].visible || layer.canopyLines.visible)) throw Error('solid window changed');
      const first = document.getElementById('c').toDataURL();
      window.__renderAt(35.7);
      window.__renderAt(28.2);
      window.__renderAt(time);
      if (first !== document.getElementById('c').toDataURL()) throw Error(`wutong frame depends on seek order at ${time}`);
      snapshots.push(first.split(',')[1]);
      const outline = wutongContours(model, camera);
      const vertices = new Set(model.parts.flatMap(part => {
        const positions = part.geometry.attributes.position.array;
        return Array.from({ length: positions.length / 3 }, (_, index) => Array.from(positions.slice(index * 3, index * 3 + 3)).join(','));
      }));
      for (let vertex = 0; vertex < outline.length; vertex += 3) {
        if (!vertices.has(Array.from(outline.slice(vertex, vertex + 3)).join(','))) throw Error('outline vertex does not belong to solid mesh');
      }
    }
    const windows = [[2.5, 3.5], [6.5, 8], [10.5, 11.5], [14.5, 16], [18.5, 19.5], [22.5, 23.5]];
    for (const [begin, end] of windows) {
      for (const beat of [begin - 0.01, begin + 0.01, end - 0.01, end + 0.01]) {
        const time = 26.666666666666668 + beat * BEAT;
        const actual = layer.stateOf(frameAt(time));
        if (!!actual.flash !== glitchBinaryAt(beat)) throw Error('flash boundary changed');
        window.__renderAt(time);
      }
    }
    window.__renderAt(33.7);
    const drawCalls = layer.models[4].children.filter(child => child.isMesh).length;
    const triangles = layer.models[4].children.reduce((total, child) => total + (child.isMesh ? (child.geometry.index?.count ?? child.geometry.attributes.position.count) / 3 : 0), 0);
    if (drawCalls > 7 || triangles > 15000) throw Error('wutong is not batched');
    if (!layer.lensRT[4]) throw Error('ball does not cache the new wutong model');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(952, 594);
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const target = new THREE.WebGLRenderTarget(952, 594);
    const savedCamera = layer.cam;
    const referenceCamera = new THREE.PerspectiveCamera(42, 952 / 594, 0.1, 100);
    referenceCamera.position.set(0, ground + 1.65, 5.8);
    referenceCamera.lookAt(0, ground + 4.8, -13);
    referenceCamera.updateMatrixWorld(true);
    try {
      layer.cam = referenceCamera;
      layer.inkRender(renderer, target);
      const { FSPass } = await import('/src/engine/gl.ts');
      const pass = new FSPass('uniform sampler2D tIn; void main(){ vec3 col = texture2D(tIn, vUv).rgb; vec3 srgb = mix(col * 12.92, 1.055 * pow(max(col, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), col)); gl_FragColor = vec4(srgb, 1.0); }', { tIn: { value: target.texture } });
      pass.render(renderer, null);
      const reference = new Image();
      reference.src = '/reference/wutong-avenue-reference.png';
      await reference.decode();
      const comparison = document.createElement('canvas');
      comparison.width = 1904;
      comparison.height = 630;
      const context = comparison.getContext('2d');
      context.fillStyle = '#eee9df';
      context.fillRect(0, 0, 1904, 630);
      context.drawImage(reference, 0, 36, 952, 594);
      context.drawImage(renderer.domElement, 952, 36, 952, 594);
      context.fillStyle = '#0a0a0b';
      context.font = '18px sans-serif';
      context.fillText('REFERENCE', 16, 25);
      context.fillText('SHARED WUTONG MODEL / TEST CAMERA ONLY', 968, 25);
      snapshots.push(comparison.toDataURL().split(',')[1]);
    } finally {
      layer.cam = savedCamera;
      target.dispose();
      renderer.dispose();
    }
    window.__renderAt(33.7);
    return { treeCount: model.trees.length, roots: roots.size, foliageLayers, layerMetrics, skySamples, canopySamples, skyDepths: [...skyDepths], visibleSky, drawCalls, triangles, cameras, snapshots, deterministic: true, solidOutlineSameVertices: true, continuousCanopy: true, brightMouth: true, lensUsesModel: true };
  });
  assert.deepEqual(errors, [], 'browser errors');
  mkdirSync(output, { recursive: true });
  for (const [index, name] of ['t33.40.png', 't33.70.png', 't34.50.png', 'reference-comparison.png'].entries()) writeFileSync(resolve(output, name), Buffer.from(result.snapshots[index], 'base64'));
  delete result.snapshots;
  result.poseHash = createHash('sha256').update(poseSource).digest('hex');
  result.flashHash = createHash('sha256').update(flashSource).digest('hex');
  result.browserErrors = errors;
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await server.close();
}
