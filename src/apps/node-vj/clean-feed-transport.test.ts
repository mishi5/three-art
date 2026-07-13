// #283: クリーンフィードのシグナリング transport のテスト。
// OBS のブラウザソースは OBS 内蔵の別ブラウザ（CEF）で動くため BroadcastChannel が
// メインタブへ届かない。WS リレー（/cf-signal）を主経路にし、BC は同一ブラウザ内の
// フォールバックとして残す。WsSignalTransport は WebSocket/タイマを fake 注入でテストする。
import { describe, expect, test } from "bun:test";
import {
  CF_SIGNAL_PATH,
  WS_RECONNECT_MS,
  WsSignalTransport,
  wsSignalUrl,
  type WsLike,
  type WsTransportDeps,
} from "./clean-feed-transport";

interface FakeWs extends WsLike {
  url: string;
  sent: string[];
  closed: boolean;
  simulateOpen(): void;
  simulateMessage(data: unknown): void;
  simulateClose(): void;
}

function makeFakes(): {
  deps: WsTransportDeps;
  sockets: FakeWs[];
  timers: { fn: () => void; ms: number; id: number; cancelled: boolean }[];
} {
  const sockets: FakeWs[] = [];
  const timers: { fn: () => void; ms: number; id: number; cancelled: boolean }[] = [];
  const deps: WsTransportDeps = {
    createWebSocket: (url) => {
      const ws: FakeWs = {
        url,
        sent: [],
        closed: false,
        readyState: 0,   // CONNECTING
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send(data: string) { this.sent.push(data); },
        close() {
          this.closed = true;
          this.readyState = 3;   // CLOSED
        },
        simulateOpen() {
          this.readyState = 1;   // OPEN
          this.onopen?.();
        },
        simulateMessage(data: unknown) { this.onmessage?.({ data }); },
        simulateClose() {
          this.readyState = 3;
          this.onclose?.();
        },
      };
      sockets.push(ws);
      return ws;
    },
    scheduleReconnect: (fn, ms) => {
      const id = timers.length + 1;
      timers.push({ fn, ms, id, cancelled: false });
      return id;
    },
    cancelReconnect: (id) => {
      const rec = timers.find((t) => t.id === id);
      if (rec) rec.cancelled = true;
    },
  };
  return { deps, sockets, timers };
}

describe("wsSignalUrl (#283)", () => {
  test("http は ws、https は wss にする", () => {
    expect(wsSignalUrl({ protocol: "http:", host: "localhost:3000" }))
      .toBe(`ws://localhost:3000${CF_SIGNAL_PATH}`);
    expect(wsSignalUrl({ protocol: "https:", host: "vj.example.com" }))
      .toBe(`wss://vj.example.com${CF_SIGNAL_PATH}`);
  });
});

describe("WsSignalTransport (#283)", () => {
  test("接続後の send は JSON 文字列で送る", () => {
    const { deps, sockets } = makeFakes();
    const t = new WsSignalTransport("ws://x/cf-signal", deps);
    expect(sockets).toHaveLength(1);
    expect(sockets[0]!.url).toBe("ws://x/cf-signal");
    t.send({ type: "cf:hello", viewerId: "v1" });   // CONNECTING 中は落とす（hello は再送される）
    expect(sockets[0]!.sent).toHaveLength(0);
    sockets[0]!.simulateOpen();
    t.send({ type: "cf:hello", viewerId: "v1" });
    expect(sockets[0]!.sent).toEqual(['{"type":"cf:hello","viewerId":"v1"}']);
  });

  test("受信は JSON パースして onMessage へ（不正 JSON・非文字列は無視）", () => {
    const { deps, sockets } = makeFakes();
    const t = new WsSignalTransport("ws://x/cf-signal", deps);
    const got: unknown[] = [];
    t.onMessage = (raw) => { got.push(raw); };
    sockets[0]!.simulateOpen();
    sockets[0]!.simulateMessage('{"type":"cf:hello","viewerId":"v1"}');
    sockets[0]!.simulateMessage("not json");
    sockets[0]!.simulateMessage(123);
    expect(got).toEqual([{ type: "cf:hello", viewerId: "v1" }]);
  });

  test("切断で再接続を予約し、tick で張り直す", () => {
    const { deps, sockets, timers } = makeFakes();
    const t = new WsSignalTransport("ws://x/cf-signal", deps);
    sockets[0]!.simulateOpen();
    sockets[0]!.simulateClose();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(WS_RECONNECT_MS);
    timers[0]!.fn();
    expect(sockets).toHaveLength(2);
    sockets[1]!.simulateOpen();
    t.send({ type: "cf:bye", viewerId: "v1" });
    expect(sockets[1]!.sent).toHaveLength(1);
  });

  test("接続前（サーバ不在）に落ちても再接続を続ける", () => {
    const { deps, sockets, timers } = makeFakes();
    new WsSignalTransport("ws://x/cf-signal", deps);
    sockets[0]!.simulateClose();   // 接続失敗（open せず close）
    timers[0]!.fn();
    sockets[1]!.simulateClose();
    expect(timers).toHaveLength(2);
  });

  test("close で socket と再接続タイマを片付ける（以後は再接続しない）", () => {
    const { deps, sockets, timers } = makeFakes();
    const t = new WsSignalTransport("ws://x/cf-signal", deps);
    sockets[0]!.simulateOpen();
    t.close();
    expect(sockets[0]!.closed).toBe(true);
    // close() 由来の onclose で再接続を予約しない
    sockets[0]!.simulateClose();
    expect(timers.filter((x) => !x.cancelled)).toHaveLength(0);
  });
});
