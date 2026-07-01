// #214: 起動したカメラをシーン切替で落とさないための共有カメラリソース。
// MediaStream と隠し <video> を per-state ライフサイクル（CameraInputRuntime）から切り離し、
// モジュール単一資源として保持する。各 CameraInputRuntime はこれにアタッチし、映像 texture /
// pose 推定の入力に使うだけ。stream を止めるのは「明示停止」「全シーンから CameraInput が
// 消えたときの自動停止」「ページ unload」のみ（各 CameraInputRuntime.dispose では止めない）。
export class SharedCamera {
  private videoEl: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  /** 起動中の getUserMedia。冪等 start のため保持する（多重取得を防ぐ）。 */
  private startPromise: Promise<void> | null = null;

  /** カメラ映像を描画する隠し <video>（遅延生成・複数ノードで共有）。 */
  get video(): HTMLVideoElement {
    if (!this.videoEl) {
      const v = document.createElement("video");
      v.playsInline = true;
      v.muted = true;
      v.autoplay = true;
      v.style.display = "none";
      document.body.appendChild(v);
      this.videoEl = v;
    }
    return this.videoEl;
  }

  /** カメラが稼働中か（stream が生きている）。 */
  get started(): boolean {
    return this.stream !== null;
  }

  /**
   * カメラを開始する。冪等: 起動済みなら即 resolve、起動中なら同じ Promise を返し
   * getUserMedia を二重に呼ばない（user gesture のボタンから呼ぶ）。
   */
  start(): Promise<void> {
    if (this.stream) return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.startPromise = navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      .then(async (stream) => {
        this.stream = stream;
        const v = this.video;
        v.srcObject = stream;
        await v.play();
      })
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  /** カメラ stream を停止しトラックを解放する（video 要素は再利用のため残す）。 */
  stop(): void {
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop();
      this.stream = null;
    }
    if (this.videoEl) this.videoEl.srcObject = null;
  }
}

/** アプリ全体で共有する単一カメラ。 */
export const sharedCamera = new SharedCamera();
