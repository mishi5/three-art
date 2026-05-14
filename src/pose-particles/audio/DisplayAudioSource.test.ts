import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DisplayAudioSource } from "./DisplayAudioSource";
import { DEFAULT_AUDIO_FEATURES } from "../types";

type FakeTrack = {
  kind: "audio" | "video";
  stopped: boolean;
  stop(): void;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(): void;
  _emitEnded(): void;
};

function makeFakeTrack(kind: "audio" | "video"): FakeTrack {
  let endedHandler: (() => void) | null = null;
  return {
    kind,
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener(type, cb) {
      if (type === "ended") endedHandler = cb;
    },
    removeEventListener() {
      endedHandler = null;
    },
    _emitEnded() {
      endedHandler?.();
    },
  };
}

function makeFakeStream(tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
}

function makeFakeCtx(): AudioContext {
  return {
    sampleRate: 48000,
    createAnalyser: () => ({
      fftSize: 2048,
      smoothingTimeConstant: 0.7,
      frequencyBinCount: 1024,
      getByteFrequencyData: (_arr: Uint8Array) => {},
    }),
    createMediaStreamSource: (_stream: MediaStream) => {
      const node = {
        connect: (_input: unknown) => node,
        disconnect: () => {},
      };
      return node;
    },
  } as unknown as AudioContext;
}

let originalNavigator: typeof globalThis.navigator | undefined;

function installGetDisplayMedia(impl: () => Promise<MediaStream>): void {
  (globalThis as { navigator: unknown }).navigator = {
    mediaDevices: { getDisplayMedia: impl },
  };
}

beforeEach(() => {
  originalNavigator = (globalThis as { navigator?: typeof globalThis.navigator }).navigator;
});

afterEach(() => {
  (globalThis as { navigator: unknown }).navigator = originalNavigator;
});

describe("DisplayAudioSource - 成功パス", () => {
  it("start() 後に read() が DEFAULT_AUDIO_FEATURES 以外を返す", async () => {
    const audio = makeFakeTrack("audio");
    const video = makeFakeTrack("video");
    installGetDisplayMedia(async () => makeFakeStream([audio, video]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    const features = src.read();

    expect(features).not.toBe(DEFAULT_AUDIO_FEATURES);
    expect(features.volume).toBe(0); // fake analyzer は 0 を返すが構造は別オブジェクト
    expect(features.fft).toBeDefined();
  });

  it("start() で video track が即時 stop される", async () => {
    const audio = makeFakeTrack("audio");
    const video = makeFakeTrack("video");
    installGetDisplayMedia(async () => makeFakeStream([audio, video]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();

    expect(video.stopped).toBe(true);
    expect(audio.stopped).toBe(false);
  });

  it("stop() で全 track が stop され read() が DEFAULT を返す", async () => {
    const audio = makeFakeTrack("audio");
    const video = makeFakeTrack("video");
    installGetDisplayMedia(async () => makeFakeStream([audio, video]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    src.stop();

    expect(audio.stopped).toBe(true);
    expect(src.read()).toBe(DEFAULT_AUDIO_FEATURES);
  });

  it("二重 stop() が安全に呼べる", async () => {
    const audio = makeFakeTrack("audio");
    installGetDisplayMedia(async () => makeFakeStream([audio]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    src.stop();
    src.stop(); // throw しないこと
    expect(src.read()).toBe(DEFAULT_AUDIO_FEATURES);
  });
});

describe("DisplayAudioSource - audio track 無し", () => {
  it("audio track が無いとき start() が reject し、video track が stop される", async () => {
    const video = makeFakeTrack("video");
    installGetDisplayMedia(async () => makeFakeStream([video]));

    const src = new DisplayAudioSource(makeFakeCtx());
    let caught: unknown = null;
    try {
      await src.start();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("タブの音声共有");
    expect(video.stopped).toBe(true);
    expect(src.read()).toBe(DEFAULT_AUDIO_FEATURES);
  });
});

describe("DisplayAudioSource - 外部停止検知", () => {
  it("audio track の ended イベント後 read() が DEFAULT を返す", async () => {
    const audio = makeFakeTrack("audio");
    installGetDisplayMedia(async () => makeFakeStream([audio]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    expect(src.read()).not.toBe(DEFAULT_AUDIO_FEATURES);

    audio._emitEnded();

    expect(src.read()).toBe(DEFAULT_AUDIO_FEATURES);
  });
});
