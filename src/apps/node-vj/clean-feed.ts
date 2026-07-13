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

/**
 * 映像 sender のビットレート上限（bps）。Chrome/CEF の WebRTC は既定の上限が低く
 * （〜2.5Mbps 程度）、収まらない場合は解像度を落とす。パーティクル系の高エントロピー映像は
 * 既定値では 1080p を維持できず 480p 相当まで劣化するため、ローカル完結（帯域制約なし）
 * 前提で大きく引き上げる。degradationPreference "maintain-resolution" と併用する。
 */
export const CLEAN_FEED_MAX_BITRATE = 40_000_000;

/**
 * 映像 sender の degradationPreference。"maintain-resolution" は負荷/帯域不足時に解像度でなく
 * fps を落とす（既定 balanced だと 1080p が 480p 相当までダウンスケールされる）。
 * fps と解像度のバランスを変えたくなったらここを一箇所変更する。
 */
export const CLEAN_FEED_DEGRADATION = "maintain-resolution";

/** RTCRtpSendParameters の最小サーフェス（degradation/ビットレート設定に使う分だけ）。 */
export interface CleanFeedSendParameters {
  degradationPreference?: string;
  encodings?: { maxBitrate?: number }[];
}

/** RTCRtpSender の最小サーフェス（テストではフェイクを注入する）。 */
export interface CleanFeedSenderLike {
  getParameters(): CleanFeedSendParameters;
  setParameters(params: CleanFeedSendParameters): Promise<void>;
}

/** RTCRtpCodecCapability の最小サーフェス（コーデック優先順の並べ替えに使う分だけ）。 */
export interface CleanFeedCodec {
  mimeType: string;
  sdpFmtpLine?: string;
}

/** RTCRtpTransceiver の最小サーフェス（コーデック優先順の適用に使う分だけ）。 */
export interface CleanFeedTransceiverLike {
  /** この transceiver の sender（addTrack が返した sender と同一性比較する）。 */
  sender: unknown;
  setCodecPreferences(codecs: CleanFeedCodec[]): void;
}

/** RTCPeerConnection の最小サーフェス（publisher/viewer 共用・テストではフェイクを注入する）。 */
export interface CleanFeedPeerLike {
  connectionState: string;
  onicecandidate: ((ev: { candidate: RTCIceCandidate | null }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  ontrack: ((ev: RTCTrackEvent) => void) | null;
  addTrack(track: MediaStreamTrack, stream: MediaStream): CleanFeedSenderLike;
  getTransceivers(): CleanFeedTransceiverLike[];
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
  /**
   * 映像コーデックの capabilities（`RTCRtpSender.getCapabilities("video")`）。
   * 未対応環境は null（コーデック並べ替えをスキップして従来動作）。省略可（テスト互換）。
   */
  getVideoCodecCapabilities?(): { codecs: CleanFeedCodec[] } | null;
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

const H264_RE = /H264/i;

/**
 * コーデック一覧を H.264 最優先（その中でも packetization-mode=1 を先）に並べ替える。
 * VP8 ソフトウェアエンコードは 1080p60 の高エントロピー映像（パーティクル等）に間に合わず
 * fps が崩壊する。H.264 なら macOS では VideoToolbox のハードウェアエンコードが使われ、
 * 解像度（maintain-resolution）と fps を両立できる。元の相対順は各グループ内で維持する。
 */
export function preferH264(codecs: readonly CleanFeedCodec[]): CleanFeedCodec[] {
  const isH264 = (c: CleanFeedCodec): boolean => H264_RE.test(c.mimeType);
  const isPm1 = (c: CleanFeedCodec): boolean => (c.sdpFmtpLine ?? "").includes("packetization-mode=1");
  return [
    ...codecs.filter((c) => isH264(c) && isPm1(c)),
    ...codecs.filter((c) => isH264(c) && !isPm1(c)),
    ...codecs.filter((c) => !isH264(c)),
  ];
}

/**
 * 映像 sender に画質優先のエンコーダ設定を適用する。
 * - degradationPreference CLEAN_FEED_DEGRADATION（"maintain-resolution"）: 負荷/帯域が足りない
 *   ときは解像度でなく fps を落とす（既定 balanced だと 1080p が 480p 相当までダウンスケールされる）。
 * - maxBitrate CLEAN_FEED_MAX_BITRATE: 既定の低いビットレート上限（〜2.5Mbps）を引き上げる。
 * negotiation 前は setParameters が失敗する環境があるため、呼び出し側は offer 直後に加えて
 * connectionState "connected" 後にも再適用する（失敗は warn のみ・接続自体は続行）。
 */
async function applySenderQuality(sender: CleanFeedSenderLike): Promise<void> {
  try {
    const params = sender.getParameters();
    params.degradationPreference = CLEAN_FEED_DEGRADATION;
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    for (const enc of params.encodings) enc.maxBitrate = CLEAN_FEED_MAX_BITRATE;
    await sender.setParameters(params);
  } catch (e) {
    console.warn("[clean-feed] setParameters failed:", e);
  }
}

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
    // #283: 画質劣化対策。映像トラックに解像度優先ヒントを付け、映像 sender の
    // degradation/ビットレート上限を引き上げる（applySenderQuality 参照）。
    const videoSenders: CleanFeedSenderLike[] = [];
    for (const track of this.stream.getTracks()) {
      if (track.kind === "video") {
        track.contentHint = "detail";   // 解像度優先（fps より精細さを保つ）
        videoSenders.push(pc.addTrack(track, this.stream));
      } else {
        pc.addTrack(track, this.stream);
      }
    }
    pc.onconnectionstatechange = () => {
      if (GONE_STATES.has(pc.connectionState)) {
        this.removeViewer(viewerId);
        return;
      }
      // negotiation 前の setParameters が無効/失敗する環境向けの防御: 接続確立後に再適用する。
      if (pc.connectionState === "connected") {
        for (const s of videoSenders) void applySenderQuality(s);
      }
    };
    for (const s of videoSenders) await applySenderQuality(s);
    // #283: VP8 ソフトエンコードで fps が崩壊するため H.264（HW エンコード）を最優先にする。
    // setCodecPreferences は offer 作成前に適用する必要がある。
    this.preferVideoCodecs(pc, videoSenders);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      via.send({ type: "cf:offer", viewerId, sdp: offer.sdp ?? "" });
    } catch (e) {
      console.warn("[clean-feed] offer failed:", e);
      this.removeViewer(viewerId);
    }
  }

  /**
   * 映像 transceiver へ H.264 最優先のコーデック順を適用する（offer 作成前に呼ぶ）。
   * getCapabilities/setCodecPreferences が無い環境・H.264 が無い環境ではスキップして
   * 従来動作（ブラウザ既定＝多くは VP8）のまま。例外は warn のみで接続は続行する。
   */
  private preferVideoCodecs(pc: CleanFeedPeerLike, videoSenders: readonly CleanFeedSenderLike[]): void {
    try {
      const caps = this.deps.getVideoCodecCapabilities?.() ?? null;
      if (!caps || !caps.codecs.some((c) => H264_RE.test(c.mimeType))) return;
      const preferred = preferH264(caps.codecs);
      for (const tr of pc.getTransceivers()) {
        if ((videoSenders as readonly unknown[]).includes(tr.sender)) {
          tr.setCodecPreferences(preferred);
        }
      }
    } catch (e) {
      console.warn("[clean-feed] setCodecPreferences failed:", e);
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
    createPeerConnection: () => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      // デバッグ/E2E 用: 最新の PC を公開し、getStats で送信コーデック・encode fps・
      // qualityLimitationReason・encoderImplementation（HW/SW）を確認できるようにする。
      (window as unknown as { __cfPubPeer?: RTCPeerConnection }).__cfPubPeer = pc;
      return asPeerLike(pc);
    },
    createStream: () => source.getRecordingStream(OUTPUT_CAPTURE_FPS, true),
    stopStream: (stream) => {
      for (const t of stream.getVideoTracks()) t.stop();
    },
    getVideoCodecCapabilities: () => {
      try {
        if (typeof RTCRtpSender === "undefined" || typeof RTCRtpSender.getCapabilities !== "function") {
          return null;
        }
        return RTCRtpSender.getCapabilities("video");
      } catch {
        return null;   // 未対応環境はコーデック並べ替えをスキップ
      }
    },
  };
}
