// #272: MIDI 系ノードの純ロジック（値スケーリング・learn 状態機械・index 算出）のテスト。
import { describe, expect, test } from "bun:test";
import { MidiLearn, padIndexOf, routeIndex, scaleCc } from "./midi-node-logic";
import { ControlBus } from "../midi/control-bus";

describe("#272 scaleCc: 0..1 を min..max へ写像", () => {
  test("既定レンジ 0..1 はそのまま", () => {
    expect(scaleCc(0, 0, 1)).toBe(0);
    expect(scaleCc(0.5, 0, 1)).toBe(0.5);
    expect(scaleCc(1, 0, 1)).toBe(1);
  });

  test("任意レンジへ線形写像する", () => {
    expect(scaleCc(0, -1, 1)).toBe(-1);
    expect(scaleCc(0.5, -1, 1)).toBe(0);
    expect(scaleCc(1, 0, 100)).toBe(100);
  });

  test("min > max（反転レンジ）でもそのまま写像する", () => {
    // ノブを回すと値が下がる、という使い方を許す。
    expect(scaleCc(0, 1, 0)).toBe(1);
    expect(scaleCc(1, 1, 0)).toBe(0);
  });

  test("非有限値は min にフォールバックする", () => {
    expect(scaleCc(Number.NaN, 2, 5)).toBe(2);
  });
});

describe("#272 padIndexOf: note 番号 → パッド index", () => {
  test("baseNote が index 0、そこから連番", () => {
    expect(padIndexOf(36, 36, 16)).toBe(0);
    expect(padIndexOf(37, 36, 16)).toBe(1);
    expect(padIndexOf(51, 36, 16)).toBe(15);
  });

  test("範囲外は null", () => {
    expect(padIndexOf(35, 36, 16)).toBeNull();
    expect(padIndexOf(52, 36, 16)).toBeNull();
  });
});

describe("#272 routeIndex: index + offset → 出力番号", () => {
  test("index を四捨五入し offset を足す", () => {
    expect(routeIndex(0, 0, 16)).toBe(0);
    expect(routeIndex(2.4, 0, 16)).toBe(2);
    expect(routeIndex(2.6, 0, 16)).toBe(3);
    expect(routeIndex(0, 5, 16)).toBe(5);
  });

  test("範囲外・非有限は null（何も発火しない）", () => {
    expect(routeIndex(-1, 0, 16)).toBeNull();
    expect(routeIndex(16, 0, 16)).toBeNull();
    expect(routeIndex(15, 1, 16)).toBeNull();
    expect(routeIndex(Number.NaN, 0, 16)).toBeNull();
  });

  test("offset は負の値も受ける（17 個目以降を 2 台目で受ける逆向き）", () => {
    expect(routeIndex(16, -16, 16)).toBe(0);
  });
});

describe("#272 MidiLearn: 待機と取り込み", () => {
  test("初期状態は待機していない", () => {
    expect(new MidiLearn().waiting).toBe(false);
  });

  test("start で待機に入り、cancel で戻る", () => {
    const bus = new ControlBus();
    const learn = new MidiLearn();
    learn.start(bus);
    expect(learn.waiting).toBe(true);
    learn.cancel();
    expect(learn.waiting).toBe(false);
  });

  test("toggle は待機の開始と解除を切り替える", () => {
    const bus = new ControlBus();
    const learn = new MidiLearn();
    learn.toggle(bus);
    expect(learn.waiting).toBe(true);
    learn.toggle(bus);
    expect(learn.waiting).toBe(false);
  });

  test("待機していなければ poll は常に null", () => {
    const bus = new ControlBus();
    bus.emit({ kind: "cc", channel: 1, number: 74, value: 1 });
    expect(new MidiLearn().poll(bus, "cc")).toBeNull();
  });

  test("待機開始後に届いた cc から ch と番号を取り、取り込むと待機を抜ける", () => {
    const bus = new ControlBus();
    const learn = new MidiLearn();
    learn.start(bus);
    expect(learn.poll(bus, "cc")).toBeNull(); // まだ何も来ていない
    bus.emit({ kind: "cc", channel: 3, number: 74, value: 0.5 });
    expect(learn.poll(bus, "cc")).toEqual({ channel: 3, number: 74 });
    expect(learn.waiting).toBe(false);
    // 一度取り込んだら再度拾わない。
    expect(learn.poll(bus, "cc")).toBeNull();
  });

  test("待機開始「前」のイベントは拾わない", () => {
    const bus = new ControlBus();
    bus.emit({ kind: "cc", channel: 1, number: 1, value: 0 });
    const learn = new MidiLearn();
    learn.start(bus);
    expect(learn.poll(bus, "cc")).toBeNull();
  });

  test("種別が違うイベントでは待機を抜けない（CC 待ちは note を無視する）", () => {
    const bus = new ControlBus();
    const learn = new MidiLearn();
    learn.start(bus);
    bus.emit({ kind: "note", channel: 1, number: 36, on: true, velocity: 1 });
    expect(learn.poll(bus, "cc")).toBeNull();
    expect(learn.waiting).toBe(true);
    bus.emit({ kind: "cc", channel: 2, number: 20, value: 1 });
    expect(learn.poll(bus, "cc")).toEqual({ channel: 2, number: 20 });
  });

  test("note 待ちは note off では取り込まない（叩いた瞬間で決める）", () => {
    const bus = new ControlBus();
    const learn = new MidiLearn();
    learn.start(bus);
    bus.emit({ kind: "note", channel: 1, number: 36, on: false, velocity: 0 });
    expect(learn.poll(bus, "note")).toBeNull();
    bus.emit({ kind: "note", channel: 1, number: 40, on: true, velocity: 1 });
    expect(learn.poll(bus, "note")).toEqual({ channel: 1, number: 40 });
  });
});
