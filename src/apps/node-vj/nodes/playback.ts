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

/**
 * #221: PlaybackControl を持つ state が再生中なら停止する（duck-type）。
 * loadFile が先頭から自動再生するため、復元/初期化で新規読込した Video/Audio を止めるのに使う。
 * PlaybackControl でない（isPlaying/togglePlay を持たない）state は無視する。
 */
export function stopIfPlaying(state: unknown): void {
  const pb = state as Partial<PlaybackControl> | undefined;
  if (pb?.isPlaying?.() && pb.togglePlay) pb.togglePlay();
}
