// #148: 背面化（タブ非表示/別ウィンドウ全画面に覆われる）時に requestAnimationFrame が
// スロットルされても描画を回し続けるための Worker タイマー駆動 ticker。
// Worker の setInterval は背面でもスロットルされないため、出力ウィンドウのミラーが固まらない。

/** Worker のソース（指定 fps で postMessage、'stop' で停止）。Blob 経由で生成するので文字列で持つ。 */
export function buildTickerWorkerSource(fps: number): string {
  const interval = Math.max(1, Math.round(1000 / Math.max(1, fps)));
  return `var t=setInterval(function(){postMessage(0);},${interval});`
    + `onmessage=function(e){if(e.data==='stop'){clearInterval(t);}};`;
}

/** Worker タイマーで onTick を定期呼び出しする（start/stop）。 */
export class BackgroundTicker {
  private worker: Worker | null = null;
  private url: string | null = null;

  constructor(private readonly fps: number, private readonly onTick: () => void) {}

  get running(): boolean {
    return this.worker !== null;
  }

  start(): void {
    if (this.worker) return;
    this.url = URL.createObjectURL(new Blob([buildTickerWorkerSource(this.fps)], { type: "text/javascript" }));
    this.worker = new Worker(this.url);
    this.worker.onmessage = () => this.onTick();
  }

  stop(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
  }
}
