import { describe, expect, test } from "bun:test";
import { OnsetDetector } from "./OnsetDetector";

describe("OnsetDetector", () => {
  test("初期状態は全 wave inactive (-1)", () => {
    const d = new OnsetDetector();
    expect(d.getWaveTimes()).toEqual([-1, -1, -1, -1]);
  });

  test("threshold を超える delta で 1 回発火", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.1, 0.12, 0.0);
    d.update(0.5, 0.1, 0.12, 0.1);   // delta=0.5 > 0.1
    const times = d.getWaveTimes();
    expect(times[0]).toBeCloseTo(0.1, 6);
    expect(times[1]).toBe(-1);
  });

  test("threshold 以下では発火しない", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.2, 0.12, 0.0);
    d.update(0.1, 0.2, 0.12, 0.05);  // delta=0.1 < 0.2
    expect(d.getWaveTimes()).toEqual([-1, -1, -1, -1]);
  });

  test("cooldown 内の 2 回目は無視される", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.1, 0.12, 0.0);
    d.update(0.5, 0.1, 0.12, 0.1);   // 発火 @ 0.1
    d.update(0.0, 0.1, 0.12, 0.15);  // bassPrev=0.5, delta=-0.5
    d.update(0.5, 0.1, 0.12, 0.18);  // delta=0.5 だが cooldown 内 (0.18-0.1=0.08 < 0.12)
    const times = d.getWaveTimes();
    expect(times[0]).toBeCloseTo(0.1, 6);
    expect(times[1]).toBe(-1);
  });

  test("cooldown 経過後の発火は正常に記録される", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.1, 0.12, 0.0);
    d.update(0.5, 0.1, 0.12, 0.1);   // 発火 @ 0.1
    d.update(0.0, 0.1, 0.12, 0.3);   // bassPrev=0.5
    d.update(0.5, 0.1, 0.12, 0.4);   // 発火 @ 0.4 (cooldown 0.12 経過)
    const times = d.getWaveTimes();
    expect(times[0]).toBeCloseTo(0.1, 6);
    expect(times[1]).toBeCloseTo(0.4, 6);
  });

  test("5 回目の発火で ring buffer の最古値が上書きされる", () => {
    const d = new OnsetDetector();
    const fire = (t: number) => {
      d.update(0.0, 0.1, 0.12, t);
      d.update(0.5, 0.1, 0.12, t + 0.001);
    };
    fire(0.0);  // → index 0
    fire(0.2);  // → index 1
    fire(0.4);  // → index 2
    fire(0.6);  // → index 3
    fire(0.8);  // → index 0 上書き
    const times = d.getWaveTimes();
    expect(times[0]).toBeCloseTo(0.801, 6);
    expect(times[1]).toBeCloseTo(0.201, 6);
    expect(times[2]).toBeCloseTo(0.401, 6);
    expect(times[3]).toBeCloseTo(0.601, 6);
  });

  test("reset で全 wave がクリアされ bassPrev/lastOnsetTime もリセット", () => {
    const d = new OnsetDetector();
    d.update(0.0, 0.1, 0.12, 0.0);
    d.update(0.5, 0.1, 0.12, 0.1);
    d.reset();
    expect(d.getWaveTimes()).toEqual([-1, -1, -1, -1]);
    d.update(0.0, 0.1, 0.12, 0.2);
    d.update(0.5, 0.1, 0.12, 0.21);
    expect(d.getWaveTimes()[0]).toBeCloseTo(0.21, 6);
  });
});
