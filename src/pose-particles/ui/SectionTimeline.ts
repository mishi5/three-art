import type { BandTimeSeries, SectionBoundary } from "../automation/AnalysisCache";

export function pickBoundaryAt(
  boundaries: ReadonlyArray<SectionBoundary>,
  mouseT: number,
  hitWindowSec: number,
): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < boundaries.length; i++) {
    const d = Math.abs((boundaries[i]?.t ?? 0) - mouseT);
    if (d <= hitWindowSec && d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function addOrRemoveBoundary(
  boundaries: ReadonlyArray<SectionBoundary>,
  mouseT: number,
  hitWindowSec: number,
): SectionBoundary[] {
  const idx = pickBoundaryAt(boundaries, mouseT, hitWindowSec);
  if (idx >= 0) {
    return boundaries.filter((_, i) => i !== idx);
  }
  const next = [...boundaries, { t: mouseT, source: "user-add" as const }];
  next.sort((a, b) => a.t - b.t);
  return next;
}

export type TimelineMouseInput = {
  /** "down" は mousedown、"scrub" は mousedown 後の mousemove */
  kind: "down" | "scrub";
  altKey: boolean;
  mouseT: number;
  hitWindowSec: number;
  boundaries: ReadonlyArray<SectionBoundary>;
};

export type TimelineMouseAction =
  | { kind: "seek"; t: number }
  | { kind: "boundary-edit"; next: SectionBoundary[] }
  | { kind: "noop" };

/**
 * タイムライン上のマウス操作を意図 (seek / 境界編集 / 何もしない) に変換する。
 * Alt なし: 常に seek。Alt あり: down 時のみ境界編集 (scrub は無視)。
 */
export function interpretTimelineMouse(input: TimelineMouseInput): TimelineMouseAction {
  if (!input.altKey) {
    return { kind: "seek", t: input.mouseT };
  }
  if (input.kind === "down") {
    return { kind: "boundary-edit", next: addOrRemoveBoundary(input.boundaries, input.mouseT, input.hitWindowSec) };
  }
  return { kind: "noop" };
}

/**
 * 画面下部に固定された Canvas タイムライン。auto.enabled のときだけ表示する。
 * クリックで境界を追加/削除し、コールバックで上位 (App) に通知する。
 *
 * Note: high-DPI (Retina) ディスプレイ対応のため、canvas の internal pixel 数は
 * `cssWidth * dpr` x `96 * dpr` を取る。CSS サイズは 100% で親要素の幅に追従。
 * SettingsPanel (右側 300px + 16px margin = 316px 占有) と重ならないよう、
 * タイムライン本体の右端を 332px 内側で止める。
 */
const TIMELINE_RIGHT_OFFSET_PX = 332;
const TIMELINE_HEIGHT_PX = 96;
const PLAY_BUTTON_WIDTH_PX = 32;
export class SectionTimeline {
  readonly element: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private playButton: HTMLButtonElement;
  private series: BandTimeSeries | null = null;
  private boundaries: SectionBoundary[] = [];
  private currentTime = 0;
  private isPlayingState = false;
  private isScrubbing = false;
  private onChange: (next: SectionBoundary[]) => void;
  private onSeek: (t: number) => void;
  private onPauseToggle: () => void;

  constructor(handlers: {
    onChange: (next: SectionBoundary[]) => void;
    onSeek: (t: number) => void;
    onPauseToggle: () => void;
  }) {
    this.onChange = handlers.onChange;
    this.onSeek = handlers.onSeek;
    this.onPauseToggle = handlers.onPauseToggle;

    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: fixed; left: 0; right: ${TIMELINE_RIGHT_OFFSET_PX}px; bottom: 0;
      height: ${TIMELINE_HEIGHT_PX}px;
      background: rgba(0,0,0,0.5);
      border-top: 1px solid rgba(255,255,255,0.2);
      z-index: 50;
      display: none;
      flex-direction: row;
    `;

    this.playButton = document.createElement("button");
    this.playButton.type = "button";
    this.playButton.textContent = "▶";
    this.playButton.setAttribute("aria-label", "再生");
    this.playButton.style.cssText = `
      width: ${PLAY_BUTTON_WIDTH_PX}px; height: 100%;
      background: rgba(255,255,255,0.06); color: #fff;
      border: none; border-right: 1px solid rgba(255,255,255,0.15);
      font-size: 14px; cursor: pointer; flex: 0 0 auto;
    `;
    this.playButton.addEventListener("click", this.handlePlayButton);
    this.element.appendChild(this.playButton);

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "flex: 1 1 auto; height: 100%; display: block; cursor: pointer;";
    this.element.appendChild(this.canvas);
    document.body.appendChild(this.element);

    this.canvas.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("keydown", this.handleAltKeyChange);
    window.addEventListener("keyup", this.handleAltKeyChange);
    window.addEventListener("resize", this.handleResize);
    this.handleResize();
  }

  show(): void {
    // display:none 中は getBoundingClientRect の width が 0 になるため、
    // 表示直後に canvas の internal pixel size を再計算する。
    this.element.style.display = "flex";
    this.handleResize();
  }
  hide(): void { this.element.style.display = "none"; }

  setData(series: BandTimeSeries, boundaries: SectionBoundary[]): void {
    this.series = series;
    this.boundaries = [...boundaries].sort((a, b) => a.t - b.t);
    this.draw();
  }

  setCurrentTime(t: number): void {
    this.currentTime = t;
    this.draw();
  }

  /** 再生/一時停止状態を反映してボタンの ▶/Ⅱ を切り替える。 */
  setIsPlaying(playing: boolean): void {
    if (this.isPlayingState === playing) return;
    this.isPlayingState = playing;
    this.playButton.textContent = playing ? "Ⅱ" : "▶";
    this.playButton.setAttribute("aria-label", playing ? "一時停止" : "再生");
  }

  dispose(): void {
    this.isScrubbing = false;
    this.canvas.removeEventListener("mousedown", this.handleMouseDown);
    this.playButton.removeEventListener("click", this.handlePlayButton);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("keydown", this.handleAltKeyChange);
    window.removeEventListener("keyup", this.handleAltKeyChange);
    window.removeEventListener("resize", this.handleResize);
    this.element.remove();
  }

  private handleResize = (): void => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const rect = this.canvas.getBoundingClientRect();
    const fallback = Math.max(0, window.innerWidth - TIMELINE_RIGHT_OFFSET_PX - PLAY_BUTTON_WIDTH_PX);
    const cssWidth = rect.width > 0 ? rect.width : fallback;
    this.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(TIMELINE_HEIGHT_PX * dpr));
    this.draw();
  };

  private handlePlayButton = (): void => {
    this.onPauseToggle();
    // Space キーで二重発火しないようボタンの focus を外す
    this.playButton.blur();
  };

  /** マウス座標を曲時刻に変換。canvas が非表示で width=0 のときは null。
   *  rect の取得は 1 イベントにつき 1 回で済むよう mouseT と rectWidth を同時に返す。 */
  private mouseTAndRect(ev: MouseEvent): { mouseT: number; rectWidth: number } | null {
    if (!this.series) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const x = ev.clientX - rect.left;
    return { mouseT: (x / rect.width) * this.series.duration, rectWidth: rect.width };
  }

  private handleMouseDown = (ev: MouseEvent): void => {
    if (ev.button !== 0) return; // 左クリックのみ
    if (this.isScrubbing) return; // 既に scrub 中なら無視 (reentrancy ガード)
    if (!this.series) return;
    const r = this.mouseTAndRect(ev);
    if (r === null) return;
    const hitWindowSec = (8 / r.rectWidth) * this.series.duration;
    const action = interpretTimelineMouse({
      kind: "down",
      altKey: ev.altKey,
      mouseT: r.mouseT,
      hitWindowSec,
      boundaries: this.boundaries,
    });
    if (action.kind === "seek") {
      this.onSeek(action.t);
      this.isScrubbing = true;
      window.addEventListener("mousemove", this.handleMouseMove);
      window.addEventListener("mouseup", this.handleMouseUp);
    } else if (action.kind === "boundary-edit") {
      this.boundaries = action.next;
      this.draw();
      this.onChange(action.next);
    }
  };

  private handleMouseMove = (ev: MouseEvent): void => {
    if (!this.isScrubbing || !this.series) return;
    const r = this.mouseTAndRect(ev);
    if (r === null) return;
    const hitWindowSec = (8 / r.rectWidth) * this.series.duration;
    const action = interpretTimelineMouse({
      kind: "scrub",
      altKey: ev.altKey,
      mouseT: r.mouseT,
      hitWindowSec,
      boundaries: this.boundaries,
    });
    if (action.kind === "seek") this.onSeek(action.t);
  };

  private handleMouseUp = (): void => {
    if (!this.isScrubbing) return;
    this.isScrubbing = false;
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mouseup", this.handleMouseUp);
  };

  private handleAltKeyChange = (ev: KeyboardEvent): void => {
    if (ev.key === "Alt") {
      // Alt 押下中は境界編集モードを示すため crosshair に切り替える
      this.canvas.style.cursor = ev.type === "keydown" ? "crosshair" : "pointer";
    }
  };

  private draw(): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const { width: w, height: h } = this.canvas;
    ctx.clearRect(0, 0, w, h);
    if (!this.series) return;
    const dur = this.series.duration;
    if (dur <= 0) return;

    // volume を白塗り
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const f of this.series.frames) {
      const x = (f.t / dur) * w;
      const y = h - f.volume * h;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fill();

    // bass / mid / treble の線
    const drawBand = (key: "bass" | "mid" | "treble", color: string) => {
      ctx.beginPath();
      for (let i = 0; i < this.series!.frames.length; i++) {
        const f = this.series!.frames[i]!;
        const x = (f.t / dur) * w;
        const y = h - f[key] * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
    };
    drawBand("bass", "rgba(255,80,80,0.6)");
    drawBand("mid", "rgba(80,255,120,0.6)");
    drawBand("treble", "rgba(80,160,255,0.6)");

    // 境界
    for (const b of this.boundaries) {
      const x = (b.t / dur) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.strokeStyle = b.source === "user-add" ? "rgba(255,255,80,0.9)" : "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // 現在時刻
    const cx = (this.currentTime / dur) * w;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.strokeStyle = "rgba(255,220,80,1.0)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
