// #179: 出力のビデオ録画（MediaRecorder ラッパ）。
// 純関数（mimeType 選定・ファイル名）はテスト対象。録画自体は Playwright スモークで確認。

/** 優先順位つき録画コンテナ/コーデック候補（先頭から対応する最初を採用）。 */
export const RECORDER_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

/**
 * 対応する録画 mimeType を選ぶ。isSupported は MediaRecorder.isTypeSupported 相当。
 * どれも非対応なら空文字（呼び出し側はブラウザ既定に委ねる）。
 */
export function pickRecorderMimeType(isSupported: (mime: string) => boolean): string {
  for (const mime of RECORDER_MIME_CANDIDATES) {
    if (isSupported(mime)) return mime;
  }
  return "";
}

/** 保存ファイル名 `node-vj-YYYYMMDD-HHMMSS.webm`（ローカル時刻）。 */
export function recordingFileName(date: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  const y = p(date.getFullYear(), 4);
  const stamp = `${y}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `node-vj-${stamp}.webm`;
}

/** MediaRecorder を開始/停止し、停止時に結合 Blob を返す薄いラッパ。 */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  get recording(): boolean {
    return !!this.rec && this.rec.state !== "inactive";
  }

  /**
   * 録画開始。mimeType が空なら指定せずブラウザ既定に委ねる。
   * videoBitsPerSecond を渡すと画質（ビットレート）を指定する（既定の自動値は低すぎることがある）。
   */
  start(stream: MediaStream, mimeType: string, videoBitsPerSecond?: number): void {
    if (this.recording) return;
    this.chunks = [];
    const opts: MediaRecorderOptions = {};
    if (mimeType) opts.mimeType = mimeType;
    if (videoBitsPerSecond) opts.videoBitsPerSecond = videoBitsPerSecond;
    this.rec = new MediaRecorder(stream, opts);
    this.rec.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.rec.start();
  }

  /** 録画停止。蓄積した chunk を結合した Blob を解決する。 */
  stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const rec = this.rec;
      if (!rec || rec.state === "inactive") {
        resolve(new Blob(this.chunks, { type: "video/webm" }));
        return;
      }
      rec.onstop = () => {
        const type = rec.mimeType || "video/webm";
        resolve(new Blob(this.chunks, { type }));
        this.rec = null;
      };
      rec.stop();
    });
  }
}
