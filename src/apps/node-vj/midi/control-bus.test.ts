// #272: ControlBus（正規化入力の状態保持）のテスト。
// evaluate は毎フレーム同期で回るため、bus はコールバックを持たず状態をポーリングさせる設計。
import { describe, expect, test } from "bun:test";
import { ControlBus } from "./control-bus";
import type { ControlEvent } from "./midi-message";

const cc = (channel: number, number: number, value: number): ControlEvent =>
  ({ kind: "cc", channel, number, value });
const note = (channel: number, number: number, on: boolean, velocity = on ? 1 : 0): ControlEvent =>
  ({ kind: "note", channel, number, on, velocity });

describe("#272 ControlBus: CC", () => {
  test("未受信の CC は undefined", () => {
    expect(new ControlBus().cc(1, 74)).toBeUndefined();
  });

  test("最新値を保持し、後から来た値で上書きする", () => {
    const bus = new ControlBus();
    bus.emit(cc(1, 74, 0.25));
    expect(bus.cc(1, 74)?.value).toBe(0.25);
    bus.emit(cc(1, 74, 0.75));
    expect(bus.cc(1, 74)?.value).toBe(0.75);
  });

  test("channel 0（omni）はどの ch の CC でも拾う", () => {
    const bus = new ControlBus();
    bus.emit(cc(5, 74, 0.5));
    expect(bus.cc(0, 74)?.value).toBe(0.5);
    // ch 指定は一致したものだけ。
    expect(bus.cc(1, 74)).toBeUndefined();
    expect(bus.cc(5, 74)?.value).toBe(0.5);
  });

  test("番号が違えば混ざらない", () => {
    const bus = new ControlBus();
    bus.emit(cc(1, 74, 0.5));
    expect(bus.cc(1, 75)).toBeUndefined();
  });
});

describe("#272 ControlBus: Note", () => {
  test("note on で gate が上がり velocity を保持する", () => {
    const bus = new ControlBus();
    bus.emit(note(1, 36, true, 0.8));
    const s = bus.note(1, 36)!;
    expect(s.gate).toBe(true);
    expect(s.velocity).toBe(0.8);
  });

  test("note off で gate が下がる（velocity は 0）", () => {
    const bus = new ControlBus();
    bus.emit(note(1, 36, true, 0.8));
    bus.emit(note(1, 36, false));
    const s = bus.note(1, 36)!;
    expect(s.gate).toBe(false);
    expect(s.velocity).toBe(0);
  });

  test("onCount は note on のたびに増える（off では増えない）", () => {
    const bus = new ControlBus();
    bus.emit(note(1, 36, true));
    expect(bus.note(1, 36)!.onCount).toBe(1);
    bus.emit(note(1, 36, false));
    expect(bus.note(1, 36)!.onCount).toBe(1);
    bus.emit(note(1, 36, true));
    expect(bus.note(1, 36)!.onCount).toBe(2);
  });

  test("onCount は消費されない: 複数ノードが同じ note を独立に読める", () => {
    // ラッチ方式（読んだら消える）だと最初に読んだ 1 ノードだけが発火してしまう。
    const bus = new ControlBus();
    bus.emit(note(1, 36, true));
    // ノード A / ノード B がそれぞれ「前フレームの onCount」を持つ想定。
    const seenByA = 0;
    const seenByB = 0;
    expect(bus.note(1, 36)!.onCount - seenByA).toBe(1);
    expect(bus.note(1, 36)!.onCount - seenByB).toBe(1);
  });

  test("1 フレームに 2 回叩かれても差分 2 として残る（連打を取りこぼさない）", () => {
    const bus = new ControlBus();
    bus.emit(note(1, 36, true));
    bus.emit(note(1, 36, false));
    bus.emit(note(1, 36, true));
    expect(bus.note(1, 36)!.onCount).toBe(2);
  });

  test("channel 0（omni）はどの ch の note でも拾う", () => {
    const bus = new ControlBus();
    bus.emit(note(9, 36, true, 0.5));
    expect(bus.note(0, 36)?.gate).toBe(true);
    expect(bus.note(0, 36)?.velocity).toBe(0.5);
  });

  test("lastOnSeq は押された順序を表す（後から押した方が大きい）", () => {
    const bus = new ControlBus();
    bus.emit(note(1, 36, true));
    bus.emit(note(1, 37, true));
    expect(bus.note(1, 37)!.lastOnSeq).toBeGreaterThan(bus.note(1, 36)!.lastOnSeq);
  });
});

describe("#272 ControlBus: learn 用の直近イベント", () => {
  test("lastEvent は最後に emit したイベントと通番を返す", () => {
    const bus = new ControlBus();
    expect(bus.lastEvent()).toBeNull();
    bus.emit(cc(3, 74, 0.5));
    expect(bus.lastEvent()!.ev).toEqual(cc(3, 74, 0.5));
  });

  test("currentSeq は emit のたびに単調増加し、lastEvent.seq と一致する", () => {
    const bus = new ControlBus();
    const before = bus.currentSeq();
    bus.emit(cc(1, 1, 0));
    expect(bus.currentSeq()).toBeGreaterThan(before);
    expect(bus.lastEvent()!.seq).toBe(bus.currentSeq());
  });

  test("learn 開始後に届いたイベントかを seq の比較で判定できる", () => {
    const bus = new ControlBus();
    bus.emit(cc(1, 1, 0)); // learn 開始前のイベント
    const startSeq = bus.currentSeq();
    expect(bus.lastEvent()!.seq).toBeLessThanOrEqual(startSeq);
    bus.emit(cc(2, 74, 1));
    expect(bus.lastEvent()!.seq).toBeGreaterThan(startSeq);
  });
});

describe("#272 ControlBus: reset", () => {
  test("reset で保持状態が消える（seq は巻き戻さない）", () => {
    const bus = new ControlBus();
    bus.emit(cc(1, 74, 0.5));
    bus.emit(note(1, 36, true));
    const seq = bus.currentSeq();
    bus.reset();
    expect(bus.cc(1, 74)).toBeUndefined();
    expect(bus.note(1, 36)).toBeUndefined();
    expect(bus.lastEvent()).toBeNull();
    // seq を巻き戻すと learn 待機中のノードが過去イベントを拾ってしまう。
    expect(bus.currentSeq()).toBe(seq);
  });
});
