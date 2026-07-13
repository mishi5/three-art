// #283: CleanFeedPublisher（メインタブ側・viewer ごとの RTCPeerConnection 管理）のテスト。
// RTCPeerConnection / シグナリング transport / captureStream は deps 注入の fake で差し替える
// （ClipLauncher の ClipMediaDeps・ScreenOutputs の deps パターン）。
// シグナリングは WS リレーと BroadcastChannel の複数 transport を常時 listen し、
// 返信は hello が届いた transport へ返す（OBS の別ブラウザ問題対応）。
import { describe, expect, test } from "bun:test";
import {
  CLEAN_FEED_MAX_BITRATE,
  CleanFeedPublisher,
  HELLO_DEDUPE_MS,
  type CleanFeedPeerLike,
  type CleanFeedPublisherDeps,
  type CleanFeedSenderLike,
  type CleanFeedSendParameters,
} from "./clean-feed";
import type { CleanFeedTransport } from "./clean-feed-transport";

interface FakeTrack {
  kind: string;
  contentHint?: string;
}

interface FakeSender extends CleanFeedSenderLike {
  trackKind: string;
  /** setParameters の呼び出しを深いコピーで記録する。 */
  applied: CleanFeedSendParameters[];
}

interface FakePeer extends CleanFeedPeerLike {
  addedTracks: { track: unknown; stream: unknown }[];
  senders: FakeSender[];
  localDesc: RTCSessionDescriptionInit | null;
  remoteDesc: RTCSessionDescriptionInit | null;
  iceCandidates: RTCIceCandidateInit[];
  closed: boolean;
  /** connectionState を変えて onconnectionstatechange を発火する。 */
  simulateState(state: string): void;
}

interface FakeTransport extends CleanFeedTransport {
  sent: unknown[];
  closed: boolean;
}

function makeTransport(): FakeTransport {
  return {
    sent: [],
    closed: false,
    onMessage: null,
    send(msg: unknown) { this.sent.push(msg); },
    close() { this.closed = true; },
  };
}

function makeFakes(transportCount = 1): {
  deps: CleanFeedPublisherDeps;
  transports: FakeTransport[];
  peers: FakePeer[];
  streams: { stream: MediaStream; stopped: boolean }[];
  clock: { now: number };
} {
  const peers: FakePeer[] = [];
  const streams: { stream: MediaStream; stopped: boolean }[] = [];
  const transports = Array.from({ length: transportCount }, makeTransport);
  const clock = { now: 100_000 };
  const deps: CleanFeedPublisherDeps = {
    transports,
    now: () => clock.now,
    createPeerConnection: () => {
      const p: FakePeer = {
        addedTracks: [],
        senders: [],
        localDesc: null,
        remoteDesc: null,
        iceCandidates: [],
        closed: false,
        connectionState: "new",
        onicecandidate: null,
        onconnectionstatechange: null,
        ontrack: null,
        addTrack(track, stream) {
          this.addedTracks.push({ track, stream });
          const sender: FakeSender = {
            trackKind: (track as unknown as FakeTrack).kind,
            applied: [],
            // 実 RTCRtpSender と同様、getParameters は現在値のコピーを返す（初期は空 encodings）。
            getParameters: () => ({ encodings: [] }),
            setParameters(params) {
              this.applied.push(structuredClone(params));
              return Promise.resolve();
            },
          };
          this.senders.push(sender);
          return sender;
        },
        createOffer: () => Promise.resolve({ type: "offer" as const, sdp: "offer-sdp" }),
        createAnswer: () => Promise.resolve({ type: "answer" as const, sdp: "answer-sdp" }),
        setLocalDescription(d) { this.localDesc = d ?? null; return Promise.resolve(); },
        setRemoteDescription(d) { this.remoteDesc = d; return Promise.resolve(); },
        addIceCandidate(c) { this.iceCandidates.push(c ?? {}); return Promise.resolve(); },
        close() { this.closed = true; },
        simulateState(state: string) {
          this.connectionState = state;
          this.onconnectionstatechange?.();
        },
      };
      peers.push(p);
      return p;
    },
    createStream: () => {
      const tracks = [{ kind: "video" }, { kind: "audio" }];
      const stream = {
        getTracks: () => tracks,
        getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
      } as unknown as MediaStream;
      const rec = { stream, stopped: false };
      streams.push(rec);
      return stream;
    },
    stopStream: (stream) => {
      const rec = streams.find((r) => r.stream === stream);
      if (rec) rec.stopped = true;
    },
  };
  return { deps, transports, peers, streams, clock };
}

const hello = (viewerId: string): unknown => ({ type: "cf:hello", viewerId });

function sentOfType(t: FakeTransport, type: string): unknown[] {
  return t.sent.filter((m) => (m as { type: string }).type === type);
}

describe("CleanFeedPublisher (#283)", () => {
  test("hello で PC を張り offer を返す（track 追加・viewer 数 1・変更通知）", async () => {
    const { deps, transports, peers, streams } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    let notified = 0;
    pub.onViewersChange = () => { notified++; };

    await pub.handleMessage(hello("v1"), t1);

    expect(peers).toHaveLength(1);
    expect(streams).toHaveLength(1);
    expect(peers[0]!.addedTracks).toHaveLength(2);          // video + audio
    expect(peers[0]!.localDesc?.sdp).toBe("offer-sdp");
    expect(t1.sent).toContainEqual({ type: "cf:offer", viewerId: "v1", sdp: "offer-sdp" });
    expect(pub.viewerCount()).toBe(1);
    expect(pub.hasViewers()).toBe(true);
    expect(notified).toBe(1);
  });

  test("返信は hello が届いた transport へ（offer / ICE / dispose の bye）", async () => {
    const { deps, transports, peers } = makeFakes(2);
    const [t1, t2] = [transports[0]!, transports[1]!];
    const pub = new CleanFeedPublisher(deps);

    await pub.handleMessage(hello("v-ws"), t2);
    expect(sentOfType(t2, "cf:offer")).toHaveLength(1);
    expect(sentOfType(t1, "cf:offer")).toHaveLength(0);     // hello が来ていない側へは送らない

    const init = { candidate: "candidate:9", sdpMid: "0" };
    peers[0]!.onicecandidate?.({ candidate: { toJSON: () => init } as unknown as RTCIceCandidate });
    expect(sentOfType(t2, "cf:ice")).toEqual([{ type: "cf:ice", viewerId: "v-ws", from: "pub", candidate: init }]);
    expect(sentOfType(t1, "cf:ice")).toHaveLength(0);

    pub.dispose();
    expect(sentOfType(t2, "cf:bye")).toEqual([{ type: "cf:bye", viewerId: "v-ws" }]);
    expect(sentOfType(t1, "cf:bye")).toHaveLength(0);
  });

  test("複数 transport から届いた同一 hello はデデュープする（1 秒以内）", async () => {
    const { deps, transports, peers, clock } = makeFakes(2);
    const [t1, t2] = [transports[0]!, transports[1]!];
    const pub = new CleanFeedPublisher(deps);

    await pub.handleMessage(hello("v1"), t1);
    clock.now += 10;                                        // WS/BC の到着差
    await pub.handleMessage(hello("v1"), t2);
    expect(peers).toHaveLength(1);                          // 張り直さない
    expect(pub.viewerCount()).toBe(1);

    // 1 秒経過後の再 hello（viewer の再試行）は従来どおり張り直す
    clock.now += HELLO_DEDUPE_MS;
    await pub.handleMessage(hello("v1"), t2);
    expect(peers).toHaveLength(2);
    expect(peers[0]!.closed).toBe(true);
    expect(pub.viewerCount()).toBe(1);
    // 張り直し後の返信は新しい hello の transport（t2）へ
    const init = { candidate: "candidate:2", sdpMid: "0" };
    peers[1]!.onicecandidate?.({ candidate: { toJSON: () => init } as unknown as RTCIceCandidate });
    expect(sentOfType(t2, "cf:ice")).toHaveLength(1);
    expect(sentOfType(t1, "cf:ice")).toHaveLength(0);
  });

  test("複数 viewer: viewer ごとに PC・stream は 1 本を共有", async () => {
    const { deps, transports, peers, streams, clock } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), t1);
    clock.now += 10;
    await pub.handleMessage(hello("v2"), t1);               // 別 viewer はデデュープ対象外

    expect(peers).toHaveLength(2);
    expect(streams).toHaveLength(1);                        // captureStream は初回のみ
    expect(pub.viewerCount()).toBe(2);
    expect(sentOfType(t1, "cf:offer")).toHaveLength(2);
  });

  test("answer を該当 viewer の PC へ適用する", async () => {
    const { deps, transports, peers } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), t1);
    await pub.handleMessage({ type: "cf:answer", viewerId: "v1", sdp: "remote-sdp" }, t1);
    expect(peers[0]!.remoteDesc).toEqual({ type: "answer", sdp: "remote-sdp" });
  });

  test("viewer からの ICE は addIceCandidate・pub 発の ICE は無視", async () => {
    const { deps, transports, peers } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), t1);
    const candidate = { candidate: "candidate:1", sdpMid: "0" };
    await pub.handleMessage({ type: "cf:ice", viewerId: "v1", from: "viewer", candidate }, t1);
    await pub.handleMessage({ type: "cf:ice", viewerId: "v1", from: "pub", candidate }, t1);
    expect(peers[0]!.iceCandidates).toEqual([candidate]);
  });

  test("pub 側 ICE candidate を中継する（null は送らない）", async () => {
    const { deps, transports, peers } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), t1);
    const init = { candidate: "candidate:9", sdpMid: "0" };
    peers[0]!.onicecandidate?.({ candidate: { toJSON: () => init } as unknown as RTCIceCandidate });
    peers[0]!.onicecandidate?.({ candidate: null });
    expect(sentOfType(t1, "cf:ice")).toEqual([{ type: "cf:ice", viewerId: "v1", from: "pub", candidate: init }]);
  });

  test("二重 hello（viewer リロード・デデュープ幅より後）: 旧 PC を破棄して張り直す", async () => {
    const { deps, transports, peers, clock } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), t1);
    clock.now += HELLO_DEDUPE_MS + 1;
    await pub.handleMessage(hello("v1"), t1);
    expect(peers).toHaveLength(2);
    expect(peers[0]!.closed).toBe(true);
    expect(peers[1]!.closed).toBe(false);
    expect(pub.viewerCount()).toBe(1);
  });

  test("bye で片付け・最後の viewer が消えたら stream を停止", async () => {
    const { deps, transports, peers, streams, clock } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    let notified = 0;
    pub.onViewersChange = () => { notified++; };
    await pub.handleMessage(hello("v1"), t1);
    clock.now += 10;
    await pub.handleMessage(hello("v2"), t1);
    notified = 0;

    await pub.handleMessage({ type: "cf:bye", viewerId: "v1" }, t1);
    expect(peers[0]!.closed).toBe(true);
    expect(pub.viewerCount()).toBe(1);
    expect(streams[0]!.stopped).toBe(false);                // まだ v2 がいる

    await pub.handleMessage({ type: "cf:bye", viewerId: "v2" }, t1);
    expect(pub.viewerCount()).toBe(0);
    expect(streams[0]!.stopped).toBe(true);
    expect(notified).toBe(2);
  });

  test("接続断（failed / disconnected / closed）でも片付ける", async () => {
    for (const state of ["failed", "disconnected", "closed"]) {
      const { deps, transports, peers, streams } = makeFakes();
      const pub = new CleanFeedPublisher(deps);
      await pub.handleMessage(hello("v1"), transports[0]!);
      peers[0]!.simulateState(state);
      expect(pub.viewerCount()).toBe(0);
      expect(peers[0]!.closed).toBe(true);
      expect(streams[0]!.stopped).toBe(true);
    }
  });

  test("connecting / connected では片付けない", async () => {
    const { deps, transports, peers } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), transports[0]!);
    peers[0]!.simulateState("connecting");
    peers[0]!.simulateState("connected");
    expect(pub.viewerCount()).toBe(1);
  });

  test("bye 後の即再 hello はデデュープされず復帰し stream を張り直す", async () => {
    const { deps, transports, streams } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), t1);
    await pub.handleMessage({ type: "cf:bye", viewerId: "v1" }, t1);
    await pub.handleMessage(hello("v1"), t1);               // 同時刻でも再接続できる
    expect(streams).toHaveLength(2);                        // 停止後に作り直す
    expect(pub.viewerCount()).toBe(1);
  });

  test("dispose: 各 viewer へ bye 送信・PC/stream/全 transport を片付け", async () => {
    const { deps, transports, peers, streams, clock } = makeFakes(2);
    const [t1, t2] = [transports[0]!, transports[1]!];
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), t1);
    clock.now += 10;
    await pub.handleMessage(hello("v2"), t2);

    pub.dispose();
    expect(sentOfType(t1, "cf:bye")).toEqual([{ type: "cf:bye", viewerId: "v1" }]);
    expect(sentOfType(t2, "cf:bye")).toEqual([{ type: "cf:bye", viewerId: "v2" }]);
    expect(peers.every((p) => p.closed)).toBe(true);
    expect(streams[0]!.stopped).toBe(true);
    expect(t1.closed).toBe(true);
    expect(t2.closed).toBe(true);
    expect(pub.viewerCount()).toBe(0);

    // dispose 後のメッセージは無視される
    await pub.handleMessage(hello("v3"), t1);
    expect(pub.viewerCount()).toBe(0);
  });

  test("transport.onMessage 経由でも処理される（配線）", async () => {
    const { deps, transports } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    transports[0]!.onMessage?.(hello("v1"));
    await Bun.sleep(0);
    expect(pub.viewerCount()).toBe(1);
  });

  test("画質設定: 映像トラックに contentHint=detail・映像 sender に maintain-resolution と maxBitrate", async () => {
    const { deps, transports, peers, streams } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), transports[0]!);

    // 映像トラックのみ contentHint=detail（音声には付けない）
    const tracks = (streams[0]!.stream.getTracks() as unknown as FakeTrack[]);
    expect(tracks.find((t) => t.kind === "video")?.contentHint).toBe("detail");
    expect(tracks.find((t) => t.kind === "audio")?.contentHint).toBeUndefined();

    // 映像 sender のみ degradation/ビットレート設定を適用（音声 sender は触らない）
    const video = peers[0]!.senders.find((s) => s.trackKind === "video")!;
    const audio = peers[0]!.senders.find((s) => s.trackKind === "audio")!;
    expect(video.applied).toHaveLength(1);
    expect(video.applied[0]!.degradationPreference).toBe("maintain-resolution");
    expect(video.applied[0]!.encodings).toEqual([{ maxBitrate: CLEAN_FEED_MAX_BITRATE }]);
    expect(audio.applied).toHaveLength(0);
  });

  test("画質設定: 接続確立（connected）後にも再適用する（negotiation 前失敗の防御）", async () => {
    const { deps, transports, peers } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"), transports[0]!);
    const video = peers[0]!.senders.find((s) => s.trackKind === "video")!;
    expect(video.applied).toHaveLength(1);

    peers[0]!.simulateState("connected");
    await Bun.sleep(0);   // applySenderQuality は非同期
    expect(video.applied).toHaveLength(2);
    expect(video.applied[1]!.degradationPreference).toBe("maintain-resolution");
    expect(video.applied[1]!.encodings).toEqual([{ maxBitrate: CLEAN_FEED_MAX_BITRATE }]);
  });

  test("captureStream 開始（createStream）は onViewersChange の後（高解像度化してから掴む）", async () => {
    const { deps, transports } = makeFakes();
    const order: string[] = [];
    const origCreate = deps.createStream;
    deps.createStream = () => {
      order.push("createStream");
      return origCreate();
    };
    const pub = new CleanFeedPublisher(deps);
    pub.onViewersChange = () => { order.push("viewersChange"); };
    await pub.handleMessage(hello("v1"), transports[0]!);
    expect(order).toEqual(["viewersChange", "createStream"]);
  });

  test("不正メッセージ・未知 viewer 宛ては無視する", async () => {
    const { deps, transports, peers } = makeFakes();
    const t1 = transports[0]!;
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(null, t1);
    await pub.handleMessage({ type: "cf:hello" }, t1);      // viewerId なし
    await pub.handleMessage({ type: "cf:answer", viewerId: "nobody", sdp: "x" }, t1);
    await pub.handleMessage({ type: "cf:offer", viewerId: "v9", sdp: "x" }, t1); // pub 発 offer は無視
    expect(pub.viewerCount()).toBe(0);
    expect(peers).toHaveLength(0);
  });
});
