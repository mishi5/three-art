// #237: WS ブリッジ中継（scripts/vj-relay.ts）のルーティング純ロジック。
// 中継は機能を持たない dumb pipe: hello で役割を登録し、cmd を app へ・result を全 agent へ
// 原文のまま流すだけ。接続トークン C は総称型（実行時は ServerWebSocket・テストでは文字列）。
// プロトコルの type 文字列は v1（post-message-bridge）と共有する。
import { CMD_TYPE, RESULT_TYPE } from "./post-message-bridge";

/** 役割宣言メッセージの type（接続直後にクライアントが送る）。 */
export const HELLO_TYPE = "node-vj:hello";

/** クライアントの役割。app = node-vj タブ / agent = 外部 AI エージェント。 */
export type RelayRole = "app" | "agent";

/** 受信 raw の分類（中継は中身に関知せず type と cmd の id だけ見る）。 */
export type RelayParsed =
  | { kind: "hello"; role: RelayRole }
  | { kind: "cmd"; id: string | null }
  | { kind: "result" }
  | { kind: "other" };

/** 中継が発行する送信指示（to へ data をそのまま送る）。 */
export interface RelaySend<C> {
  to: C;
  data: string;
}

/** 受信 raw を分類する純関数。不正 JSON・未知 type・role 不正は other（無視対象）。 */
export function parseRelayMessage(raw: string): RelayParsed {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { kind: "other" };
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return { kind: "other" };
  const d = obj as Record<string, unknown>;
  if (d.type === HELLO_TYPE) {
    if (d.role === "app" || d.role === "agent") return { kind: "hello", role: d.role };
    return { kind: "other" };
  }
  if (d.type === CMD_TYPE) return { kind: "cmd", id: typeof d.id === "string" ? d.id : null };
  if (d.type === RESULT_TYPE) return { kind: "result" };
  return { kind: "other" };
}

/** app 不在時に cmd の送信元へ返すエラー result（v1 と同じ結果形）。 */
function appNotConnected(id: string | null): string {
  return JSON.stringify({ type: RESULT_TYPE, id, result: { ok: false, error: "app not connected" } });
}

/**
 * 役割登録と転送先解決を担うルータ。
 * - app は最後に hello した 1 本のみ有効（タブ再読込で自然に差し替わる）
 * - cmd → app へ転送（app 不在・app 自身からの cmd は送信元へエラー result）
 * - result → 現 app からのみ受理し、全 agent へ転送（agent は id で自分の応答を拾う）
 */
export class RelayRouter<C> {
  private app: C | null = null;
  private readonly agents = new Set<C>();

  /** 受信 1 件を処理し、送信指示のリストを返す（送信自体は呼び出し側）。 */
  handleMessage(sender: C, raw: string): RelaySend<C>[] {
    const msg = parseRelayMessage(raw);
    switch (msg.kind) {
      case "hello":
        // 役割の宣言し直しに備え、前の役割は外す。
        if (msg.role === "app") {
          this.app = sender;
          this.agents.delete(sender);
        } else {
          this.agents.add(sender);
          if (this.app === sender) this.app = null;
        }
        return [];
      case "cmd":
        // app 自身からの cmd は転送しない（自分宛のループを作らない）。
        if (this.app === null || this.app === sender) {
          return [{ to: sender, data: appNotConnected(msg.id) }];
        }
        return [{ to: this.app, data: raw }];
      case "result":
        if (sender !== this.app) return []; // 旧 app / 未 hello からの result は捨てる
        return [...this.agents].map((agent) => ({ to: agent, data: raw }));
      case "other":
        return [];
    }
  }

  /** 切断時の掃除。app 切断で不在扱いに戻る。 */
  handleClose(sender: C): void {
    if (this.app === sender) this.app = null;
    this.agents.delete(sender);
  }
}
