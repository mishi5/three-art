# Pose × Audio Particle Art — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モノクローム 3D 空間で観る人の身体（13 関節）と音楽が織りなす抽象的な点群作品を Bun + TypeScript + Three.js + MediaPipe で実装する。

**Architecture:** 7 モジュール構成。`AudioInput`（FileSource / MicSource、AnalyserNode で帯域抽出）と `PoseInput`（MediaPipe Pose Landmarker）の入力を `JointAnchors` で 13 関節に絞り平滑化。`PointCloud`（関節周りの局所点群、~5k 点）と `FragmentField`（空間を漂う細片、~10k）が `ShaderMaterial` で描画され、毎フレーム joints/audio uniform を受け取って表現を変調する。

**Tech Stack:**
- Bun（ランタイム + バンドラ + テストランナー、Vite 不使用）
- TypeScript（strict）
- Three.js
- @mediapipe/tasks-vision（Pose Landmarker、Tasks API）
- GLSL（`?raw` ではなく `with { type: "text" }` で text import）

**Spec:** `docs/superpowers/specs/2026-04-29-pose-audio-particle-art-design.md`

**Worktree:** このプランは `feat/pose-particles` ブランチ・`/Users/shun/dev/three-art/.worktrees/pose-particles` で実装する。

---

## File Map

すべて `.worktrees/pose-particles/` 起点。

```
package.json
tsconfig.json
pose-particles.html              # 作品の HTML エントリ
public/
  pose-particles/
    audio/sample.mp3             # サンプル楽曲（手動配置）
src/
  pose-particles/
    main.ts                      # ブートストラップ
    App.ts                       # オーケストレータ（scene/camera/renderer/loop）
    types.ts                     # AudioFeatures, Joint, JointName など
    audio/
      AudioInput.ts              # interface
      AudioAnalyzer.ts           # AnalyserNode → AudioFeatures
      AudioAnalyzer.test.ts      # bass/mid/treble 帯域抽出のテスト
      FileAudioSource.ts         # ファイル → AudioBufferSourceNode
      MicAudioSource.ts          # マイク → MediaStreamAudioSourceNode
    pose/
      PoseInput.ts               # MediaPipe ラッパー
      JointAnchors.ts            # 13関節抽出 + lerp 平滑化
      JointAnchors.test.ts       # 平滑化数値テスト
    visuals/
      PointCloud.ts
      FragmentField.ts
      shaders/
        pointCloud.vert.glsl
        pointCloud.frag.glsl
        fragmentField.vert.glsl
        fragmentField.frag.glsl
    ui/
      UI.ts                      # 開始オーバーレイ + コントロールパネル
```

責務の境界：
- **audio/** は Web Audio のみ依存（Three.js 非依存）
- **pose/** は MediaPipe + 数値変換のみ
- **visuals/** は Three.js + GLSL のみ
- **App.ts** がそれらを束ねる
- **ui/** は DOM のみ、App には公開メソッドで指示する

---

## Task 1: プロジェクト初期化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `pose-particles.html`
- Create: `src/pose-particles/main.ts`
- Create: `public/pose-particles/audio/.gitkeep`

- [ ] **Step 1: package.json を作成**

```json
{
  "name": "three-art-pose-particles",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --hot ./pose-particles.html",
    "build": "bun build ./pose-particles.html --outdir dist --minify",
    "test": "bun test"
  },
  "dependencies": {
    "@mediapipe/tasks-vision": "^0.10.0",
    "three": "^0.170.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "@types/three": "^0.170.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: tsconfig.json を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "types": ["@types/bun"],
    "allowImportingTsExtensions": false,
    "verbatimModuleSyntax": false
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: pose-particles.html を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pose × Audio Particles</title>
  <style>
    html, body { margin: 0; padding: 0; background: #000; overflow: hidden; height: 100%; font-family: system-ui, sans-serif; color: #fff; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="canvas"></canvas>
  <div id="ui-root"></div>
  <script type="module" src="./src/pose-particles/main.ts"></script>
</body>
</html>
```

- [ ] **Step 4: src/pose-particles/main.ts を仮で作成**

```ts
console.log("pose-particles bootstrap");
```

- [ ] **Step 5: public/pose-particles/audio/.gitkeep を作成**

空ファイルを置く：

```bash
mkdir -p public/pose-particles/audio
touch public/pose-particles/audio/.gitkeep
```

- [ ] **Step 6: 依存をインストール**

```bash
bun install
```

期待：`node_modules/` が生成され、エラーなし。

- [ ] **Step 7: dev サーバ起動を確認**

```bash
bun --hot ./pose-particles.html
```

期待：Bun が `http://localhost:3000`（または別ポート）で配信し、ブラウザで真っ黒の画面とコンソールに `pose-particles bootstrap` が出る。確認後 Ctrl+C で停止。

- [ ] **Step 8: コミット**

```bash
git add package.json bun.lock tsconfig.json pose-particles.html src/ public/
git commit -m "feat: bootstrap bun + ts + three project for pose-particles"
```

---

## Task 2: 共通型定義

**Files:**
- Create: `src/pose-particles/types.ts`

- [ ] **Step 1: types.ts を作成**

```ts
export type AudioFeatures = {
  /** 全体音量 0..1 */
  volume: number;
  /** 60-250Hz 帯域強度 0..1 */
  bass: number;
  /** 250-2000Hz 帯域強度 0..1 */
  mid: number;
  /** 2-8kHz 帯域強度 0..1 */
  treble: number;
  /** 生 FFT（0..1 正規化、長さ=fftSize/2） */
  fft: Float32Array;
};

export const DEFAULT_AUDIO_FEATURES: AudioFeatures = {
  volume: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  fft: new Float32Array(0),
};

/** 抽出する 13 関節の MediaPipe ランドマーク番号 */
export const JOINT_INDICES = [
  0,  // nose
  11, // left shoulder
  12, // right shoulder
  13, // left elbow
  14, // right elbow
  15, // left wrist
  16, // right wrist
  23, // left hip
  24, // right hip
  25, // left knee
  26, // right knee
  27, // left ankle
  28, // right ankle
] as const;

export const NUM_JOINTS = JOINT_INDICES.length; // 13

/** 13 関節の 3D 位置（メートル単位、シーン座標系） */
export type Joints = Float32Array; // length = NUM_JOINTS * 3

export function makeEmptyJoints(): Joints {
  return new Float32Array(NUM_JOINTS * 3);
}
```

- [ ] **Step 2: コミット**

```bash
git add src/pose-particles/types.ts
git commit -m "feat(types): add shared AudioFeatures and Joints types"
```

---

## Task 3: AudioAnalyzer（テスト先行）

**Files:**
- Create: `src/pose-particles/audio/AudioAnalyzer.ts`
- Create: `src/pose-particles/audio/AudioAnalyzer.test.ts`

`AudioAnalyzer` は `AnalyserNode` を受け取り、毎フレーム `getByteFrequencyData()` を呼んで FFT 配列を bass/mid/treble に集計する。

- [ ] **Step 1: 失敗するテストを書く**

`src/pose-particles/audio/AudioAnalyzer.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { computeBands } from "./AudioAnalyzer";

describe("computeBands", () => {
  const sampleRate = 48000;
  const fftSize = 2048;

  it("returns zeros for silence", () => {
    const bins = new Uint8Array(fftSize / 2); // 全部 0
    const r = computeBands(bins, sampleRate, fftSize);
    expect(r.volume).toBe(0);
    expect(r.bass).toBe(0);
    expect(r.mid).toBe(0);
    expect(r.treble).toBe(0);
  });

  it("isolates bass when only low bins are loud", () => {
    const bins = new Uint8Array(fftSize / 2);
    // 60-250Hz 帯域の bin index：~ 2..10 (with sampleRate=48000, fftSize=2048)
    for (let i = 2; i <= 10; i++) bins[i] = 255;
    const r = computeBands(bins, sampleRate, fftSize);
    expect(r.bass).toBeGreaterThan(0.9);
    expect(r.mid).toBe(0);
    expect(r.treble).toBe(0);
  });

  it("isolates treble when only high bins are loud", () => {
    const bins = new Uint8Array(fftSize / 2);
    // 2-8kHz: bin index ~ 85..341
    for (let i = 85; i <= 341; i++) bins[i] = 255;
    const r = computeBands(bins, sampleRate, fftSize);
    expect(r.treble).toBeGreaterThan(0.9);
    expect(r.bass).toBe(0);
  });

  it("volume is the global average", () => {
    const bins = new Uint8Array(fftSize / 2).fill(128);
    const r = computeBands(bins, sampleRate, fftSize);
    expect(r.volume).toBeCloseTo(128 / 255, 2);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
bun test src/pose-particles/audio/AudioAnalyzer.test.ts
```

期待：`computeBands` が見つからずエラー。

- [ ] **Step 3: AudioAnalyzer.ts を実装**

```ts
import type { AudioFeatures } from "../types";

/** 帯域定義（Hz） */
const BANDS = {
  bass: [60, 250] as const,
  mid: [250, 2000] as const,
  treble: [2000, 8000] as const,
};

function hzToBin(hz: number, sampleRate: number, fftSize: number): number {
  return Math.round((hz / (sampleRate / 2)) * (fftSize / 2));
}

function avgBand(
  bins: Uint8Array,
  lo: number,
  hi: number,
  sampleRate: number,
  fftSize: number,
): number {
  const a = hzToBin(lo, sampleRate, fftSize);
  const b = Math.min(hzToBin(hi, sampleRate, fftSize), bins.length - 1);
  if (b < a) return 0;
  let sum = 0;
  for (let i = a; i <= b; i++) sum += bins[i] ?? 0;
  return sum / (b - a + 1) / 255; // 0..1
}

export function computeBands(
  bins: Uint8Array,
  sampleRate: number,
  fftSize: number,
): Pick<AudioFeatures, "volume" | "bass" | "mid" | "treble"> {
  let volSum = 0;
  for (let i = 0; i < bins.length; i++) volSum += bins[i] ?? 0;
  return {
    volume: volSum / bins.length / 255,
    bass: avgBand(bins, BANDS.bass[0], BANDS.bass[1], sampleRate, fftSize),
    mid: avgBand(bins, BANDS.mid[0], BANDS.mid[1], sampleRate, fftSize),
    treble: avgBand(bins, BANDS.treble[0], BANDS.treble[1], sampleRate, fftSize),
  };
}

export class AudioAnalyzer {
  private analyser: AnalyserNode;
  private bins: Uint8Array;
  private fftBuf: Float32Array;

  constructor(ctx: AudioContext, fftSize: number = 2048, smoothing: number = 0.7) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = smoothing;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.fftBuf = new Float32Array(this.analyser.frequencyBinCount);
  }

  /** 入力ノードを analyser に接続する（外部から） */
  get input(): AudioNode {
    return this.analyser;
  }

  read(sampleRate: number): AudioFeatures {
    this.analyser.getByteFrequencyData(this.bins);
    const bands = computeBands(this.bins, sampleRate, this.analyser.fftSize);
    for (let i = 0; i < this.bins.length; i++) {
      this.fftBuf[i] = (this.bins[i] ?? 0) / 255;
    }
    return { ...bands, fft: this.fftBuf };
  }
}
```

- [ ] **Step 4: テスト再実行で全 PASS を確認**

```bash
bun test src/pose-particles/audio/AudioAnalyzer.test.ts
```

期待：4 件全て PASS。

- [ ] **Step 5: コミット**

```bash
git add src/pose-particles/audio/AudioAnalyzer.ts src/pose-particles/audio/AudioAnalyzer.test.ts
git commit -m "feat(audio): add AudioAnalyzer with bass/mid/treble band extraction"
```

---

## Task 4: AudioInput interface + FileAudioSource

**Files:**
- Create: `src/pose-particles/audio/AudioInput.ts`
- Create: `src/pose-particles/audio/FileAudioSource.ts`

- [ ] **Step 1: AudioInput.ts でインターフェース定義**

```ts
import type { AudioFeatures } from "../types";

export interface AudioInput {
  /** 音声を開始（user gesture 内で呼ぶ）*/
  start(): Promise<void>;
  /** 停止 + リソース解放 */
  stop(): void;
  /** 現在の音響特徴量を取得（フレームごとに呼ぶ）*/
  read(): AudioFeatures;
}
```

- [ ] **Step 2: FileAudioSource.ts を実装**

```ts
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

export class FileAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private playing = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
  }

  async loadFromUrl(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch audio: ${res.status}`);
    const arr = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
  }

  async loadFromFile(file: File): Promise<void> {
    const arr = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
  }

  async start(): Promise<void> {
    if (!this.buffer) throw new Error("no audio buffer loaded");
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.loop = true;
    this.source.connect(this.analyzer.input).connect(this.ctx.destination);
    this.source.start(0);
    this.playing = true;
  }

  stop(): void {
    if (this.source) {
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  read(): AudioFeatures {
    if (!this.playing) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }
}
```

- [ ] **Step 3: ビルド確認**

```bash
bunx tsc --noEmit
```

期待：型エラーなし。

- [ ] **Step 4: コミット**

```bash
git add src/pose-particles/audio/AudioInput.ts src/pose-particles/audio/FileAudioSource.ts
git commit -m "feat(audio): add AudioInput interface and FileAudioSource"
```

---

## Task 5: MicAudioSource

**Files:**
- Create: `src/pose-particles/audio/MicAudioSource.ts`

- [ ] **Step 1: MicAudioSource.ts を実装**

```ts
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

export class MicAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;
  private active = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    this.node = this.ctx.createMediaStreamSource(this.stream);
    // マイクは destination には繋がない（ハウリング防止）
    this.node.connect(this.analyzer.input);
    this.active = true;
  }

  stop(): void {
    if (this.node) {
      this.node.disconnect();
      this.node = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.active = false;
  }

  read(): AudioFeatures {
    if (!this.active) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }
}
```

- [ ] **Step 2: ビルド確認**

```bash
bunx tsc --noEmit
```

- [ ] **Step 3: コミット**

```bash
git add src/pose-particles/audio/MicAudioSource.ts
git commit -m "feat(audio): add MicAudioSource using getUserMedia"
```

---

## Task 6: PoseInput（MediaPipe ラッパー）

**Files:**
- Create: `src/pose-particles/pose/PoseInput.ts`

- [ ] **Step 1: PoseInput.ts を実装**

```ts
import {
  FilesetResolver,
  PoseLandmarker,
  type PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type PoseCallback = (result: PoseLandmarkerResult) => void;

export class PoseInput {
  private video: HTMLVideoElement;
  private landmarker: PoseLandmarker | null = null;
  private stream: MediaStream | null = null;
  private rafId: number | null = null;
  private lastVideoTime = -1;

  constructor(private onResult: PoseCallback) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    // 表示しない（抽象化された身体を貫徹）
    this.video.style.display = "none";
    document.body.appendChild(this.video);
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numPoses: 1,
      outputSegmentationMasks: false,
    });

    this.loop();
  }

  private loop = (): void => {
    if (!this.landmarker) return;
    const now = performance.now();
    if (this.video.currentTime !== this.lastVideoTime && this.video.readyState >= 2) {
      this.lastVideoTime = this.video.currentTime;
      const result = this.landmarker.detectForVideo(this.video, now);
      this.onResult(result);
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.video.srcObject = null;
    this.video.remove();
  }
}
```

- [ ] **Step 2: ビルド確認**

```bash
bunx tsc --noEmit
```

- [ ] **Step 3: コミット**

```bash
git add src/pose-particles/pose/PoseInput.ts
git commit -m "feat(pose): add PoseInput wrapping MediaPipe Pose Landmarker"
```

---

## Task 7: JointAnchors（テスト先行）

**Files:**
- Create: `src/pose-particles/pose/JointAnchors.ts`
- Create: `src/pose-particles/pose/JointAnchors.test.ts`

`JointAnchors` は MediaPipe の生 landmarks（33点 of `{x,y,z}`）を受け取り、`JOINT_INDICES` の 13 関節に絞って `Float32Array(39)` に詰め、フレームごとに lerp で平滑化する。

座標変換：MediaPipe の `worldLandmarks` はメートル単位の 3D（観測者からみて x: 右、y: 下、z: 奥）。シーン座標系は y-up なので **y を反転**する。

- [ ] **Step 1: 失敗するテストを書く**

`src/pose-particles/pose/JointAnchors.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { JOINT_INDICES, makeEmptyJoints } from "../types";
import { JointAnchors } from "./JointAnchors";

type Lm = { x: number; y: number; z: number; visibility?: number };

function makeLandmarks(filler: (idx: number) => Lm): Lm[] {
  return Array.from({ length: 33 }, (_, i) => filler(i));
}

describe("JointAnchors", () => {
  it("starts with zero joints", () => {
    const a = new JointAnchors();
    const j = a.getSmoothed();
    expect(j.length).toBe(13 * 3);
    expect(Array.from(j).every((v) => v === 0)).toBe(true);
  });

  it("flips y axis when ingesting MediaPipe coords", () => {
    const a = new JointAnchors();
    a.update(makeLandmarks((i) => ({ x: 0, y: 0.5, z: 0 }))); // y=0.5 (下方)
    a.tick(1.0); // 平滑化を一気に最新へ
    const j = a.getSmoothed();
    // JOINT_INDICES[0] = nose. y成分（index 1）は -0.5 のはず
    expect(j[1]).toBeCloseTo(-0.5, 5);
  });

  it("only extracts the configured joints", () => {
    const a = new JointAnchors();
    a.update(
      makeLandmarks((i) => ({
        x: i === JOINT_INDICES[5] ? 0.9 : 0,
        y: 0,
        z: 0,
      })),
    );
    a.tick(1.0);
    const j = a.getSmoothed();
    expect(j[5 * 3]).toBeCloseTo(0.9, 5); // 6番目の関節 (left wrist) の x
    expect(j[0]).toBe(0); // 1番目 (nose) の x は 0
  });

  it("lerps toward latest at the given factor", () => {
    const a = new JointAnchors();
    a.update(makeLandmarks(() => ({ x: 1, y: 0, z: 0 })));
    a.tick(0.5);
    const j = a.getSmoothed();
    expect(j[0]).toBeCloseTo(0.5, 5); // 0 → 1 を 0.5 lerp
  });
});
```

- [ ] **Step 2: テストを実行して失敗確認**

```bash
bun test src/pose-particles/pose/JointAnchors.test.ts
```

期待：`JointAnchors` import エラー。

- [ ] **Step 3: JointAnchors.ts を実装**

```ts
import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import {
  JOINT_INDICES,
  NUM_JOINTS,
  makeEmptyJoints,
  type Joints,
} from "../types";

type Landmark = { x: number; y: number; z: number; visibility?: number };

/** 既定 lerp 係数（毎フレームの追従強度。0..1） */
const DEFAULT_LERP = 0.25;

export class JointAnchors {
  private smoothed: Joints = makeEmptyJoints();
  private latest: Joints = makeEmptyJoints();
  private hasLatest = false;

  /** MediaPipe の結果（または同型）を取り込む */
  update(landmarks: Landmark[] | PoseLandmarkerResult): void {
    const lms = Array.isArray(landmarks)
      ? landmarks
      : (landmarks.worldLandmarks?.[0] ?? null);
    if (!lms || lms.length < 33) return;
    for (let i = 0; i < NUM_JOINTS; i++) {
      const idx = JOINT_INDICES[i]!;
      const lm = lms[idx];
      if (!lm) continue;
      this.latest[i * 3 + 0] = lm.x;
      this.latest[i * 3 + 1] = -lm.y; // y 反転
      this.latest[i * 3 + 2] = lm.z;
    }
    this.hasLatest = true;
  }

  /** 平滑化を 1 ステップ進める。factor=1 で最新へ即座に追従。*/
  tick(factor: number = DEFAULT_LERP): void {
    if (!this.hasLatest) return;
    for (let i = 0; i < this.smoothed.length; i++) {
      this.smoothed[i] += (this.latest[i]! - this.smoothed[i]!) * factor;
    }
  }

  getSmoothed(): Joints {
    return this.smoothed;
  }
}
```

- [ ] **Step 4: テスト全 PASS を確認**

```bash
bun test src/pose-particles/pose/JointAnchors.test.ts
```

- [ ] **Step 5: コミット**

```bash
git add src/pose-particles/pose/JointAnchors.ts src/pose-particles/pose/JointAnchors.test.ts
git commit -m "feat(pose): add JointAnchors for 13-joint extraction and smoothing"
```

---

## Task 8: App ブートストラップ（黒キャンバス + ループ）

**Files:**
- Create: `src/pose-particles/App.ts`
- Modify: `src/pose-particles/main.ts`

App は scene/camera/renderer/ループを所有。この時点では PointCloud / FragmentField はまだ無く、黒キャンバスが描画される。

- [ ] **Step 1: App.ts を作成**

```ts
import * as THREE from "three";
import type { AudioInput } from "./audio/AudioInput";
import { JointAnchors } from "./pose/JointAnchors";
import { PoseInput } from "./pose/PoseInput";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "./types";

export class App {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly jointAnchors = new JointAnchors();
  private poseInput: PoseInput | null = null;
  private audioInput: AudioInput | null = null;
  private rafId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x000000);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    this.camera.position.set(0, 0, 2.5);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.handleResize();
    window.addEventListener("resize", this.handleResize);
  }

  private handleResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  async startPose(): Promise<void> {
    this.poseInput = new PoseInput((result) => {
      this.jointAnchors.update(result);
    });
    await this.poseInput.start();
  }

  setAudio(audio: AudioInput | null): void {
    this.audioInput?.stop();
    this.audioInput = audio;
  }

  start(): void {
    const tick = (): void => {
      this.rafId = requestAnimationFrame(tick);
      this.jointAnchors.tick();
      const audio: AudioFeatures = this.audioInput?.read() ?? DEFAULT_AUDIO_FEATURES;
      this.update(audio);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  /** サブモジュール更新フック（後の Task で PointCloud/FragmentField を呼ぶ）*/
  protected update(_audio: AudioFeatures): void {
    /* override or extend */
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.poseInput?.stop();
    this.audioInput?.stop();
    window.removeEventListener("resize", this.handleResize);
  }
}
```

- [ ] **Step 2: main.ts を更新**

```ts
import { App } from "./App";

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not found");

const app = new App(canvas);
app.start();

// dev 用：window から触れるように
(window as unknown as { app: App }).app = app;
```

- [ ] **Step 3: dev サーバを起動して黒画面を確認**

```bash
bun --hot ./pose-particles.html
```

ブラウザで開くと、画面いっぱいの真っ黒なキャンバスが表示される（リサイズに追従）。コンソールエラーなし。Ctrl+C で停止。

- [ ] **Step 4: コミット**

```bash
git add src/pose-particles/App.ts src/pose-particles/main.ts
git commit -m "feat(app): bootstrap App with scene/camera/renderer/loop"
```

---

## Task 9: PointCloud（基本版、音なし）

**Files:**
- Create: `src/pose-particles/visuals/shaders/pointCloud.vert.glsl`
- Create: `src/pose-particles/visuals/shaders/pointCloud.frag.glsl`
- Create: `src/pose-particles/visuals/PointCloud.ts`
- Modify: `src/pose-particles/App.ts`

13関節 × 400 = 5200 点を `THREE.Points` で描画。各点は所属関節の周りにガウス分布で配置。この時点では音響特徴は未使用（uniform は宣言するが値は 0 固定）。

- [ ] **Step 1: vertex shader を作成**

`src/pose-particles/visuals/shaders/pointCloud.vert.glsl`:

```glsl
#define MAX_JOINTS 13

uniform vec3 uJoints[MAX_JOINTS];
uniform float uTime;
uniform float uVolume;
uniform float uBass;
uniform float uTreble;
uniform float uPixelRatio;

attribute float aJointIndex;
attribute vec3 aOffset;   // ガウス分布サンプル（関節中心からのオフセット、メートル）
attribute float aSeed;

varying float vAlpha;

void main() {
  int jointIdx = int(aJointIndex + 0.5);
  vec3 jointPos = uJoints[jointIdx];

  // bass で半径膨張（後の Task で使う、今は uBass=0 固定）
  float radius = 1.0 + uBass * 1.5;
  vec3 offset = aOffset * radius;

  // treble で個別シマー
  float shimmer = sin(uTime * 30.0 + aSeed * 100.0) * uTreble * 0.02;
  offset += normalize(aOffset + 0.0001) * shimmer;

  vec3 pos = jointPos + offset;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (3.0 + uVolume * 5.0) * uPixelRatio * (1.0 / -mv.z);

  float d = length(aOffset);
  vAlpha = (1.0 - smoothstep(0.0, 0.15, d)) * (0.5 + uTreble * 0.5);
}
```

- [ ] **Step 2: fragment shader を作成**

`src/pose-particles/visuals/shaders/pointCloud.frag.glsl`:

```glsl
precision mediump float;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float circle = 1.0 - smoothstep(0.4, 0.5, d);
  if (circle < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0), circle * vAlpha);
}
```

- [ ] **Step 3: PointCloud.ts を作成**

```ts
import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import vertexShader from "./shaders/pointCloud.vert.glsl" with { type: "text" };
import fragmentShader from "./shaders/pointCloud.frag.glsl" with { type: "text" };

const POINTS_PER_JOINT = 400;
const SIGMA = 0.08; // メートル

function gaussian(): number {
  // Box–Muller
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export class PointCloud {
  readonly object3D: THREE.Points;
  private material: THREE.ShaderMaterial;
  private jointsUniform: Float32Array; // length 39

  constructor(pixelRatio: number) {
    const total = NUM_JOINTS * POINTS_PER_JOINT;
    const geom = new THREE.BufferGeometry();

    const offsets = new Float32Array(total * 3);
    const indices = new Float32Array(total);
    const seeds = new Float32Array(total);
    for (let j = 0; j < NUM_JOINTS; j++) {
      for (let p = 0; p < POINTS_PER_JOINT; p++) {
        const i = j * POINTS_PER_JOINT + p;
        offsets[i * 3 + 0] = gaussian() * SIGMA;
        offsets[i * 3 + 1] = gaussian() * SIGMA;
        offsets[i * 3 + 2] = gaussian() * SIGMA;
        indices[i] = j;
        seeds[i] = Math.random();
      }
    }
    // dummy position attribute（Three.js は position を要求）
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    geom.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 3));
    geom.setAttribute("aJointIndex", new THREE.BufferAttribute(indices, 1));
    geom.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 4);

    this.jointsUniform = new Float32Array(NUM_JOINTS * 3);

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uJoints: { value: this.toVec3Array(this.jointsUniform) },
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uBass: { value: 0 },
        uTreble: { value: 0 },
        uPixelRatio: { value: pixelRatio },
      },
    });

    this.object3D = new THREE.Points(geom, this.material);
    this.object3D.frustumCulled = false;
  }

  private toVec3Array(flat: Float32Array): THREE.Vector3[] {
    const arr: THREE.Vector3[] = [];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr.push(new THREE.Vector3(flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!));
    }
    return arr;
  }

  update(joints: Joints, audio: AudioFeatures, timeSec: number): void {
    const u = this.material.uniforms;
    const arr = u.uJoints.value as THREE.Vector3[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr[i].set(joints[i * 3]!, joints[i * 3 + 1]!, joints[i * 3 + 2]!);
    }
    u.uTime.value = timeSec;
    u.uVolume.value = audio.volume;
    u.uBass.value = audio.bass;
    u.uTreble.value = audio.treble;
  }
}
```

- [ ] **Step 4: App.ts に PointCloud を統合**

`src/pose-particles/App.ts` の class に変更を加える：

ファイル冒頭のインポートに追加：

```ts
import { PointCloud } from "./visuals/PointCloud";
```

class フィールド：

```ts
  readonly pointCloud: PointCloud;
```

constructor の末尾（`window.addEventListener` の前）に追加：

```ts
    this.pointCloud = new PointCloud(this.renderer.getPixelRatio());
    this.scene.add(this.pointCloud.object3D);
```

`update` メソッドを以下に置換：

```ts
  protected update(audio: AudioFeatures): void {
    const t = performance.now() / 1000;
    this.pointCloud.update(this.jointAnchors.getSmoothed(), audio, t);
  }
```

- [ ] **Step 5: dev で動作確認**

```bash
bun --hot ./pose-particles.html
```

期待：黒画面に薄白い 5200 点の点群が画面中央付近にうっすら見える（関節位置がまだ全部 0 なので、原点周辺に重なっている）。コンソールエラーなし。

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/visuals/
git add src/pose-particles/App.ts
git commit -m "feat(visuals): add PointCloud rendering 5k particles via shader"
```

---

## Task 10: PointCloud をポーズに連動させる

**Files:**
- Modify: `src/pose-particles/main.ts`
- Modify: `src/pose-particles/ui/UI.ts` （新規作成、最小スタブ）

PoseInput を実際に起動して、関節が動くと点群が動くのを確認する。Webcam 権限が必要なので user gesture が要る → 最小の「開始」オーバーレイをここで作る。

- [ ] **Step 1: 最小スタブの UI.ts を作成**

`src/pose-particles/ui/UI.ts`:

```ts
import type { App } from "../App";

export class UI {
  private root: HTMLElement;

  constructor(private app: App) {
    const root = document.getElementById("ui-root");
    if (!(root instanceof HTMLElement)) throw new Error("ui-root not found");
    this.root = root;
  }

  showStartOverlay(): void {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.85); z-index: 100;
      color: #fff; font-family: system-ui;
    `;
    overlay.innerHTML = `
      <div style="text-align:center;max-width:480px;padding:32px">
        <h1 style="font-weight:300;letter-spacing:0.05em;margin-bottom:24px">Pose × Audio Particles</h1>
        <p style="opacity:0.7;margin-bottom:32px;line-height:1.7">
          Webカメラの前に立ち、音楽と共に体を動かしてください。<br>
          観る人の身体は描画されず、空間に点と粒子が現れます。
        </p>
        <button id="start-btn" style="
          padding: 12px 32px; background: #fff; color: #000;
          border: none; border-radius: 4px; font-size: 16px;
          letter-spacing: 0.05em; cursor: pointer;
        ">開始</button>
        <p id="start-error" style="color:#f88;margin-top:16px;display:none"></p>
      </div>
    `;
    this.root.appendChild(overlay);

    const btn = overlay.querySelector("#start-btn") as HTMLButtonElement;
    const err = overlay.querySelector("#start-error") as HTMLParagraphElement;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "起動中...";
      try {
        await this.app.startPose();
        overlay.remove();
      } catch (e) {
        err.style.display = "block";
        err.textContent =
          e instanceof Error ? e.message : "カメラの起動に失敗しました";
        btn.disabled = false;
        btn.textContent = "再試行";
      }
    });
  }
}
```

- [ ] **Step 2: main.ts を更新**

```ts
import { App } from "./App";
import { UI } from "./ui/UI";

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not found");

const app = new App(canvas);
app.start();

const ui = new UI(app);
ui.showStartOverlay();

(window as unknown as { app: App }).app = app;
```

- [ ] **Step 3: dev で動作確認**

```bash
bun --hot ./pose-particles.html
```

期待：開始オーバーレイが出る → クリック → カメラ権限を許可 → オーバーレイ消える → カメラの前で体を動かすと、画面に 13 箇所の薄い点群クラスタが現れて自分の動きを追う。

確認項目：
- [ ] 関節 13 箇所に点群がクラスタする（鼻・両肩・両肘・両手首・両腰・両膝・両足首）
- [ ] 動くと点群が追従する（lerp による若干の遅延あり）
- [ ] カメラ権限を拒否するとエラーメッセージが表示される

- [ ] **Step 4: コミット**

```bash
git add src/pose-particles/ui/ src/pose-particles/main.ts
git commit -m "feat(ui): add start overlay and wire PoseInput into App"
```

---

## Task 11: FragmentField（基本版、curl noise 漂流のみ）

**Files:**
- Create: `src/pose-particles/visuals/shaders/fragmentField.vert.glsl`
- Create: `src/pose-particles/visuals/shaders/fragmentField.frag.glsl`
- Create: `src/pose-particles/visuals/FragmentField.ts`
- Modify: `src/pose-particles/App.ts`

10000 個の細片を 3D 領域に分散配置。シェーダー内で curl noise によるドリフトを計算する。この時点では関節重力・音響変調は無効（uniform は宣言のみ）。

- [ ] **Step 1: vertex shader を作成**

`src/pose-particles/visuals/shaders/fragmentField.vert.glsl`:

```glsl
#define MAX_JOINTS 13

uniform vec3 uJoints[MAX_JOINTS];
uniform float uTime;
uniform float uVolume;
uniform float uMid;
uniform float uPixelRatio;

attribute vec3 aBasePosition;
attribute float aSeed;

varying float vAlpha;

vec3 hash3(vec3 p) {
  p = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

vec3 curlNoise(vec3 p) {
  float e = 0.05;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  vec3 px0 = hash3(p - dx); vec3 px1 = hash3(p + dx);
  vec3 py0 = hash3(p - dy); vec3 py1 = hash3(p + dy);
  vec3 pz0 = hash3(p - dz); vec3 pz1 = hash3(p + dz);
  vec3 dFdx = (px1 - px0) / (2.0 * e);
  vec3 dFdy = (py1 - py0) / (2.0 * e);
  vec3 dFdz = (pz1 - pz0) / (2.0 * e);
  return vec3(dFdy.z - dFdz.y, dFdz.x - dFdx.z, dFdx.y - dFdy.x);
}

void main() {
  vec3 base = aBasePosition;
  vec3 drift = curlNoise(base * 0.5 + uTime * 0.1) * (0.3 + uMid * 0.5);
  vec3 pos = base + drift;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.5 + uVolume * 1.5) * uPixelRatio * (1.0 / -mv.z);
  vAlpha = 0.4 + uVolume * 0.4;
}
```

- [ ] **Step 2: fragment shader を作成**

`src/pose-particles/visuals/shaders/fragmentField.frag.glsl`:

```glsl
precision mediump float;
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float circle = 1.0 - smoothstep(0.35, 0.5, d);
  if (circle < 0.01) discard;
  gl_FragColor = vec4(vec3(0.85), circle * vAlpha);
}
```

- [ ] **Step 3: FragmentField.ts を作成**

```ts
import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import vertexShader from "./shaders/fragmentField.vert.glsl" with { type: "text" };
import fragmentShader from "./shaders/fragmentField.frag.glsl" with { type: "text" };

const FRAGMENT_COUNT = 10000;
const FIELD_SIZE = 3.0; // メートル

export class FragmentField {
  readonly object3D: THREE.Points;
  private material: THREE.ShaderMaterial;

  constructor(pixelRatio: number) {
    const geom = new THREE.BufferGeometry();
    const basePos = new Float32Array(FRAGMENT_COUNT * 3);
    const seeds = new Float32Array(FRAGMENT_COUNT);
    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      basePos[i * 3 + 0] = (Math.random() - 0.5) * FIELD_SIZE;
      basePos[i * 3 + 1] = (Math.random() - 0.5) * FIELD_SIZE;
      basePos[i * 3 + 2] = (Math.random() - 0.5) * FIELD_SIZE;
      seeds[i] = Math.random();
    }
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FRAGMENT_COUNT * 3), 3));
    geom.setAttribute("aBasePosition", new THREE.BufferAttribute(basePos, 3));
    geom.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), FIELD_SIZE);

    const jointVecs: THREE.Vector3[] = [];
    for (let i = 0; i < NUM_JOINTS; i++) jointVecs.push(new THREE.Vector3());

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uJoints: { value: jointVecs },
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uMid: { value: 0 },
        uPixelRatio: { value: pixelRatio },
      },
    });

    this.object3D = new THREE.Points(geom, this.material);
    this.object3D.frustumCulled = false;
  }

  update(joints: Joints, audio: AudioFeatures, timeSec: number): void {
    const u = this.material.uniforms;
    const arr = u.uJoints.value as THREE.Vector3[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr[i].set(joints[i * 3]!, joints[i * 3 + 1]!, joints[i * 3 + 2]!);
    }
    u.uTime.value = timeSec;
    u.uVolume.value = audio.volume;
    u.uMid.value = audio.mid;
  }
}
```

- [ ] **Step 4: App.ts に FragmentField を統合**

冒頭インポート追加：

```ts
import { FragmentField } from "./visuals/FragmentField";
```

class フィールド（PointCloud の下に）：

```ts
  readonly fragmentField: FragmentField;
```

constructor 末尾、PointCloud の追加直後に：

```ts
    this.fragmentField = new FragmentField(this.renderer.getPixelRatio());
    this.scene.add(this.fragmentField.object3D);
```

`update` メソッドを置換：

```ts
  protected update(audio: AudioFeatures): void {
    const t = performance.now() / 1000;
    const joints = this.jointAnchors.getSmoothed();
    this.pointCloud.update(joints, audio, t);
    this.fragmentField.update(joints, audio, t);
  }
```

- [ ] **Step 5: dev で動作確認**

```bash
bun --hot ./pose-particles.html
```

期待：開始オーバーレイ → カメラ許可後、黒い空間に薄灰色の細片群（10000）が漂い、関節周りの白い点群（5000）も同居する。両者が独立に存在する。

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/visuals/
git add src/pose-particles/App.ts
git commit -m "feat(visuals): add FragmentField with curl noise drift"
```

---

## Task 12: FragmentField に関節重力を追加

**Files:**
- Modify: `src/pose-particles/visuals/shaders/fragmentField.vert.glsl`

vertex shader 内で 13 関節からの逆二乗合力で位置を変位させる。

- [ ] **Step 1: vertex shader を更新**

`fragmentField.vert.glsl` の `void main()` を以下に置換：

```glsl
void main() {
  vec3 base = aBasePosition;
  vec3 drift = curlNoise(base * 0.5 + uTime * 0.1) * (0.3 + uMid * 0.5);
  vec3 pos = base + drift;

  // 13 関節からの逆二乗合力で吸い寄せ
  vec3 force = vec3(0.0);
  for (int i = 0; i < MAX_JOINTS; i++) {
    vec3 toJoint = uJoints[i] - pos;
    float d2 = dot(toJoint, toJoint) + 0.05;
    force += toJoint / d2;
  }
  pos += force * 0.02;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.5 + uVolume * 1.5) * uPixelRatio * (1.0 / -mv.z);
  vAlpha = 0.4 + uVolume * 0.4;
}
```

- [ ] **Step 2: dev で動作確認**

```bash
bun --hot ./pose-particles.html
```

期待：細片が体の周りに引き寄せられて流れる。体を動かすと、細片の流れがそれに引きずられて変化する。

- [ ] **Step 3: コミット**

```bash
git add src/pose-particles/visuals/shaders/fragmentField.vert.glsl
git commit -m "feat(visuals): add joint-gravity influence to fragment field"
```

---

## Task 13: AudioInput と UI 切替（File / Mic）

**Files:**
- Modify: `src/pose-particles/ui/UI.ts`
- Modify: `src/pose-particles/App.ts`

UI に右上の小さなコントロールパネルを追加し、ファイル / マイクを切り替えられるようにする。

- [ ] **Step 1: App.ts に AudioContext を持たせる**

class フィールド追加（`renderer` の下）：

```ts
  private audioCtx: AudioContext | null = null;
```

新しいメソッド（`setAudio` の上）：

```ts
  getOrCreateAudioContext(): AudioContext {
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    return this.audioCtx;
  }
```

- [ ] **Step 2: UI.ts を拡張**

`UI.ts` を以下で全置換：

```ts
import type { App } from "../App";
import { FileAudioSource } from "../audio/FileAudioSource";
import { MicAudioSource } from "../audio/MicAudioSource";

type Mode = "none" | "file" | "mic";

export class UI {
  private root: HTMLElement;
  private mode: Mode = "none";

  constructor(private app: App) {
    const root = document.getElementById("ui-root");
    if (!(root instanceof HTMLElement)) throw new Error("ui-root not found");
    this.root = root;
  }

  showStartOverlay(): void {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.85); z-index: 100;
      color: #fff; font-family: system-ui;
    `;
    overlay.innerHTML = `
      <div style="text-align:center;max-width:480px;padding:32px">
        <h1 style="font-weight:300;letter-spacing:0.05em;margin-bottom:24px">Pose × Audio Particles</h1>
        <p style="opacity:0.7;margin-bottom:32px;line-height:1.7">
          Webカメラの前に立ち、音楽と共に体を動かしてください。<br>
          観る人の身体は描画されず、空間に点と粒子が現れます。
        </p>
        <button id="start-btn" style="
          padding: 12px 32px; background: #fff; color: #000;
          border: none; border-radius: 4px; font-size: 16px;
          letter-spacing: 0.05em; cursor: pointer;
        ">開始</button>
        <p id="start-error" style="color:#f88;margin-top:16px;display:none"></p>
      </div>
    `;
    this.root.appendChild(overlay);

    const btn = overlay.querySelector("#start-btn") as HTMLButtonElement;
    const err = overlay.querySelector("#start-error") as HTMLParagraphElement;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "起動中...";
      try {
        // user gesture 内で AudioContext を起動しておく
        const ctx = this.app.getOrCreateAudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        await this.app.startPose();
        overlay.remove();
        this.showControlPanel();
      } catch (e) {
        err.style.display = "block";
        err.textContent =
          e instanceof Error ? e.message : "起動に失敗しました";
        btn.disabled = false;
        btn.textContent = "再試行";
      }
    });
  }

  private showControlPanel(): void {
    const panel = document.createElement("div");
    panel.style.cssText = `
      position: fixed; top: 16px; right: 16px;
      background: rgba(20,20,20,0.7); padding: 12px;
      border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
      color: #fff; font-family: system-ui; font-size: 12px;
      backdrop-filter: blur(4px); z-index: 50;
      display: flex; flex-direction: column; gap: 8px; min-width: 200px;
    `;
    panel.innerHTML = `
      <div style="display:flex;gap:4px">
        <button data-mode="file" style="${btnCss}">ファイル</button>
        <button data-mode="mic"  style="${btnCss}">マイク</button>
      </div>
      <div id="file-controls" style="display:none">
        <input id="file-input" type="file" accept="audio/*" style="font-size:11px;color:#ccc">
        <div id="file-status" style="margin-top:6px;opacity:0.7"></div>
      </div>
      <div id="mic-status" style="display:none;opacity:0.7">マイク使用中</div>
      <div id="audio-error" style="color:#f88;display:none"></div>
    `;
    this.root.appendChild(panel);

    const fileCtrl = panel.querySelector("#file-controls") as HTMLDivElement;
    const fileInput = panel.querySelector("#file-input") as HTMLInputElement;
    const fileStatus = panel.querySelector("#file-status") as HTMLDivElement;
    const micStatus = panel.querySelector("#mic-status") as HTMLDivElement;
    const errBox = panel.querySelector("#audio-error") as HTMLDivElement;

    panel.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((b) => {
      b.addEventListener("click", () => {
        const mode = b.dataset.mode as Mode;
        if (mode === "file") {
          fileCtrl.style.display = "block";
          micStatus.style.display = "none";
          this.switchToFile();
        } else {
          fileCtrl.style.display = "none";
          micStatus.style.display = "block";
          this.switchToMic(errBox);
        }
      });
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const ctx = this.app.getOrCreateAudioContext();
        const src = new FileAudioSource(ctx);
        await src.loadFromFile(file);
        await src.start();
        this.app.setAudio(src);
        fileStatus.textContent = `再生中: ${file.name}`;
        errBox.style.display = "none";
      } catch (e) {
        errBox.style.display = "block";
        errBox.textContent = e instanceof Error ? e.message : "ファイル読込失敗";
      }
    });
  }

  private switchToFile(): void {
    this.app.setAudio(null);
    this.mode = "file";
  }

  private async switchToMic(errBox: HTMLElement): Promise<void> {
    try {
      const ctx = this.app.getOrCreateAudioContext();
      const mic = new MicAudioSource(ctx);
      await mic.start();
      this.app.setAudio(mic);
      this.mode = "mic";
      errBox.style.display = "none";
    } catch (e) {
      errBox.style.display = "block";
      errBox.textContent =
        e instanceof Error ? e.message : "マイク起動失敗";
      this.mode = "none";
    }
  }
}

const btnCss = `
  flex: 1; padding: 6px 8px; background: rgba(255,255,255,0.1);
  color: #fff; border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; cursor: pointer; font-size: 12px;
`;
```

- [ ] **Step 3: dev で動作確認**

```bash
bun --hot ./pose-particles.html
```

期待：
- [ ] 開始 → 右上にコントロールパネルが現れる
- [ ] 「ファイル」→ ファイル選択 → 楽曲が流れ、点群が脈動・細片が乱気流（bass で関節クラスタが膨張、mid で細片が乱れる）
- [ ] 「マイク」→ 権限許可 → 声を出すと点群が反応する
- [ ] マイク権限拒否で「マイク起動失敗」エラーが見える

`public/pose-particles/audio/sample.mp3` に試したい曲を置いておくとデバッグが楽（実装上必須ではない）。

- [ ] **Step 4: コミット**

```bash
git add src/pose-particles/ui/UI.ts src/pose-particles/App.ts
git commit -m "feat(ui): add file/mic switcher and wire AudioInput"
```

---

## Task 14: WebGL 非対応のガード

**Files:**
- Modify: `src/pose-particles/main.ts`

WebGL 未サポート環境で起動時にブロックする。

- [ ] **Step 1: main.ts を更新**

```ts
import { App } from "./App";
import { UI } from "./ui/UI";

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not found");

if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;
                height:100vh;color:#fff;font-family:system-ui;text-align:center">
      <p>このブラウザは WebGL に対応していません。</p>
    </div>
  `;
  throw new Error("WebGL not supported");
}

const app = new App(canvas);
app.start();

const ui = new UI(app);
ui.showStartOverlay();

(window as unknown as { app: App }).app = app;
```

- [ ] **Step 2: 通常起動を再確認**

```bash
bun --hot ./pose-particles.html
```

期待：通常通り動作。

- [ ] **Step 3: コミット**

```bash
git add src/pose-particles/main.ts
git commit -m "feat: guard against missing WebGL support"
```

---

## Task 15: 最終手動検証 + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: 全テストを実行**

```bash
bun test
```

期待：`AudioAnalyzer.test.ts` と `JointAnchors.test.ts` が全 PASS。

- [ ] **Step 2: 本番ビルドが通ることを確認**

```bash
bun build ./pose-particles.html --outdir dist --minify
```

期待：`dist/` 配下にバンドル済みのファイルが出る。エラーなし。

- [ ] **Step 3: 手動検証チェックリスト**

`bun --hot ./pose-particles.html` を起動して以下を確認：

- [ ] 開始オーバーレイが表示される
- [ ] 「開始」→ カメラ権限プロンプト → 許可後オーバーレイ消える
- [ ] カメラ権限拒否時にエラーメッセージが見える
- [ ] 体を動かすと 13 箇所の点群クラスタが追従する
- [ ] 細片群（薄灰）が空間を漂い、体の方向に引き寄せられる
- [ ] 「ファイル」→ mp3 を選択 → 再生 → bass で点群クラスタが膨張、mid で細片が乱れる
- [ ] 「マイク」→ 許可 → 声で点群が反応する
- [ ] 60fps を維持できる（DevTools Performance で確認、5秒間で 290+ frames あれば OK）
- [ ] ウィンドウリサイズで描画が崩れない

- [ ] **Step 4: README.md を作成**

```markdown
# Pose × Audio Particles

体の動き（Webcam ポーズ検出）と音楽（ファイル / マイク）に反応するモノクロームの 3D 点群作品。

## 要件

- Bun 1.2+
- WebGL 対応のモダンブラウザ（Chrome / Safari / Firefox の最新版）
- Webcam とマイク（任意）

## 起動

```bash
bun install
bun --hot ./pose-particles.html
```

ブラウザで表示された URL を開き、「開始」ボタンを押してカメラ権限を許可する。

## 操作

- 右上のパネルで音源を切り替え
  - **ファイル**：ローカルの mp3 / m4a などを選択
  - **マイク**：マイク入力をそのまま解析

## ビルド

```bash
bun build ./pose-particles.html --outdir dist --minify
```

## テスト

```bash
bun test
```

## 設計

設計仕様：[docs/superpowers/specs/2026-04-29-pose-audio-particle-art-design.md](docs/superpowers/specs/2026-04-29-pose-audio-particle-art-design.md)
```

- [ ] **Step 5: コミット**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## 完了条件

- [ ] 全 Task が PASS
- [ ] `bun test` で 2 ファイル全 PASS
- [ ] `bun build ./pose-particles.html` がエラーなしで完了
- [ ] 手動検証チェックリスト（Task 15 Step 3）がすべて確認済み

完了後の選択肢：
- `feat/pose-particles` ブランチを `main` にマージ
- 進化（Bloom 追加、カメラ周回、複数人対応など Spec の「スコープ外」に列挙）

---

## ラフな所要時間目安

| Task | 内容 | 目安 |
|---|---|---|
| 1 | 初期化 | 15min |
| 2 | 型定義 | 5min |
| 3 | AudioAnalyzer | 25min |
| 4 | FileAudioSource | 15min |
| 5 | MicAudioSource | 10min |
| 6 | PoseInput | 25min |
| 7 | JointAnchors | 20min |
| 8 | App ブートストラップ | 15min |
| 9 | PointCloud | 40min |
| 10 | Pose 連動 + UI スタブ | 20min |
| 11 | FragmentField 基本 | 30min |
| 12 | 関節重力 | 10min |
| 13 | AudioInput + UI 切替 | 35min |
| 14 | WebGL ガード | 5min |
| 15 | 最終検証 + README | 20min |
| **合計** | | **約 5 時間** |
