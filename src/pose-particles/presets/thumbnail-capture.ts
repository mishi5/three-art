import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export interface ThumbnailCaptureOptions {
  /** デフォルト 256 */
  width?: number;
  /** デフォルト 144 (16:9) */
  height?: number;
  /** デフォルト "image/webp" */
  mime?: "image/webp" | "image/png";
  /** デフォルト 0.7 */
  quality?: number;
  /** テスト用フック。指定すると Canvas を使わずこの関数の戻り値を返す。 */
  encode?: (buf: Uint8Array, w: number, h: number, mime: string, quality: number) => string;
  /**
   * RenderPass の後・OutputPass の前に挿入する追加パス (Blur など)。
   * 渡したパスの dispose は captureThumbnail 側が描画後に行う。
   * 呼び出しの都度評価したいので関数で受ける。
   */
  extraPasses?: () => Pass[];
  /**
   * テスト用フック。指定時は EffectComposer 経由の描画をスキップし、
   * この関数が返した w*h*4 バイトのバッファを encode に渡す。
   * bun + happy-dom のように本物の WebGL コンテキストが無い環境用のエスケープハッチ。
   */
  __captureForTest?: (
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    w: number,
    h: number,
  ) => Uint8Array;
}

/**
 * シーンを 1 回だけ独立 RT に描き、結果を data URL (WebP/PNG) として返す。
 *
 * 内部で `EffectComposer (RenderPass + OutputPass)` を一時構築する。
 * これにより本番描画と同じく `renderer.outputColorSpace` (sRGB) と
 * `renderer.toneMapping` が適用され、リニア色空間でピクセル化した
 * サムネが全体的に明るく見える (Issue #36) 問題を回避する。
 *
 * preserveDrawingBuffer に依存しないため、毎フレーム保持コストはかからない。
 * composer / RT は呼び出しごとに作って即時 dispose するので GPU メモリも
 * 常時占有しない。
 *
 * 注意: 本実装は `BlurPipeline` の blur パスは通っていない。blur 半径が
 * texel 単位で表現されており、サムネサイズに合わせると過剰/過小になるため、
 * 「OutputPass による色変換のみ」を最優先で揃えている。
 */
export function captureThumbnail(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts: ThumbnailCaptureOptions = {},
): string {
  const w = opts.width ?? 256;
  const h = opts.height ?? 144;
  const mime = opts.mime ?? "image/webp";
  const quality = opts.quality ?? 0.7;

  const extraPasses = opts.extraPasses?.() ?? [];
  const capture = opts.__captureForTest
    ?? ((r, s, c, ww, hh) => captureViaComposer(r, s, c, ww, hh, extraPasses));
  const buf = capture(renderer, scene, camera, w, h);

  const encode = opts.encode ?? encodeWithCanvas;
  return encode(buf, w, h, mime, quality);
}

/**
 * デフォルトの描画ステップ: 専用 EffectComposer (RenderPass + OutputPass) を
 * 構築し、`renderToScreen = false` で内部 swap buffer に書き、`readBuffer` から
 * ピクセルを読み出す。最後に composer と pass を dispose して GPU リソースを回収する。
 */
function captureViaComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  w: number,
  h: number,
  extraPasses: Pass[],
): Uint8Array {
  // composer に渡す初期 RT。Uint8 で読み出したいので UnsignedByteType を強制する
  // (EffectComposer のデフォルトは HalfFloatType で、readRenderTargetPixels(Uint8Array) と
  //  型が合わない)。
  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  const composer = new EffectComposer(renderer, target);
  composer.renderToScreen = false;
  const renderPass = new RenderPass(scene, camera);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  for (const pass of extraPasses) composer.addPass(pass);
  composer.addPass(outputPass);

  const buf = new Uint8Array(w * h * 4);
  try {
    composer.render();
    // 各 pass で swapBuffers されるので、最終出力は readBuffer 側に書かれている。
    renderer.readRenderTargetPixels(composer.readBuffer, 0, 0, w, h, buf);
  } finally {
    // composer.dispose() は内部の renderTarget1 / renderTarget2 を両方 dispose する。
    composer.dispose();
    renderPass.dispose?.();
    for (const p of extraPasses) p.dispose?.();
    outputPass.dispose();
  }
  return buf;
}

/**
 * 任意画像ファイルを 256x144 にアスペクト保持で contain 描画して data URL 化する。
 * (UI 側で「サムネ差し替え」ボタンから呼ぶ)
 */
export async function imageToThumbnailDataURL(
  file: File,
  width = 256,
  height = 144,
  mime: "image/webp" | "image/png" = "image/webp",
  quality = 0.7,
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  // contain
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  ctx.drawImage(bitmap, dx, dy, dw, dh);
  bitmap.close?.();
  return canvas.toDataURL(mime, quality);
}

/**
 * WebGL は左下原点・canvas は左上原点なので Y 反転して 2D canvas に描き、
 * toDataURL する。
 */
function encodeWithCanvas(
  buf: Uint8Array, w: number, h: number, mime: string, quality: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return ""; // 取れなければ空 (呼び出し側で fallback)
  const img = ctx.createImageData(w, h);
  // 行単位で上下反転
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * rowBytes;
    const dst = y * rowBytes;
    img.data.set(buf.subarray(src, src + rowBytes), dst);
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL(mime, quality);
}
