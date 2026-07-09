import { expect, test, describe } from "bun:test";
import { finalizeRecording, firedBetween } from "./tap-sequencer-logic";

describe("#204 finalizeRecording", () => {
  test("タップ列とループ長をそのまま確定する", () => {
    const r = finalizeRecording([0.5, 1.0, 1.5], 2.0)!;
    expect(r.taps).toEqual([0.5, 1.0, 1.5]);
    expect(r.loopLenSec).toBe(2.0);
  });

  test("タップ 0 回は null（再生しない）", () => {
    expect(finalizeRecording([], 2.0)).toBeNull();
  });

  test("ループ長 0 以下 / 非有限は null", () => {
    expect(finalizeRecording([0.5], 0)).toBeNull();
    expect(finalizeRecording([0.5], -1)).toBeNull();
    expect(finalizeRecording([0.5], Number.NaN)).toBeNull();
  });

  test("taps は昇順に整列される", () => {
    const r = finalizeRecording([1.5, 0.2, 0.9], 2.0)!;
    expect(r.taps).toEqual([0.2, 0.9, 1.5]);
  });

  test("範囲外タップは防御的に正規化（負→0・loopLen 以上→wrap）", () => {
    const r = finalizeRecording([-0.1, 2.0, 2.5], 2.0)!;
    // -0.1→0, 2.0→0, 2.5→0.5
    expect(r.taps).toEqual([0, 0, 0.5]);
  });

  test("非有限のタップは捨てる（全滅なら null）", () => {
    const r = finalizeRecording([Number.NaN, 0.5], 2.0)!;
    expect(r.taps).toEqual([0.5]);
    expect(finalizeRecording([Number.NaN], 2.0)).toBeNull();
  });
});

describe("#204 firedBetween（半開区間 [prev, cur)）", () => {
  const taps = [0.5, 1.5];
  const L = 2.0;

  test("区間内にタップがあれば true", () => {
    expect(firedBetween(0.4, 0.6, taps, L)).toBe(true);
    expect(firedBetween(1.4, 1.6, taps, L)).toBe(true);
  });

  test("区間内にタップが無ければ false", () => {
    expect(firedBetween(0.6, 0.8, taps, L)).toBe(false);
    expect(firedBetween(1.6, 1.9, taps, L)).toBe(false);
  });

  test("半開区間: 始端は含み終端は含まない（連続フレームで二重発火しない）", () => {
    expect(firedBetween(0.5, 0.6, taps, L)).toBe(true);   // [0.5, 0.6) は 0.5 を含む
    expect(firedBetween(0.4, 0.5, taps, L)).toBe(false);  // [0.4, 0.5) は 0.5 を含まない
  });

  test("t=0 のタップは再生開始直後のフレームで発火する", () => {
    expect(firedBetween(0, 0.016, [0], L)).toBe(true);
  });

  test("2 周目以降も wrap して発火する", () => {
    expect(firedBetween(2.4, 2.6, taps, L)).toBe(true);   // 0.5 の 2 周目
    expect(firedBetween(4.4, 4.6, taps, L)).toBe(true);   // 3 周目
    expect(firedBetween(2.6, 2.8, taps, L)).toBe(false);
  });

  test("ループ境界（wrap）を跨ぐ区間: 末尾側と先頭側の両方を見る", () => {
    // [1.9, 2.1) は wrap して [1.9, 2.0)∪[0, 0.1)。taps に 1.95 や 0.05 があれば発火。
    expect(firedBetween(1.9, 2.1, [1.95], L)).toBe(true);
    expect(firedBetween(1.9, 2.1, [0.05], L)).toBe(true);
    expect(firedBetween(1.9, 2.1, [0.5], L)).toBe(false);
  });

  test("wrap 跨ぎでも連続フレームで二重発火・欠落しない", () => {
    // 0.05 のタップ: [1.9, 2.1) で 1 回、続く [2.1, 2.3) では発火しない。
    expect(firedBetween(1.9, 2.1, [0.05], L)).toBe(true);
    expect(firedBetween(2.1, 2.3, [0.05], L)).toBe(false);
    // 1.95 のタップ: [1.8, 1.95) では発火せず、[1.95, 2.05) で 1 回。
    expect(firedBetween(1.8, 1.95, [1.95], L)).toBe(false);
    expect(firedBetween(1.95, 2.05, [1.95], L)).toBe(true);
  });

  test("dt がループ長以上（コマ落ち等）は最低 1 回として true", () => {
    expect(firedBetween(0.6, 0.6 + L, taps, L)).toBe(true);
    expect(firedBetween(0.6, 0.6 + 10 * L, taps, L)).toBe(true);
  });

  test("dt<=0 / taps 空 / loopLen<=0 は false", () => {
    expect(firedBetween(1.0, 1.0, taps, L)).toBe(false);
    expect(firedBetween(1.0, 0.5, taps, L)).toBe(false);
    expect(firedBetween(0, 1, [], L)).toBe(false);
    expect(firedBetween(0, 1, taps, 0)).toBe(false);
  });

  test("フレーム間に複数タップが入っても発火は 1 回ぶん（true）扱い", () => {
    expect(firedBetween(0.4, 1.6, taps, L)).toBe(true); // 0.5 と 1.5 の両方を含む
  });
});

// #278: playPositionSec は TapSequencerRuntime が AutomationRuntime と同じ累積 playhead 方式へ
// 移行したため使われなくなり削除した（表示位置は automation-logic.ts の loopPosition を使う）。
