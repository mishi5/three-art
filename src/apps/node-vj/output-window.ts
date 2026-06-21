// #148: Screen 出力を別ウィンドウ（プロジェクタ/セカンドディスプレイ）へミラーする。
// 方式 B: 出力 canvas の captureStream() を出力ウィンドウの <video> に流す（WebGL でも安定）。
// 出力ウィンドウは UI を持たず映像のみ全画面（object-fit: contain でアスペクト比維持）。

/** captureStream のフレームレート。 */
export const OUTPUT_CAPTURE_FPS = 60;

/** 出力ウィンドウ表示中のレンダリング解像度（PiP 表示サイズに依らず高解像度で描く）。 */
export const OUTPUT_RENDER_W = 1920;
export const OUTPUT_RENDER_H = 1080;

/**
 * 出力ウィンドウの HTML。黒背景・余白なしで video を全画面表示し、
 * クリックで全画面（Fullscreen API）に入る。映像は object-fit: contain でアスペクト比維持。
 */
export function buildOutputHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>node-vj 出力</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background:#000; overflow: hidden; cursor: pointer; }
  #out { width: 100vw; height: 100vh; object-fit: contain; background:#000; display: block; }
  #hint { position: fixed; left: 0; right: 0; bottom: 8px; text-align: center; color: #888; font: 12px system-ui; pointer-events: none; }
</style>
</head>
<body>
<video id="out" autoplay muted playsinline></video>
<div id="hint">クリックで全画面 / Esc で解除</div>
<script>
  document.body.addEventListener('click', function () {
    var el = document.documentElement;
    if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen(); }
    else { if (document.exitFullscreen) document.exitFullscreen(); }
    var h = document.getElementById('hint'); if (h) h.style.display = 'none';
  });
</script>
</body>
</html>`;
}

/**
 * 出力ウィンドウの管理。open() で別ウィンドウを開き、ソース canvas の captureStream を
 * <video> に流す。close()/本体終了でクリーンアップ。再 open は前ウィンドウを閉じてから。
 */
export class OutputWindow {
  private win: Window | null = null;
  private stream: MediaStream | null = null;
  /** 出力ウィンドウが閉じられた時に呼ばれる（UI 状態同期用）。 */
  onClose: (() => void) | null = null;
  private pollTimer: number | null = null;

  isOpen(): boolean {
    return !!this.win && !this.win.closed;
  }

  /** ソース canvas をミラーする出力ウィンドウを開く（既に開いていれば前面化のみ）。 */
  open(source: HTMLCanvasElement): void {
    if (this.isOpen()) { this.win!.focus(); return; }
    const win = window.open("", "node-vj-output", "width=1280,height=720");
    if (!win) return;   // ポップアップブロック時
    this.win = win;
    win.document.open();
    win.document.write(buildOutputHtml());
    win.document.close();
    const video = win.document.getElementById("out") as HTMLVideoElement | null;
    const canStream = (source as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
    if (video && typeof canStream === "function") {
      this.stream = canStream.call(source, OUTPUT_CAPTURE_FPS);
      video.srcObject = this.stream;
      void video.play().catch(() => { /* gesture 不足時は次の操作で */ });
    }
    // 本体終了時に閉じる
    window.addEventListener("pagehide", this.handleParentUnload);
    // 出力ウィンドウが閉じられたら状態を同期（beforeunload は跨ぐので polling で検知）
    this.pollTimer = window.setInterval(() => {
      if (this.win && this.win.closed) this.cleanup();
    }, 500);
  }

  /** 出力ウィンドウを閉じてクリーンアップする。 */
  close(): void {
    if (this.win && !this.win.closed) this.win.close();
    this.cleanup();
  }

  private handleParentUnload = (): void => {
    if (this.win && !this.win.closed) this.win.close();
  };

  private cleanup(): void {
    if (this.pollTimer !== null) { window.clearInterval(this.pollTimer); this.pollTimer = null; }
    window.removeEventListener("pagehide", this.handleParentUnload);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.win = null;
    this.onClose?.();
  }
}
