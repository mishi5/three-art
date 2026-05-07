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
export class SectionTimeline {
  readonly element: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private series: BandTimeSeries | null = null;
  private boundaries: SectionBoundary[] = [];
  private currentTime = 0;
  private onChange: (next: SectionBoundary[]) => void;

  constructor(onChange: (next: SectionBoundary[]) => void) {
    this.onChange = onChange;
    this.element = document.createElement("div");
    this.element.style.cssText = `
      position: fixed; left: 0; right: ${TIMELINE_RIGHT_OFFSET_PX}px; bottom: 0;
      height: ${TIMELINE_HEIGHT_PX}px;
      background: rgba(0,0,0,0.5);
      border-top: 1px solid rgba(255,255,255,0.2);
      z-index: 50;
      display: none;
    `;
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "width: 100%; height: 100%; display: block;";
    this.element.appendChild(this.canvas);
    document.body.appendChild(this.element);

    this.canvas.addEventListener("click", this.handleClick);
    window.addEventListener("resize", this.handleResize);
    this.handleResize();
  }

  show(): void {
    this.element.style.display = "block";
    // display:none 中は getBoundingClientRect の width が 0 になるため、
    // 表示直後に canvas の internal pixel size を再計算する。
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

  dispose(): void {
    this.canvas.removeEventListener("click", this.handleClick);
    window.removeEventListener("resize", this.handleResize);
    this.element.remove();
  }

  private handleResize = (): void => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    // CSS で `right: <offset>px` を指定しているため、canvas の実際の幅は
    // `getBoundingClientRect().width` で取得する。display:none のときは 0 を
    // 返すので、その場合はフォールバックで window.innerWidth - offset を使う。
    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = rect.width > 0 ? rect.width : Math.max(0, window.innerWidth - TIMELINE_RIGHT_OFFSET_PX);
    this.canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.floor(TIMELINE_HEIGHT_PX * dpr));
    this.draw();
  };

  private handleClick = (ev: MouseEvent): void => {
    if (!this.series) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const mouseT = (x / rect.width) * this.series.duration;
    const hitWindowSec = (8 / rect.width) * this.series.duration; // ≈ 8px
    const next = addOrRemoveBoundary(this.boundaries, mouseT, hitWindowSec);
    this.boundaries = next;
    this.draw();
    this.onChange(next);
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
