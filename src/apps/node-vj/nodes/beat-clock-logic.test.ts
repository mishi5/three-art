// #270: BeatClock（BPM ビートクロック）純粋ロジックのテスト。
import { describe, expect, test } from "bun:test";
import {
  BPM_MIN, BPM_MAX, GAP_RESET_SEC,
  foldIntervalToBpmRange, estimateBpm, recentIntervals, crossedDivision, divisionToBeats,
} from "./beat-clock-logic";

describe("#270 foldIntervalToBpmRange", () => {
  test("120BPM 相当（0.5s）はそのまま（正規化帯の中）", () => {
    expect(foldIntervalToBpmRange(0.5)).toBeCloseTo(0.5, 9);
  });

  test("8分打ち（0.25s=240BPM 相当）は ÷2 折り込みで 0.5s（120BPM）", () => {
    expect(foldIntervalToBpmRange(0.25)).toBeCloseTo(0.5, 9);
  });

  test("2拍毎（1.0s=60BPM 相当）は ×2 折り込みで 0.5s（120BPM）", () => {
    expect(foldIntervalToBpmRange(1.0)).toBeCloseTo(0.5, 9);
  });

  test("16分打ち（0.125s）は 2 段折り込みで 0.5s", () => {
    expect(foldIntervalToBpmRange(0.125)).toBeCloseTo(0.5, 9);
  });

  test("帯内の別テンポ（100BPM=0.6s）は折らない", () => {
    expect(foldIntervalToBpmRange(0.6)).toBeCloseTo(0.6, 9);
  });

  test("極端に短い/長い間隔（妥当域から 1 オクターブ超）は null で棄却", () => {
    expect(foldIntervalToBpmRange(0.05)).toBeNull(); // 1200BPM 相当（チャタリング）
    expect(foldIntervalToBpmRange(3.0)).toBeNull();  // 20BPM 相当（曲間の無音など）
  });

  test("境界 BPM: 妥当域 ±1 オクターブの端は受理して折り込む", () => {
    // BPM_MAX*2 = 500 相当（60/500=0.12s）→ 500→250→125 で帯内。
    expect(foldIntervalToBpmRange(60 / (BPM_MAX * 2))).toBeCloseTo(60 / 125, 9);
    // BPM_MIN/2 = 25 相当（2.4s）→ 25→50→100 で帯内。
    expect(foldIntervalToBpmRange(60 / (BPM_MIN / 2))).toBeCloseTo(0.6, 9);
  });

  test("非有限・0 以下は null", () => {
    expect(foldIntervalToBpmRange(0)).toBeNull();
    expect(foldIntervalToBpmRange(-0.5)).toBeNull();
    expect(foldIntervalToBpmRange(Number.NaN)).toBeNull();
    expect(foldIntervalToBpmRange(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("#270 estimateBpm", () => {
  test("0.5s 間隔 ×3 → 120BPM", () => {
    expect(estimateBpm([0.5, 0.5, 0.5])).toBeCloseTo(120, 6);
  });

  test("有効数が minCount 未満なら null（default 3）", () => {
    expect(estimateBpm([])).toBeNull();
    expect(estimateBpm([0.5, 0.5])).toBeNull();
    expect(estimateBpm([0.5, 0.5], 2)).toBeCloseTo(120, 6);
  });

  test("ジッタ入り（±10%）でも中央値で安定する", () => {
    // 中央値は 0.5（偶数個は中央 2 点の平均）→ 120BPM ちょうど。
    expect(estimateBpm([0.45, 0.5, 0.55, 0.5])).toBeCloseTo(120, 6);
  });

  test("8分打ち（0.25s 列）は fold されて 120BPM", () => {
    expect(estimateBpm([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(120, 6);
  });

  test("外れ値（棄却対象）が混ざっても残りで推定する", () => {
    // 3.0s は fold で棄却 → 有効 3 件で 120。
    expect(estimateBpm([0.5, 3.0, 0.5, 0.5])).toBeCloseTo(120, 6);
    // 棄却で有効数が minCount を割れば null。
    expect(estimateBpm([0.5, 3.0, 0.5])).toBeNull();
  });

  test("単発の外れ値（帯内に fold される値）にも中央値ベースで頑健", () => {
    // 0.7 が 1 つ混ざっても中央値は 0.5 のまま。
    expect(estimateBpm([0.5, 0.5, 0.7, 0.5, 0.5])).toBeCloseTo(120, 6);
  });
});

describe("#270 recentIntervals", () => {
  test("昇順時刻列 → 隣接間隔列", () => {
    expect(recentIntervals([0, 0.5, 1.0, 1.5])).toEqual([0.5, 0.5, 0.5]);
  });

  test("gapResetSec を超える間隔でそれ以前を捨てる（default 2.5s）", () => {
    expect(recentIntervals([0, 0.5, 10, 10.5, 11])).toEqual([0.5, 0.5]);
    expect(GAP_RESET_SEC).toBe(2.5);
  });

  test("gapResetSec は引数で変更できる", () => {
    expect(recentIntervals([0, 0.5, 1.6, 2.1], 1.0)).toEqual([0.5]);
  });

  test("0/1 要素・非増加時刻は防御的に扱う", () => {
    expect(recentIntervals([])).toEqual([]);
    expect(recentIntervals([1])).toEqual([]);
    // 同時刻・逆行（dt<=0）はスキップする。
    expect(recentIntervals([0, 0, 0.5, 0.4, 0.9])).toEqual([0.5, 0.5]);
  });
});

describe("#270 crossedDivision", () => {
  test("初回フレーム相当（prev=cur=0）は発火しない", () => {
    expect(crossedDivision(0, 0, 1)).toBe(false);
  });

  test("境界ちょうど: 半開区間 (prev, cur] なので cur=境界は発火・prev=境界は再発火しない", () => {
    expect(crossedDivision(0.9, 1.0, 1)).toBe(true);
    expect(crossedDivision(1.0, 1.1, 1)).toBe(false);
  });

  test("複数境界を跨いでも true（コマ落ちで 1 回にまとまる）", () => {
    expect(crossedDivision(0.5, 2.5, 1)).toBe(true);
  });

  test("divBeats に応じた境界で発火する", () => {
    expect(crossedDivision(0.9, 1.0, 0.25)).toBe(true);  // 1/4 拍
    expect(crossedDivision(3.9, 4.0, 4)).toBe(true);     // 4 拍
    expect(crossedDivision(0, 3.9, 4)).toBe(false);      // まだ 4 拍に届かない
    expect(crossedDivision(7.5, 7.9, 8)).toBe(false);
    expect(crossedDivision(7.9, 8.05, 8)).toBe(true);
  });

  test("div<=0・非有限・cur<=prev は false", () => {
    expect(crossedDivision(0, 1, 0)).toBe(false);
    expect(crossedDivision(0, 1, -1)).toBe(false);
    expect(crossedDivision(0, 1, Number.NaN)).toBe(false);
    expect(crossedDivision(Number.NaN, 1, 1)).toBe(false);
    expect(crossedDivision(0, Number.NaN, 1)).toBe(false);
    expect(crossedDivision(1, 1, 1)).toBe(false);
    expect(crossedDivision(2, 1, 1)).toBe(false);
  });
});

describe("#270 divisionToBeats", () => {
  test("enum 値 → 拍数", () => {
    expect(divisionToBeats("1/4")).toBe(0.25);
    expect(divisionToBeats("1/2")).toBe(0.5);
    expect(divisionToBeats("1")).toBe(1);
    expect(divisionToBeats("2")).toBe(2);
    expect(divisionToBeats("4")).toBe(4);
    expect(divisionToBeats("8")).toBe(8);
  });

  test("不正値は 1（毎拍）へフォールバック", () => {
    expect(divisionToBeats("3")).toBe(1);
    expect(divisionToBeats(2)).toBe(1);
    expect(divisionToBeats(null)).toBe(1);
    expect(divisionToBeats(undefined)).toBe(1);
  });
});
