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
  /** 外部所有の video を使う場合 true（stop でカメラ/要素に触らない）。 */
  private externalVideo = false;

  constructor(private onResult: PoseCallback) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    // 表示しない（DebugOverlay が必要なら取り出して使う）
    this.video.style.display = "none";
    document.body.appendChild(this.video);
  }

  getVideo(): HTMLVideoElement {
    return this.video;
  }

  /**
   * 姿勢推定を開始する。externalVideo を渡すと既存のカメラ映像（呼び出し側所有）に
   * 対して推定だけを行い、カメラの取得・解放には関与しない（#66 CameraInput 用）。
   */
  async start(externalVideo?: HTMLVideoElement): Promise<void> {
    if (externalVideo) {
      this.externalVideo = true;
      this.video.remove(); // 自前の隠し video は使わない
      this.video = externalVideo;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
    }

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
    if (!this.externalVideo) {
      this.video.srcObject = null;
      this.video.remove();
    }
  }
}
