// #283: クリーンフィード viewer（/obs.html 側）。publisher（メインタブ）の出現を cf:hello の
// 定期送信で待ち、offer を受けたら answer を返して映像/音声トラックを video へ流す。
// 切断（connectionState 悪化・pub の bye）で hello 再送へ戻る＝メインタブのリロードにも追従する。
// シグナリングは複数 transport（WS リレー＝OBS 等の別ブラウザ対応・BroadcastChannel＝
// WS エンドポイントが無い環境のフォールバック）へ**同時に hello を送り**、届いた側から
// offer が返る（返信はその transport へ）。WS が繋がらなければ BC だけが機能する＝自動的に
// フォールバックし、WS transport 自体も再接続を続けるため復帰も自動。
// RTCPeerConnection / transport / タイマは deps 注入で差し替え可能（テスト用）。
import { parseCleanFeedMessage } from "./clean-feed-protocol";
import type { CleanFeedPeerLike } from "./clean-feed";
import type { CleanFeedTransport } from "./clean-feed-transport";

/** 未接続の間に cf:hello を再送する間隔（ms）。 */
export const HELLO_INTERVAL_MS = 2000;

/** CleanFeedViewer の外部依存（WebRTC / シグナリング / タイマ / 親 UI）。 */
export interface CleanFeedViewerDeps {
  /** シグナリング transport 群（WS リレー・BroadcastChannel 等）。hello は全てへ送る。 */
  transports: CleanFeedTransport[];
  /** publisher と繋ぐ RTCPeerConnection を作る（iceServers: []）。 */
  createPeerConnection(): CleanFeedPeerLike;
  /** track 受信で親へ stream を渡す（video.srcObject へ）。 */
  onStream(stream: MediaStream): void;
  /** 接続確立/切断の通知（ステータステキストの表示切替用）。 */
  onConnectedChange(connected: boolean): void;
  /** hello 再送タイマ（setInterval 互換）。テストでは手動 tick に差し替える。 */
  scheduleHello(fn: () => void, intervalMs: number): number;
  cancelHello(id: number): void;
}

/** RTCIceCandidate をシグナリングで送れる plain object へ変換する。 */
function toCandidateInit(c: RTCIceCandidate): RTCIceCandidateInit {
  return typeof c.toJSON === "function" ? c.toJSON() : (c as unknown as RTCIceCandidateInit);
}

/** 切断とみなす connectionState。 */
const GONE_STATES = new Set(["failed", "disconnected", "closed"]);

/**
 * クリーンフィードの viewer。start() で hello の定期送信（全 transport へ）を開始し、
 * publisher からの offer に answer を返す（返信は offer が届いた transport へ）。
 * 二重 offer（publisher のリロード等）は古い PC を破棄して張り直す。
 */
export class CleanFeedViewer {
  private pc: CleanFeedPeerLike | null = null;
  /** 現在の接続の offer が届いた transport。answer/ice はここへ返す。 */
  private via: CleanFeedTransport | null = null;
  private helloTimer: number | null = null;
  private connected = false;
  private disposed = false;

  constructor(
    private readonly deps: CleanFeedViewerDeps,
    readonly viewerId: string,
  ) {
    for (const t of deps.transports) {
      t.onMessage = (raw) => { void this.handleMessage(raw, t); };
    }
  }

  /** hello を即送信し、未接続の間の定期再送を開始する。 */
  start(): void {
    this.sendHello();
    this.scheduleHelloTimer();
  }

  /** transport で受けた生メッセージを処理する（テストから直接 await 可能）。 */
  async handleMessage(raw: unknown, via: CleanFeedTransport): Promise<void> {
    if (this.disposed) return;
    const msg = parseCleanFeedMessage(raw);
    if (!msg || msg.viewerId !== this.viewerId) return;   // 自分宛て以外は無視
    switch (msg.type) {
      case "cf:offer":
        await this.handleOffer(msg.sdp, via);
        break;
      case "cf:ice": {
        if (msg.from !== "pub") break;   // viewer 発（自分の中継）は無視
        if (this.pc) {
          await this.pc.addIceCandidate(msg.candidate)
            .catch((e) => console.warn("[clean-feed-viewer] addIceCandidate failed:", e));
        }
        break;
      }
      case "cf:bye":
        this.handleDisconnect();
        break;
      // cf:hello / cf:answer は viewer 発なので無視
    }
  }

  /** ページ終了時の片付け。bye を全 transport へ送り publisher を即片付けさせる。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sendToAll({ type: "cf:bye", viewerId: this.viewerId });
    this.closePeer();
    this.cancelHelloTimer();
    for (const t of this.deps.transports) {
      t.onMessage = null;
      t.close();
    }
  }

  /** 全 transport へ送る（hello / bye。届く経路が事前に分からないため全てへ）。 */
  private sendToAll(msg: unknown): void {
    for (const t of this.deps.transports) t.send(msg);
  }

  private sendHello(): void {
    this.sendToAll({ type: "cf:hello", viewerId: this.viewerId });
  }

  private scheduleHelloTimer(): void {
    if (this.helloTimer !== null) return;
    this.helloTimer = this.deps.scheduleHello(() => {
      if (!this.connected) this.sendHello();
    }, HELLO_INTERVAL_MS);
  }

  private cancelHelloTimer(): void {
    if (this.helloTimer === null) return;
    this.deps.cancelHello(this.helloTimer);
    this.helloTimer = null;
  }

  private setConnected(on: boolean): void {
    if (this.connected === on) return;
    this.connected = on;
    this.deps.onConnectedChange(on);
  }

  /** offer を受けて answer を返す。既存 PC（古い publisher 等）は破棄して張り直す。 */
  private async handleOffer(sdp: string, via: CleanFeedTransport): Promise<void> {
    this.closePeer();
    const pc = this.deps.createPeerConnection();
    this.pc = pc;
    this.via = via;
    pc.ontrack = (ev) => {
      const stream = ev.streams?.[0];
      if (stream) this.deps.onStream(stream);
    };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      via.send({
        type: "cf:ice", viewerId: this.viewerId, from: "viewer", candidate: toCandidateInit(ev.candidate),
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        this.setConnected(true);
        this.cancelHelloTimer();
      } else if (GONE_STATES.has(pc.connectionState)) {
        this.handleDisconnect();
      }
    };
    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      via.send({ type: "cf:answer", viewerId: this.viewerId, sdp: answer.sdp ?? "" });
    } catch (e) {
      console.warn("[clean-feed-viewer] answer failed:", e);
      this.handleDisconnect();
    }
  }

  /** 切断の片付け。即 hello を打ち、定期再送へ戻る（publisher の再出現待ち）。 */
  private handleDisconnect(): void {
    this.closePeer();
    this.setConnected(false);
    if (this.disposed) return;
    this.sendHello();
    this.scheduleHelloTimer();
  }

  private closePeer(): void {
    this.via = null;
    if (!this.pc) return;
    const pc = this.pc;
    this.pc = null;
    pc.onconnectionstatechange = null;   // close() 由来の "closed" で再入しない
    pc.close();
  }
}

/** viewer id を生成する（crypto.randomUUID が無い環境は乱数フォールバック）。 */
export function newViewerId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
