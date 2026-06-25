import { expect, test, describe } from "bun:test";
import { effectiveOutputSceneId, isFollowingEdit } from "./output-scene";

const ids = ["A", "B", "C"];

describe("effectiveOutputSceneId", () => {
  test("null は active へ追従", () => {
    expect(effectiveOutputSceneId(null, "A", ids)).toBe("A");
  });
  test("空文字も active へ追従", () => {
    expect(effectiveOutputSceneId("", "A", ids)).toBe("A");
  });
  test("存在する別シーンはそれを返す（ピン）", () => {
    expect(effectiveOutputSceneId("B", "A", ids)).toBe("B");
  });
  test("存在しない id は active へフォールバック", () => {
    expect(effectiveOutputSceneId("Z", "A", ids)).toBe("A");
  });
  test("active と同じ id でもピンとして返す", () => {
    expect(effectiveOutputSceneId("A", "A", ids)).toBe("A");
  });
});

describe("isFollowingEdit", () => {
  test("null は追従", () => {
    expect(isFollowingEdit(null, ids)).toBe(true);
  });
  test("存在しない id は追従（フォールバック）", () => {
    expect(isFollowingEdit("Z", ids)).toBe(true);
  });
  test("有効なピンは追従でない", () => {
    expect(isFollowingEdit("B", ids)).toBe(false);
  });
});
