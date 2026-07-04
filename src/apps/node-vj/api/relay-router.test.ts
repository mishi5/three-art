// #237: WS ブリッジ中継のルーティングのテスト。接続トークンは文字列で代用し、
// 「誰から来た raw を誰へ流すか」だけを検証する（ソケット/サーバは scripts/vj-relay.ts）。
import { describe, expect, test } from "bun:test";
import { HELLO_TYPE, RelayRouter, parseRelayMessage } from "./relay-router";
import { CMD_TYPE, RESULT_TYPE } from "./post-message-bridge";

// ---- parseRelayMessage ----

describe("parseRelayMessage", () => {
  test("hello（role: app / agent）を読み取れる", () => {
    expect(parseRelayMessage(JSON.stringify({ type: HELLO_TYPE, role: "app" })))
      .toEqual({ kind: "hello", role: "app" });
    expect(parseRelayMessage(JSON.stringify({ type: HELLO_TYPE, role: "agent" })))
      .toEqual({ kind: "hello", role: "agent" });
  });

  test("hello の role 不正は other（登録しない）", () => {
    expect(parseRelayMessage(JSON.stringify({ type: HELLO_TYPE, role: "admin" }))).toEqual({ kind: "other" });
    expect(parseRelayMessage(JSON.stringify({ type: HELLO_TYPE }))).toEqual({ kind: "other" });
  });

  test("cmd は id（string 以外は null）を取り出す", () => {
    expect(parseRelayMessage(JSON.stringify({ type: CMD_TYPE, id: "r1", cmd: "getStatus" })))
      .toEqual({ kind: "cmd", id: "r1" });
    expect(parseRelayMessage(JSON.stringify({ type: CMD_TYPE, cmd: "getStatus" })))
      .toEqual({ kind: "cmd", id: null });
    expect(parseRelayMessage(JSON.stringify({ type: CMD_TYPE, id: 42 })))
      .toEqual({ kind: "cmd", id: null });
  });

  test("result / 未知 type / 不正 JSON / 非オブジェクト", () => {
    expect(parseRelayMessage(JSON.stringify({ type: RESULT_TYPE, id: "r1", result: {} })))
      .toEqual({ kind: "result" });
    expect(parseRelayMessage(JSON.stringify({ type: "other:msg" }))).toEqual({ kind: "other" });
    expect(parseRelayMessage("{oops")).toEqual({ kind: "other" });
    expect(parseRelayMessage("42")).toEqual({ kind: "other" });
    expect(parseRelayMessage("[1,2]")).toEqual({ kind: "other" });
    expect(parseRelayMessage("null")).toEqual({ kind: "other" });
  });
});

// ---- RelayRouter ----

const hello = (role: string): string => JSON.stringify({ type: HELLO_TYPE, role });
const cmd = (id: string): string => JSON.stringify({ type: CMD_TYPE, id, cmd: "getStatus" });
const result = (id: string): string => JSON.stringify({ type: RESULT_TYPE, id, result: { ok: true } });
/** app 不在時に中継が送信元へ返すエラー result。 */
const notConnected = (id: string | null): string =>
  JSON.stringify({ type: RESULT_TYPE, id, result: { ok: false, error: "app not connected" } });

describe("RelayRouter", () => {
  test("agent の cmd を app へ原文のまま転送する", () => {
    const r = new RelayRouter<string>();
    expect(r.handleMessage("app1", hello("app"))).toEqual([]);
    expect(r.handleMessage("agent1", hello("agent"))).toEqual([]);
    const raw = cmd("r1");
    expect(r.handleMessage("agent1", raw)).toEqual([{ to: "app1", data: raw }]);
  });

  test("app の result を全 agent へ原文のまま転送する（agent は id で拾う）", () => {
    const r = new RelayRouter<string>();
    r.handleMessage("app1", hello("app"));
    r.handleMessage("agent1", hello("agent"));
    r.handleMessage("agent2", hello("agent"));
    const raw = result("r1");
    expect(r.handleMessage("app1", raw)).toEqual([
      { to: "agent1", data: raw },
      { to: "agent2", data: raw },
    ]);
  });

  test("app 不在の cmd は送信元へ app not connected を返す（id を引き継ぐ）", () => {
    const r = new RelayRouter<string>();
    r.handleMessage("agent1", hello("agent"));
    expect(r.handleMessage("agent1", cmd("r9"))).toEqual([{ to: "agent1", data: notConnected("r9") }]);
  });

  test("cmd の id 欠落時は id: null でエラー返信する", () => {
    const r = new RelayRouter<string>();
    expect(r.handleMessage("agent1", JSON.stringify({ type: CMD_TYPE, cmd: "getStatus" })))
      .toEqual([{ to: "agent1", data: notConnected(null) }]);
  });

  test("app は最後に hello した 1 本が有効（差し替え。旧 app の result は捨てる）", () => {
    const r = new RelayRouter<string>();
    r.handleMessage("app1", hello("app"));
    r.handleMessage("app2", hello("app"));
    r.handleMessage("agent1", hello("agent"));
    expect(r.handleMessage("agent1", cmd("r1"))).toEqual([{ to: "app2", data: cmd("r1") }]);
    // 旧 app からの result は agent へ流さない
    expect(r.handleMessage("app1", result("r1"))).toEqual([]);
    expect(r.handleMessage("app2", result("r1"))).toEqual([{ to: "agent1", data: result("r1") }]);
  });

  test("app 自身からの cmd は転送しない（自分宛ループを作らない）", () => {
    const r = new RelayRouter<string>();
    r.handleMessage("app1", hello("app"));
    expect(r.handleMessage("app1", cmd("r1"))).toEqual([{ to: "app1", data: notConnected("r1") }]);
  });

  test("agent 以外（未 hello / app）からの result は捨てる", () => {
    const r = new RelayRouter<string>();
    r.handleMessage("agent1", hello("agent"));
    expect(r.handleMessage("stranger", result("r1"))).toEqual([]);
  });

  test("切断掃除: app 切断で不在扱い・agent 切断で転送先から外れる", () => {
    const r = new RelayRouter<string>();
    r.handleMessage("app1", hello("app"));
    r.handleMessage("agent1", hello("agent"));
    r.handleMessage("agent2", hello("agent"));
    r.handleClose("app1");
    expect(r.handleMessage("agent1", cmd("r1"))).toEqual([{ to: "agent1", data: notConnected("r1") }]);
    r.handleMessage("app2", hello("app"));
    r.handleClose("agent1");
    expect(r.handleMessage("app2", result("r2"))).toEqual([{ to: "agent2", data: result("r2") }]);
  });

  test("役割の宣言し直しで前の役割を外す（app→agent / agent→app）", () => {
    const r = new RelayRouter<string>();
    r.handleMessage("c1", hello("app"));
    r.handleMessage("c1", hello("agent"));
    // c1 は agent になったので app 不在
    expect(r.handleMessage("c1", cmd("r1"))).toEqual([{ to: "c1", data: notConnected("r1") }]);
    r.handleMessage("c2", hello("agent"));
    r.handleMessage("c2", hello("app"));
    // c2 は app になったので result の転送先（agent）から外れる
    expect(r.handleMessage("c2", result("r2"))).toEqual([{ to: "c1", data: result("r2") }]);
  });

  test("不正 JSON・未知 type・role 不正の hello は黙って無視する", () => {
    const r = new RelayRouter<string>();
    r.handleMessage("app1", hello("app"));
    expect(r.handleMessage("agent1", "{oops")).toEqual([]);
    expect(r.handleMessage("agent1", JSON.stringify({ type: "other:msg" }))).toEqual([]);
    expect(r.handleMessage("agent1", hello("admin"))).toEqual([]);
  });
});
