# Voxel-Style Sunset Diorama Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, browser-displayed dusk-lit fantasy diorama (small island with castle tower, houses, dock, ship, bridge, river, trees) using Three.js. All geometry is generated procedurally in code, and a custom shader pipeline gives a voxel-like look.

**Architecture:** Vite + TypeScript single-page app. All scene objects are composed from `BoxGeometry` (and a few primitives) inside factory functions. A custom material extension (normal quantization + color posterization) plus a depth-edge post-process create the pseudo-voxel aesthetic. Sunset lighting is fixed via a low warm `DirectionalLight`, a `HemisphereLight`, a gradient sky background, and warm exponential fog. The pmndrs/postprocessing library powers SSAO, Bloom, Tilt-Shift, LUT grading, vignette, and SMAA in an `EffectComposer`. User can orbit / pan / zoom via `OrbitControls`.

**Tech Stack:**
- Bun (package manager + script runner)
- Vite (dev server + build)
- TypeScript (strict)
- Three.js r170+ (WebGL2 `WebGLRenderer`)
- `postprocessing` (pmndrs) for the post-processing pipeline
- Vitest (unit tests for deterministic utilities)

**Renderer note:** Although Three.js ships a `WebGPURenderer`, the post-processing chain we need (SSAO, Bloom, Tilt-Shift DoF, LUT, SMAA) is far more mature on WebGL2 via `postprocessing` (pmndrs). We deliberately stay on WebGL2 for production stability.

**Repo layout target:**
```
three-art/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── index.html
├── src/
│   ├── main.ts
│   ├── lighting.ts
│   ├── sky.ts
│   ├── terrain.ts
│   ├── water.ts
│   ├── trees.ts
│   ├── voxel-material.ts
│   ├── post.ts
│   ├── utils.ts
│   └── buildings/
│       ├── tower.ts
│       ├── house.ts
│       ├── bridge.ts
│       ├── dock.ts
│       └── ship.ts
├── tests/
│   ├── utils.test.ts
│   └── trees.test.ts
└── docs/
    └── superpowers/plans/2026-04-29-voxel-diorama.md  (this file)
```

**Conventions:**
- All factory functions return a `THREE.Group` or `THREE.Object3D` ready to `scene.add(...)`.
- All world units are meters; the island is roughly 32×32 units.
- All colors are sunset-warm — see `Task 3` for the palette.
- Geometry is built around the origin; placement is done by the caller via `position.set(...)`.
- Test where it pays off (deterministic logic). Visual scenes are verified by running the dev server and observing the result.

---

## Task 1: Project Bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `.gitignore`

- [ ] **Step 1: Initialize bun project and install deps**

Run from `/Users/shun/dev/three-art`:
```bash
bun init -y
bun add three postprocessing
bun add -d @types/three typescript vite vitest
```

Expected: `package.json` and `bun.lock` created, `node_modules/` populated.

- [ ] **Step 2: Replace `package.json` scripts**

Open `package.json` and ensure the `scripts` block reads:
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```
Also remove any `"main"` / `"module"` fields Bun added — this is a browser app, not a library.

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: true },
  build: { target: 'es2022' },
});
```

- [ ] **Step 5: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules
dist
.DS_Store
*.log
.vite
```

- [ ] **Step 7: Write `index.html`**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Voxel Diorama</title>
    <style>
      html, body { margin: 0; padding: 0; overflow: hidden; background: #000; }
      #app { position: fixed; inset: 0; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: Write smoke-test `src/main.ts`**

```ts
import * as THREE from 'three';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x202028);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(20, 18, 22);
camera.lookAt(0, 0, 0);

const geometry = new THREE.BoxGeometry(2, 2, 2);
const material = new THREE.MeshStandardMaterial({ color: 0xff8855 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

scene.add(new THREE.HemisphereLight(0xffeedd, 0x223355, 1.0));
const sun = new THREE.DirectionalLight(0xffaa66, 2.0);
sun.position.set(5, 10, 7);
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  cube.rotation.y += 0.005;
  renderer.render(scene, camera);
});
```

- [ ] **Step 9: Run dev server and verify**

```bash
bun run dev
```
Expected: browser opens at `http://localhost:5173/` showing a slowly rotating orange cube on a dark background. Stop the server with Ctrl+C.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Vite + Three.js project"
```

---

## Task 2: Renderer Core, Camera, OrbitControls

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace `src/main.ts` with the structured app skeleton**

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x394a6b);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(36, 30, 36);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 12;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.48; // never quite from below horizon
controls.minPolarAngle = Math.PI * 0.10; // never directly overhead
controls.update();

// Temporary placeholder so we can confirm the camera works
const ground = new THREE.Mesh(
  new THREE.BoxGeometry(40, 1, 40),
  new THREE.MeshStandardMaterial({ color: 0x6a7a3a }),
);
ground.position.y = -0.5;
ground.receiveShadow = true;
scene.add(ground);

const marker = new THREE.Mesh(
  new THREE.BoxGeometry(2, 4, 2),
  new THREE.MeshStandardMaterial({ color: 0xff8855 }),
);
marker.position.y = 2;
marker.castShadow = true;
scene.add(marker);

scene.add(new THREE.HemisphereLight(0xffeedd, 0x223355, 1.0));
const sun = new THREE.DirectionalLight(0xffaa66, 2.5);
sun.position.set(8, 12, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 60;
sun.shadow.bias = -0.0005;
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
```

- [ ] **Step 2: Run dev server and verify**

```bash
bun run dev
```
Expected:
- A green ground slab with an orange box marker on it.
- Left-drag rotates around the marker; right-drag (or shift+left) pans; wheel zooms.
- Camera does not flip below the horizon and does not reach straight overhead.
- Damping makes motion feel inertial.

Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: add core renderer, camera, OrbitControls"
```

---

## Task 3: Sunset Lighting & Sky

**Files:**
- Create: `src/lighting.ts`
- Create: `src/sky.ts`
- Modify: `src/main.ts`

The sunset palette used everywhere downstream is defined here as the source of truth.

- [ ] **Step 1: Write `src/sky.ts`**

```ts
import * as THREE from 'three';

const skyVert = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(worldPos.xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const skyFrag = /* glsl */ `
  varying vec3 vWorldDir;
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float sunSize;

  void main() {
    float h = clamp(vWorldDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 grad = mix(horizonColor, topColor, pow(h, 1.4));

    float sunAmount = max(dot(normalize(vWorldDir), normalize(sunDir)), 0.0);
    float halo = pow(sunAmount, 8.0) * 0.6 + pow(sunAmount, 64.0);
    vec3 col = grad + sunColor * halo * sunSize;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSky(sunDir: THREE.Vector3): THREE.Mesh {
  const geo = new THREE.SphereGeometry(200, 32, 16);
  const mat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor:     { value: new THREE.Color('#3a4a78') },
      horizonColor: { value: new THREE.Color('#ff9a5c') },
      sunColor:     { value: new THREE.Color('#ffd29a') },
      sunDir:       { value: sunDir.clone().normalize() },
      sunSize:      { value: 1.0 },
    },
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.name = 'sky';
  return sky;
}
```

- [ ] **Step 2: Write `src/lighting.ts`**

```ts
import * as THREE from 'three';

export const SUNSET_PALETTE = {
  sunColor:        new THREE.Color('#ffb070'),
  hemiSky:         new THREE.Color('#7a6a8a'),
  hemiGround:      new THREE.Color('#3a3a55'),
  fog:             new THREE.Color('#d18a55'),
  stone:           new THREE.Color('#7a7a78'),
  stoneDark:       new THREE.Color('#5a5a58'),
  wood:            new THREE.Color('#6b4a2b'),
  woodDark:        new THREE.Color('#4a3220'),
  roofRed:         new THREE.Color('#a4503c'),
  roofBlue:        new THREE.Color('#3d4a6b'),
  roofGreen:       new THREE.Color('#3a5a40'),
  grass:           new THREE.Color('#6a7a3a'),
  grassDark:       new THREE.Color('#4f5e2c'),
  sand:            new THREE.Color('#c9a87c'),
  water:           new THREE.Color('#2a4a6a'),
  waterShallow:    new THREE.Color('#4a7a8a'),
  foliage:         new THREE.Color('#4a6a3a'),
  foliageDark:     new THREE.Color('#2e4423'),
  trunk:           new THREE.Color('#3a2a1a'),
  flag:            new THREE.Color('#3d4a6b'),
};

export const SUN_DIRECTION = new THREE.Vector3(8, 1.4, 4); // low + warm

export function addLighting(scene: THREE.Scene): { sun: THREE.DirectionalLight } {
  const hemi = new THREE.HemisphereLight(SUNSET_PALETTE.hemiSky, SUNSET_PALETTE.hemiGround, 0.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(SUNSET_PALETTE.sunColor, 3.0);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -28;
  sun.shadow.camera.right = 28;
  sun.shadow.camera.top = 28;
  sun.shadow.camera.bottom = -28;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  scene.fog = new THREE.FogExp2(SUNSET_PALETTE.fog.getHex(), 0.012);
  return { sun };
}
```

- [ ] **Step 3: Replace `src/main.ts` to use the new modules**

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { addLighting, SUN_DIRECTION, SUNSET_PALETTE } from './lighting';
import { createSky } from './sky';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(createSky(SUN_DIRECTION));
addLighting(scene);

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(36, 30, 36);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 12;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minPolarAngle = Math.PI * 0.10;
controls.update();

// Placeholder ground + marker until terrain task lands
const ground = new THREE.Mesh(
  new THREE.BoxGeometry(40, 1, 40),
  new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.grass }),
);
ground.position.y = -0.5;
ground.receiveShadow = true;
scene.add(ground);

const marker = new THREE.Mesh(
  new THREE.BoxGeometry(2, 4, 2),
  new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.stone }),
);
marker.position.y = 2;
marker.castShadow = true;
scene.add(marker);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
```

- [ ] **Step 4: Run dev server and verify**

```bash
bun run dev
```
Expected:
- Sky shows blue-purple top blending to warm orange near the horizon, with a soft sun halo to the right.
- Ground/marker are warmly lit on the sun-facing side, with long blue-tinted shadows on the opposite side.
- Distant objects (rotate camera away from origin) softly fade into the warm fog.

Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/lighting.ts src/sky.ts src/main.ts
git commit -m "feat: sunset lighting and gradient sky"
```

---

## Task 4: Utilities (Seeded Random + Beveled Box) — TDD

**Files:**
- Create: `src/utils.ts`
- Create: `tests/utils.test.ts`

- [ ] **Step 1: Write the failing test for `mulberry32`**

`tests/utils.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../src/utils';

describe('mulberry32', () => {
  it('produces deterministic sequences for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toBe(b());
  });

  it('returns values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
bun run test
```
Expected: FAIL — `mulberry32` not defined.

- [ ] **Step 3: Implement `mulberry32` in `src/utils.ts`**

```ts
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run the test to see it pass**

```bash
bun run test
```
Expected: PASS.

- [ ] **Step 5: Add the failing test for `beveledBox`**

Append to `tests/utils.test.ts`:
```ts
import { beveledBox } from '../src/utils';
import * as THREE from 'three';

describe('beveledBox', () => {
  it('returns a non-empty BufferGeometry with positions', () => {
    const geo = beveledBox(2, 2, 2, 0.05);
    expect(geo).toBeInstanceOf(THREE.BufferGeometry);
    const pos = geo.getAttribute('position');
    expect(pos.count).toBeGreaterThan(0);
  });

  it('respects the requested outer dimensions on its bounding box', () => {
    const geo = beveledBox(4, 2, 6, 0.1);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const size = new THREE.Vector3();
    bb.getSize(size);
    expect(size.x).toBeCloseTo(4, 3);
    expect(size.y).toBeCloseTo(2, 3);
    expect(size.z).toBeCloseTo(6, 3);
  });
});
```

- [ ] **Step 6: Run the test to see it fail**

```bash
bun run test
```
Expected: FAIL — `beveledBox` not defined.

- [ ] **Step 7: Implement `beveledBox` in `src/utils.ts`**

Append:
```ts
import * as THREE from 'three';

/**
 * BoxGeometry with very small chamfered edges. Bevel is a tiny extrusion that
 * gives shaded highlights along voxel edges so faces don't look perfectly flat.
 * `bevel` is the inset of the chamfer in world units (e.g. 0.05).
 */
export function beveledBox(width: number, height: number, depth: number, bevel = 0.05): THREE.BufferGeometry {
  const w = width / 2;
  const h = height / 2;
  const d = depth / 2;
  const b = Math.min(bevel, Math.min(width, height, depth) * 0.45);

  const shape = new THREE.Shape();
  shape.moveTo(-w + b, -h);
  shape.lineTo(w - b, -h);
  shape.quadraticCurveTo(w, -h, w, -h + b);
  shape.lineTo(w, h - b);
  shape.quadraticCurveTo(w, h, w - b, h);
  shape.lineTo(-w + b, h);
  shape.quadraticCurveTo(-w, h, -w, h - b);
  shape.lineTo(-w, -h + b);
  shape.quadraticCurveTo(-w, -h, -w + b, -h);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: depth - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.translate(0, 0, -(depth / 2 - b));
  geo.computeVertexNormals();
  return geo;
}
```

- [ ] **Step 8: Run all tests**

```bash
bun run test
```
Expected: PASS, all 5 tests green.

- [ ] **Step 9: Commit**

```bash
git add src/utils.ts tests/utils.test.ts
git commit -m "feat(utils): seeded RNG and beveled box geometry"
```

---

## Task 5: Terrain (Island Base)

The island is built from stacked box "voxels" arranged on a height map. We keep this procedural but seeded so the result is stable.

**Files:**
- Create: `src/terrain.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/terrain.ts`**

```ts
import * as THREE from 'three';
import { mulberry32 } from './utils';
import { SUNSET_PALETTE } from './lighting';

const SIZE = 32;          // 32 x 32 columns
const CELL = 1.0;         // 1m per voxel column
const ISLAND_RADIUS = 14; // distance from origin where land ends

/**
 * Returns true if (gx, gz) integer grid coordinates (centered) are inside the island.
 * The shape is roughly elliptical with a sinusoidal coastline.
 */
function isLand(gx: number, gz: number, rng: () => number): { land: boolean; height: number; sand: boolean } {
  const x = gx + 0.5;
  const z = gz + 0.5;
  const r = Math.sqrt(x * x + z * z);
  const wobble = Math.sin(Math.atan2(z, x) * 4 + rng() * 0.001) * 1.2;
  const edge = ISLAND_RADIUS + wobble;
  if (r > edge) return { land: false, height: 0, sand: false };
  const h = 1 + Math.floor((1 - r / edge) * 3 + rng() * 0.5);
  const sand = r > edge - 1.5;
  return { land: true, height: h, sand };
}

/**
 * Returns true if the grid cell falls in the river, which cuts the island roughly NE→SW.
 */
function isRiver(gx: number, gz: number): boolean {
  const x = gx + 0.5;
  const z = gz + 0.5;
  // line through origin with slope ~1: |x - z| < 1.2 carves the river
  const distToLine = Math.abs(x - z) / Math.SQRT2;
  return distToLine < 1.2 && Math.sqrt(x * x + z * z) < ISLAND_RADIUS - 1.5;
}

export function createTerrain(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'terrain';
  const rng = mulberry32(1337);

  const grassGeo = new THREE.BoxGeometry(CELL, 1, CELL);
  const sandGeo = new THREE.BoxGeometry(CELL, 1, CELL);
  const grassMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.grass, roughness: 0.95 });
  const grassDarkMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.grassDark, roughness: 0.95 });
  const sandMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.sand, roughness: 1.0 });

  // Count cells first so we can size InstancedMeshes
  const cells: { gx: number; gz: number; h: number; sand: boolean }[] = [];
  for (let gx = -SIZE / 2; gx < SIZE / 2; gx++) {
    for (let gz = -SIZE / 2; gz < SIZE / 2; gz++) {
      if (isRiver(gx, gz)) continue;
      const r = isLand(gx, gz, rng);
      if (!r.land) continue;
      cells.push({ gx, gz, h: r.height, sand: r.sand });
    }
  }

  // We split into 3 instanced meshes: grass tops, dark grass under-blocks, and sand
  const grassCount = cells.filter(c => !c.sand).length;
  const sandCount = cells.filter(c => c.sand).length;
  const stackCount = cells.reduce((acc, c) => acc + Math.max(0, c.h - 1), 0);

  const grassTops = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
  const sandTops = new THREE.InstancedMesh(sandGeo, sandMat, sandCount);
  const stacks = new THREE.InstancedMesh(grassGeo, grassDarkMat, stackCount);
  grassTops.castShadow = grassTops.receiveShadow = true;
  sandTops.castShadow = sandTops.receiveShadow = true;
  stacks.castShadow = stacks.receiveShadow = true;

  const m = new THREE.Matrix4();
  let gi = 0, si = 0, ki = 0;
  for (const c of cells) {
    const wx = c.gx + 0.5;
    const wz = c.gz + 0.5;
    const topY = c.h - 0.5;
    if (c.sand) {
      m.makeTranslation(wx, topY, wz);
      sandTops.setMatrixAt(si++, m);
    } else {
      m.makeTranslation(wx, topY, wz);
      grassTops.setMatrixAt(gi++, m);
    }
    for (let y = 0; y < c.h - 1; y++) {
      m.makeTranslation(wx, y + 0.5, wz);
      stacks.setMatrixAt(ki++, m);
    }
  }
  grassTops.instanceMatrix.needsUpdate = true;
  sandTops.instanceMatrix.needsUpdate = true;
  stacks.instanceMatrix.needsUpdate = true;

  group.add(grassTops, sandTops, stacks);
  return group;
}

export const TERRAIN_CONST = { SIZE, CELL, ISLAND_RADIUS };
```

- [ ] **Step 2: Use the terrain in `src/main.ts`**

Remove the placeholder ground + marker and the `SUNSET_PALETTE` import path-fix isn't needed (still imported for direct use elsewhere later). Replace the placeholder block in `src/main.ts`:

```ts
// ...above unchanged
import { addLighting, SUN_DIRECTION } from './lighting';
import { createSky } from './sky';
import { createTerrain } from './terrain';

// after addLighting(scene):
scene.add(createTerrain());

// remove the old `ground` and `marker` blocks and the SUNSET_PALETTE import
```

The full `src/main.ts` should now look like:
```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { addLighting, SUN_DIRECTION } from './lighting';
import { createSky } from './sky';
import { createTerrain } from './terrain';

const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(createSky(SUN_DIRECTION));
addLighting(scene);
scene.add(createTerrain());

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(36, 30, 36);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 12;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minPolarAngle = Math.PI * 0.10;
controls.update();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
```

- [ ] **Step 3: Run dev server and verify**

```bash
bun run dev
```
Expected:
- A roughly oval green island ~28 units across, with a sand fringe at the coast.
- A river-shaped gap cuts diagonally across the island (NE to SW), revealing dark space underneath (we add water in the next task).
- Edges look stepped/voxel-like, shadows are visible on the side away from the sun.

- [ ] **Step 4: Commit**

```bash
git add src/terrain.ts src/main.ts
git commit -m "feat: procedural voxel island terrain"
```

---

## Task 6: Water Surfaces

We render two water bodies: the surrounding sea (large flat plane at y=0) and the river (slightly higher water surface that fills the cut in the island).

**Files:**
- Create: `src/water.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/water.ts`**

```ts
import * as THREE from 'three';
import { SUNSET_PALETTE } from './lighting';

export function createWater(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'water';

  // Surrounding sea
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180, 1, 1),
    new THREE.MeshStandardMaterial({
      color: SUNSET_PALETTE.water,
      roughness: 0.25,
      metalness: 0.1,
    }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0.0;
  sea.receiveShadow = true;
  group.add(sea);

  // River: shorter strip aligned with the island's diagonal cut
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 2.4, 1, 1),
    new THREE.MeshStandardMaterial({
      color: SUNSET_PALETTE.waterShallow,
      roughness: 0.35,
      metalness: 0.1,
    }),
  );
  river.rotation.x = -Math.PI / 2;
  river.rotation.z = Math.PI / 4; // align with diagonal cut
  river.position.y = 0.05;
  river.receiveShadow = true;
  group.add(river);

  return group;
}
```

- [ ] **Step 2: Add water to `src/main.ts`**

Add the import and call after `createTerrain()`:
```ts
import { createWater } from './water';
// ...
scene.add(createWater());
```

- [ ] **Step 3: Run dev server and verify**

```bash
bun run dev
```
Expected:
- Sea fills the area around the island with a deep blue tint and a subtle warm reflection from the sky.
- The river is visible inside the diagonal cut as a slightly lighter band.

- [ ] **Step 4: Commit**

```bash
git add src/water.ts src/main.ts
git commit -m "feat: water surfaces (sea and river)"
```

---

## Task 7: Castle Tower

**Files:**
- Create: `src/buildings/tower.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/buildings/tower.ts`**

```ts
import * as THREE from 'three';
import { SUNSET_PALETTE } from '../lighting';

export function createTower(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tower';

  const stoneMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.stone, roughness: 0.85 });
  const stoneDarkMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.stoneDark, roughness: 0.9 });
  const woodMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.wood, roughness: 0.8 });
  const flagMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.flag, roughness: 0.6 });

  // Main shaft: 3x8x3
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(3, 8, 3), stoneMat);
  shaft.position.y = 4;
  shaft.castShadow = shaft.receiveShadow = true;
  g.add(shaft);

  // Battlements: 8 small boxes around the top
  const cren = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  for (const [dx, dz] of [
    [-1.2, -1.2], [0, -1.2], [1.2, -1.2],
    [-1.2,  0],                [1.2,  0],
    [-1.2,  1.2], [0,  1.2], [1.2,  1.2],
  ]) {
    const b = new THREE.Mesh(cren, stoneDarkMat);
    b.position.set(dx, 8.35, dz);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
  }

  // Roof: 4-sided pyramid via ConeGeometry with 4 segments
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.4, 2.4, 4, 1),
    new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.roofBlue, roughness: 0.7 }),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 9.2;
  roof.castShadow = true;
  g.add(roof);

  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.1), woodMat);
  door.position.set(0, 0.8, 1.55);
  door.castShadow = true;
  g.add(door);

  // Windows (dark recesses suggested via small dark boxes)
  for (const y of [3, 5.5]) {
    for (const [rotY, x, z] of [
      [0,        0,   1.51],
      [Math.PI,  0,  -1.51],
      [Math.PI/2, 1.51, 0],
      [-Math.PI/2,-1.51, 0],
    ] as const) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.05), stoneDarkMat);
      w.position.set(x, y, z);
      w.rotation.y = rotY;
      g.add(w);
    }
  }

  // Flag pole + flag
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 0.08), woodMat);
  pole.position.y = 11.1;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.04), flagMat);
  flag.position.set(0.5, 11.4, 0);
  flag.castShadow = true;
  g.add(flag);

  return g;
}
```

- [ ] **Step 2: Place the tower in `src/main.ts`**

Add import and placement (the tower sits on the larger half of the island, NW of origin):
```ts
import { createTower } from './buildings/tower';
// ...
const tower = createTower();
tower.position.set(-7, 4, -5); // sit on top of the +3-step plateau
scene.add(tower);
```

- [ ] **Step 3: Run dev server and verify**

```bash
bun run dev
```
Expected:
- A grey tower with blue-tiled pyramid roof stands on the larger half of the island. Crenellations are visible at the top, a blue flag flies above it, and a wooden door faces the front. Long shadow stretches away from the sun.

- [ ] **Step 4: Commit**

```bash
git add src/buildings/tower.ts src/main.ts
git commit -m "feat: procedural castle tower"
```

---

## Task 8: Houses

**Files:**
- Create: `src/buildings/house.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/buildings/house.ts`**

```ts
import * as THREE from 'three';
import { SUNSET_PALETTE } from '../lighting';

export interface HouseOpts {
  width?: number;        // X
  depth?: number;        // Z
  wallHeight?: number;   // Y of the box body
  roofColor?: THREE.Color | number | string;
}

export function createHouse(opts: HouseOpts = {}): THREE.Group {
  const w = opts.width ?? 3;
  const d = opts.depth ?? 4;
  const h = opts.wallHeight ?? 2.4;
  const roofCol = new THREE.Color(opts.roofColor ?? SUNSET_PALETTE.roofRed);

  const g = new THREE.Group();
  g.name = 'house';

  const wallMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.wood, roughness: 0.85 });
  const beamMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.woodDark, roughness: 0.85 });
  const roofMat = new THREE.MeshStandardMaterial({ color: roofCol, roughness: 0.7 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.stone, roughness: 0.9 });

  // Stone base
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.4, d + 0.2), stoneMat);
  base.position.y = 0.2;
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  // Walls
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  walls.position.y = 0.4 + h / 2;
  walls.castShadow = walls.receiveShadow = true;
  g.add(walls);

  // Corner beams (4 verticals)
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.18, h, 0.18), beamMat);
    beam.position.set((sx * (w / 2 - 0.05))!, 0.4 + h / 2, (sz * (d / 2 - 0.05))!);
    beam.castShadow = true;
    g.add(beam);
  }

  // Roof: a triangular prism made of two tilted planes (here we use a 4-sided
  // ConeGeometry stretched on Z to fake a long ridge roof).
  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, 1.6, 4, 1), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(w / Math.max(w, d) * 1.0, 1, d / Math.max(w, d) * 1.0);
  roof.position.y = 0.4 + h + 0.8;
  roof.castShadow = true;
  g.add(roof);

  // Door
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.4, 0.08), beamMat);
  door.position.set(0, 0.4 + 0.7, d / 2 + 0.02);
  g.add(door);

  // Window (dark patch)
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.06), beamMat);
  win.position.set(w / 2 - 0.6, 0.4 + h - 0.7, d / 2 + 0.02);
  g.add(win);

  return g;
}
```

- [ ] **Step 2: Place houses in `src/main.ts`**

```ts
import { createHouse } from './buildings/house';

// after the tower:
const houseConfigs = [
  { pos: [-3, 3, 0],  rotY: 0.2,           roofColor: 0xa4503c, w: 3, d: 4 },
  { pos: [-1, 3, -3], rotY: -0.4,          roofColor: 0x3d4a6b, w: 2.6, d: 3.4 },
  { pos: [-5, 3, 0.5], rotY: Math.PI * 0.6, roofColor: 0x3a5a40, w: 2.4, d: 3.0 },
] as const;

for (const cfg of houseConfigs) {
  const h = createHouse({
    width: cfg.w,
    depth: cfg.d,
    roofColor: cfg.roofColor,
  });
  h.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  h.rotation.y = cfg.rotY;
  scene.add(h);
}
```

- [ ] **Step 3: Run dev server and verify**

```bash
bun run dev
```
Expected:
- Three half-timbered houses with red, blue, and green roofs sit clustered near the tower. Each casts long warm shadows across the grass.

- [ ] **Step 4: Commit**

```bash
git add src/buildings/house.ts src/main.ts
git commit -m "feat: procedural medieval houses"
```

---

## Task 9: Stone Bridge

**Files:**
- Create: `src/buildings/bridge.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/buildings/bridge.ts`**

```ts
import * as THREE from 'three';
import { SUNSET_PALETTE } from '../lighting';

export function createBridge(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bridge';

  const stoneMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.stone, roughness: 0.9 });
  const stoneDarkMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.stoneDark, roughness: 0.9 });

  // Span: 5 long, 1.6 wide, 0.4 thick
  const span = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, 1.6), stoneMat);
  span.position.y = 0.5;
  span.castShadow = span.receiveShadow = true;
  g.add(span);

  // Two railings
  for (const sz of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 0.18), stoneDarkMat);
    rail.position.set(0, 0.95, sz * 0.7);
    rail.castShadow = true;
    g.add(rail);
  }

  // Two abutments (chunky boxes at each end)
  for (const sx of [-1, 1]) {
    const ab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 1.8), stoneMat);
    ab.position.set(sx * 2.4, 0.35, 0);
    ab.castShadow = ab.receiveShadow = true;
    g.add(ab);
  }

  return g;
}
```

- [ ] **Step 2: Place the bridge across the river in `src/main.ts`**

```ts
import { createBridge } from './buildings/bridge';

const bridge = createBridge();
bridge.position.set(2, 0.5, 2);     // straddle the diagonal river near origin
bridge.rotation.y = Math.PI / 4;    // align with river diagonal
scene.add(bridge);
```

- [ ] **Step 3: Run dev server and verify**

A pale stone bridge straddles the river near the center of the island, with low railings and chunky abutments anchoring it on both banks.

- [ ] **Step 4: Commit**

```bash
git add src/buildings/bridge.ts src/main.ts
git commit -m "feat: procedural stone bridge"
```

---

## Task 10: Dock and Ship

**Files:**
- Create: `src/buildings/dock.ts`
- Create: `src/buildings/ship.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/buildings/dock.ts`**

```ts
import * as THREE from 'three';
import { SUNSET_PALETTE } from '../lighting';

export function createDock(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'dock';

  const planks = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.wood, roughness: 0.9 });
  const piles = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.woodDark, roughness: 0.9 });

  // Deck: 6 wide planks
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 2.4), planks);
  deck.position.y = 0.3;
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);

  // Pilings
  for (const sx of [-2.5, -0.8, 0.8, 2.5]) {
    for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.2, 0.18), piles);
      p.position.set(sx, -0.3, sz);
      p.castShadow = true;
      g.add(p);
    }
  }

  return g;
}
```

- [ ] **Step 2: Write `src/buildings/ship.ts`**

```ts
import * as THREE from 'three';
import { SUNSET_PALETTE } from '../lighting';

export function createShip(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ship';

  const hullMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.woodDark, roughness: 0.85 });
  const deckMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.wood, roughness: 0.85 });
  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xefe4cc,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const flagMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.flag, roughness: 0.6 });

  // Hull (3 stacked boxes with decreasing width = simple chamfer)
  for (const [w, h, d, y] of [
    [3.6, 0.5, 1.4, 0.0],
    [4.2, 0.5, 1.6, 0.5],
    [3.2, 0.4, 1.4, 0.95],
  ] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), hullMat);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }

  // Deck plate
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.4), deckMat);
  deck.position.y = 1.18;
  g.add(deck);

  // Bowsprit prow tip
  const prow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.2), hullMat);
  prow.position.set(2.0, 0.5, 0);
  g.add(prow);

  // Mast
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4, 0.16), deckMat);
  mast.position.y = 3.2;
  g.add(mast);

  // Yard (cross beam)
  const yard = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 0.1), deckMat);
  yard.position.y = 4.2;
  g.add(yard);

  // Sail (slightly curved by simple scale on Y)
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.8), sailMat);
  sail.position.set(0, 3.2, 0);
  sail.rotation.y = Math.PI / 2;
  g.add(sail);

  // Top flag
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), deckMat);
  pole.position.y = 5.4;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.03), flagMat);
  flag.position.set(0.32, 5.55, 0);
  g.add(flag);

  return g;
}
```

- [ ] **Step 3: Place dock and ship in `src/main.ts`**

```ts
import { createDock } from './buildings/dock';
import { createShip } from './buildings/ship';

const dock = createDock();
dock.position.set(-7, 0, 11); // along the south coast
dock.rotation.y = Math.PI / 2;
scene.add(dock);

const ship = createShip();
ship.position.set(-9.5, 1.0, 11);
ship.rotation.y = Math.PI / 2;
scene.add(ship);
```

- [ ] **Step 4: Run dev server and verify**

A wooden dock juts out from the south shore, and a small sailing ship is moored alongside it with a beige sail and a blue pennant.

- [ ] **Step 5: Commit**

```bash
git add src/buildings/dock.ts src/buildings/ship.ts src/main.ts
git commit -m "feat: dock and sailing ship"
```

---

## Task 11: Trees (Instanced) — TDD on placement

**Files:**
- Create: `src/trees.ts`
- Create: `tests/trees.test.ts`
- Modify: `src/main.ts`

The placement function `pickTreePositions` is deterministic and pure — easy to test. The actual mesh construction is verified visually.

- [ ] **Step 1: Write the failing placement test**

`tests/trees.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pickTreePositions } from '../src/trees';

describe('pickTreePositions', () => {
  it('returns the requested count', () => {
    const pts = pickTreePositions(30, 1234);
    expect(pts.length).toBe(30);
  });

  it('is deterministic for the same seed', () => {
    const a = pickTreePositions(20, 7);
    const b = pickTreePositions(20, 7);
    expect(a).toEqual(b);
  });

  it('keeps points away from the river center line', () => {
    const pts = pickTreePositions(100, 99);
    for (const [x, , z] of pts) {
      const distToRiver = Math.abs(x - z) / Math.SQRT2;
      expect(distToRiver).toBeGreaterThan(1.6);
    }
  });

  it('keeps points within the island radius', () => {
    const pts = pickTreePositions(100, 5);
    for (const [x, , z] of pts) {
      expect(Math.sqrt(x * x + z * z)).toBeLessThan(13);
    }
  });
});
```

- [ ] **Step 2: Run the test to see it fail**

```bash
bun run test
```
Expected: FAIL — `pickTreePositions` not defined.

- [ ] **Step 3: Write `src/trees.ts`**

```ts
import * as THREE from 'three';
import { mulberry32 } from './utils';
import { SUNSET_PALETTE } from './lighting';

const ISLAND_R = 13;
const RIVER_BUFFER = 1.6;

/**
 * Returns `count` (x, y, z) tuples sampled inside the island bounds, away from
 * the river. y is set to a placeholder height (3) because terrain top is roughly
 * at y=3 on the higher plateau.
 */
export function pickTreePositions(count: number, seed: number): [number, number, number][] {
  const rng = mulberry32(seed);
  const out: [number, number, number][] = [];
  let attempts = 0;
  while (out.length < count && attempts < count * 200) {
    attempts++;
    const r = Math.sqrt(rng()) * (ISLAND_R - 1.0);
    const t = rng() * Math.PI * 2;
    const x = Math.cos(t) * r;
    const z = Math.sin(t) * r;
    const distToRiver = Math.abs(x - z) / Math.SQRT2;
    if (distToRiver < RIVER_BUFFER) continue;
    out.push([x, 3, z]);
  }
  return out;
}

export function createTrees(count = 32, seed = 4242): THREE.Group {
  const g = new THREE.Group();
  g.name = 'trees';

  const trunkMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.trunk, roughness: 0.95 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.foliage, roughness: 0.9 });
  const foliageDarkMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.foliageDark, roughness: 0.9 });

  const trunkGeo = new THREE.BoxGeometry(0.4, 1.4, 0.4);
  const blobGeo = new THREE.BoxGeometry(1.4, 1.0, 1.4);
  const blobSmallGeo = new THREE.BoxGeometry(1.0, 0.8, 1.0);

  const positions = pickTreePositions(count, seed);

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const blobs = new THREE.InstancedMesh(blobGeo, foliageMat, positions.length);
  const tops = new THREE.InstancedMesh(blobSmallGeo, foliageDarkMat, positions.length);
  trunks.castShadow = trunks.receiveShadow = true;
  blobs.castShadow = blobs.receiveShadow = true;
  tops.castShadow = tops.receiveShadow = true;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const rng = mulberry32(seed + 1);

  positions.forEach(([x, y, z], i) => {
    const yaw = rng() * Math.PI * 2;
    const sc = 0.85 + rng() * 0.4;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    s.set(sc, sc, sc);

    m.compose(new THREE.Vector3(x, y + 0.7 * sc, z), q, s);
    trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, y + 1.5 * sc, z), q, s);
    blobs.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(x, y + 2.1 * sc, z), q, s);
    tops.setMatrixAt(i, m);
  });
  trunks.instanceMatrix.needsUpdate = true;
  blobs.instanceMatrix.needsUpdate = true;
  tops.instanceMatrix.needsUpdate = true;

  g.add(trunks, blobs, tops);
  return g;
}
```

- [ ] **Step 4: Run all tests**

```bash
bun run test
```
Expected: PASS, 9 tests total green.

- [ ] **Step 5: Add trees to `src/main.ts`**

```ts
import { createTrees } from './trees';

scene.add(createTrees(32, 4242));
```

- [ ] **Step 6: Run dev server and verify**

About 30 stylized trees (dark trunk, two-block green canopy) are scattered across the island, none crossing the river. The grouping should look organic.

- [ ] **Step 7: Commit**

```bash
git add src/trees.ts tests/trees.test.ts src/main.ts
git commit -m "feat: instanced trees with deterministic placement"
```

---

## Task 12: Pseudo-Voxel Material (Normal Quantization + Color Posterization)

This is the first half of the "voxel look" — applied to every standard material in the scene by patching the shader chunks via `onBeforeCompile`.

**Files:**
- Create: `src/voxel-material.ts`
- Modify: every factory file that builds materials (`src/lighting.ts`, `src/terrain.ts`, `src/water.ts`, `src/trees.ts`, `src/buildings/*.ts`) — see Step 4.

- [ ] **Step 1: Write `src/voxel-material.ts`**

```ts
import * as THREE from 'three';

/**
 * Mutates a MeshStandardMaterial so its fragment shader:
 *   1) snaps the normal vector to its dominant axis (±X/Y/Z) before lighting,
 *      producing flat per-face shading even on smoothed geometry,
 *   2) posterizes the final RGB by `levels` steps for a chunky color feel.
 *
 * Returns the same material reference (for chaining).
 */
export function voxelize<M extends THREE.MeshStandardMaterial>(mat: M, levels = 6): M {
  mat.flatShading = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPosterLevels = { value: levels };

    // 1) Normal quantization just before lighting evaluation.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      /* glsl */ `
        #include <normal_fragment_begin>
        {
          vec3 absN = abs(normal);
          float maxC = max(max(absN.x, absN.y), absN.z);
          vec3 q = vec3(0.0);
          if (absN.x >= maxC - 1e-5) q.x = sign(normal.x);
          else if (absN.y >= maxC - 1e-5) q.y = sign(normal.y);
          else q.z = sign(normal.z);
          normal = normalize(q);
        }
      `,
    );

    // 2) Posterize at the end of the lit fragment shader.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
        #include <dithering_fragment>
        gl_FragColor.rgb = floor(gl_FragColor.rgb * uPosterLevels) / uPosterLevels;
      `,
    );

    shader.fragmentShader =
      `uniform float uPosterLevels;\n` + shader.fragmentShader;
  };
  // Force a recompile if the material was already cached.
  mat.needsUpdate = true;
  return mat;
}
```

- [ ] **Step 2: Apply `voxelize` everywhere a `MeshStandardMaterial` is created**

For each material constructor in:
- `src/terrain.ts`
- `src/water.ts`
- `src/trees.ts`
- `src/buildings/tower.ts`
- `src/buildings/house.ts`
- `src/buildings/bridge.ts`
- `src/buildings/dock.ts`
- `src/buildings/ship.ts`

Wrap the creation. Example for `terrain.ts`:
```ts
import { voxelize } from './voxel-material';
// before:
// const grassMat = new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.grass, roughness: 0.95 });
// after:
const grassMat = voxelize(new THREE.MeshStandardMaterial({ color: SUNSET_PALETTE.grass, roughness: 0.95 }));
```
Repeat for `grassDarkMat`, `sandMat`, every `MeshStandardMaterial(...)` in the building files, the trees' three materials, and the water materials.

**Do NOT voxelize** the sky `ShaderMaterial` (it isn't a MeshStandardMaterial and uses a custom shader anyway).

- [ ] **Step 3: Run dev server and verify**

```bash
bun run dev
```
Expected:
- All buildings, terrain, trees, and water now show flat per-face shading (no smooth normals).
- Color banding is visible — a stone wall now has 2-3 distinct shade steps rather than a smooth gradient.
- The sky still looks smooth.

- [ ] **Step 4: Commit**

```bash
git add src/voxel-material.ts src/terrain.ts src/water.ts src/trees.ts src/buildings/*.ts
git commit -m "feat: pseudo-voxel shader (normal quantization + posterize)"
```

---

## Task 13: Outline Edge Effect (Custom Post-Processing Pass)

This is the second half of the voxel look — black outlines along depth discontinuities.

**Files:**
- Create: `src/outline-effect.ts`

(Composer wiring happens in Task 14.)

- [ ] **Step 1: Write `src/outline-effect.ts`**

```ts
import { Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Color } from 'three';

const fragmentShader = /* glsl */ `
  uniform float uThickness;
  uniform float uDepthThreshold;
  uniform vec3  uColor;

  // postprocessing v6 supplies depth as a fragment-shader argument when
  // EffectAttribute.DEPTH is declared. We sample neighbors with readDepth.
  float readDepth(vec2 uv) { return texture2D(depthBuffer, uv).x; }

  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec2 px = uThickness / resolution;
    float d0 = depth;
    float d1 = readDepth(uv + vec2(px.x, 0.0));
    float d2 = readDepth(uv - vec2(px.x, 0.0));
    float d3 = readDepth(uv + vec2(0.0, px.y));
    float d4 = readDepth(uv - vec2(0.0, px.y));
    float diff = abs(d1 - d0) + abs(d2 - d0) + abs(d3 - d0) + abs(d4 - d0);
    float edge = step(uDepthThreshold, diff);
    outputColor = vec4(mix(inputColor.rgb, uColor, edge), inputColor.a);
  }
`;

export class OutlineEdgeEffect extends Effect {
  constructor(opts: { thickness?: number; depthThreshold?: number; color?: number } = {}) {
    super('OutlineEdgeEffect', fragmentShader, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, Uniform>([
        ['uThickness',      new Uniform(opts.thickness ?? 1.2)],
        ['uDepthThreshold', new Uniform(opts.depthThreshold ?? 0.0008)],
        ['uColor',          new Uniform(new Color(opts.color ?? 0x000000))],
      ]),
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/outline-effect.ts
git commit -m "feat: depth-based outline edge post effect"
```

---

## Task 14: Full Post-Processing Pipeline

Wire the EffectComposer with SSAO, Bloom, Tilt-Shift, LUT/grade, Outline, Vignette, and SMAA.

**Files:**
- Create: `src/post.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Write `src/post.ts`**

```ts
import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  SMAAEffect,
  SMAAPreset,
  BloomEffect,
  KernelSize,
  SSAOEffect,
  TiltShiftEffect,
  VignetteEffect,
  HueSaturationEffect,
  BrightnessContrastEffect,
  NormalPass,
} from 'postprocessing';
import { OutlineEdgeEffect } from './outline-effect';

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): EffectComposer {
  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });

  composer.addPass(new RenderPass(scene, camera));

  const normalPass = new NormalPass(scene, camera);
  composer.addPass(normalPass);

  const ssao = new SSAOEffect(camera, normalPass.texture, {
    samples: 16,
    rings: 4,
    distanceThreshold: 0.5,
    distanceFalloff: 0.1,
    rangeThreshold: 0.0015,
    rangeFalloff: 0.001,
    luminanceInfluence: 0.7,
    radius: 0.06,
    intensity: 1.0,
    bias: 0.025,
  });

  const outline = new OutlineEdgeEffect({
    thickness: 1.2,
    depthThreshold: 0.0009,
    color: 0x121212,
  });

  const bloom = new BloomEffect({
    intensity: 0.55,
    luminanceThreshold: 0.85,
    luminanceSmoothing: 0.2,
    kernelSize: KernelSize.LARGE,
  });

  const tilt = new TiltShiftEffect({
    offset: 0.0,
    rotation: 0.0,
    focusArea: 0.4,
    feather: 0.4,
  });

  // Sunset color grading: pull shadows blue, push highlights orange, bump saturation
  const hue = new HueSaturationEffect({ hue: 0.0, saturation: 0.12 });
  const bc = new BrightnessContrastEffect({ brightness: -0.02, contrast: 0.08 });

  const vignette = new VignetteEffect({ darkness: 0.45, offset: 0.35 });
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });

  composer.addPass(new EffectPass(camera, ssao, outline));
  composer.addPass(new EffectPass(camera, bloom, tilt, hue, bc, vignette));
  composer.addPass(new EffectPass(camera, smaa));

  return composer;
}
```

- [ ] **Step 2: Switch the render loop in `src/main.ts` to use the composer**

Replace the renderer.setAnimationLoop call so it renders via the composer:
```ts
import { createComposer } from './post';

const composer = createComposer(renderer, scene, camera);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  composer.render();
});
```

(Remove the old `renderer.render(scene, camera)` call.)

- [ ] **Step 3: Run dev server and verify**

```bash
bun run dev
```
Expected:
- Sharp dark outlines along the silhouettes of buildings, trees, terrain steps.
- AO darkens the underside of roofs, eaves, and the inside of crenellations.
- Sunset highlights bloom slightly on bright stone faces.
- Top and bottom thirds of the screen are gently blurred (tilt-shift), giving the diorama feel.
- Subtle vignette around the corners.
- Edges are anti-aliased (no jaggies on tower walls).

- [ ] **Step 4: If any pass throws on init**, check for typos against the import list at the top of `post.ts`. The `postprocessing` package version installed by Task 1 must support `TiltShiftEffect` (v6.30+); upgrade with `bun add postprocessing@latest` if needed and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/post.ts src/main.ts
git commit -m "feat: full post-processing pipeline (SSAO, outline, bloom, tilt-shift, grading, vignette, SMAA)"
```

---

## Task 15: Polish, Camera Framing, README

**Files:**
- Modify: `src/main.ts`
- Create: `README.md`

- [ ] **Step 1: Tune the initial camera framing in `src/main.ts`**

Adjust the camera and OrbitControls so the diorama is centered:
```ts
camera.position.set(28, 24, 28);
controls.target.set(-1, 3, 0);
controls.minDistance = 14;
controls.maxDistance = 70;
```

- [ ] **Step 2: Verify visually with the dev server**

```bash
bun run dev
```
Expected: on first load, the entire island fits comfortably in the frame with the tower in the upper-left third and the dock/ship in the lower-left. Rotate, pan, and zoom feel natural and constrained.

- [ ] **Step 3: Write `README.md`**

```markdown
# Voxel Diorama

A static dusk-lit fantasy diorama rendered in the browser with Three.js.

All geometry is generated procedurally in TypeScript — no external models, no
textures, no images. A custom shader gives the scene a pseudo-voxel feel via
normal quantization, color posterization, and a depth-based outline pass.

## Quick start

```bash
bun install
bun run dev      # http://localhost:5173/
bun run test     # vitest
bun run build    # production bundle in dist/
```

## Controls

- Left-drag — orbit
- Right-drag (or Shift+left-drag) — pan
- Mouse wheel — zoom

## Stack

- Bun, Vite, TypeScript
- Three.js (WebGL2)
- pmndrs/postprocessing (SSAO, Bloom, Tilt-Shift, SMAA, custom outline)

## Layout

- `src/main.ts` — entry, renderer, camera, controls, render loop
- `src/lighting.ts`, `src/sky.ts` — sunset palette, sun, hemi, fog, gradient sky
- `src/terrain.ts` — voxel island
- `src/water.ts` — sea + river surfaces
- `src/buildings/*.ts` — tower, house, bridge, dock, ship
- `src/trees.ts` — instanced foliage
- `src/voxel-material.ts` — MeshStandardMaterial pseudo-voxel patch
- `src/outline-effect.ts` — depth-edge post pass
- `src/post.ts` — EffectComposer wiring
```

- [ ] **Step 4: Run a final production build sanity check**

```bash
bun run build
bun run preview
```
Expected: build completes without TypeScript errors; preview at the printed URL renders identically to dev.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts README.md
git commit -m "polish: camera framing and README"
```

---

## Self-Review Checklist (run before declaring done)

- [ ] All tasks above committed individually (15 commits).
- [ ] `bun run test` passes (9 tests).
- [ ] `bun run build` succeeds with zero TypeScript errors.
- [ ] Dev server: full diorama visible in the initial frame.
- [ ] Sunset palette consistent (no neon-blue or pure-white surfaces).
- [ ] Outlines visible on building silhouettes.
- [ ] Tilt-shift visibly blurs top and bottom of frame.
- [ ] Camera respects min/max distance and polar angle limits.
- [ ] Trees never overlap the river (test enforces this).
- [ ] Bridge straddles the river.
- [ ] Ship is moored at the dock.

---

**End of plan.**
