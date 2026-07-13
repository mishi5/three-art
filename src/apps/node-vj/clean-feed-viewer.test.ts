// #283: CleanFeedViewer（/obs.html 側・publisher 出現待ち→offer/answer→再接続）のテスト。
// RTCPeerConnection / シグナリング transport / タイマは deps 注入の fake で差し替える。
// hello は全 transport（WS リレー + BroadcastChannel）へ送り、返信は offer が届いた
// transport へ返す＝WS が繋がらない環境では BC が自動的にフォールバックとして機能する。
import { describe, expect, test } from "bun:test";
import {
  CleanFeedViewer,
  HELLO_INTERVAL_MS,
  type CleanFeedViewerDeps,
} from "./clean-feed-viewer";
import type { CleanFeedPeerLike } from "./clean-feed";
import type { CleanFeedTransport } from "./clean-feed-transport";

interface FakePeer extends CleanFeedPeerLike {
  localDesc: RTCSessionDescriptionInit | null;
  remoteDesc: RTCSessionDescriptionInit | null;
  iceCandidates: RTCIceCandidateInit[];
  closed: boolean;
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

function makeFakes(transportCount = 2): {
  deps: CleanFeedViewerDeps;
  transports: FakeTransport[];
  peers: FakePeer[];
  streams: unknown[];
  connected: boolean[];
  timers: { fn: () => void; ms: number; id: number; cancelled: boolean }[];
} {
  const peers: FakePeer[] = [];
  const streams: unknown[] = [];
  const connected: boolean[] = [];
  const timers: { fn: () => void; ms: number; id: number; cancelled: boolean }[] = [];
  const transports = Array.from({ length: transportCount }, makeTransport);
  const deps: CleanFeedViewerDeps = {
    transports,
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
  return { deps, transports, peers, streams, connected, timers };
}

const offerFor = (viewerId: string): unknown => ({ type: "cf:offer", viewerId, sdp: "pub-sdp" });

function countHello(t: FakeTransport, viewerId: string): number {
  return t.sent.filter((m) =>
    (m as { type: string; viewerId: string }).type === "cf:hello" &&
    (m as { viewerId: string }).viewerId === viewerId).length;
}

function sentOfType(t: FakeTransport, type: string): unknown[] {
  return t.sent.filter((m) => (m as { type: string }).type === type);
}

describe("CleanFeedViewer (#283)", () => {
  test("start で全 transport へ即 hello 送信し、2 秒間隔の再送を予約する", () => {
    const { deps, transports, timers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    expect(countHello(transports[0]!, "v1")).toBe(1);
    expect(countHello(transports[1]!, "v1")).toBe(1);   // WS/BC 両方へ（届く経路が事前に不明）
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(HELLO_INTERVAL_MS);
    // 未接続の間は tick ごとに hello を再送する
    timers[0]!.fn();
    timers[0]!.fn();
    expect(countHello(transports[0]!, "v1")).toBe(3);
    expect(countHello(transports[1]!, "v1")).toBe(3);
  });

  test("自分宛て offer で PC を張り、answer は offer が届いた transport へ返す", async () => {
    const { deps, transports, peers } = makeFakes();
    const [t1, t2] = [transports[0]!, transports[1]!];
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), t2);     // WS 側から届いた想定
    expect(peers).toHaveLength(1);
    expect(peers[0]!.remoteDesc).toEqual({ type: "offer", sdp: "pub-sdp" });
    expect(peers[0]!.localDesc?.sdp).toBe("answer-sdp");
    expect(sentOfType(t2, "cf:answer")).toEqual([{ type: "cf:answer", viewerId: "v1", sdp: "answer-sdp" }]);
    expect(sentOfType(t1, "cf:answer")).toHaveLength(0);
  });

  test("BC 側から届いた offer には BC 側へ返す（WS 不在時のフォールバック）", async () => {
    const { deps, transports, peers } = makeFakes();
    const [t1, t2] = [transports[0]!, transports[1]!];
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), t1);
    expect(sentOfType(t1, "cf:answer")).toHaveLength(1);
    expect(sentOfType(t2, "cf:answer")).toHaveLength(0);
    // 自分の ICE も同じ transport へ
    const mine = { candidate: "candidate:v", sdpMid: "0" };
    peers[0]!.onicecandidate?.({ candidate: { toJSON: () => mine } as unknown as RTCIceCandidate });
    peers[0]!.onicecandidate?.({ candidate: null });    // end-of-candidates は送らない
    expect(sentOfType(t1, "cf:ice")).toEqual([{ type: "cf:ice", viewerId: "v1", from: "viewer", candidate: mine }]);
    expect(sentOfType(t2, "cf:ice")).toHaveLength(0);
  });

  test("他 viewer 宛て・viewer 発メッセージは無視する", async () => {
    const { deps, transports, peers } = makeFakes();
    const t1 = transports[0]!;
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v2"), t1);                                  // 他人宛て offer
    await viewer.handleMessage({ type: "cf:hello", viewerId: "v2" }, t1);            // 他 viewer の hello
    await viewer.handleMessage({ type: "cf:answer", viewerId: "v1", sdp: "x" }, t1); // viewer 発
    expect(peers).toHaveLength(0);
  });

  test("ontrack で stream を親（video.srcObject）へ渡す", async () => {
    const { deps, transports, peers, streams } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), transports[0]!);
    const stream = { fake: "stream" };
    peers[0]!.ontrack?.({ streams: [stream] } as unknown as RTCTrackEvent);
    expect(streams).toEqual([stream]);
  });

  test("pub からの ICE を適用し、viewer 発の中継は無視する", async () => {
    const { deps, transports, peers } = makeFakes();
    const t1 = transports[0]!;
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), t1);
    const fromPub = { candidate: "candidate:p", sdpMid: "0" };
    await viewer.handleMessage({ type: "cf:ice", viewerId: "v1", from: "pub", candidate: fromPub }, t1);
    await viewer.handleMessage({ type: "cf:ice", viewerId: "v1", from: "viewer", candidate: fromPub }, t1);
    expect(peers[0]!.iceCandidates).toEqual([fromPub]);
  });

  test("接続確立で hello 再送を止め、接続状態を親へ通知する", async () => {
    const { deps, transports, peers, connected, timers } = makeFakes();
    const t1 = transports[0]!;
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), t1);
    peers[0]!.simulateState("connected");
    expect(connected).toEqual([true]);
    expect(timers[0]!.cancelled).toBe(true);
    expect(countHello(t1, "v1")).toBe(1);   // 接続後は再送しない
  });

  test("切断で PC を片付け hello 再送へ戻る（メインタブのリロード追従）", async () => {
    const { deps, transports, peers, connected, timers } = makeFakes();
    const t1 = transports[0]!;
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), t1);
    peers[0]!.simulateState("connected");
    peers[0]!.simulateState("failed");
    expect(connected).toEqual([true, false]);
    expect(peers[0]!.closed).toBe(true);
    expect(countHello(t1, "v1")).toBe(2);   // 切断で即 hello（全 transport へ）
    expect(countHello(transports[1]!, "v1")).toBe(2);
    // 再送タイマも張り直されている
    const active = timers.filter((t) => !t.cancelled);
    expect(active).toHaveLength(1);
    active[0]!.fn();
    expect(countHello(t1, "v1")).toBe(3);
  });

  test("pub の bye でも切断扱いで再試行へ戻る", async () => {
    const { deps, transports, peers, connected } = makeFakes();
    const t1 = transports[0]!;
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), t1);
    peers[0]!.simulateState("connected");
    await viewer.handleMessage({ type: "cf:bye", viewerId: "v1" }, t1);
    expect(peers[0]!.closed).toBe(true);
    expect(connected).toEqual([true, false]);
    expect(countHello(t1, "v1")).toBe(2);
  });

  test("再 offer（pub リロード）で古い PC を破棄して張り直す", async () => {
    const { deps, transports, peers } = makeFakes();
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), transports[0]!);
    await viewer.handleMessage(offerFor("v1"), transports[0]!);
    expect(peers).toHaveLength(2);
    expect(peers[0]!.closed).toBe(true);
    expect(peers[1]!.closed).toBe(false);
  });

  test("dispose で bye を全 transport へ送り、PC/タイマ/transport を片付ける", async () => {
    const { deps, transports, peers, timers } = makeFakes();
    const [t1, t2] = [transports[0]!, transports[1]!];
    const viewer = new CleanFeedViewer(deps, "v1");
    viewer.start();
    await viewer.handleMessage(offerFor("v1"), t1);
    viewer.dispose();
    expect(t1.sent).toContainEqual({ type: "cf:bye", viewerId: "v1" });
    expect(t2.sent).toContainEqual({ type: "cf:bye", viewerId: "v1" });
    expect(peers[0]!.closed).toBe(true);
    expect(timers.every((t) => t.cancelled)).toBe(true);
    expect(t1.closed).toBe(true);
    expect(t2.closed).toBe(true);
  });
});
