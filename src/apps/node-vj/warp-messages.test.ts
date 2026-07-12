// #282: 出力ウィンドウ ⇄ 親のワープ postMessage プロトコル（純関数）テスト。
import { describe, expect, test } from "bun:test";
import {
  WARP_MSG_TYPE, WARP_STATE_TYPE, clampWarpValue, parseWarpMessage,
} from "./warp-messages";

describe("parseWarpMessage (#282)", () => {
  const valid = { type: "node-vj:warp", screenId: "s1", corner: "tl", x: 0.1, y: 0.2, phase: "move" };

  test("正しいドラッグメッセージを受理する", () => {
    expect(parseWarpMessage(valid)).toEqual({ screenId: "s1", corner: "tl", x: 0.1, y: 0.2, phase: "move" });
    expect(parseWarpMessage({ ...valid, corner: "br", phase: "start" })?.corner).toBe("br");
    expect(parseWarpMessage({ ...valid, phase: "end" })?.phase).toBe("end");
  });

  test("type 不一致・非オブジェクトは null（他の postMessage と衝突しない）", () => {
    expect(parseWarpMessage({ ...valid, type: "node-vj:cmd" })).toBeNull();
    expect(parseWarpMessage(null)).toBeNull();
    expect(parseWarpMessage("x")).toBeNull();
    expect(parseWarpMessage([])).toBeNull();
  });

  test("corner / phase / 座標が不正なら null", () => {
    expect(parseWarpMessage({ ...valid, corner: "center" })).toBeNull();
    expect(parseWarpMessage({ ...valid, phase: "drag" })).toBeNull();
    expect(parseWarpMessage({ ...valid, x: NaN })).toBeNull();
    expect(parseWarpMessage({ ...valid, y: "0.2" })).toBeNull();
    expect(parseWarpMessage({ ...valid, screenId: 1 })).toBeNull();
    expect(parseWarpMessage({ ...valid, screenId: "" })).toBeNull();
  });

  test("メッセージ type 定数", () => {
    expect(WARP_MSG_TYPE).toBe("node-vj:warp");
    expect(WARP_STATE_TYPE).toBe("node-vj:warp-state");
  });
});

describe("clampWarpValue (#282)", () => {
  test("param の min/max（-0.5..1.5）へクランプし step 相当（0.001）へ丸める", () => {
    expect(clampWarpValue(0.12345)).toBe(0.123);
    expect(clampWarpValue(-2)).toBe(-0.5);
    expect(clampWarpValue(9)).toBe(1.5);
    expect(clampWarpValue(1)).toBe(1);
  });

  test("非有限は 0", () => {
    expect(clampWarpValue(NaN)).toBe(0);
    expect(clampWarpValue(Infinity)).toBe(1.5);
    expect(clampWarpValue(-Infinity)).toBe(-0.5);
  });
});
