import * as THREE from "three";
import { NUM_JOINTS, type AudioFeatures, type Joints } from "../types";
import { modeToInt, type Settings } from "../settings";
import { axisToInt, effectiveTwistStrength, twistPhase } from "./twist";
import type { ImageGrid } from "./ImageSampler";

const POINTS_PER_JOINT = 400;
const SIGMA = 0.08; // メートル
export const TOTAL_PARTICLES = NUM_JOINTS * POINTS_PER_JOINT;

const vertexShader = /* glsl */ `
  #define MAX_JOINTS 13

  uniform vec3 uJoints[MAX_JOINTS];
  uniform float uVisibility[MAX_JOINTS];
  uniform vec3 uCenter;
  uniform float uTime;
  uniform float uVolume;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uPixelRatio;
  uniform float uPixelPerWorld;  // world 1m を drawing-buffer pixel に変換する係数 (z=1 時)
  uniform float uBassExpansion;
  uniform float uTrebleShimmer;
  uniform float uAmbientShimmer;
  uniform float uBaseSize;
  uniform float uVolumeSize;
  uniform float uMode;          // 0=bones, 1=cube, 2=sphere, 3=lattice, 4=image (float for WebGL1 portability)
  uniform float uPolyhedron;    // 4 | 6 | 8 | 12 (cube モード時の正多面体面数。Issue #40)
  uniform float uLatticeN;      // 格子解像度 (lattice モードのみ使用)
  uniform float uImageGridW;    // 画像粒子グリッド W (image モードのみ使用)
  uniform float uImageGridH;    // 画像粒子グリッド H
  uniform float uImagePlaneW;   // 画像平面の幅 (m)
  uniform float uImagePlaneH;   // 画像平面の高さ (m)
  uniform float uImagePushAmount;  // Z 押し出しゲイン
  uniform float uImageNoiseAmp;
  uniform float uImageNoiseScale;
  uniform float uImageNoiseSpeed;
  uniform float uImageWaveStrength; // image 専用波動振幅
  uniform float uImageSizeScale;    // 粒子サイズ倍率 (image モード)
  uniform float uImageShape;        // 0=円, 1=矩形 (image モード)
  uniform float uWaveTimes[4];  // 直近 onset 時刻 (-1 = inactive)
  uniform float uWaveSpeed;     // 波速度 m/s
  uniform float uWaveAmplitude; // 弾性振動の最大変位 m
  uniform float uWaveOscFreq;   // 振動周波数 Hz
  uniform float uWaveDamping;   // 減衰時定数 sec (1/e)
  uniform float uShapeRadius;
  uniform float uShapeBassPulse;
  uniform float uHueBase;
  uniform float uHueSpread;
  uniform float uBassHueShift;
  uniform float uSaturation;
  uniform float uTrebleBoost;
  uniform float uOutlierThreshold;  // aSeed > this => outlier
  uniform float uOutlierBoost;      // multiplier applied to offsets / size on outliers
  uniform float uTwistStrength;     // 0 disables twist
  uniform float uTwistPhase;
  uniform float uTwistAxis;         // 0=x, 1=y, 2=z

  attribute float aJointIndex;
  attribute vec3 aOffset;
  attribute float aSeed;
  attribute float aIndex;       // 0..total-1 のグローバル粒子インデックス (lattice / image モードで使用)
  attribute vec3 aColor;        // 画像セルの RGB (image モードのみ使用、それ以外は白)

  varying float vAlpha;
  varying vec3 vColor;
  varying float vSquare;  // 1.0 = 矩形描画 (image モード + uImageShape), 0.0 = 円

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // Twist: rotate around the chosen axis by an angle proportional to the
  // coordinate value on that axis (plus a time-driven phase). Preserves the
  // axis-aligned coordinate, rotates the orthogonal pair in 2D.
  vec3 applyTwist(vec3 p, float strength, float phase, float axis) {
    if (strength == 0.0 && phase == 0.0) return p;
    float s;
    if (axis < 0.5)      s = p.x;
    else if (axis < 1.5) s = p.y;
    else                 s = p.z;
    float a = strength * s + phase;
    float c = cos(a);
    float sn = sin(a);
    if (axis < 0.5) {
      // x-axis: rotate (y,z)
      return vec3(p.x, p.y * c - p.z * sn, p.y * sn + p.z * c);
    } else if (axis < 1.5) {
      // y-axis: rotate (x,z)
      return vec3(p.x * c - p.z * sn, p.y, p.x * sn + p.z * c);
    }
    // z-axis: rotate (x,y)
    return vec3(p.x * c - p.y * sn, p.x * sn + p.y * c, p.z);
  }

  vec3 hash3unit(float seed) {
    return vec3(
      fract(sin(seed * 12.9898) * 43758.5453),
      fract(sin(seed * 78.2330) * 12345.6789),
      fract(sin(seed * 39.3460) * 98765.4321)
    );
  }

  vec3 selectJoint(int jointIdx) {
    if (jointIdx == 0)  return uJoints[0];
    if (jointIdx == 1)  return uJoints[1];
    if (jointIdx == 2)  return uJoints[2];
    if (jointIdx == 3)  return uJoints[3];
    if (jointIdx == 4)  return uJoints[4];
    if (jointIdx == 5)  return uJoints[5];
    if (jointIdx == 6)  return uJoints[6];
    if (jointIdx == 7)  return uJoints[7];
    if (jointIdx == 8)  return uJoints[8];
    if (jointIdx == 9)  return uJoints[9];
    if (jointIdx == 10) return uJoints[10];
    if (jointIdx == 11) return uJoints[11];
    return uJoints[12];
  }

  float selectVisibility(int jointIdx) {
    if (jointIdx == 0)  return uVisibility[0];
    if (jointIdx == 1)  return uVisibility[1];
    if (jointIdx == 2)  return uVisibility[2];
    if (jointIdx == 3)  return uVisibility[3];
    if (jointIdx == 4)  return uVisibility[4];
    if (jointIdx == 5)  return uVisibility[5];
    if (jointIdx == 6)  return uVisibility[6];
    if (jointIdx == 7)  return uVisibility[7];
    if (jointIdx == 8)  return uVisibility[8];
    if (jointIdx == 9)  return uVisibility[9];
    if (jointIdx == 10) return uVisibility[10];
    if (jointIdx == 11) return uVisibility[11];
    return uVisibility[12];
  }

  void main() {
    int jointIdx = int(aJointIndex + 0.5);
    vec3 pos;
    float vis;
    float visAlpha;

    // Outlier spike: ~uOutlierFraction of particles oscillate independently,
    // shooting outward and retracting at their own per-particle frequency.
    // Each picked particle pulses 1× → boost× → 1× over time, so the
    // silhouette grows and pulls back in trembling spikes rather than
    // looking like a static second shell.
    float outlierMask = smoothstep(uOutlierThreshold - 0.04, uOutlierThreshold, aSeed);
    float spikeFreq = 1.0 + aSeed * 4.0;       // 1..5 Hz, per-particle
    float spikePhase = aSeed * 217.13;         // de-sync phases
    float spikeWave = sin(uTime * spikeFreq + spikePhase) * 0.5 + 0.5;  // 0..1
    float outlier = 1.0 + outlierMask * (uOutlierBoost - 1.0) * spikeWave;

    float shimmerAmp = uTreble * uTrebleShimmer + uAmbientShimmer;
    float shimmer = sin(uTime * 30.0 + aSeed * 100.0) * shimmerAmp * outlier;

    if (uMode < 0.5) {
      // bones: per-joint gaussian cluster
      vec3 jointPos = selectJoint(jointIdx) - uCenter;
      vis = selectVisibility(jointIdx);
      float radius = 1.0 + uBass * uBassExpansion;
      vec3 offset = aOffset * radius * outlier;
      offset += normalize(aOffset + 0.0001) * shimmer;
      pos = jointPos + offset;
      float d = length(aOffset);
      float visGate = smoothstep(0.2, 0.6, vis);
      visAlpha = (1.0 - smoothstep(0.0, 0.15, d)) * visGate;
    } else if (uMode < 1.5) {
      // cube: particles uniformly on the SURFACE of a centred cube
      // Pick a face uniformly (6 faces) using a separate hash, then place
      // randomly on that face.
      float faceHash = fract(aSeed * 13.717 + aJointIndex * 0.41);
      vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
      vec2 uv = (r.xy - 0.5) * 2.0;       // [-1, 1]^2
      vec3 cubePos;
      if (faceHash < 0.16667)      cubePos = vec3( 1.0, uv.x, uv.y);
      else if (faceHash < 0.33333) cubePos = vec3(-1.0, uv.x, uv.y);
      else if (faceHash < 0.50000) cubePos = vec3(uv.x,  1.0, uv.y);
      else if (faceHash < 0.66667) cubePos = vec3(uv.x, -1.0, uv.y);
      else if (faceHash < 0.83333) cubePos = vec3(uv.x, uv.y,  1.0);
      else                         cubePos = vec3(uv.x, uv.y, -1.0);
      float scale = uShapeRadius * (1.0 + uBass * uShapeBassPulse) * outlier;
      pos = cubePos * scale + normalize(cubePos + 0.0001) * shimmer;
      visAlpha = 0.85;
    } else if (uMode < 2.5) {
      // sphere: particles uniformly on the SURFACE of a sphere
      vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
      float theta = r.x * 6.2831853;
      float cosPhi = 2.0 * r.y - 1.0;
      float sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
      vec3 dir = vec3(sinPhi * cos(theta), sinPhi * sin(theta), cosPhi);
      float radius = uShapeRadius * (1.0 + uBass * uShapeBassPulse) * outlier;
      pos = dir * radius + dir * shimmer;
      visAlpha = 0.85;
    } else if (uMode < 3.5) {
      // lattice: NxNxN 厳密格子。bass shockwave は別 step で追加。
      int idx = int(aIndex + 0.5);
      int N = int(uLatticeN + 0.5);
      int N3 = N * N * N;
      if (idx >= N3) {
        pos = vec3(0.0);
        visAlpha = 0.0;
      } else {
        // WebGL1 互換のため整数 %% を使わず割り算で代用
        int ix = idx - (idx / N) * N;
        int iy = (idx / N) - (idx / (N * N)) * N;
        int iz = idx / (N * N);
        vec3 cell = vec3(float(ix), float(iy), float(iz));
        float cellSize = uShapeRadius * 2.0 / max(float(N - 1), 1.0);
        vec3 latticePos = (cell - vec3(float(N - 1) * 0.5)) * cellSize;
        vec3 outwardDir = normalize(latticePos + vec3(1e-5));
        float r = length(latticePos);
        float totalDisp = 0.0;
        for (int wi = 0; wi < 4; wi++) {
          float t0 = uWaveTimes[wi];
          if (t0 < 0.0) continue;
          float waveAge = (uTime - t0) - r / uWaveSpeed;
          if (waveAge < 0.0) continue;
          float env = exp(-waveAge / uWaveDamping);
          float osc = sin(waveAge * uWaveOscFreq * 6.2831853);
          totalDisp += uWaveAmplitude * env * osc;
        }
        pos = latticePos + outwardDir * totalDisp;
        pos += outwardDir * shimmer;
        visAlpha = 0.85;
      }
    } else {
      // image: 2D 画像平面 (z=0) 上にグリッド配置 + 音声反応 3D 歪み
      int idx = int(aIndex + 0.5);
      int gridW = int(uImageGridW + 0.5);
      int gridH = int(uImageGridH + 0.5);
      int total = gridW * gridH;
      if (idx >= total) {
        pos = vec3(0.0);
        visAlpha = 0.0;
      } else {
        // WebGL1 互換のため整数 %% は割り算で代用
        int ix = idx - (idx / gridW) * gridW;
        int iy = idx / gridW;
        float u = (float(ix) + 0.5) / float(gridW);
        float v = (float(iy) + 0.5) / float(gridH);
        // 画像座標 (y は下方向正) → 世界座標 (y 上向き) に反転
        vec3 imagePos = vec3((u - 0.5) * uImagePlaneW, (0.5 - v) * uImagePlaneH, 0.0);

        // (1) Z 押し出し (中高域 × 輝度)
        float lum = dot(aColor, vec3(0.299, 0.587, 0.114));
        imagePos.z += lum * (uMid + uTreble) * uImagePushAmount;

        // (2) 中心からの shockwave (lattice と同式、半径は平面内)
        float rr = length(imagePos.xy);
        vec2 outDir = normalize(imagePos.xy + vec2(1e-5));
        float totalDisp = 0.0;
        for (int wi = 0; wi < 4; wi++) {
          float t0 = uWaveTimes[wi];
          if (t0 < 0.0) continue;
          float waveAge = (uTime - t0) - rr / uWaveSpeed;
          if (waveAge < 0.0) continue;
          float env = exp(-waveAge / uWaveDamping);
          float osc = sin(waveAge * uWaveOscFreq * 6.2831853);
          totalDisp += uImageWaveStrength * env * osc;
        }
        imagePos.xy += outDir * totalDisp;

        // (3) 安価な smooth noise で XYZ を揺らす (uVolume でスケール)
        vec3 ns = imagePos * uImageNoiseScale + vec3(uTime * uImageNoiseSpeed);
        vec3 noise = vec3(
          sin(ns.x * 1.7 + ns.y * 2.3),
          sin(ns.y * 1.9 + ns.z * 2.1),
          sin(ns.z * 2.5 + ns.x * 1.3)
        );
        imagePos += noise * uImageNoiseAmp * uVolume;

        pos = imagePos;
        visAlpha = 0.95;
      }
    }

    pos = applyTwist(pos, uTwistStrength, uTwistPhase, uTwistAxis);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    if (uMode > 3.5) {
      // image: セル間隔 (world m) に追従。隙間が出ないよう大きい方の辺を採用。
      // cellSize × uPixelPerWorld で drawing-buffer pixel @ z=1 → 1/-mv.z で perspective scale
      float cellW = uImagePlaneW / max(uImageGridW, 1.0);
      float cellH = uImagePlaneH / max(uImageGridH, 1.0);
      float cellSize = max(cellW, cellH);
      float ptDrawing = cellSize * uPixelPerWorld * outlier * uImageSizeScale / -mv.z;
      // volume は CSS pixel ベースの追加サイズなので uPixelRatio で drawing pixel に揃える
      ptDrawing += uVolume * uVolumeSize * uPixelRatio;
      gl_PointSize = ptDrawing;
    } else {
      gl_PointSize = (uBaseSize + uVolume * uVolumeSize) * outlier * uPixelRatio * (1.0 / -mv.z);
    }

    if (uMode > 3.5) {
      // image モード: 粒子色は画像セルの RGB をそのまま使用 (treble で軽くブースト)
      vColor = aColor * (1.0 + uTreble * uTrebleBoost);
    } else {
      // Per-particle colour (HSV).
      float hue = fract(uHueBase + (aSeed - 0.5) * uHueSpread + uBass * uBassHueShift);
      float bright = 1.0 + uTreble * uTrebleBoost;
      vColor = hsv2rgb(vec3(hue, uSaturation, bright));
    }
    // Treble drives a small alpha boost on top of the layout-derived alpha.
    vAlpha = visAlpha * (0.5 + uTreble * 0.5);
    // image モードかつ square 指定のときだけ矩形描画フラグを立てる
    vSquare = (uMode > 3.5 && uImageShape > 0.5) ? 1.0 : 0.0;
  }
`;

const fragmentShader = /* glsl */ `
  precision mediump float;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vSquare;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float mask;
    if (vSquare > 0.5) {
      // 矩形: スプライト全面をほぼ塗り、端だけ僅かにアンチエイリアス
      float m = max(abs(uv.x), abs(uv.y));
      mask = 1.0 - smoothstep(0.48, 0.5, m);
    } else {
      // 円: 従来どおり
      float d = length(uv);
      mask = 1.0 - smoothstep(0.4, 0.5, d);
    }
    if (mask < 0.01) discard;
    gl_FragColor = vec4(vColor, mask * vAlpha);
  }
`;

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
  private lastImageAspect = 4 / 3; // image モードの平面サイズ計算用 (デフォルト 4:3)

  private colorAttr: THREE.BufferAttribute;

  constructor(pixelRatio: number) {
    const total = TOTAL_PARTICLES;
    const geom = new THREE.BufferGeometry();

    const offsets = new Float32Array(total * 3);
    const indices = new Float32Array(total);
    const seeds = new Float32Array(total);
    const aIndexArr = new Float32Array(total);
    const colors = new Float32Array(total * 3).fill(1); // image モード以外では未使用、初期値は白
    for (let j = 0; j < NUM_JOINTS; j++) {
      for (let p = 0; p < POINTS_PER_JOINT; p++) {
        const i = j * POINTS_PER_JOINT + p;
        offsets[i * 3 + 0] = gaussian() * SIGMA;
        offsets[i * 3 + 1] = gaussian() * SIGMA;
        offsets[i * 3 + 2] = gaussian() * SIGMA;
        indices[i] = j;
        seeds[i] = Math.random();
        aIndexArr[i] = i;
      }
    }
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    geom.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 3));
    geom.setAttribute("aJointIndex", new THREE.BufferAttribute(indices, 1));
    geom.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geom.setAttribute("aIndex", new THREE.BufferAttribute(aIndexArr, 1));
    this.colorAttr = new THREE.BufferAttribute(colors, 3);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("aColor", this.colorAttr);
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
        uVisibility: { value: new Array(NUM_JOINTS).fill(0) },
        uCenter: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uVolume: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uPixelRatio: { value: pixelRatio },
        // 後段の setProjection() で更新する。0 のままだと image モードで粒子が消えるので初期値は適当な大きさ
        uPixelPerWorld: { value: 1000 },
        uBassExpansion: { value: 1.5 },
        uTrebleShimmer: { value: 0.02 },
        uAmbientShimmer: { value: 0.0 },
        uBaseSize: { value: 3.0 },
        uVolumeSize: { value: 5.0 },
        uMode: { value: 0.0 },
        uPolyhedron: { value: 6.0 },
        uLatticeN: { value: 12.0 },
        uImageGridW: { value: 80.0 },
        uImageGridH: { value: 60.0 },
        uImagePlaneW: { value: 0.8 },
        uImagePlaneH: { value: 0.6 },
        uImagePushAmount: { value: 0.5 },
        uImageNoiseAmp: { value: 0.05 },
        uImageNoiseScale: { value: 2.0 },
        uImageNoiseSpeed: { value: 0.5 },
        uImageWaveStrength: { value: 0.15 },
        uImageSizeScale: { value: 1.0 },
        uImageShape: { value: 0.0 },
        uWaveTimes: { value: new Float32Array([-1, -1, -1, -1]) },
        uWaveSpeed: { value: 1.2 },
        uWaveAmplitude: { value: 0.15 },
        uWaveOscFreq: { value: 4.0 },
        uWaveDamping: { value: 0.4 },
        uShapeRadius: { value: 1.0 },
        uShapeBassPulse: { value: 0.5 },
        uHueBase: { value: 0.6 },
        uHueSpread: { value: 0.0 },
        uBassHueShift: { value: 0.0 },
        uSaturation: { value: 0.0 },
        uTrebleBoost: { value: 0.3 },
        uOutlierThreshold: { value: 0.9 },
        uOutlierBoost: { value: 1.0 },
        uTwistStrength: { value: 0 },
        uTwistPhase: { value: 0 },
        uTwistAxis: { value: 1 },
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

  update(
    joints: Joints,
    visibility: Float32Array,
    center: Float32Array,
    audio: AudioFeatures,
    settings: Settings,
    timeSec: number,
  ): void {
    const u = this.material.uniforms;
    const arr = u.uJoints!.value as THREE.Vector3[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      arr[i]!.set(joints[i * 3]!, joints[i * 3 + 1]!, joints[i * 3 + 2]!);
    }
    const vis = u.uVisibility!.value as number[];
    for (let i = 0; i < NUM_JOINTS; i++) {
      vis[i] = visibility[i] ?? 0;
    }
    (u.uCenter!.value as THREE.Vector3).set(center[0] ?? 0, center[1] ?? 0, center[2] ?? 0);
    u.uTime!.value = timeSec;
    u.uVolume!.value = audio.volume;
    u.uBass!.value = audio.bass;
    u.uMid!.value = audio.mid;
    u.uTreble!.value = audio.treble;
    u.uBassExpansion!.value = settings.pointCloud.bassExpansion;
    u.uTrebleShimmer!.value = settings.pointCloud.trebleShimmer;
    u.uAmbientShimmer!.value = settings.pointCloud.ambientShimmer;
    u.uBaseSize!.value = settings.pointCloud.baseSize;
    u.uVolumeSize!.value = settings.pointCloud.volumeSize;
    u.uMode!.value = modeToInt(settings.mode);
    u.uPolyhedron!.value = settings.shape.polyhedron;
    u.uLatticeN!.value = settings.lattice.resolution;
    u.uWaveSpeed!.value = settings.lattice.waveSpeed;
    u.uWaveAmplitude!.value = settings.lattice.waveAmplitude;
    u.uWaveOscFreq!.value = settings.lattice.waveOscFreq;
    u.uWaveDamping!.value = settings.lattice.waveDamping;
    u.uShapeRadius!.value = settings.shape.radius;
    u.uShapeBassPulse!.value = settings.shape.bassPulse;
    u.uImagePushAmount!.value = settings.image.pushAmount;
    u.uImageNoiseAmp!.value = settings.image.noiseAmp;
    u.uImageNoiseScale!.value = settings.image.noiseScale;
    u.uImageNoiseSpeed!.value = settings.image.noiseSpeed;
    u.uImageWaveStrength!.value = settings.image.waveStrength;
    u.uImageSizeScale!.value = settings.image.sizeScale;
    u.uImageShape!.value = settings.image.particleShape === "square" ? 1.0 : 0.0;
    // shape.radius がライブで変わっても画像平面のサイズが追従するように再計算
    // (gridW/gridH と aColor は setImage 経由でしか変えない)
    const longest = settings.shape.radius * 2;
    if (this.lastImageAspect >= 1) {
      u.uImagePlaneW!.value = longest;
      u.uImagePlaneH!.value = longest / this.lastImageAspect;
    } else {
      u.uImagePlaneH!.value = longest;
      u.uImagePlaneW!.value = longest * this.lastImageAspect;
    }
    u.uHueBase!.value = settings.color.hueBase;
    u.uHueSpread!.value = settings.color.hueSpread;
    u.uBassHueShift!.value = settings.color.bassHueShift;
    u.uSaturation!.value = settings.color.saturation;
    u.uTrebleBoost!.value = settings.color.trebleBoost;
    u.uOutlierThreshold!.value = 1.0 - Math.max(0, Math.min(1, settings.outlier.fraction));
    u.uOutlierBoost!.value = settings.outlier.boost;
    u.uTwistStrength!.value = effectiveTwistStrength(settings.twist, audio.bass);
    u.uTwistPhase!.value = twistPhase(settings.twist, timeSec);
    u.uTwistAxis!.value = axisToInt(settings.twist.axis);
  }

  /**
   * world 1m が drawing-buffer 上で何 pixel に対応するか (z=1 時) を更新する。
   * image モードで粒子サイズをセル間隔から決めるのに使用。
   * renderer.setSize と camera.fov 変更時に呼ぶこと。
   */
  setProjection(drawingBufferHeight: number, fovYDeg: number): void {
    const fovRad = (fovYDeg * Math.PI) / 180;
    this.material.uniforms.uPixelPerWorld!.value =
      drawingBufferHeight / (2 * Math.tan(fovRad / 2));
  }

  /**
   * Issue #36: サムネ生成用に gl_PointSize 関連 uniform (uPixelRatio,
   * uPixelPerWorld) を「サムネ RT サイズ基準」に一時上書きし、fn 実行後に
   * 元の値へ復元する。実画面の drawing buffer (例: 2000px) 基準の uniform で
   * サムネ RT (例: 144px) に描くと、粒子が相対的に巨大化して加算合成で
   * 白飛びするため。fn が throw しても uniform は確実に戻す。
   */
  withRenderScale<T>(
    drawingBufferHeight: number,
    pixelRatio: number,
    fovYDeg: number,
    fn: () => T,
  ): T {
    const u = this.material.uniforms;
    const savedPixelRatio = u.uPixelRatio!.value as number;
    const savedPixelPerWorld = u.uPixelPerWorld!.value as number;
    u.uPixelRatio!.value = pixelRatio;
    this.setProjection(drawingBufferHeight, fovYDeg);
    try {
      return fn();
    } finally {
      u.uPixelRatio!.value = savedPixelRatio;
      u.uPixelPerWorld!.value = savedPixelPerWorld;
    }
  }

  setWaveTimes(times: readonly number[]): void {
    const arr = this.material.uniforms.uWaveTimes!.value as Float32Array;
    for (let i = 0; i < 4; i++) arr[i] = times[i] ?? -1;
  }

  /**
   * 画像グリッドの RGB を aColor attribute に書き込み、平面サイズ uniform を更新する。
   * shape.radius を基準に画像のアスペクト比を保持して contain で配置する。
   */
  setImage(grid: ImageGrid, gridW: number, gridH: number): void {
    const total = gridW * gridH;
    if (total > TOTAL_PARTICLES) {
      throw new Error(`grid ${gridW}x${gridH}=${total} exceeds particle budget ${TOTAL_PARTICLES}`);
    }
    if (grid.colors.length !== total * 3) {
      throw new Error(`grid.colors length ${grid.colors.length} != ${total * 3}`);
    }
    const colors = this.colorAttr.array as Float32Array;
    // 使う範囲だけ上書き
    colors.set(grid.colors, 0);
    // 余り粒子は image モードでは visAlpha=0 で非表示にされるが、念のため白で埋めておく
    for (let i = total * 3; i < TOTAL_PARTICLES * 3; i++) colors[i] = 1;
    this.colorAttr.needsUpdate = true;

    this.lastImageAspect = grid.imageAspect;
    this.material.uniforms.uImageGridW!.value = gridW;
    this.material.uniforms.uImageGridH!.value = gridH;
    // 平面サイズは update() 内で毎フレーム shape.radius に追従して再計算する
  }
}
