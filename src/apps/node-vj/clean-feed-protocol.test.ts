// #283: クリーンフィード（OBS ブラウザソース向け WebRTC ミラー）のシグナリング
// プロトコル（BroadcastChannel メッセージ）の検証付きパースのテスト。
import { describe, expect, test } from "bun:test";
import {
  CLEAN_FEED_CHANNEL,
  parseCleanFeedMessage,
  type CleanFeedMessage,
} from "./clean-feed-protocol";

describe("parseCleanFeedMessage (#283)", () => {
  test("チャンネル名定数は node-vj 接頭辞付き", () => {
    expect(CLEAN_FEED_CHANNEL).toBe("node-vj:clean-feed");
  });

  test("cf:hello をパースする", () => {
    const msg = parseCleanFeedMessage({ type: "cf:hello", viewerId: "v1" });
    expect(msg).toEqual({ type: "cf:hello", viewerId: "v1" });
  });

  test("cf:bye をパースする", () => {
    const msg = parseCleanFeedMessage({ type: "cf:bye", viewerId: "v1" });
    expect(msg).toEqual({ type: "cf:bye", viewerId: "v1" });
  });

  test("cf:offer / cf:answer は sdp 必須", () => {
    expect(parseCleanFeedMessage({ type: "cf:offer", viewerId: "v1", sdp: "o" }))
      .toEqual({ type: "cf:offer", viewerId: "v1", sdp: "o" });
    expect(parseCleanFeedMessage({ type: "cf:answer", viewerId: "v1", sdp: "a" }))
      .toEqual({ type: "cf:answer", viewerId: "v1", sdp: "a" });
    expect(parseCleanFeedMessage({ type: "cf:offer", viewerId: "v1" })).toBeNull();
    expect(parseCleanFeedMessage({ type: "cf:answer", viewerId: "v1", sdp: 1 })).toBeNull();
  });

  test("cf:ice は from と candidate（オブジェクト）必須", () => {
    const candidate = { candidate: "candidate:1 1 udp ...", sdpMid: "0" };
    const msg = parseCleanFeedMessage({ type: "cf:ice", viewerId: "v1", from: "pub", candidate });
    expect(msg).toEqual({ type: "cf:ice", viewerId: "v1", from: "pub", candidate });
    expect(parseCleanFeedMessage({ type: "cf:ice", viewerId: "v1", from: "other", candidate })).toBeNull();
    expect(parseCleanFeedMessage({ type: "cf:ice", viewerId: "v1", from: "viewer" })).toBeNull();
    expect(parseCleanFeedMessage({ type: "cf:ice", viewerId: "v1", from: "viewer", candidate: "x" })).toBeNull();
  });

  test("不正値は null（型ガードとして機能する）", () => {
    expect(parseCleanFeedMessage(null)).toBeNull();
    expect(parseCleanFeedMessage(undefined)).toBeNull();
    expect(parseCleanFeedMessage("cf:hello")).toBeNull();
    expect(parseCleanFeedMessage(42)).toBeNull();
    expect(parseCleanFeedMessage({})).toBeNull();
    expect(parseCleanFeedMessage({ type: "cf:hello" })).toBeNull();            // viewerId なし
    expect(parseCleanFeedMessage({ type: "cf:hello", viewerId: "" })).toBeNull(); // 空 viewerId
    expect(parseCleanFeedMessage({ type: "cf:hello", viewerId: 7 })).toBeNull();
    expect(parseCleanFeedMessage({ type: "cf:unknown", viewerId: "v1" })).toBeNull();
  });

  test("パース結果は CleanFeedMessage 型として絞り込める", () => {
    const raw: unknown = { type: "cf:hello", viewerId: "v1" };
    const msg: CleanFeedMessage | null = parseCleanFeedMessage(raw);
    if (msg && msg.type === "cf:hello") {
      expect(msg.viewerId).toBe("v1");
    } else {
      throw new Error("expected cf:hello");
    }
  });
});
