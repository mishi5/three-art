// #283: クリーンフィード publisher（メインタブ側）。出力 canvas の captureStream を
// WebRTC（RTCPeerConnection）で /obs.html（viewer）へ配信する。シグナリングは同一オリジンの
// BroadcastChannel（clean-feed-protocol.ts）＝同一マシン完結・シグナリングサーバ/STUN 不要
// （iceServers: [] で host candidate のみ）。viewer ごとに PC を 1 本張り（OBS＋確認用等の
// 複数 viewer 対応）、viewer が 1 人でもいる間は親（main.ts）が keepAlive/outputActive を立てる。
// RTCPeerConnection / BroadcastChannel / captureStream は deps 注入で差し替え可能
// （ClipLauncher の ClipMediaDeps・ScreenOutputs の deps パターン）。
import { CLEAN_FEED_CHANNEL, parseCleanFeedMessage } from "./clean-feed-protocol";
import { OUTPUT_CAPTURE_FPS } from "./output-window";

/** BroadcastChannel の最小サーフェス（テストではフェイクを注入する）。 */
export interface CleanFeedChannelLike {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  close(): void;
}

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
  /** シグナリング用チャンネル（BroadcastChannel 互換）。 */
  channel: CleanFeedChannelLike;
  /** viewer 1 人ぶんの RTCPeerConnection を作る（iceServers: []）。 */
  createPeerConnection(): CleanFeedPeerLike;
  /** 配信する MediaStream（出力 canvas の captureStream ＋ 音声トラック）を作る。 */
  createStream(): MediaStream;
  /**
   * createStream で作った stream を止める。注意: 音声トラックは録画（#179）と同一トラックを
   * 共有するため、実装（domCleanFeedDeps）では video トラックのみ stop する。
   */
  stopStream(stream: MediaStream): void;
}

/**
 * 実 RTCPeerConnection を最小サーフェス（CleanFeedPeerLike）として扱う。構造は互換だが、
 * DOM 型の handler 引数（RTCPeerConnectionIceEvent 等）が最小型より広く、strictFunctionTypes の
 * 反変チェックを通らないためここだけキャストする（実行時は subset プロパティしか触らない）。
 */
export function asPeerLike(pc: RTCPeerConnection): CleanFeedPeerLike {
  return pc as unknown as CleanFeedPeerLike;
}

/** RTCIceCandidate を BroadcastChannel で送れる plain object へ変換する。 */
function toCandidateInit(c: RTCIceCandidate): RTCIceCandidateInit {
  return typeof c.toJSON === "function" ? c.toJSON() : (c as unknown as RTCIceCandidateInit);
}

/** 切断とみなす connectionState（片付けの対象）。 */
const GONE_STATES = new Set(["failed", "disconnected", "closed"]);

/**
 * クリーンフィードの publisher。チャンネルを常時 listen し、viewer の cf:hello ごとに
 * RTCPeerConnection を張って offer を返す。viewer の bye/接続断で片付け、viewer が 0 に
 * なったら captureStream を停止する（＝誰もいなければ従来どおりのコストゼロ）。
 * viewer 数の増減は onViewersChange で親へ通知する（keepAlive/outputActive/解像度の同期用）。
 */
export class CleanFeedPublisher {
  /** viewer 数が変わったとき（追加・bye・接続断・dispose）。 */
  onViewersChange: (() => void) | null = null;
  private peers = new Map<string, CleanFeedPeerLike>();
  private stream: MediaStream | null = null;
  private disposed = false;

  constructor(private readonly deps: CleanFeedPublisherDeps) {
    deps.channel.onmessage = (e) => { void this.handleMessage(e.data); };
  }

  viewerCount(): number {
    return this.peers.size;
  }

  /** viewer が 1 人でもいるか（keepAlive/outputActive/描画解像度の OR 判定用）。 */
  hasViewers(): boolean {
    return this.peers.size > 0;
  }

  /** チャンネルで受けた生メッセージを処理する（テストから直接 await 可能）。 */
  async handleMessage(raw: unknown): Promise<void> {
    if (this.disposed) return;
    const msg = parseCleanFeedMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case "cf:hello":
        await this.handleHello(msg.viewerId);
        break;
      case "cf:answer": {
        const pc = this.peers.get(msg.viewerId);
        if (pc) {
          await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp })
            .catch((e) => console.warn("[clean-feed] setRemoteDescription failed:", e));
        }
        break;
      }
      case "cf:ice": {
        if (msg.from !== "viewer") break;   // 自分（pub）発の中継はここへ来ない想定だが保険
        const pc = this.peers.get(msg.viewerId);
        if (pc) {
          await pc.addIceCandidate(msg.candidate)
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

  /** viewer の接続要求。二重 hello（viewer リロード）は既存 PC を破棄して張り直す。 */
  private async handleHello(viewerId: string): Promise<void> {
    const existing = this.peers.get(viewerId);
    if (existing) {
      this.peers.delete(viewerId);
      existing.close();
    }
    const pc = this.deps.createPeerConnection();
    this.peers.set(viewerId, pc);
    // 先に親へ通知して keepAlive/outputActive/高解像度を立ててから captureStream を開始する。
    this.onViewersChange?.();
    this.stream ??= this.deps.createStream();
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;   // end-of-candidates は送らない
      this.deps.channel.postMessage({
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
      this.deps.channel.postMessage({ type: "cf:offer", viewerId, sdp: offer.sdp ?? "" });
    } catch (e) {
      console.warn("[clean-feed] offer failed:", e);
      this.removeViewer(viewerId);
    }
  }

  /** viewer 1 件の片付け。最後の 1 人が消えたら captureStream も停止する。 */
  private removeViewer(viewerId: string): void {
    const pc = this.peers.get(viewerId);
    if (!pc) return;
    this.peers.delete(viewerId);
    pc.close();
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
    for (const [viewerId, pc] of this.peers) {
      this.deps.channel.postMessage({ type: "cf:bye", viewerId });
      pc.close();
    }
    this.peers.clear();
    if (this.stream) {
      this.deps.stopStream(this.stream);
      this.stream = null;
    }
    this.deps.channel.onmessage = null;
    this.deps.channel.close();
    this.onViewersChange?.();
  }
}

/**
 * 実ブラウザ用の既定 deps。映像は出力 canvas（出力シーンに追従）の captureStream、
 * 音声は録画（#179）と同じ分岐（AudioOutput → recordingDestination・keep-alive 付き）から取る。
 * 音声トラックは録画と同一トラックの共有なので stopStream では video のみ止める。
 */
export function domCleanFeedDeps(
  source: { getRecordingStream(fps?: number, withAudio?: boolean): MediaStream },
): CleanFeedPublisherDeps {
  return {
    channel: new BroadcastChannel(CLEAN_FEED_CHANNEL),
    createPeerConnection: () => asPeerLike(new RTCPeerConnection({ iceServers: [] })),
    createStream: () => source.getRecordingStream(OUTPUT_CAPTURE_FPS, true),
    stopStream: (stream) => {
      for (const t of stream.getVideoTracks()) t.stop();
    },
  };
}
