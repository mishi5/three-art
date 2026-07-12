// #283: CleanFeedPublisher（メインタブ側・viewer ごとの RTCPeerConnection 管理）のテスト。
// RTCPeerConnection / BroadcastChannel / captureStream は deps 注入の fake で差し替える
// （ClipLauncher の ClipMediaDeps・ScreenOutputs の deps パターン）。
import { describe, expect, test } from "bun:test";
import {
  CleanFeedPublisher,
  type CleanFeedChannelLike,
  type CleanFeedPeerLike,
  type CleanFeedPublisherDeps,
} from "./clean-feed";

interface FakePeer extends CleanFeedPeerLike {
  addedTracks: { track: unknown; stream: unknown }[];
  localDesc: RTCSessionDescriptionInit | null;
  remoteDesc: RTCSessionDescriptionInit | null;
  iceCandidates: RTCIceCandidateInit[];
  closed: boolean;
  /** connectionState を変えて onconnectionstatechange を発火する。 */
  simulateState(state: string): void;
}

interface FakeChannel extends CleanFeedChannelLike {
  posted: unknown[];
  closed: boolean;
}

function makeFakes(): {
  deps: CleanFeedPublisherDeps;
  channel: FakeChannel;
  peers: FakePeer[];
  streams: { stream: MediaStream; stopped: boolean }[];
} {
  const peers: FakePeer[] = [];
  const streams: { stream: MediaStream; stopped: boolean }[] = [];
  const channel: FakeChannel = {
    posted: [],
    closed: false,
    onmessage: null,
    postMessage(msg: unknown) { this.posted.push(msg); },
    close() { this.closed = true; },
  };
  const deps: CleanFeedPublisherDeps = {
    channel,
    createPeerConnection: () => {
      const p: FakePeer = {
        addedTracks: [],
        localDesc: null,
        remoteDesc: null,
        iceCandidates: [],
        closed: false,
        connectionState: "new",
        onicecandidate: null,
        onconnectionstatechange: null,
        ontrack: null,
        addTrack(track, stream) { this.addedTracks.push({ track, stream }); },
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
  return { deps, channel, peers, streams };
}

const hello = (viewerId: string): unknown => ({ type: "cf:hello", viewerId });

describe("CleanFeedPublisher (#283)", () => {
  test("hello で PC を張り offer を返す（track 追加・viewer 数 1・変更通知）", async () => {
    const { deps, channel, peers, streams } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    let notified = 0;
    pub.onViewersChange = () => { notified++; };

    await pub.handleMessage(hello("v1"));

    expect(peers).toHaveLength(1);
    expect(streams).toHaveLength(1);
    expect(peers[0]!.addedTracks).toHaveLength(2);          // video + audio
    expect(peers[0]!.localDesc?.sdp).toBe("offer-sdp");
    expect(channel.posted).toContainEqual({ type: "cf:offer", viewerId: "v1", sdp: "offer-sdp" });
    expect(pub.viewerCount()).toBe(1);
    expect(pub.hasViewers()).toBe(true);
    expect(notified).toBe(1);
  });

  test("複数 viewer: viewer ごとに PC・stream は 1 本を共有", async () => {
    const { deps, channel, peers, streams } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"));
    await pub.handleMessage(hello("v2"));

    expect(peers).toHaveLength(2);
    expect(streams).toHaveLength(1);                        // captureStream は初回のみ
    expect(pub.viewerCount()).toBe(2);
    expect(channel.posted.filter((m) => (m as { type: string }).type === "cf:offer")).toHaveLength(2);
  });

  test("answer を該当 viewer の PC へ適用する", async () => {
    const { deps, peers } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"));
    await pub.handleMessage({ type: "cf:answer", viewerId: "v1", sdp: "remote-sdp" });
    expect(peers[0]!.remoteDesc).toEqual({ type: "answer", sdp: "remote-sdp" });
  });

  test("viewer からの ICE は addIceCandidate・pub 発の ICE は無視", async () => {
    const { deps, peers } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"));
    const candidate = { candidate: "candidate:1", sdpMid: "0" };
    await pub.handleMessage({ type: "cf:ice", viewerId: "v1", from: "viewer", candidate });
    await pub.handleMessage({ type: "cf:ice", viewerId: "v1", from: "pub", candidate });
    expect(peers[0]!.iceCandidates).toEqual([candidate]);
  });

  test("pub 側 ICE candidate を cf:ice(from pub) で中継する（null は送らない）", async () => {
    const { deps, channel, peers } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"));
    const init = { candidate: "candidate:9", sdpMid: "0" };
    peers[0]!.onicecandidate?.({ candidate: { toJSON: () => init } as unknown as RTCIceCandidate });
    peers[0]!.onicecandidate?.({ candidate: null });
    const ice = channel.posted.filter((m) => (m as { type: string }).type === "cf:ice");
    expect(ice).toEqual([{ type: "cf:ice", viewerId: "v1", from: "pub", candidate: init }]);
  });

  test("二重 hello（viewer リロード）: 旧 PC を破棄して張り直す", async () => {
    const { deps, peers } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"));
    await pub.handleMessage(hello("v1"));
    expect(peers).toHaveLength(2);
    expect(peers[0]!.closed).toBe(true);
    expect(peers[1]!.closed).toBe(false);
    expect(pub.viewerCount()).toBe(1);
  });

  test("bye で片付け・最後の viewer が消えたら stream を停止", async () => {
    const { deps, peers, streams } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    let notified = 0;
    pub.onViewersChange = () => { notified++; };
    await pub.handleMessage(hello("v1"));
    await pub.handleMessage(hello("v2"));
    notified = 0;

    await pub.handleMessage({ type: "cf:bye", viewerId: "v1" });
    expect(peers[0]!.closed).toBe(true);
    expect(pub.viewerCount()).toBe(1);
    expect(streams[0]!.stopped).toBe(false);                 // まだ v2 がいる

    await pub.handleMessage({ type: "cf:bye", viewerId: "v2" });
    expect(pub.viewerCount()).toBe(0);
    expect(streams[0]!.stopped).toBe(true);
    expect(notified).toBe(2);
  });

  test("接続断（failed / disconnected / closed）でも片付ける", async () => {
    for (const state of ["failed", "disconnected", "closed"]) {
      const { deps, peers, streams } = makeFakes();
      const pub = new CleanFeedPublisher(deps);
      await pub.handleMessage(hello("v1"));
      peers[0]!.simulateState(state);
      expect(pub.viewerCount()).toBe(0);
      expect(peers[0]!.closed).toBe(true);
      expect(streams[0]!.stopped).toBe(true);
    }
  });

  test("connecting / connected では片付けない", async () => {
    const { deps, peers } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"));
    peers[0]!.simulateState("connecting");
    peers[0]!.simulateState("connected");
    expect(pub.viewerCount()).toBe(1);
  });

  test("bye 後の再 hello で復帰し stream を張り直す", async () => {
    const { deps, streams } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"));
    await pub.handleMessage({ type: "cf:bye", viewerId: "v1" });
    await pub.handleMessage(hello("v1"));
    expect(streams).toHaveLength(2);                        // 停止後に作り直す
    expect(pub.viewerCount()).toBe(1);
  });

  test("dispose: 各 viewer へ bye 送信・PC/stream/チャンネルを片付け", async () => {
    const { deps, channel, peers, streams } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(hello("v1"));
    await pub.handleMessage(hello("v2"));

    pub.dispose();
    const byes = channel.posted.filter((m) => (m as { type: string }).type === "cf:bye");
    expect(byes).toEqual([
      { type: "cf:bye", viewerId: "v1" },
      { type: "cf:bye", viewerId: "v2" },
    ]);
    expect(peers.every((p) => p.closed)).toBe(true);
    expect(streams[0]!.stopped).toBe(true);
    expect(channel.closed).toBe(true);
    expect(pub.viewerCount()).toBe(0);

    // dispose 後のメッセージは無視される
    await pub.handleMessage(hello("v3"));
    expect(pub.viewerCount()).toBe(0);
  });

  test("channel.onmessage 経由でも処理される（配線）", async () => {
    const { deps, channel } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    channel.onmessage?.({ data: hello("v1") } as MessageEvent);
    await Bun.sleep(0);
    expect(pub.viewerCount()).toBe(1);
  });

  test("不正メッセージ・未知 viewer 宛ては無視する", async () => {
    const { deps, peers } = makeFakes();
    const pub = new CleanFeedPublisher(deps);
    await pub.handleMessage(null);
    await pub.handleMessage({ type: "cf:hello" });          // viewerId なし
    await pub.handleMessage({ type: "cf:answer", viewerId: "nobody", sdp: "x" });
    await pub.handleMessage({ type: "cf:offer", viewerId: "v9", sdp: "x" }); // pub 発 offer は無視
    expect(pub.viewerCount()).toBe(0);
    expect(peers).toHaveLength(0);
  });
});
