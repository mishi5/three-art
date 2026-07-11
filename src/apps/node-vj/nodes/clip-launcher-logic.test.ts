// #281: ClipLauncher のアーム→切替判定（純関数）のテスト。
// sync 未接続なら即時切替、接続時は sync の立ち上がりエッジまでアーム（予約）する。
import { expect, test, describe } from "bun:test";
import { resolveLaunch } from "./clip-launcher-logic";

describe("#281 resolveLaunch", () => {
  test("pending なしは何もしない（switchTo/armed とも null）", () => {
    expect(resolveLaunch(null, false, false)).toEqual({ switchTo: null, armed: null });
    expect(resolveLaunch(null, true, false)).toEqual({ switchTo: null, armed: null });
    expect(resolveLaunch(null, true, true)).toEqual({ switchTo: null, armed: null });
  });

  test("sync 未接続: pending は即切替（armed にならない）", () => {
    expect(resolveLaunch(3, false, false)).toEqual({ switchTo: 3, armed: null });
    // 未接続で syncEdge=true はあり得ないが、来ても即切替で安全。
    expect(resolveLaunch(3, false, true)).toEqual({ switchTo: 3, armed: null });
  });

  test("sync 接続・エッジなし: pending はアームのまま保持", () => {
    expect(resolveLaunch(5, true, false)).toEqual({ switchTo: null, armed: 5 });
  });

  test("sync 接続・立ち上がりエッジ: アームを消費して切替", () => {
    expect(resolveLaunch(5, true, true)).toEqual({ switchTo: 5, armed: null });
  });

  test("パッド 0 も有効な pending として扱う（falsy 判定に依存しない）", () => {
    expect(resolveLaunch(0, false, false)).toEqual({ switchTo: 0, armed: null });
    expect(resolveLaunch(0, true, false)).toEqual({ switchTo: null, armed: 0 });
    expect(resolveLaunch(0, true, true)).toEqual({ switchTo: 0, armed: null });
  });
});
