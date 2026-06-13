// #99: ファイル系入力ノードの再生コントロール共通インターフェース。
// VideoFileInput / AudioFileInput のランタイムが実装し、エディタの transport 行から操作する。
export interface PlaybackControl {
  isPlaying(): boolean;
  /** 再生 ⇄ 一時停止のトグル（未読込・stopped は no-op）。 */
  togglePlay(): void;
  /** 現在の再生位置（秒）。 */
  getCurrentTime(): number;
  /** 総尺（秒）。未読込は 0。 */
  getDuration(): number;
  /** 指定秒へシーク。 */
  seek(t: number): void;
}
