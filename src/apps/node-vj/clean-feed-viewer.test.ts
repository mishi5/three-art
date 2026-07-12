// #283: CleanFeedViewer（/obs.html 側・publisher 出現待ち→offer/answer→再接続）のテスト。
// RTCPeerConnection / BroadcastChannel / タイマは deps 注入の fake で差し替える。
import { describe, expect, test } from "bun:test";
import {
  CleanFeedViewer,
  HELLO_INTERVAL_MS,
  type CleanFeedViewerDeps,
} from "./clean-feed-viewer";
import type { CleanFeedChannelLike, CleanFeedPeerLike } from "./clean-feed";

interface FakePeer extends CleanFeedPeerLike {
  localDesc: RTCSessionDescriptionInit | null;
  remoteDesc: RTCSessionDescriptionInit | null;
  iceCandidates: RTCIceCandidateInit[];
  closed: boolean;
  simulateState(state: string): void;
}

interface FakeChannel extends CleanFeedChannelLike {
  posted: unknown[];
  closed: boolean;
}

function makeFakes(): {
  deps: CleanFeedViewerDeps;
  channel: FakeChannel;
  peers: FakePeer[];
  streams: unknown[];
  connected: boolean[];
  timers: { fn: () => void; ms: number; id: number; cancelled: boolean }[];
} {
  const peers: FakePeer[] = [];
  const streams: unknown[] = [];
  const connected: boolean[] = [];
  const timers: { fn: () => void; ms: number; id: number; cancelled: boolean }[] = [];
  const channel: FakeChannel = {
    posted: [],
    closed: false,
    onmessage: null,
    postMessage(msg: unknown) { this.posted.push(msg); },
    close() { this.closed = true; },
  };
  const deps: CleanFeedViewerDeps = {
    channel,
    createPeerConnection: () => {
      const p: FakePeer = {
        localDesc: null,
        remoteDesc: null,
        iceCandidates: [],
        closed: false,
        connectionState: "new",
        onicecandidate: null,
        onconnectionstatechange: null,
        ontrack: null,
        addTrack() { /* viewer は送信しない */ },
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
    onStream: (s) => { streams.push(s); },
    onConnectedChange: (c) => { connected.push(c); },
    scheduleHello: (fn, ms) => {
      const id = timers.length + 1;
      timers.push({ fn, ms, id, cancelled: false });
      return id;
    },
    cancelHello: (id) => {
      const rec = timers.find((t) => t.id === id);
      if (rec) rec.cancelled = true;
    },
  };
  return { deps, channel, peers, streams, connected, timers };
}

const offerFor = (viewerId: string): unknown => ({ type: "cf:offer", viewerId, sdp: "pub-sdp" });

function countHello(channel: FakeChannel, viewerId: string): number {
  return channel.posted.filter((m) =>
    (m as { type: string; viewerId: string }).type === "cf:hello" &&
    (m as { viewerId: string }).viewerId === viewerId).length;
}

describe("CleanFeedViewer (#283)", () => {
  test("start で即 hello 送信し、2 秒間隔の再送を予約する", () => {
    const { deps, channel, timers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    expect(countHello(channel, "v1")).toBe(1);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(HELLO_INTERVAL_MS);
    // 未接続の間は tick ごとに hello を再送する
    timers[0]!.fn();
    timers[0]!.fn();
    expect(countHello(channel, "v1")).toBe(3);
  });

  test("自分宛て offer で PC を張り answer を返す", async () => {
    const { deps, channel, peers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"));
    expect(peers).toHaveLength(1);
    expect(peers[0]!.remoteDesc).toEqual({ type: "offer", sdp: "pub-sdp" });
    expect(peers[0]!.localDesc?.sdp).toBe("answer-sdp");
    expect(channel.posted).toContainEqual({ type: "cf:answer", viewerId: "v1", sdp: "answer-sdp" });
  });

  test("他 viewer 宛て・viewer 発メッセージは無視する", async () => {
    const { deps, peers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v2"));                                  // 他人宛て offer
    await viewer.handleMessage({ type: "cf:hello", viewerId: "v2" });            // 他 viewer の hello
    await viewer.handleMessage({ type: "cf:answer", viewerId: "v1", sdp: "x" }); // viewer 発
    expect(peers).toHaveLength(0);
  });

  test("ontrack で stream を親（video.srcObject）へ渡す", async () => {
    const { deps, peers, streams } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"));
    const stream = { fake: "stream" };
    peers[0]!.ontrack?.({ streams: [stream] } as unknown as RTCTrackEvent);
    expect(streams).toEqual([stream]);
  });

  test("pub からの ICE を適用し、自分の ICE は from viewer で中継する", async () => {
    const { deps, channel, peers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"));
    const fromPub = { candidate: "candidate:p", sdpMid: "0" };
    await viewer.handleMessage({ type: "cf:ice", viewerId: "v1", from: "pub", candidate: fromPub });
    await viewer.handleMessage({ type: "cf:ice", viewerId: "v1", from: "viewer", candidate: fromPub });
    expect(peers[0]!.iceCandidates).toEqual([fromPub]);

    const mine = { candidate: "candidate:v", sdpMid: "0" };
    peers[0]!.onicecandidate?.({ candidate: { toJSON: () => mine } as unknown as RTCIceCandidate });
    peers[0]!.onicecandidate?.({ candidate: null });
    const ice = channel.posted.filter((m) => (m as { type: string }).type === "cf:ice");
    expect(ice).toEqual([{ type: "cf:ice", viewerId: "v1", from: "viewer", candidate: mine }]);
  });

  test("接続確立で hello 再送を止め、接続状態を親へ通知する", async () => {
    const { deps, channel, peers, connected, timers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"));
    peers[0]!.simulateState("connected");
    expect(connected).toEqual([true]);
    expect(timers[0]!.cancelled).toBe(true);
    const before = countHello(channel, "v1");
    expect(before).toBe(1);   // 接続後は再送しない
  });

  test("切断で PC を片付け hello 再送へ戻る（メインタブのリロード追従）", async () => {
    const { deps, channel, peers, connected, timers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"));
    peers[0]!.simulateState("connected");
    peers[0]!.simulateState("failed");
    expect(connected).toEqual([true, false]);
    expect(peers[0]!.closed).toBe(true);
    expect(countHello(channel, "v1")).toBe(2);   // 切断で即 hello
    // 再送タイマも張り直されている
    const active = timers.filter((t) => !t.cancelled);
    expect(active).toHaveLength(1);
    active[0]!.fn();
    expect(countHello(channel, "v1")).toBe(3);
  });

  test("pub の bye でも切断扱いで再試行へ戻る", async () => {
    const { deps, channel, peers, connected } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"));
    peers[0]!.simulateState("connected");
    await viewer.handleMessage({ type: "cf:bye", viewerId: "v1" });
    expect(peers[0]!.closed).toBe(true);
    expect(connected).toEqual([true, false]);
    expect(countHello(channel, "v1")).toBe(2);
  });

  test("再 offer（pub リロード）で古い PC を破棄して張り直す", async () => {
    const { deps, peers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"));
    await viewer.handleMessage(offerFor("v1"));
    expect(peers).toHaveLength(2);
    expect(peers[0]!.closed).toBe(true);
    expect(peers[1]!.closed).toBe(false);
  });

  test("dispose で bye 送信・PC/タイマ/チャンネルを片付ける", async () => {
    const { deps, channel, peers, timers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"));
    viewer.dispose();
    expect(channel.posted).toContainEqual({ type: "cf:bye", viewerId: "v1" });
    expect(peers[0]!.closed).toBe(true);
    expect(timers.every((t) => t.cancelled)).toBe(true);
    expect(channel.closed).toBe(true);
  });
});
