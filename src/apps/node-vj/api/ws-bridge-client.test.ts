// #237: フロント側 WS ブリッジクライアントのテスト。接続状態機械（純関数）と、
// フェイク socket / フェイクタイマ注入でのクライアント本体（hello 送信・cmd→result 往復・
// 自動リトライ・disable/URL 変更の即時反映）を検証する。
import { describe, expect, test } from "bun:test";
import type { AiApi } from "./ai-api";
import { CMD_TYPE, RESULT_TYPE } from "./post-message-bridge";
import { HELLO_TYPE } from "./relay-router";
import {
  WsBridgeClient, nextStatus,
  type BridgeSocket, type WsBridgeEvent, type WsBridgeStatus,
} from "./ws-bridge-client";

// ---- nextStatus（接続状態機械） ----

describe("nextStatus", () => {
  const table: [WsBridgeStatus, WsBridgeEvent, WsBridgeStatus][] = [
    // enable は disabled からのみ接続開始
    ["disabled", "enable", "connecting"],
    ["connecting", "enable", "connecting"],
    ["connected", "enable", "connected"],
    ["retrying", "enable", "retrying"],
    // disable はどこからでも即 disabled
    ["disabled", "disable", "disabled"],
    ["connecting", "disable", "disabled"],
    ["connected", "disable", "disabled"],
    ["retrying", "disable", "disabled"],
    // opened は connecting からのみ
    ["connecting", "opened", "connected"],
    ["disabled", "opened", "disabled"],
    ["retrying", "opened", "retrying"],
    ["connected", "opened", "connected"],
    // closed は disabled 以外を retrying へ落とす
    ["connecting", "closed", "retrying"],
    ["connected", "closed", "retrying"],
    ["retrying", "closed", "retrying"],
    ["disabled", "closed", "disabled"],
    // retry（タイマ発火）は retrying からのみ再接続
    ["retrying", "retry", "connecting"],
    ["disabled", "retry", "disabled"],
    ["connecting", "retry", "connecting"],
    ["connected", "retry", "connected"],
  ];
  for (const [from, event, to] of table) {
    test(`${from} + ${event} → ${to}`, () => {
      expect(nextStatus(from, event)).toBe(to);
    });
  }
});

// ---- WsBridgeClient（フェイク socket / タイマ） ----

/** 手動で open/message/close を発火できるフェイク socket。 */
interface FakeSocket extends BridgeSocket {
  url: string;
  sent: string[];
  closed: boolean;
}

function fakeSocketFactory(): { create: (url: string) => BridgeSocket; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    create: (url) => {
      const s: FakeSocket = {
        url,
        sent: [],
        closed: false,
        send: (data) => s.sent.push(data),
        close: () => { s.closed = true; },
        onopen: null,
        onmessage: null,
        onclose: null,
      };
      sockets.push(s);
      return s;
    },
  };
}

/** 発火を手動制御するフェイクタイマ。 */
function fakeTimers(): {
  setTimeoutFn: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn: (h: unknown) => void;
  fire(): void;
  pendingCount(): number;
} {
  let seq = 0;
  const pending = new Map<number, () => void>();
  return {
    setTimeoutFn: (fn) => { pending.set(++seq, fn); return seq; },
    clearTimeoutFn: (h) => { pending.delete(h as number); },
    fire: () => {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    pendingCount: () => pending.size,
  };
}

/** getStatus のみ実装したフェイク AiApi（dispatch 経路の検証用）。 */
function fakeApi(): { api: AiApi; calls: string[] } {
  const calls: string[] = [];
  const api = {
    getStatus: () => {
      calls.push("getStatus");
      return { ok: true, activeSceneId: "s", outputSceneId: "s", nodeCount: 0, nodes: [] };
    },
  } as unknown as AiApi;
  return { api, calls };
}

const URL_A = "ws://localhost:8787";
const URL_B = "ws://localhost:9999";

function setup(): {
  client: WsBridgeClient;
  sockets: FakeSocket[];
  timers: ReturnType<typeof fakeTimers>;
  calls: string[];
} {
  const { api, calls } = fakeApi();
  const factory = fakeSocketFactory();
  const timers = fakeTimers();
  const client = new WsBridgeClient(api, {
    createSocket: factory.create,
    setTimeoutFn: timers.setTimeoutFn,
    clearTimeoutFn: timers.clearTimeoutFn,
  });
  return { client, sockets: factory.sockets, timers, calls };
}

describe("WsBridgeClient", () => {
  test("初期状態は disabled（socket を作らない）", () => {
    const { client, sockets } = setup();
    expect(client.getStatus()).toBe("disabled");
    expect(sockets.length).toBe(0);
  });

  test("有効化で connecting・open で connected になり hello role:app を送る", () => {
    const { client, sockets } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    expect(client.getStatus()).toBe("connecting");
    expect(sockets.length).toBe(1);
    expect(sockets[0]!.url).toBe(URL_A);
    sockets[0]!.onopen?.();
    expect(client.getStatus()).toBe("connected");
    expect(sockets[0]!.sent).toEqual([JSON.stringify({ type: HELLO_TYPE, role: "app" })]);
  });

  test("受信 cmd を dispatch し result を返信する（v1 プロトコル互換）", () => {
    const { client, sockets, calls } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    sockets[0]!.onopen?.();
    sockets[0]!.onmessage?.(JSON.stringify({ type: CMD_TYPE, id: "r1", cmd: "getStatus" }));
    expect(calls).toEqual(["getStatus"]);
    expect(JSON.parse(sockets[0]!.sent[1]!)).toEqual({
      type: RESULT_TYPE,
      id: "r1",
      result: { ok: true, activeSceneId: "s", outputSceneId: "s", nodeCount: 0, nodes: [] },
    });
  });

  test("形不正の cmd はエラー result・cmd 以外/不正 JSON は黙って無視", () => {
    const { client, sockets, calls } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    sockets[0]!.onopen?.();
    const before = sockets[0]!.sent.length;
    // type が合うのに id 欠落 → エラー返信
    sockets[0]!.onmessage?.(JSON.stringify({ type: CMD_TYPE, cmd: "getStatus" }));
    const reply = JSON.parse(sockets[0]!.sent[before]!) as { id: null; result: { ok: boolean } };
    expect(reply.id).toBe(null);
    expect(reply.result.ok).toBe(false);
    // 無関係な type・不正 JSON は無視（返信も throw もしない）
    sockets[0]!.onmessage?.(JSON.stringify({ type: "other:msg" }));
    sockets[0]!.onmessage?.("{oops");
    expect(sockets[0]!.sent.length).toBe(before + 1);
    expect(calls).toEqual([]);
  });

  test("API が throw しても ok:false で返信する", () => {
    const api = { getStatus: () => { throw new Error("boom"); } } as unknown as AiApi;
    const factory = fakeSocketFactory();
    const client = new WsBridgeClient(api, { createSocket: factory.create });
    client.setConfig({ enabled: true, url: URL_A });
    factory.sockets[0]!.onopen?.();
    factory.sockets[0]!.onmessage?.(JSON.stringify({ type: CMD_TYPE, id: "r1", cmd: "getStatus" }));
    expect(JSON.parse(factory.sockets[0]!.sent[1]!)).toEqual({
      type: RESULT_TYPE, id: "r1", result: { ok: false, error: "boom" },
    });
  });

  test("切断で retrying になり、タイマ発火で新しい socket へ再接続する", () => {
    const { client, sockets, timers } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    sockets[0]!.onopen?.();
    sockets[0]!.onclose?.();
    expect(client.getStatus()).toBe("retrying");
    expect(timers.pendingCount()).toBe(1);
    timers.fire();
    expect(client.getStatus()).toBe("connecting");
    expect(sockets.length).toBe(2);
    sockets[1]!.onopen?.();
    expect(client.getStatus()).toBe("connected");
  });

  test("接続前の失敗（open 前の close）もリトライする", () => {
    const { client, sockets, timers } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    sockets[0]!.onclose?.(); // 接続失敗
    expect(client.getStatus()).toBe("retrying");
    timers.fire();
    expect(sockets.length).toBe(2);
  });

  test("socket 生成が throw しても静かに retrying へ落ちる", () => {
    const { api } = fakeApi();
    const timers = fakeTimers();
    const client = new WsBridgeClient(api, {
      createSocket: () => { throw new Error("bad url"); },
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });
    expect(() => client.setConfig({ enabled: true, url: "bad" })).not.toThrow();
    expect(client.getStatus()).toBe("retrying");
    expect(timers.pendingCount()).toBe(1);
  });

  test("disable で即 disabled・socket を閉じ・リトライタイマも止める", () => {
    const { client, sockets, timers } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    sockets[0]!.onopen?.();
    client.setConfig({ enabled: false, url: URL_A });
    expect(client.getStatus()).toBe("disabled");
    expect(sockets[0]!.closed).toBe(true);
    // retrying 中の disable でタイマが残らない
    client.setConfig({ enabled: true, url: URL_A });
    sockets[1]!.onclose?.();
    expect(timers.pendingCount()).toBe(1);
    client.setConfig({ enabled: false, url: URL_A });
    expect(timers.pendingCount()).toBe(0);
    expect(client.getStatus()).toBe("disabled");
  });

  test("disable 後に旧 socket の close が届いても disabled のまま（リトライしない）", () => {
    const { client, sockets, timers } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    const old = sockets[0]!;
    client.setConfig({ enabled: false, url: URL_A });
    old.onclose?.(); // 実 WebSocket は close() 後に onclose が飛ぶ
    expect(client.getStatus()).toBe("disabled");
    expect(timers.pendingCount()).toBe(0);
    expect(sockets.length).toBe(1);
  });

  test("URL 変更は張り直し（旧 socket を閉じて新 URL へ）", () => {
    const { client, sockets } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    sockets[0]!.onopen?.();
    client.setConfig({ enabled: true, url: URL_B });
    expect(sockets[0]!.closed).toBe(true);
    expect(sockets.length).toBe(2);
    expect(sockets[1]!.url).toBe(URL_B);
    expect(client.getStatus()).toBe("connecting");
  });

  test("同一設定の setConfig は何もしない（接続を張り直さない）", () => {
    const { client, sockets } = setup();
    client.setConfig({ enabled: true, url: URL_A });
    sockets[0]!.onopen?.();
    client.setConfig({ enabled: true, url: URL_A });
    expect(sockets.length).toBe(1);
    expect(client.getStatus()).toBe("connected");
    client.setConfig({ enabled: false, url: URL_A });
    client.setConfig({ enabled: false, url: URL_B });
    expect(sockets.length).toBe(1);
  });
});
