import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";

/**
 * Bone connections (start/end MediaPipe landmark indices). Subset of the official
 * POSE_CONNECTIONS that's enough to read body posture at a glance.
 */
const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // face/head
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  // shoulders + arms
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22],
  // torso
  [11, 23], [12, 24], [23, 24],
  // legs
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

type Mode = "off" | "video" | "skeleton" | "both";

/**
 * Floating debug overlay that shows what MediaPipe sees.
 *
 * Modes:
 *   off       — hidden
 *   video     — webcam feed only
 *   skeleton  — skeleton on black
 *   both      — webcam feed with skeleton overlay
 *
 * Press D to cycle modes.
 */
export class DebugOverlay {
  private container: HTMLDivElement;
  private videoWrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private label: HTMLDivElement;
  private mode: Mode = "off";
  private latest: PoseLandmarkerResult | null = null;
  private rafId: number | null = null;

  constructor(private video: HTMLVideoElement) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: fixed; left: 16px; bottom: 16px;
      width: 320px; height: 240px;
      border: 1px solid rgba(255,255,255,0.25);
      background: #000;
      display: none;
      z-index: 60;
      font-family: system-ui;
    `;

    this.videoWrap = document.createElement("div");
    this.videoWrap.style.cssText = `
      position: absolute; inset: 0;
      overflow: hidden;
      display: none;
    `;
    // Move the existing video element into the wrap so we don't duplicate the stream.
    // Style it to fill the wrap, mirrored for selfie display.
    video.style.cssText = `
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    `;
    this.videoWrap.appendChild(video);
    this.container.appendChild(this.videoWrap);

    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 240;
    this.canvas.style.cssText = `
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      pointer-events: none;
    `;
    this.container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;

    this.label = document.createElement("div");
    this.label.style.cssText = `
      position: absolute; left: 4px; top: 4px;
      padding: 2px 6px;
      background: rgba(0,0,0,0.55);
      color: #fff; font-size: 11px;
      letter-spacing: 0.05em;
    `;
    this.container.appendChild(this.label);

    document.body.appendChild(this.container);

    window.addEventListener("keydown", this.onKeyDown);
  }

  /** Called from PoseInput callback so we always have the latest landmarks to draw. */
  setResult(result: PoseLandmarkerResult): void {
    this.latest = result;
  }

  cycleMode(): void {
    const order: Mode[] = ["off", "video", "skeleton", "both"];
    const next = order[(order.indexOf(this.mode) + 1) % order.length]!;
    this.setMode(next);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === "off") {
      this.container.style.display = "none";
      this.video.style.display = "none";
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      this.rafId = null;
      return;
    }
    this.container.style.display = "block";
    const showVideo = mode === "video" || mode === "both";
    this.videoWrap.style.display = showVideo ? "block" : "none";
    this.video.style.display = showVideo ? "block" : "none";
    this.label.textContent = `debug: ${mode}  (press D)`;
    if (this.rafId === null) {
      const draw = (): void => {
        this.rafId = requestAnimationFrame(draw);
        this.draw();
      };
      draw();
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "d" || e.key === "D") this.cycleMode();
  };

  private draw(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this.mode === "off" || this.mode === "video") return;

    const lms = this.latest?.landmarks?.[0];
    if (!lms) return;

    // Mirror the drawing to match the mirrored video.
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);

    // Bones
    ctx.strokeStyle = "rgba(0,255,160,0.9)";
    ctx.lineWidth = 2;
    for (const [a, b] of POSE_CONNECTIONS) {
      const la = lms[a];
      const lb = lms[b];
      if (!la || !lb) continue;
      const va = la.visibility ?? 0;
      const vb = lb.visibility ?? 0;
      if (va < 0.2 && vb < 0.2) continue;
      ctx.globalAlpha = Math.min(1, Math.min(va, vb) + 0.2);
      ctx.beginPath();
      ctx.moveTo(la.x * W, la.y * H);
      ctx.lineTo(lb.x * W, lb.y * H);
      ctx.stroke();
    }

    // Joints
    ctx.globalAlpha = 1;
    for (let i = 0; i < lms.length; i++) {
      const lm = lms[i]!;
      const v = lm.visibility ?? 0;
      if (v < 0.2) continue;
      ctx.fillStyle = `rgba(255,255,255,${0.3 + v * 0.7})`;
      ctx.beginPath();
      ctx.arc(lm.x * W, lm.y * H, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.container.remove();
  }
}
