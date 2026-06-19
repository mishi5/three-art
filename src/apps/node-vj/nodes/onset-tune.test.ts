import { expect, test, describe } from "bun:test";
import {
  OnsetTracker, ONSET_PARAMS, DEFAULT_ONSET_THRESHOLD, DEFAULT_ONSET_COOLDOWN,
} from "./audio-feature-logic";
import { MicInputNode } from "./MicInputNode";
import { DisplayAudioInputNode } from "./DisplayAudioInputNode";
import { AudioFileInputNode } from "./AudioFileInputNode";

const THR = DEFAULT_ONSET_THRESHOLD;
const CD = DEFAULT_ONSET_COOLDOWN;

describe("OnsetTracker チューニング (#109)", () => {
  test("prime 後の定常では発火しない（起動直後の誤発火なし）", () => {
    const t = new OnsetTracker();
    expect(t.detect(0.2, 0.0, THR, CD)).toBe(false);     // prime
    expect(t.detect(0.2, 1 / 60, THR, CD)).toBe(false);  // 定常
    expect(t.detect(0.2, 2 / 60, THR, CD)).toBe(false);
  });

  test("bass のステップ上昇で発火する", () => {
    const t = new OnsetTracker();
    t.detect(0.1, 0.0, THR, CD);                          // prime @0.1
    expect(t.detect(0.6, 1 / 60, THR, CD)).toBe(true);    // 大きな立ち上がり → 発火
  });

  test("cooldown 内の連続ステップは 1 回だけ発火", () => {
    const t = new OnsetTracker();
    t.detect(0.1, 0.0, THR, CD);
    expect(t.detect(0.6, 0.02, THR, CD)).toBe(true);      // 発火
    t.detect(0.1, 0.04, THR, CD);                          // 立ち下がり
    expect(t.detect(0.6, 0.06, THR, CD)).toBe(false);     // cooldown(0.12) 内 → 不発
  });

  test("しきい値ゲート: 小さいステップは既定で不発・しきい値を下げると発火", () => {
    // 既定 0.06: 0.10→0.13 の delta=0.03 は不発
    const a = new OnsetTracker();
    a.detect(0.10, 0.0, THR, CD);
    expect(a.detect(0.13, 1 / 60, THR, CD)).toBe(false);
    // しきい値を下げると同じ入力で発火
    const b = new OnsetTracker();
    b.detect(0.10, 0.0, 0.005, CD);
    expect(b.detect(0.13, 1 / 60, 0.005, CD)).toBe(true);
  });
});

describe("audio ノードの onset param (#109)", () => {
  test("3 ノードが onsetThreshold/onsetCooldown param を持つ", () => {
    for (const node of [MicInputNode, DisplayAudioInputNode, AudioFileInputNode]) {
      const ids = node.params.map((p) => p.id);
      expect(ids).toContain("onsetThreshold");
      expect(ids).toContain("onsetCooldown");
    }
    expect(ONSET_PARAMS.map((p) => p.id)).toEqual(["onsetThreshold", "onsetCooldown"]);
    expect(ONSET_PARAMS.find((p) => p.id === "onsetThreshold")?.default).toBe(DEFAULT_ONSET_THRESHOLD);
  });
});
