import { expect, test, describe } from "bun:test";
import {
  advancePlayhead, armEdge, loopPosition, pushFrame, sampleAt, sanitizeFrames,
  type AutomationFrame,
} from "./automation-logic";

describe("#186 armEdge", () => {
  test("false→true（立ち上がり）は start", () => {
    expect(armEdge(false, true)).toBe("start");
  });

  test("true→false（立ち下がり）は stop", () => {
    expect(armEdge(true, false)).toBe("stop");
  });

  test("変化なし（true→true / false→false）は none", () => {
    expect(armEdge(true, true)).toBe("none");
    expect(armEdge(false, false)).toBe("none");
  });
});

describe("#186 pushFrame", () => {
  test("push した順に積まれる", () => {
    const frames: AutomationFrame[] = [];
    pushFrame(frames, 0, 1, 10);
    pushFrame(frames, 0.1, 2, 10);
    expect(frames).toEqual([{ t: 0, v: 1 }, { t: 0.1, v: 2 }]);
  });

  test("上限超過分は古い方から捨てる", () => {
    const frames: AutomationFrame[] = [];
    for (let i = 0; i < 5; i++) pushFrame(frames, i, i * 10, 3);
    expect(frames).toEqual([{ t: 2, v: 20 }, { t: 3, v: 30 }, { t: 4, v: 40 }]);
  });

  test("非有限値は 0 に丸める", () => {
    const frames: AutomationFrame[] = [];
    pushFrame(frames, 0, Number.NaN, 10);
    pushFrame(frames, 1, Number.POSITIVE_INFINITY, 10);
    expect(frames).toEqual([{ t: 0, v: 0 }, { t: 1, v: 0 }]);
  });
});

describe("#186 sampleAt", () => {
  test("0 件は 0", () => {
    expect(sampleAt([], 1)).toBe(0);
  });

  test("1 件は t によらずその値", () => {
    const frames = [{ t: 5, v: 42 }];
    expect(sampleAt(frames, 0)).toBe(42);
    expect(sampleAt(frames, 5)).toBe(42);
    expect(sampleAt(frames, 100)).toBe(42);
  });

  test("範囲外はクランプ（先頭より前/末尾より後）", () => {
    const frames = [{ t: 1, v: 10 }, { t: 2, v: 20 }];
    expect(sampleAt(frames, 0)).toBe(10);
    expect(sampleAt(frames, 3)).toBe(20);
  });

  test("2 点間は線形補間", () => {
    const frames = [{ t: 0, v: 0 }, { t: 2, v: 10 }];
    expect(sampleAt(frames, 1)).toBeCloseTo(5);
    expect(sampleAt(frames, 0.5)).toBeCloseTo(2.5);
  });

  test("3 点以上でも該当区間を選んで補間する", () => {
    const frames = [{ t: 0, v: 0 }, { t: 1, v: 10 }, { t: 2, v: 0 }];
    expect(sampleAt(frames, 0.5)).toBeCloseTo(5);
    expect(sampleAt(frames, 1.5)).toBeCloseTo(5);
    expect(sampleAt(frames, 1)).toBeCloseTo(10);
  });

  test("同時刻フレーム（span=0 の区間）があっても破綻せず線形探索で最初に到達した区間の値を返す", () => {
    const frames = [{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 1, v: 3 }, { t: 2, v: 4 }];
    expect(sampleAt(frames, 1)).toBe(2); // [0,1] 区間で t<=b.t に先に一致する
    expect(sampleAt(frames, 1.5)).toBeCloseTo(3.5); // [1,2] 区間（3→4）で補間
  });
});

describe("#186 advancePlayhead", () => {
  test("loop: 加算し続ける（wrap しない・wrap は loopPosition の役目）", () => {
    expect(advancePlayhead(1.9, 0.2, 2, "loop", 1)).toBeCloseTo(2.1);
  });

  test("pingpong: 加算し続ける（折り返しは loopPosition の役目）", () => {
    expect(advancePlayhead(1.9, 0.2, 2, "pingpong", 1)).toBeCloseTo(2.1);
  });

  test("once: [0, loopLenSec] にクランプして末尾で停止する", () => {
    expect(advancePlayhead(1.9, 0.5, 2, "once", 1)).toBe(2);
    expect(advancePlayhead(2, 0.5, 2, "once", 1)).toBe(2); // 末尾到達後は動かない
  });

  test("speed 倍速がかかる", () => {
    expect(advancePlayhead(0, 1, 10, "loop", 2)).toBeCloseTo(2);
    expect(advancePlayhead(0, 1, 10, "loop", 0.5)).toBeCloseTo(0.5);
  });

  test("loopLenSec<=0・非有限は 0", () => {
    expect(advancePlayhead(5, 0.1, 0, "loop", 1)).toBe(0);
    expect(advancePlayhead(5, 0.1, -1, "loop", 1)).toBe(0);
    expect(advancePlayhead(5, 0.1, Number.NaN, "loop", 1)).toBe(0);
  });

  test("dtSec/speed が非有限なら現在値を維持する", () => {
    expect(advancePlayhead(3, Number.NaN, 10, "loop", 1)).toBe(3);
    expect(advancePlayhead(3, 0.1, 10, "loop", Number.NaN)).toBe(3);
  });
});

describe("#186 loopPosition", () => {
  test("loop: modulo wrap（負値も [0, L) へ）", () => {
    expect(loopPosition(0.5, 2, "loop")).toBeCloseTo(0.5);
    expect(loopPosition(2.5, 2, "loop")).toBeCloseTo(0.5);
    expect(loopPosition(-0.5, 2, "loop")).toBeCloseTo(1.5);
  });

  test("pingpong: 三角波で往復する", () => {
    expect(loopPosition(0, 2, "pingpong")).toBeCloseTo(0);
    expect(loopPosition(1, 2, "pingpong")).toBeCloseTo(1);
    expect(loopPosition(2, 2, "pingpong")).toBeCloseTo(2);   // 折り返し点
    expect(loopPosition(3, 2, "pingpong")).toBeCloseTo(1);   // 復路
    expect(loopPosition(4, 2, "pingpong")).toBeCloseTo(0);   // 1 往復完了
    expect(loopPosition(5, 2, "pingpong")).toBeCloseTo(1);   // 2 周目往路
  });

  test("pingpong: 負値でも破綻しない", () => {
    expect(loopPosition(-1, 2, "pingpong")).toBeCloseTo(1);
  });

  test("once: [0, loopLenSec] にクランプ", () => {
    expect(loopPosition(-1, 2, "once")).toBe(0);
    expect(loopPosition(3, 2, "once")).toBe(2);
    expect(loopPosition(1, 2, "once")).toBe(1);
  });

  test("loopLenSec<=0・非有限は 0", () => {
    expect(loopPosition(1, 0, "loop")).toBe(0);
    expect(loopPosition(1, Number.NaN, "loop")).toBe(0);
  });
});

describe("#186 sanitizeFrames", () => {
  test("正常な配列はそのまま t 昇順で返す", () => {
    expect(sanitizeFrames([{ t: 1, v: 2 }, { t: 0, v: 1 }])).toEqual([{ t: 0, v: 1 }, { t: 1, v: 2 }]);
  });

  test("配列以外は空配列", () => {
    expect(sanitizeFrames(undefined)).toEqual([]);
    expect(sanitizeFrames(null)).toEqual([]);
    expect(sanitizeFrames("not array")).toEqual([]);
    expect(sanitizeFrames(123)).toEqual([]);
  });

  test("不正な要素（t/v 欠落・非数値・非有限）は捨てる", () => {
    const raw = [
      { t: 0, v: 1 },
      { t: 1 }, // v 欠落
      { v: 2 }, // t 欠落
      { t: "x", v: 1 },
      { t: 1, v: Number.NaN },
      { t: Number.POSITIVE_INFINITY, v: 1 },
      null,
      "string",
      42,
    ];
    expect(sanitizeFrames(raw)).toEqual([{ t: 0, v: 1 }]);
  });

  test("空配列は空配列", () => {
    expect(sanitizeFrames([])).toEqual([]);
  });
});
