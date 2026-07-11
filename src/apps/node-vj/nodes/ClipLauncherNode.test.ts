// #281: ClipLauncher ノードのテスト。
// DOM の video/Image には依存せず、ClipMediaDeps を fake 注入して Runtime を検証する
// （SamplePadNode.test.ts の fakeAudioContext と同じ流儀）。
import { expect, test, describe } from "bun:test";
import {
  ClipLauncherNode, ClipLauncherRuntime, type ClipMediaDeps,
} from "./ClipLauncherNode";
import { CLIP_PAD_COUNT, CLIP_PAD_ROWS, CLIP_PAD_COLS } from "./ClipLauncherNode";
import type { EvalContext } from "../graph/node-type";

/** play/pause/remove の呼び出しを記録する fake video 要素。 */
interface FakeVideo {
  muted: boolean; playsInline: boolean; loop: boolean; preload: string;
  src: string; currentTime: number; paused: boolean;
  videoWidth: number; videoHeight: number;
  playCalls: number; removed: boolean;
  play(): Promise<void>; pause(): void; remove(): void;
}

function makeFakeVideo(): FakeVideo {
  return {
    muted: false, playsInline: false, loop: false, preload: "",
    src: "", currentTime: 7, paused: true,
    videoWidth: 320, videoHeight: 240,
    playCalls: 0, removed: false,
    play() { this.paused = false; this.playCalls++; return Promise.resolve(); },
    pause() { this.paused = true; },
    remove() { this.removed = true; },
  };
}

/** fake deps 一式（生成した video と revoke 履歴を外から覗ける）。 */
function makeDeps(): { deps: ClipMediaDeps; videos: FakeVideo[]; revoked: string[] } {
  const videos: FakeVideo[] = [];
  const revoked: string[] = [];
  let urlSeq = 0;
  const deps: ClipMediaDeps = {
    createVideo: () => {
      const v = makeFakeVideo();
      videos.push(v);
      return v as unknown as HTMLVideoElement;
    },
    loadImage: () => Promise.resolve({ naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement),
    createObjectURL: () => `blob:fake-${urlSeq++}`,
    revokeObjectURL: (u) => { revoked.push(u); },
  };
  return { deps, videos, revoked };
}

function videoFile(name = "clip.mp4"): File {
  return new File(["x"], name, { type: "video/mp4" });
}

function imageFile(name = "still.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

describe("#281 ClipLauncherNode 定義", () => {
  test("source カテゴリ・4×4 の padGrid（accept=video/*,image/*）", () => {
    expect(ClipLauncherNode.type).toBe("ClipLauncher");
    expect(ClipLauncherNode.category).toBe("source");
    expect(ClipLauncherNode.padGrid).toEqual({
      rows: CLIP_PAD_ROWS, cols: CLIP_PAD_COLS, accept: "video/*,image/*",
    });
    expect(CLIP_PAD_COUNT).toBe(16);
  });

  test("sync 入力（trigger）と texture / trigger 出力を持つ", () => {
    expect(ClipLauncherNode.inputs.map((p) => p.id)).toEqual(["sync"]);
    expect(ClipLauncherNode.inputs[0]!.type).toBe("trigger");
    expect(ClipLauncherNode.outputs.map((p) => p.id)).toEqual(["texture", "trigger"]);
    expect(ClipLauncherNode.outputs[0]!.type).toBe("texture");
    expect(ClipLauncherNode.outputs[1]!.type).toBe("trigger");
  });

  test("loop param（enum on/off 既定 on）と hidden の padAssets を持つ", () => {
    expect(ClipLauncherNode.params.map((p) => p.id)).toEqual(["loop", "padAssets"]);
    const loop = ClipLauncherNode.params.find((p) => p.id === "loop")!;
    expect(loop.kind).toBe("enum");
    expect(loop.options).toEqual(["on", "off"]);
    expect(loop.default).toBe("on");
    const pad = ClipLauncherNode.params.find((p) => p.id === "padAssets")!;
    expect(pad.hidden).toBe(true);
    expect(pad.noInput).toBe(true);
    expect(pad.default).toEqual([]);
  });

  test("state 無しの evaluate は texture 無し・trigger false（headless 安全）", () => {
    const ctx: EvalContext = {
      timeSec: 0,
      input: () => undefined,
      param: () => undefined,
      node: { id: "x", type: "ClipLauncher", params: {} },
    };
    const out = ClipLauncherNode.evaluate(ctx);
    expect(out.texture).toBeUndefined();
    expect(out.trigger).toBe(false);
  });
});

describe("#281 loadPadFile / hasPad / padLabel / clearPad（PadLoadable duck-type）", () => {
  test("動画割当: muted+playsInline+preload の video を作り src を設定（再生はしない）", async () => {
    const { deps, videos } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("loop.mp4"));
    expect(videos.length).toBe(1);
    const v = videos[0]!;
    expect(v.muted).toBe(true);       // 自動再生と evaluate 内 play() のため常時必須
    expect(v.playsInline).toBe(true);
    expect(v.preload).toBe("auto");
    expect(v.src).toBe("blob:fake-0");
    expect(v.playCalls).toBe(0);      // preload のみ・paused のまま
    expect(rt.hasPad(0)).toBe(true);
    expect(rt.padLabel(0)).toBe("loop");
  });

  test("画像割当: loadImage で読み込み hasPad/padLabel が立つ", async () => {
    const { deps, videos } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(1, imageFile("still.png"));
    expect(videos.length).toBe(0); // video 要素は作らない
    expect(rt.hasPad(1)).toBe(true);
    expect(rt.padLabel(1)).toBe("still");
  });

  test("範囲外 index / 未割当は安全（no-op / false / null）", async () => {
    const { deps } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(-1, videoFile());
    await rt.loadPadFile(CLIP_PAD_COUNT, videoFile());
    expect(rt.hasPad(-1)).toBe(false);
    expect(rt.hasPad(0)).toBe(false);
    expect(rt.padLabel(0)).toBeNull();
  });

  test("再割当は古いクリップを破棄（revoke・video 除去）してから差し替える", async () => {
    const { deps, videos, revoked } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(0, videoFile("b.mp4"));
    expect(videos.length).toBe(2);
    expect(videos[0]!.removed).toBe(true);
    expect(revoked).toEqual(["blob:fake-0"]);
    expect(rt.padLabel(0)).toBe("b");
  });

  test("clearPad は割当解除・objectURL revoke・要素破棄（アクティブなら解除）", async () => {
    const { deps, videos, revoked } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(2, videoFile("c.mp4"));
    rt.playPad(2);
    rt.step(undefined, true); // 即時切替でアクティブ化
    expect(rt.activeIndex()).toBe(2);
    rt.clearPad(2);
    expect(rt.hasPad(2)).toBe(false);
    expect(rt.padLabel(2)).toBeNull();
    expect(rt.activeIndex()).toBeNull();
    expect(videos[0]!.removed).toBe(true);
    expect(revoked).toEqual(["blob:fake-0"]);
  });
});

describe("#281 playPad + step: sync 未接続は即時切替", () => {
  test("押下→次の step で切替（currentTime=0 から play・switched=true は 1 回だけ）", async () => {
    const { deps, videos } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile());
    rt.playPad(0);
    expect(rt.activeIndex()).toBeNull(); // 切替は step が行う
    const r1 = rt.step(undefined, true);
    expect(r1.switched).toBe(true);
    expect(rt.activeIndex()).toBe(0);
    expect(videos[0]!.currentTime).toBe(0); // 頭から再生
    expect(videos[0]!.playCalls).toBe(1);
    expect(videos[0]!.paused).toBe(false);
    const r2 = rt.step(undefined, true);
    expect(r2.switched).toBe(false); // 発火は切替フレームのみ
  });

  test("未割当パッドの playPad は no-op（切替もトリガも発生しない）", () => {
    const { deps } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    rt.playPad(4);
    const r = rt.step(undefined, true);
    expect(r.switched).toBe(false);
    expect(rt.activeIndex()).toBeNull();
  });

  test("別パッドへ切替時は前のアクティブ video を pause する", async () => {
    const { deps, videos } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(1, videoFile("b.mp4"));
    rt.playPad(0);
    rt.step(undefined, true);
    rt.playPad(1);
    rt.step(undefined, true);
    expect(videos[0]!.paused).toBe(true);
    expect(videos[1]!.paused).toBe(false);
    expect(rt.activeIndex()).toBe(1);
  });

  test("同じパッドの再押下は頭から再生し直す（リトリガ）", async () => {
    const { deps, videos } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile());
    rt.playPad(0);
    rt.step(undefined, true);
    videos[0]!.currentTime = 3.3; // 再生が進んだ体
    rt.playPad(0);
    const r = rt.step(undefined, true);
    expect(r.switched).toBe(true);
    expect(videos[0]!.currentTime).toBe(0);
    expect(videos[0]!.playCalls).toBe(2);
  });

  test("画像パッドは切替のみ（video 操作なし・switched は発火）", async () => {
    const { deps } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(3, imageFile());
    rt.playPad(3);
    const r = rt.step(undefined, true);
    expect(r.switched).toBe(true);
    expect(rt.activeIndex()).toBe(3);
  });
});

describe("#281 playPad + step: sync 接続時はアーム→エッジで切替", () => {
  test("sync=false の間はアーム保持（armedIndex）・エッジで切替", async () => {
    const { deps } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile());
    rt.playPad(0);
    let r = rt.step(false, true); // 接続済み・エッジなし
    expect(r.switched).toBe(false);
    expect(rt.armedIndex()).toBe(0);
    expect(rt.activeIndex()).toBeNull();
    r = rt.step(false, true); // まだ待つ
    expect(rt.armedIndex()).toBe(0);
    r = rt.step(true, true); // 立ち上がりエッジ
    expect(r.switched).toBe(true);
    expect(rt.armedIndex()).toBeNull();
    expect(rt.activeIndex()).toBe(0);
  });

  test("sync=true が続くフレームでは再発火しない（立ち上がりエッジのみ）", async () => {
    const { deps } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(1, videoFile("b.mp4"));
    rt.playPad(0);
    rt.step(true, true); // 初回 true = エッジ → 切替
    expect(rt.activeIndex()).toBe(0);
    rt.playPad(1);
    const r = rt.step(true, true); // true 継続中はエッジでない → アーム保持
    expect(r.switched).toBe(false);
    expect(rt.armedIndex()).toBe(1);
    rt.step(false, true);
    const r2 = rt.step(true, true); // 次の立ち上がりで切替
    expect(r2.switched).toBe(true);
    expect(rt.activeIndex()).toBe(1);
  });

  test("アーム中に押し直すと予約を上書きする", async () => {
    const { deps } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(1, videoFile("b.mp4"));
    rt.playPad(0);
    rt.step(false, true);
    rt.playPad(1); // 上書き
    rt.step(false, true);
    expect(rt.armedIndex()).toBe(1);
    rt.step(true, true);
    expect(rt.activeIndex()).toBe(1);
  });
});

describe("#281 loop 反映", () => {
  test("step の loop を全 video 要素へ反映する", async () => {
    const { deps, videos } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(1, videoFile("b.mp4"));
    rt.step(undefined, true);
    expect(videos.every((v) => v.loop)).toBe(true);
    rt.step(undefined, false);
    expect(videos.every((v) => !v.loop)).toBe(false === videos.some((v) => v.loop)); // 全 false
    expect(videos.some((v) => v.loop)).toBe(false);
  });
});

describe("#281 stopAll / stopPad（Stop ボタン・個別停止）", () => {
  test("stopAll はアクティブ video を pause しアクティブ/アームを解除", async () => {
    const { deps, videos } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(1, videoFile("b.mp4"));
    rt.playPad(0);
    rt.step(undefined, true);
    rt.playPad(1);
    rt.step(false, true); // pad1 をアーム
    rt.stopAll();
    expect(videos[0]!.paused).toBe(true);
    expect(rt.activeIndex()).toBeNull();
    expect(rt.armedIndex()).toBeNull();
    const r = rt.step(true, true); // 予約は消えているので何も起きない
    expect(r.switched).toBe(false);
  });

  test("stopPad はそのパッドがアクティブなら停止・アーム中ならアーム解除", async () => {
    const { deps, videos } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(1, videoFile("b.mp4"));
    rt.playPad(0);
    rt.step(undefined, true);
    rt.playPad(1);
    rt.step(false, true); // pad1 アーム
    rt.stopPad(1); // アーム解除（アクティブ pad0 はそのまま）
    expect(rt.armedIndex()).toBeNull();
    expect(rt.activeIndex()).toBe(0);
    rt.stopPad(0); // アクティブ停止
    expect(videos[0]!.paused).toBe(true);
    expect(rt.activeIndex()).toBeNull();
  });

  test("無関係なパッドの stopPad は何もしない", async () => {
    const { deps } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile());
    rt.playPad(0);
    rt.step(undefined, true);
    rt.stopPad(5);
    expect(rt.activeIndex()).toBe(0);
  });
});

describe("#281 padActive / padArmed（パッド表示用）", () => {
  test("アクティブ/アーム中のパッドだけ true を返す", async () => {
    const { deps } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(1, videoFile("b.mp4"));
    rt.playPad(0);
    rt.step(undefined, true);
    rt.playPad(1);
    rt.step(false, true);
    expect(rt.padActive(0)).toBe(true);
    expect(rt.padActive(1)).toBe(false);
    expect(rt.padArmed(1)).toBe(true);
    expect(rt.padArmed(0)).toBe(false);
  });
});

describe("#281 dispose", () => {
  test("全クリップの video を破棄し objectURL を revoke する", async () => {
    const { deps, videos, revoked } = makeDeps();
    const rt = new ClipLauncherRuntime(deps);
    await rt.loadPadFile(0, videoFile("a.mp4"));
    await rt.loadPadFile(1, videoFile("b.mp4"));
    await rt.loadPadFile(2, imageFile("c.png"));
    rt.dispose();
    expect(videos.every((v) => v.removed && v.paused)).toBe(true);
    expect(revoked.sort()).toEqual(["blob:fake-0", "blob:fake-1", "blob:fake-2"]);
  });
});
