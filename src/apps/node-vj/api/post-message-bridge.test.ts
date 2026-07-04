// #177: postMessage 受け口のテスト。プロトコル検証（純関数）・dispatch（フェイク API）・
// ブリッジ本体（フェイク window で origin 制限/返信先/解除を検証）。
import { describe, expect, test } from "bun:test";
import type { AiApi } from "./ai-api";
import {
  CMD_TYPE, RESULT_TYPE, dispatchCommand, installPostMessageBridge, parseCommandMessage,
  type BridgeWindow,
} from "./post-message-bridge";

// ---- parseCommandMessage ----

describe("parseCommandMessage", () => {
  test("type が合わないメッセージは ignore（返信対象にしない）", () => {
    expect(parseCommandMessage(null)).toEqual({ kind: "ignore" });
    expect(parseCommandMessage("hello")).toEqual({ kind: "ignore" });
    expect(parseCommandMessage(42)).toEqual({ kind: "ignore" });
    expect(parseCommandMessage([1, 2])).toEqual({ kind: "ignore" });
    expect(parseCommandMessage({})).toEqual({ kind: "ignore" });
    expect(parseCommandMessage({ type: "other-lib:msg", id: "1" })).toEqual({ kind: "ignore" });
    // 自分の返信（RESULT_TYPE）もループしない
    expect(parseCommandMessage({ type: RESULT_TYPE, id: "1", result: {} })).toEqual({ kind: "ignore" });
  });

  test("type が合うのに id/cmd が不正なら invalid（エラー返信対象）", () => {
    expect(parseCommandMessage({ type: CMD_TYPE })).toMatchObject({ kind: "invalid", id: null });
    expect(parseCommandMessage({ type: CMD_TYPE, id: 5, cmd: "getStatus" })).toMatchObject({ kind: "invalid", id: null });
    expect(parseCommandMessage({ type: CMD_TYPE, id: "" })).toMatchObject({ kind: "invalid", id: null });
    expect(parseCommandMessage({ type: CMD_TYPE, id: "1" })).toMatchObject({ kind: "invalid", id: "1" });
    expect(parseCommandMessage({ type: CMD_TYPE, id: "1", cmd: 9 })).toMatchObject({ kind: "invalid", id: "1" });
  });

  test("args はオブジェクトのみ許可（省略時は {}）", () => {
    expect(parseCommandMessage({ type: CMD_TYPE, id: "1", cmd: "getStatus" }))
      .toEqual({ kind: "cmd", id: "1", cmd: "getStatus", args: {} });
    expect(parseCommandMessage({ type: CMD_TYPE, id: "1", cmd: "x", args: [1] })).toMatchObject({ kind: "invalid" });
    expect(parseCommandMessage({ type: CMD_TYPE, id: "1", cmd: "x", args: "s" })).toMatchObject({ kind: "invalid" });
    expect(parseCommandMessage({ type: CMD_TYPE, id: "1", cmd: "x", args: null })).toMatchObject({ kind: "invalid" });
    expect(parseCommandMessage({ type: CMD_TYPE, id: "1", cmd: "setParam", args: { nodeId: "n" } }))
      .toEqual({ kind: "cmd", id: "1", cmd: "setParam", args: { nodeId: "n" } });
  });
});

// ---- dispatchCommand ----

/** 呼び出し記録付きのフェイク AiApi。 */
function fakeApi(): { api: AiApi; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record = (name: string, result: unknown) => (...args: unknown[]) => {
    calls.push([name, ...args]);
    return result;
  };
  const api = {
    getGraphYaml: record("getGraphYaml", { ok: true, yaml: "y" }),
    getScenes: record("getScenes", { ok: true, scenes: [] }),
    getNodeCatalog: record("getNodeCatalog", { ok: true, version: 1, nodes: [] }),
    getStatus: record("getStatus", { ok: true, activeSceneId: "s", outputSceneId: "s", nodeCount: 0, nodes: [] }),
    applyGraphYaml: record("applyGraphYaml", { ok: true, warnings: [] }),
    setParam: record("setParam", { ok: true }),
    switchScene: record("switchScene", { ok: true }),
  } as unknown as AiApi;
  return { api, calls };
}

describe("dispatchCommand", () => {
  test("引数なしコマンドはそのまま振り分ける", () => {
    const { api, calls } = fakeApi();
    for (const cmd of ["getGraphYaml", "getScenes", "getNodeCatalog", "getStatus"]) {
      const res = dispatchCommand(api, cmd, {}) as { ok: boolean };
      expect(res.ok).toBe(true);
    }
    expect(calls.map((c) => c[0])).toEqual(["getGraphYaml", "getScenes", "getNodeCatalog", "getStatus"]);
  });

  test("applyGraphYaml / setParam / switchScene は args を検証して渡す", () => {
    const { api, calls } = fakeApi();
    dispatchCommand(api, "applyGraphYaml", { yaml: "version: 1" });
    dispatchCommand(api, "setParam", { nodeId: "n1", paramId: "value", value: 0.5 });
    dispatchCommand(api, "switchScene", { sceneId: "s2" });
    expect(calls).toEqual([
      ["applyGraphYaml", "version: 1"],
      ["setParam", "n1", "value", 0.5],
      ["switchScene", "s2"],
    ]);
  });

  test("setParam は value: undefined 以外の欠落をエラーにする（value キー必須）", () => {
    const { api } = fakeApi();
    const missing = dispatchCommand(api, "setParam", { nodeId: "n", paramId: "p" }) as { ok: boolean; error: string };
    expect(missing.ok).toBe(false);
    // false や 0 も value として渡せる
    const { api: api2, calls } = fakeApi();
    dispatchCommand(api2, "setParam", { nodeId: "n", paramId: "p", value: false });
    expect(calls).toEqual([["setParam", "n", "p", false]]);
  });

  test("args 型不正・未知 cmd は { ok:false, error }（throw しない）", () => {
    const { api, calls } = fakeApi();
    expect((dispatchCommand(api, "applyGraphYaml", {}) as { ok: boolean }).ok).toBe(false);
    expect((dispatchCommand(api, "setParam", { nodeId: 1, paramId: "p", value: 0 }) as { ok: boolean }).ok).toBe(false);
    expect((dispatchCommand(api, "switchScene", {}) as { ok: boolean }).ok).toBe(false);
    const unknown = dispatchCommand(api, "selfDestruct", {}) as { ok: boolean; error: string };
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toContain("selfDestruct");
    expect(calls).toEqual([]); // API 本体には一切届かない
  });
});

// ---- installPostMessageBridge ----

const ORIGIN = "http://localhost:3300";

/** メッセージリスナと postMessage 記録を持つフェイク window。 */
function fakeWindow(): BridgeWindow & {
  emit(e: Partial<MessageEvent>): void;
  posted: { message: unknown; options?: { targetOrigin?: string } }[];
  listenerCount(): number;
} {
  const listeners = new Set<(e: MessageEvent) => void>();
  const posted: { message: unknown; options?: { targetOrigin?: string } }[] = [];
  return {
    location: { origin: ORIGIN },
    addEventListener: (_t, h) => listeners.add(h),
    removeEventListener: (_t, h) => listeners.delete(h),
    postMessage: (message, options) => posted.push({ message, options }),
    emit: (e) => { for (const h of [...listeners]) h(e as MessageEvent); },
    posted,
    listenerCount: () => listeners.size,
  };
}

/** 返信記録付きのフェイク event.source。 */
function fakeSource() {
  const posted: { message: unknown; options?: { targetOrigin?: string } }[] = [];
  return {
    posted,
    postMessage: (message: unknown, options?: { targetOrigin?: string }) => posted.push({ message, options }),
  };
}

describe("installPostMessageBridge", () => {
  test("同一オリジンのコマンドを dispatch し、source へ結果を返信する", () => {
    const win = fakeWindow();
    const source = fakeSource();
    const { api, calls } = fakeApi();
    installPostMessageBridge(api, win);

    win.emit({
      origin: ORIGIN,
      source: source as unknown as MessageEventSource,
      data: { type: CMD_TYPE, id: "req-1", cmd: "getStatus" },
    });
    expect(calls).toEqual([["getStatus"]]);
    expect(source.posted).toEqual([{
      message: {
        type: RESULT_TYPE,
        id: "req-1",
        result: { ok: true, activeSceneId: "s", outputSceneId: "s", nodeCount: 0, nodes: [] },
      },
      options: { targetOrigin: ORIGIN },
    }]);
    expect(win.posted).toEqual([]); // source があれば window へは送らない
  });

  test("別オリジンからのメッセージは無視する（same-origin 限定）", () => {
    const win = fakeWindow();
    const source = fakeSource();
    const { api, calls } = fakeApi();
    installPostMessageBridge(api, win);
    win.emit({
      origin: "https://evil.example",
      source: source as unknown as MessageEventSource,
      data: { type: CMD_TYPE, id: "req-1", cmd: "applyGraphYaml", args: { yaml: "version: 1" } },
    });
    expect(calls).toEqual([]);
    expect(source.posted).toEqual([]);
  });

  test("type が合わないメッセージには返信しない（他ライブラリと衝突しない）", () => {
    const win = fakeWindow();
    const { api, calls } = fakeApi();
    installPostMessageBridge(api, win);
    win.emit({ origin: ORIGIN, data: { type: "webpack:ping" } });
    win.emit({ origin: ORIGIN, data: "raw string" });
    expect(calls).toEqual([]);
    expect(win.posted).toEqual([]);
  });

  test("形不正（id/cmd/args）は ok:false のエラーを返信する", () => {
    const win = fakeWindow();
    const source = fakeSource();
    installPostMessageBridge(fakeApi().api, win);
    win.emit({
      origin: ORIGIN,
      source: source as unknown as MessageEventSource,
      data: { type: CMD_TYPE, id: "req-2", cmd: "setParam", args: "oops" },
    });
    const reply = source.posted[0]!.message as { type: string; id: string; result: { ok: boolean } };
    expect(reply.type).toBe(RESULT_TYPE);
    expect(reply.id).toBe("req-2");
    expect(reply.result.ok).toBe(false);
  });

  test("source が無ければ window 自身へ返信する（同一タブのコンソール用）", () => {
    const win = fakeWindow();
    installPostMessageBridge(fakeApi().api, win);
    win.emit({ origin: ORIGIN, source: null, data: { type: CMD_TYPE, id: "req-3", cmd: "getScenes" } });
    expect(win.posted.length).toBe(1);
    expect(win.posted[0]!.message).toMatchObject({ type: RESULT_TYPE, id: "req-3" });
  });

  test("API が throw しても ok:false で返信する", () => {
    const win = fakeWindow();
    const source = fakeSource();
    const api = { getStatus: () => { throw new Error("boom"); } } as unknown as AiApi;
    installPostMessageBridge(api, win);
    win.emit({
      origin: ORIGIN,
      source: source as unknown as MessageEventSource,
      data: { type: CMD_TYPE, id: "req-4", cmd: "getStatus" },
    });
    const reply = source.posted[0]!.message as { result: { ok: boolean; error: string } };
    expect(reply.result).toEqual({ ok: false, error: "boom" });
  });

  test("戻り値の関数でリスナを解除できる", () => {
    const win = fakeWindow();
    const { api, calls } = fakeApi();
    const uninstall = installPostMessageBridge(api, win);
    expect(win.listenerCount()).toBe(1);
    uninstall();
    expect(win.listenerCount()).toBe(0);
    win.emit({ origin: ORIGIN, data: { type: CMD_TYPE, id: "1", cmd: "getStatus" } });
    expect(calls).toEqual([]);
  });
});
