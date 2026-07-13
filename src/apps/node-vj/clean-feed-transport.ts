// #283: クリーンフィードのシグナリング transport 抽象。
// 当初は BroadcastChannel のみだったが、OBS のブラウザソースは OBS 内蔵の別ブラウザ（CEF）で
// 動くため BroadcastChannel がメインタブ（Chrome）へ届かないことが実機で発覚した。
// そこで dev サーバ（scripts/vj-dev.ts）の WS リレー（/cf-signal・送信元以外へ転送）を
// 主経路にし、BroadcastChannel は WS エンドポイントが無い環境（静的 dist 配信等）の
// 同一ブラウザ内フォールバックとして残す。publisher/viewer は複数 transport を同時に
// listen/送信し、返信は「相手のメッセージが届いた transport」へ返す。
import { CLEAN_FEED_CHANNEL } from "./clean-feed-protocol";

/** WS シグナリングリレーのパス（scripts/vj-dev.ts が upgrade する）。 */
export const CF_SIGNAL_PATH = "/cf-signal";

/** WS 切断/接続失敗後に再接続を試みる間隔（ms）。 */
export const WS_RECONNECT_MS = 3000;

/**
 * シグナリングメッセージの送受信路。send は接続状態が整っていなければ黙って落としてよい
 * （cf:hello は定期再送されるため）。受信は構造化データ（plain object）を onMessage へ渡す。
 */
export interface CleanFeedTransport {
  send(msg: unknown): void;
  onMessage: ((raw: unknown) => void) | null;
  close(): void;
}

/** location から WS シグナリング URL を組み立てる（https は wss）。 */
export function wsSignalUrl(loc: { protocol: string; host: string }): string {
  const scheme = loc.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${loc.host}${CF_SIGNAL_PATH}`;
}

/** WebSocket の最小サーフェス（テストではフェイクを注入する）。 */
export interface WsLike {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

/** WsSignalTransport の外部依存（WebSocket 生成・再接続タイマ）。 */
export interface WsTransportDeps {
  createWebSocket(url: string): WsLike;
  scheduleReconnect(fn: () => void, ms: number): number;
  cancelReconnect(id: number): void;
}

/**
 * 実 WebSocket を最小サーフェスへ縮める。構造は互換だが、DOM 型の handler 引数
 * （MessageEvent 等）が最小型より広く strictFunctionTypes の反変チェックを通らないため
 * ここだけキャストする（実行時は subset プロパティしか触らない）。
 */
function asWsLike(ws: WebSocket): WsLike {
  return ws as unknown as WsLike;
}

/** 実ブラウザ用の既定 deps。 */
function domWsTransportDeps(): WsTransportDeps {
  return {
    createWebSocket: (url) => asWsLike(new WebSocket(url)),
    scheduleReconnect: (fn, ms) => window.setTimeout(fn, ms),
    cancelReconnect: (id) => window.clearTimeout(id),
  };
}

const WS_OPEN = 1;

/**
 * WS リレー（/cf-signal）経由の transport。メッセージは JSON 文字列化して送り、受信は
 * JSON パースして onMessage へ（不正 JSON は無視）。切断・接続失敗時は WS_RECONNECT_MS
 * 間隔で自動再接続する（publisher は受け身で hello を待つため、能動的な再接続が必要）。
 * 接続前の send は黙って落とす（hello は定期再送・offer/answer/ice は受信直後＝接続中に送る）。
 */
export class WsSignalTransport implements CleanFeedTransport {
  onMessage: ((raw: unknown) => void) | null = null;
  private ws: WsLike | null = null;
  private reconnectTimer: number | null = null;
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly deps: WsTransportDeps = domWsTransportDeps(),
  ) {
    this.connect();
  }

  send(msg: unknown): void {
    if (!this.ws || this.ws.readyState !== WS_OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (e) {
      console.warn("[clean-feed] ws send failed:", e);
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer !== null) {
      this.deps.cancelReconnect(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.onMessage = null;
  }

  private connect(): void {
    if (this.closed) return;
    let ws: WsLike;
    try {
      ws = this.deps.createWebSocket(this.url);
    } catch {
      this.scheduleReconnect();   // URL 不正・環境非対応などの同期失敗
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;   // 不正 JSON は無視
      }
      this.onMessage?.(raw);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;   // close() 済み・古い socket の遅延イベント
      this.ws = null;
      this.scheduleReconnect();
    };
    ws.onerror = () => { /* onclose が続くのでそちらで処理 */ };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    this.reconnectTimer = this.deps.scheduleReconnect(() => {
      this.reconnectTimer = null;
      this.connect();
    }, WS_RECONNECT_MS);
  }
}

/**
 * BroadcastChannel 経由の transport（同一ブラウザ・同一オリジン内のみ届く）。
 * WS エンドポイントが無い環境（静的 dist 配信等）のフォールバック。
 */
export class BroadcastChannelTransport implements CleanFeedTransport {
  onMessage: ((raw: unknown) => void) | null = null;
  private readonly ch: BroadcastChannel;

  constructor(name: string = CLEAN_FEED_CHANNEL) {
    this.ch = new BroadcastChannel(name);
    this.ch.onmessage = (e) => { this.onMessage?.(e.data); };
  }

  send(msg: unknown): void {
    this.ch.postMessage(msg);
  }

  close(): void {
    this.ch.onmessage = null;
    this.ch.close();
    this.onMessage = null;
  }
}
