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
    expect(store.load()).toEqual({ panMode: "legacy", dockPinned: true });
  });
});
