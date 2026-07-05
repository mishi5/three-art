import { describe, expect, it } from "bun:test";
import { DEFAULT_PREFS, PREFS_KEY, PrefsStore, parsePrefs } from "./prefs";
import { memoryAdapter } from "./graph/graph-store";

describe("parsePrefs (#229)", () => {
  it("null（未保存）は既定値", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it("空文字も既定値", () => {
    expect(parsePrefs("")).toEqual(DEFAULT_PREFS);
  });

  it("壊れた JSON は既定値へフォールバック", () => {
    expect(parsePrefs("{oops")).toEqual(DEFAULT_PREFS);
  });

  it("オブジェクト以外（配列/数値/文字列）は既定値", () => {
    expect(parsePrefs("[1,2]")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("42")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs('"legacy"')).toEqual(DEFAULT_PREFS);
  });

  it("panMode: legacy を読み取れる", () => {
    expect(parsePrefs('{"panMode":"legacy"}').panMode).toBe("legacy");
  });

  it("panMode: modern を読み取れる", () => {
    expect(parsePrefs('{"panMode":"modern"}').panMode).toBe("modern");
  });

  it("panMode が不正値なら既定（modern）へフォールバック", () => {
    expect(parsePrefs('{"panMode":"turbo"}').panMode).toBe("modern");
    expect(parsePrefs('{"panMode":123}').panMode).toBe("modern");
  });

  it("部分指定は既定値とマージされる（未指定フィールドは既定）", () => {
    expect(parsePrefs("{}")).toEqual(DEFAULT_PREFS);
  });

  it("未知キーは無視される（将来バージョンの JSON でも壊れない）", () => {
    const p = parsePrefs('{"panMode":"legacy","futureFlag":true}');
    expect(p.panMode).toBe("legacy");
    expect(Object.keys(p).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
  });

  // #228: サイドドックのピン状態
  it("dockPinned の既定値は false", () => {
    expect(parsePrefs(null).dockPinned).toBe(false);
    expect(parsePrefs("{}").dockPinned).toBe(false);
  });

  it("dockPinned: true / false を読み取れる", () => {
    expect(parsePrefs('{"dockPinned":true}').dockPinned).toBe(true);
    expect(parsePrefs('{"dockPinned":false}').dockPinned).toBe(false);
  });

  it("dockPinned が boolean 以外なら既定（false）へフォールバック", () => {
    expect(parsePrefs('{"dockPinned":"true"}').dockPinned).toBe(false);
    expect(parsePrefs('{"dockPinned":1}').dockPinned).toBe(false);
  });

  // #237: AI ブリッジ（WS）設定
  it("wsBridgeEnabled の既定値は false（opt-in）", () => {
    expect(parsePrefs(null).wsBridgeEnabled).toBe(false);
    expect(parsePrefs("{}").wsBridgeEnabled).toBe(false);
  });

  it("wsBridgeEnabled: true / false を読み取れる", () => {
    expect(parsePrefs('{"wsBridgeEnabled":true}').wsBridgeEnabled).toBe(true);
    expect(parsePrefs('{"wsBridgeEnabled":false}').wsBridgeEnabled).toBe(false);
  });

  it("wsBridgeEnabled が boolean 以外なら既定（false）へフォールバック", () => {
    expect(parsePrefs('{"wsBridgeEnabled":"true"}').wsBridgeEnabled).toBe(false);
    expect(parsePrefs('{"wsBridgeEnabled":1}').wsBridgeEnabled).toBe(false);
  });

  it("wsBridgeUrl の既定値は ws://localhost:8787", () => {
    expect(parsePrefs(null).wsBridgeUrl).toBe("ws://localhost:8787");
    expect(parsePrefs("{}").wsBridgeUrl).toBe("ws://localhost:8787");
  });

  it("wsBridgeUrl: 文字列を読み取れる（検証は文字列のみ）", () => {
    expect(parsePrefs('{"wsBridgeUrl":"ws://localhost:8791"}').wsBridgeUrl).toBe("ws://localhost:8791");
  });

  it("wsBridgeUrl が空文字・文字列以外なら既定へフォールバック", () => {
    expect(parsePrefs('{"wsBridgeUrl":""}').wsBridgeUrl).toBe("ws://localhost:8787");
    expect(parsePrefs('{"wsBridgeUrl":123}').wsBridgeUrl).toBe("ws://localhost:8787");
    expect(parsePrefs('{"wsBridgeUrl":null}').wsBridgeUrl).toBe("ws://localhost:8787");
  });

  // #244: UI 言語
  it("lang の既定値は ja（既存ユーザの見た目を変えない）", () => {
    expect(parsePrefs(null).lang).toBe("ja");
    expect(parsePrefs("{}").lang).toBe("ja");
  });

  it("lang: ja / en を読み取れる", () => {
    expect(parsePrefs('{"lang":"ja"}').lang).toBe("ja");
    expect(parsePrefs('{"lang":"en"}').lang).toBe("en");
  });

  it("lang が不正値なら既定（ja）へフォールバック", () => {
    expect(parsePrefs('{"lang":"fr"}').lang).toBe("ja");
    expect(parsePrefs('{"lang":123}').lang).toBe("ja");
    expect(parsePrefs('{"lang":null}').lang).toBe("ja");
  });
});

describe("PrefsStore (#229)", () => {
  it("未保存の load は既定値", () => {
    const store = new PrefsStore(memoryAdapter());
    expect(store.load()).toEqual(DEFAULT_PREFS);
  });

  it("save → load で保存値が返る", () => {
    const store = new PrefsStore(memoryAdapter());
    store.save({ panMode: "legacy" });
    expect(store.load().panMode).toBe("legacy");
  });

  it("save は部分更新（他フィールドを保持する read-modify-write）", () => {
    // 現状フィールドは 1 つだが、#228 で増える前提の振る舞いを固定する。
    const kv = memoryAdapter();
    kv.setItem(PREFS_KEY, '{"panMode":"legacy"}');
    const store = new PrefsStore(kv);
    store.save({});
    expect(store.load().panMode).toBe("legacy");
  });

  it("壊れた保存値の上からでも save/load できる", () => {
    const kv = memoryAdapter();
    kv.setItem(PREFS_KEY, "{oops");
    const store = new PrefsStore(kv);
    expect(store.load()).toEqual(DEFAULT_PREFS);
    store.save({ panMode: "legacy" });
    expect(store.load().panMode).toBe("legacy");
  });

  // #228: dockPinned の永続化と他フィールドとの独立性
  it("dockPinned を save → load で保持する", () => {
    const store = new PrefsStore(memoryAdapter());
    store.save({ dockPinned: true });
    expect(store.load().dockPinned).toBe(true);
    store.save({ dockPinned: false });
    expect(store.load().dockPinned).toBe(false);
  });

  it("dockPinned の保存は panMode を壊さない（部分更新）", () => {
    const store = new PrefsStore(memoryAdapter());
    store.save({ panMode: "legacy" });
    store.save({ dockPinned: true });
    expect(store.load()).toEqual({ ...DEFAULT_PREFS, panMode: "legacy", dockPinned: true });
  });

  // #237: AI ブリッジ設定の永続化と他フィールドとの独立性
  it("wsBridgeEnabled / wsBridgeUrl を save → load で保持する", () => {
    const store = new PrefsStore(memoryAdapter());
    store.save({ wsBridgeEnabled: true, wsBridgeUrl: "ws://localhost:8791" });
    expect(store.load().wsBridgeEnabled).toBe(true);
    expect(store.load().wsBridgeUrl).toBe("ws://localhost:8791");
  });

  it("wsBridge 系の保存は他フィールドを壊さない（部分更新）", () => {
    const store = new PrefsStore(memoryAdapter());
    store.save({ panMode: "legacy" });
    store.save({ wsBridgeEnabled: true });
    expect(store.load()).toEqual({
      ...DEFAULT_PREFS, panMode: "legacy", wsBridgeEnabled: true,
    });
  });

  // #244: UI 言語の永続化と他フィールドとの独立性
  it("lang を save → load で保持する", () => {
    const store = new PrefsStore(memoryAdapter());
    store.save({ lang: "en" });
    expect(store.load().lang).toBe("en");
    store.save({ lang: "ja" });
    expect(store.load().lang).toBe("ja");
  });

  it("lang の保存は他フィールドを壊さない（部分更新）", () => {
    const store = new PrefsStore(memoryAdapter());
    store.save({ panMode: "legacy" });
    store.save({ lang: "en" });
    expect(store.load()).toEqual({ ...DEFAULT_PREFS, panMode: "legacy", lang: "en" });
  });
});
