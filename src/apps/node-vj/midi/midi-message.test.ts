// #272: MIDI バイト列 → 正規化 ControlEvent の変換テスト（Web MIDI API 非依存の純関数）。
import { describe, expect, test } from "bun:test";
import { parseMidiMessage } from "./midi-message";

describe("#272 parseMidiMessage: Control Change", () => {
  test("0xB0 は cc イベントになり value は 0..1 に正規化される", () => {
    // ch1 / CC74 / 値 127（最大）。
    expect(parseMidiMessage([0xb0, 74, 127])).toEqual({
      kind: "cc", channel: 1, number: 74, value: 1,
    });
  });

  test("channel は下位 4bit + 1（1..16 で表現する）", () => {
    expect(parseMidiMessage([0xb0, 1, 0])?.channel).toBe(1);
    expect(parseMidiMessage([0xb5, 1, 0])?.channel).toBe(6);
    expect(parseMidiMessage([0xbf, 1, 0])?.channel).toBe(16);
  });

  test("value 0 は 0、中間値は 0..1 の間に写像される", () => {
    expect(parseMidiMessage([0xb0, 74, 0])).toMatchObject({ value: 0 });
    const mid = parseMidiMessage([0xb0, 74, 64]);
    expect(mid?.value).toBeGreaterThan(0.5);
    expect(mid?.value).toBeLessThan(0.51);
  });
});

describe("#272 parseMidiMessage: Note", () => {
  test("0x90 は note on になり velocity は 0..1 に正規化される", () => {
    expect(parseMidiMessage([0x90, 36, 127])).toEqual({
      kind: "note", channel: 1, number: 36, on: true, velocity: 1,
    });
  });

  test("0x80 は note off で velocity 0", () => {
    expect(parseMidiMessage([0x80, 36, 64])).toEqual({
      kind: "note", channel: 1, number: 36, on: false, velocity: 0,
    });
  });

  test("velocity 0 の note on は note off として扱う（MIDI の慣習）", () => {
    // 多くのコントローラが離鍵をこの形で送るため、on=false に倒さないと gate が下がらない。
    expect(parseMidiMessage([0x90, 36, 0])).toEqual({
      kind: "note", channel: 1, number: 36, on: false, velocity: 0,
    });
  });
});

describe("#272 parseMidiMessage: 対象外・不正入力", () => {
  test("ピッチベンド・アフタータッチ・MIDI クロックは null", () => {
    expect(parseMidiMessage([0xe0, 0, 64])).toBeNull(); // pitch bend
    expect(parseMidiMessage([0xa0, 36, 64])).toBeNull(); // polyphonic aftertouch
    expect(parseMidiMessage([0xd0, 64])).toBeNull(); // channel aftertouch
    expect(parseMidiMessage([0xf8])).toBeNull(); // MIDI clock
  });

  test("status バイトが無い（ランニングステータス）は null", () => {
    // Web MIDI は常に status 付きで届くため対応不要。
    expect(parseMidiMessage([74, 127])).toBeNull();
  });

  test("データ長が足りないメッセージは null", () => {
    expect(parseMidiMessage([0xb0])).toBeNull();
    expect(parseMidiMessage([0xb0, 74])).toBeNull();
    expect(parseMidiMessage([0x90, 36])).toBeNull();
    expect(parseMidiMessage([])).toBeNull();
  });

  test("データバイトの最上位ビットは無視して 0..127 に丸める", () => {
    expect(parseMidiMessage([0xb0, 0x80 | 74, 127])).toMatchObject({ number: 74 });
  });

  test("Uint8Array でも同じ結果になる", () => {
    expect(parseMidiMessage(new Uint8Array([0xb0, 74, 127]))).toEqual({
      kind: "cc", channel: 1, number: 74, value: 1,
    });
  });
});
