import { expect, test, describe } from "bun:test";
import { stopIfPlaying, type PlaybackControl } from "./playback";

/** テスト用の最小 PlaybackControl フェイク（isPlaying の返り値と togglePlay 呼出回数を記録）。 */
function fakePlayback(playing: boolean): PlaybackControl & { toggleCalls: number } {
  const state = {
    toggleCalls: 0,
    isPlaying: () => playing,
    togglePlay(): void {
      state.toggleCalls++;
      playing = !playing; // togglePlay で再生状態が反転する
    },
    getCurrentTime: () => 0,
    getDuration: () => 0,
    seek: () => {},
  };
  return state;
}

describe("stopIfPlaying (#221)", () => {
  test("再生中（isPlaying=true）なら togglePlay を 1 回呼んで停止する", () => {
    const s = fakePlayback(true);
    stopIfPlaying(s);
    expect(s.toggleCalls).toBe(1);
    expect(s.isPlaying()).toBe(false); // 停止済み
  });

  test("停止中（isPlaying=false）なら togglePlay を呼ばない（再生開始しない）", () => {
    const s = fakePlayback(false);
    stopIfPlaying(s);
    expect(s.toggleCalls).toBe(0);
    expect(s.isPlaying()).toBe(false);
  });

  test("PlaybackControl でない state（isPlaying/togglePlay を持たない）は無視して throw しない", () => {
    expect(() => stopIfPlaying({ loadFile: async () => {} })).not.toThrow();
    expect(() => stopIfPlaying(undefined)).not.toThrow();
    expect(() => stopIfPlaying(null)).not.toThrow();
  });

  test("isPlaying は true だが togglePlay を持たない不完全な state でも throw しない", () => {
    expect(() => stopIfPlaying({ isPlaying: () => true })).not.toThrow();
  });
});
