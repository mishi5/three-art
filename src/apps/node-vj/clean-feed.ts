// #283: クリーンフィード publisher（メインタブ側）。出力 canvas の captureStream を
// WebRTC（RTCPeerConnection）で /obs.html（viewer）へ配信する。シグナリングは
// clean-feed-transport.ts の transport 群——dev サーバの WS リレー（/cf-signal・クロス
// ブラウザ＝OBS のブラウザソース対応）と BroadcastChannel（同一ブラウザ内フォールバック）
// ——を**両方常時 listen** し、返信（offer/ice/bye）は hello が届いた transport へ返す。
// WebRTC 自体はブラウザ間で問題なく張れる（iceServers: [] で host candidate のみ）。
// viewer ごとに PC を 1 本張り（OBS＋確認用等の複数 viewer 対応）、viewer が 1 人でも
// いる間は親（main.ts）が keepAlive/outputActive を立てる。
// RTCPeerConnection / transport / captureStream は deps 注入で差し替え可能
// （ClipLauncher の ClipMediaDeps・ScreenOutputs の deps パターン）。
import { parseCleanFeedMessage } from "./clean-feed-protocol";
import { BroadcastChannelTransport, WsSignalTransport, wsSignalUrl, type CleanFeedTransport } from "./clean-feed-transport";
import { OUTPUT_CAPTURE_FPS } from "./output-window";

/**
 * 同一 viewerId の hello をまとめる時間幅（ms）。viewer は hello を全 transport へ送るため、
 * WS と BroadcastChannel の両方が生きている環境では同じ hello が二重に届く。直近の hello
 * から 1 秒以内の再 hello は無視して無駄な張り直しを避ける（viewer の再送間隔は 2 秒）。
 */
export const HELLO_DEDUPE_MS = 1000;

/** RTCPeerConnection の最小サーフェス（publisher/viewer 共用・テストではフェイクを注入する）。 */
export interface CleanFeedPeerLike {
  connectionState: string;
  onicecandidate: ((ev: { candidate: RTCIceCandidate | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  ontrack: ((ev: RTCTrackEvent) => void) | null;
  addTrack(track: MediaStreamTrack, stream: MediaStream): unknown;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
}

/** CleanFeedPublisher の外部依存（WebRTC / シグナリング / captureStream）。 */
export interface CleanFeedPublisherDeps {
  /** シグナリング transport 群（WS リレー・BroadcastChannel 等）。全てを常時 listen する。 */
  transports: CleanFeedTransport[];
  /** viewer 1 人ぶんの RTCPeerConnection を作る（iceServers: []）。 */
  createPeerConnection(): CleanFeedPeerLike;
  /** 配信する MediaStream（出力 canvas の captureStream ＋ 音声トラック）を作る。 */
  createStream(): MediaStream;
  /**
   * createStream で作った stream を止める。注意: 音声トラックは録画（#179）と同一トラックを
   * 共有するため、実装（domCleanFeedDeps）では video トラックのみ stop する。
   */
  stopStream(stream: MediaStream): void;
  /** hello デデュープ用の現在時刻（テスト用に注入可能・既定 Date.now）。 */
  now?: () => number;
}

/**
 * 実 RTCPeerConnection を最小サーフェス（CleanFeedPeerLike）として扱う。構造は互換だが、
 * DOM 型の handler 引数（RTCPeerConnectionIceEvent 等）が最小型より広く、strictFunctionTypes の
 * 反変チェックを通らないためここだけキャストする（実行時は subset プロパティしか触らない）。
 */
export function asPeerLike(pc: RTCPeerConnection): CleanFeedPeerLike {
  return pc as unknown as CleanFeedPeerLike;
}

/** RTCIceCandidate をシグナリングで送れる plain object へ変換する。 */
function toCandidateInit(c: RTCIceCandidate): RTCIceCandidateInit {
  return typeof c.toJSON === "function" ? c.toJSON() : (c as unknown as RTCIceCandidateInit);
}

/** 切断とみなす connectionState（片付けの対象）。 */
const GONE_STATES = new Set(["failed", "disconnected", "closed"]);

interface ViewerEntry {
  pc: CleanFeedPeerLike;
  /** この viewer の hello が届いた transport。返信（offer/ice/bye）はここへ返す。 */
  via: CleanFeedTransport;
}

/**
 * クリーンフィードの publisher。全 transport を常時 listen し、viewer の cf:hello ごとに
 * RTCPeerConnection を張って offer を返す（返信は hello が届いた transport へ）。
 * viewer の bye/接続断で片付け、viewer が 0 になったら captureStream を停止する
 * （＝誰もいなければ従来どおりのコストゼロ）。viewer 数の増減は onViewersChange で
 * 親へ通知する（keepAlive/outputActive/解像度の同期用）。
 */
export class CleanFeedPublisher {
  /** viewer 数が変わったとき（追加・bye・接続断・dispose）。 */
  onViewersChange: (() => void) | null = null;
  private peers = new Map<string, ViewerEntry>();
  private lastHelloAt = new Map<string, number>();
  private stream: MediaStream | null = null;
  private disposed = false;
  private readonly now: () => number;

  constructor(private readonly deps: CleanFeedPublisherDeps) {
    this.now = deps.now ?? (() => Date.now());
    for (const t of deps.transports) {
      t.onMessage = (raw) => { void this.handleMessage(raw, t); };
    }
  }

  viewerCount(): number {
    return this.peers.size;
  }

  /** viewer が 1 人でもいるか（keepAlive/outputActive/描画解像度の OR 判定用）。 */
  hasViewers(): boolean {
    return this.peers.size > 0;
  }

  /** transport で受けた生メッセージを処理する（テストから直接 await 可能）。 */
  async handleMessage(raw: unknown, via: CleanFeedTransport): Promise<void> {
    if (this.disposed) return;
    const msg = parseCleanFeedMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case "cf:hello":
        await this.handleHello(msg.viewerId, via);
        break;
      case "cf:answer": {
        const entry = this.peers.get(msg.viewerId);
        if (entry) {
          await entry.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp })
            .catch((e) => console.warn("[clean-feed] setRemoteDescription failed:", e));
        }
        break;
      }
      case "cf:ice": {
        if (msg.from !== "viewer") break;   // 自分（pub）発の中継はここへ来ない想定だが保険
        const entry = this.peers.get(msg.viewerId);
        if (entry) {
          await entry.pc.addIceCandidate(msg.candidate)
            .catch((e) => console.warn("[clean-feed] addIceCandidate failed:", e));
        }
        break;
      }
      case "cf:bye":
        this.removeViewer(msg.viewerId);
        break;
      // cf:offer は pub 発なので無視（parse は通るがハンドラなし）
    }
  }

  /**
   * viewer の接続要求。二重 hello（viewer リロード等）は既存 PC を破棄して張り直す。
   * ただし直近 HELLO_DEDUPE_MS 以内の再 hello（WS と BC の両方から届いた同一 hello）は無視する。
   */
  private async handleHello(viewerId: string, via: CleanFeedTransport): Promise<void> {
    const existing = this.peers.get(viewerId);
    if (existing) {
      const last = this.lastHelloAt.get(viewerId);
      if (last !== undefined && this.now() - last < HELLO_DEDUPE_MS) return;
      this.peers.delete(viewerId);
      existing.pc.close();
    }
    this.lastHelloAt.set(viewerId, this.now());
    const pc = this.deps.createPeerConnection();
    this.peers.set(viewerId, { pc, via });
    // 先に親へ通知して keepAlive/outputActive/高解像度を立ててから captureStream を開始する。
    this.onViewersChange?.();
    this.stream ??= this.deps.createStream();
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;   // end-of-candidates は送らない
      // 返信先は「現在のこの viewer の transport」（張り直し後の遅延 candidate に備え毎回引く）。
      this.peers.get(viewerId)?.via.send({
        type: "cf:ice", viewerId, from: "pub", candidate: toCandidateInit(ev.candidate),
      });
    };
    pc.onconnectionstatechange = () => {
      if (GONE_STATES.has(pc.connectionState)) this.removeViewer(viewerId);
    };
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      via.send({ type: "cf:offer", viewerId, sdp: offer.sdp ?? "" });
    } catch (e) {
      console.warn("[clean-feed] offer failed:", e);
      this.removeViewer(viewerId);
    }
  }

  /** viewer 1 件の片付け。最後の 1 人が消えたら captureStream も停止する。 */
  private removeViewer(viewerId: string): void {
    const entry = this.peers.get(viewerId);
    if (!entry) return;
    this.peers.delete(viewerId);
    this.lastHelloAt.delete(viewerId);   // 直後の再 hello（再接続）をデデュープしない
    entry.pc.close();
    if (this.peers.size === 0 && this.stream) {
      this.deps.stopStream(this.stream);
      this.stream = null;
    }
    this.onViewersChange?.();
  }

  /** 本体終了（pagehide）時の片付け。接続中 viewer へ bye を送って即再試行へ移らせる。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [viewerId, entry] of this.peers) {
      entry.via.send({ type: "cf:bye", viewerId });
      entry.pc.close();
    }
    this.peers.clear();
    this.lastHelloAt.clear();
    if (this.stream) {
      this.deps.stopStream(this.stream);
      this.stream = null;
    }
    for (const t of this.deps.transports) {
      t.onMessage = null;
      t.close();
    }
    this.onViewersChange?.();
  }
}

/**
 * 実ブラウザ用の既定 deps。シグナリングは WS リレー（/cf-signal・OBS のブラウザソース等の
 * 別ブラウザへ届く）と BroadcastChannel（WS エンドポイントが無い静的配信等の同一ブラウザ内
 * フォールバック）の両方を listen する。映像は出力 canvas（出力シーンに追従）の captureStream、
 * 音声は録画（#179）と同じ分岐（AudioOutput → recordingDestination・keep-alive 付き）から取る。
 * 音声トラックは録画と同一トラックの共有なので stopStream では video のみ止める。
 */
export function domCleanFeedDeps(
  source: { getRecordingStream(fps?: number, withAudio?: boolean): MediaStream },
): CleanFeedPublisherDeps {
  return {
    transports: [
      new WsSignalTransport(wsSignalUrl(location)),
      new BroadcastChannelTransport(),
    ],
    createPeerConnection: () => asPeerLike(new RTCPeerConnection({ iceServers: [] })),
    createStream: () => source.getRecordingStream(OUTPUT_CAPTURE_FPS, true),
    stopStream: (stream) => {
      for (const t of stream.getVideoTracks()) t.stop();
    },
  };
}
