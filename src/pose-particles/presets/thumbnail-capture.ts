import * as THREE from "three";

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
}

/**
 * シーンを 1 回だけ独立 RT に描き、結果を data URL (WebP/PNG) として返す。
 *
 * preserveDrawingBuffer に依存しないため、毎フレーム保持コストはかからない。
 * RT は呼び出しごとに作って即時 dispose するので GPU メモリも常時占有しない。
 *
 * 注意: BlurPipeline 等の post-process は通っていない「scene+camera のみの
 * 描画結果」が得られる。サムネとしては十分。
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

  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    renderer.setRenderTarget(null);

    const encode = opts.encode ?? encodeWithCanvas;
    return encode(buf, w, h, mime, quality);
  } finally {
    rt.dispose();
  }
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
