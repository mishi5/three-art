// #237: WS ブリッジのフロント側クライアント。ローカル中継（scripts/vj-relay.ts）へ
// WebSocket クライアントとして接続し、受信 cmd を v1 の parseCommandMessage /
// dispatchCommand（post-message-bridge）へ流して result を返信する＝プロトコルは v1 と同一。
// 中継が居なくてもアプリは通常動作する（接続失敗は静かに retrying へ落とし自動リトライ）。
import type { AiApi } from "./ai-api";
import { RESULT_TYPE, dispatchCommand, parseCommandMessage } from "./post-message-bridge";
import { HELLO_TYPE } from "./relay-router";

/** 接続状態（設定パネルの表示にもそのまま使う）。 */
export type WsBridgeStatus = "disabled" | "connecting" | "connected" | "retrying";

/** 状態機械のイベント。retry はリトライタイマの発火。 */
export type WsBridgeEvent = "enable" | "disable" | "opened" | "closed" | "retry";

/** 接続状態機械の遷移（純関数）。定義外のイベントは現状維持。 */
export function nextStatus(status: WsBridgeStatus, event: WsBridgeEvent): WsBridgeStatus {
  switch (event) {
    case "enable":
      return status === "disabled" ? "connecting" : status;
    case "disable":
      return "disabled";
    case "opened":
      return status === "connecting" ? "connected" : status;
    case "closed":
      return status === "disabled" ? "disabled" : "retrying";
    case "retry":
      return status === "retrying" ? "connecting" : status;
  }
}

/** WebSocket の最小サーフェス（テストではフェイクを注入する）。 */
export interface BridgeSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((data: string) => void) | null;
  onclose: (() => void) | null;
}

/** 実 WebSocket を BridgeSocket に包む（error は無視＝直後の close でリトライに落ちる）。 */
function defaultCreateSocket(url: string): BridgeSocket {
  const ws = new WebSocket(url);
  const s: BridgeSocket = {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
  ws.onopen = () => s.onopen?.();
  ws.onmessage = (e) => {
    if (typeof e.data === "string") s.onmessage?.(e.data);
  };
  ws.onclose = () => s.onclose?.();
  ws.onerror = () => {}; // console を汚さない（続く onclose がリトライを起こす）
  return s;
}

export interface WsBridgeClientOptions {
  createSocket?: (url: string) => BridgeSocket;
  /** 自動リトライ間隔（既定 3000ms）。 */
  retryIntervalMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface WsBridgeConfig {
  enabled: boolean;
  url: string;
}

/**
 * 中継への接続を管理するクライアント。setConfig で ON/OFF・URL 変更を即時反映する
 * （main.ts が prefs の変更ごとに呼ぶ）。open 時に hello role:"app" を送る。
 */
export class WsBridgeClient {
  private status: WsBridgeStatus = "disabled";
  private config: WsBridgeConfig = { enabled: false, url: "" };
  private socket: BridgeSocket | null = null;
  private retryHandle: unknown = null;
  private readonly createSocket: (url: string) => BridgeSocket;
  private readonly retryIntervalMs: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;

  constructor(private readonly api: AiApi, opts: WsBridgeClientOptions = {}) {
    this.createSocket = opts.createSocket ?? defaultCreateSocket;
    this.retryIntervalMs = opts.retryIntervalMs ?? 3000;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as number));
  }

  getStatus(): WsBridgeStatus {
    return this.status;
  }

  /** 設定を反映する。同一設定なら何もしない。URL 変更は張り直し。 */
  setConfig(config: WsBridgeConfig): void {
    const prev = this.config;
    this.config = { ...config };
    if (!config.enabled) {
      if (this.status === "disabled") return;
      this.teardown();
      this.status = nextStatus(this.status, "disable");
      return;
    }
    if (prev.enabled && prev.url === config.url) return; // 変更なし
    this.teardown();
    this.status = "disabled"; // enable 遷移の起点に揃える（URL 変更の張り直しも同経路）
    this.status = nextStatus(this.status, "enable");
    this.connect();
  }

  /** 現在の socket・リトライタイマを破棄する（旧 socket のイベントは無効化してから閉じる）。 */
  private teardown(): void {
    if (this.retryHandle !== null) {
      this.clearTimeoutFn(this.retryHandle);
      this.retryHandle = null;
    }
    const s = this.socket;
    if (s !== null) {
      this.socket = null;
      s.onopen = null;
      s.onmessage = null;
      s.onclose = null;
      try {
        s.close();
      } catch {
        // 静かに（既に閉じている等は無視）
      }
    }
  }

  private connect(): void {
    let s: BridgeSocket;
    try {
      s = this.createSocket(this.config.url);
    } catch {
      // URL 不正等で生成自体が失敗（console を汚さず retrying へ）
      this.scheduleRetry();
      return;
    }
    this.socket = s;
    s.onopen = () => {
      this.status = nextStatus(this.status, "opened");
      s.send(JSON.stringify({ type: HELLO_TYPE, role: "app" }));
    };
    s.onmessage = (data) => this.handleMessage(s, data);
    s.onclose = () => {
      this.socket = null;
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.status = nextStatus(this.status, "closed");
    this.retryHandle = this.setTimeoutFn(() => {
      this.retryHandle = null;
      this.status = nextStatus(this.status, "retry");
      if (this.config.enabled) this.connect();
    }, this.retryIntervalMs);
  }

  /** 受信 raw を v1 と同じ検証・dispatch に流し、result を返信する。cmd 以外は無視。 */
  private handleMessage(s: BridgeSocket, raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return; // 不正 JSON は黙って無視（中継は原則整形済みを流す）
    }
    const parsed = parseCommandMessage(data);
    if (parsed.kind === "ignore") return;
    if (parsed.kind === "invalid") {
      s.send(JSON.stringify({ type: RESULT_TYPE, id: parsed.id, result: { ok: false, error: parsed.error } }));
      return;
    }
    let result: unknown;
    try {
      result = dispatchCommand(this.api, parsed.cmd, parsed.args);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    s.send(JSON.stringify({ type: RESULT_TYPE, id: parsed.id, result }));
  }
}
