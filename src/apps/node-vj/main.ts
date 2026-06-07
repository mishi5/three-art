// node-vj アプリのエントリポイント（WIP）。
// Epic #56: ノードベース VJ アプリ。グラフ基盤・ノードエディタ UI は #59 以降で実装する。
//
// #58 時点では「描画・エフェクトの共有コンポーネント(core)が node-vj からも
// Settings 非依存で利用できる」ことの最小実証として、core の RainField を
// core param 型だけで駆動して描画する。pose/audio など入力ノード化は #61。
import * as THREE from "three";
import { RainField } from "../../core/visuals/rain";
import type { RainFieldUpdateParams } from "../../core/visuals/params";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../core/types";

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not found");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
camera.position.set(0, 0, 2.4);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener("resize", resize);

const rain = new RainField();
scene.add(rain.object3D);

// core 共有コンポーネントを Settings ではなく core param 型だけで駆動する。
const params: RainFieldUpdateParams = {
  mode: "rain",
  rain: {
    baseSpeed: 0.3,
    ampGain: 1.0,
    count: 2000,
    length: 0.06,
    areaWidth: 2.0,
    areaHeight: 2.4,
    binMapping: "log",
  },
};

// 合成 FFT（入力ノード未実装のため擬似的に帯域エネルギーを与える）。
const fft = new Float32Array(64).map((_, i) => 0.3 + 0.2 * Math.sin(i * 0.5));
const audio: AudioFeatures = { ...DEFAULT_AUDIO_FEATURES, fft };

const start = performance.now();
function tick(): void {
  requestAnimationFrame(tick);
  const t = (performance.now() - start) / 1000;
  rain.update(audio, params, t);
  renderer.render(scene, camera);
}
tick();

const root = document.getElementById("ui-root");
if (root) {
  root.style.cssText =
    "position:fixed;left:12px;top:12px;color:#8af;font:12px/1.4 system-ui;" +
    "background:rgba(0,0,0,0.5);padding:6px 10px;border:1px solid rgba(255,255,255,0.15);";
  root.textContent = "node-vj (WIP) — core/visuals/RainField を共有コンポーネントとして描画中 (#58)";
}

console.log("[node-vj] rendering shared core RainField");
