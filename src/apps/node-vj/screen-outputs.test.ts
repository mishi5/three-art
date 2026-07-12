// #282: ScreenOutputs（Screen 別出力ウィンドウのマネージャ）のテスト。
// DOM/renderer は deps 注入で差し替える（ClipLauncher の ClipMediaDeps パターン）。
import { describe, expect, test } from "bun:test";
import { ScreenOutputs, type MirrorWindowLike, type ScreenOutputsDeps } from "./screen-outputs";
import { SCREEN_TEXTURE_KEY } from "./graph/texture-screen";
import { IDENTITY_MAT3, type Mat3 } from "./warp-logic";
import { WARP_STATE_TYPE } from "./warp-messages";
import type { GraphDoc } from "./graph/graph-doc";

interface FakeWindow extends MirrorWindowLike {
  nodeId: string;
  opened: HTMLCanvasElement | null;
  closed: boolean;
  posted: unknown[];
  fakeContent: object;
  /** ユーザが手でウィンドウを閉じたのを polling が検知した状況を再現する。 */
  simulateUserClose(): void;
}

function makeFakes(): {
  deps: ScreenOutputsDeps;
  windows: FakeWindow[];
  draws: { texture: unknown; invH: Mat3; dst: unknown }[];
} {
  const windows: FakeWindow[] = [];
  const draws: { texture: unknown; invH: Mat3; dst: unknown }[] = [];
  const deps: ScreenOutputsDeps = {
    createCanvas: () => ({ fake: "canvas" } as unknown as HTMLCanvasElement),
    createWindow: (nodeId) => {
      const posted: unknown[] = [];
      // contentWindow は同一性比較（ownsWindow）に使うため安定した参照を返す。
      const content = {
        fake: "window",
        postMessage(msg: unknown) { posted.push(msg); },
      } as unknown as Window;
      const w: FakeWindow = {
        nodeId,
        opened: null,
        closed: false,
        posted,
        fakeContent: content,
        onClose: null,
        isOpen() { return this.opened !== null && !this.closed; },
        open(source) { this.opened = source; },
        close() {
          if (this.closed) return;
          this.closed = true;
          this.onClose?.();
        },
        contentWindow() {
          return this.isOpen() ? content : null;
        },
        simulateUserClose() {
          this.closed = true;
          this.onClose?.();
        },
      };
      windows.push(w);
      return w;
    },
    drawWarped: (texture, invH, dst) => { draws.push({ texture, invH, dst }); },
  };
  return { deps, windows, draws };
}

function graphWith(...screenIds: string[]): GraphDoc {
  return {
    version: 1,
    nodes: screenIds.map((id) => ({ id, type: "Screen", params: {} })),
    connections: [],
  } as unknown as GraphDoc;
}

function outputsWith(entries: Record<string, unknown>): Map<string, Record<string, unknown>> {
  return new Map(Object.entries(entries).map(([id, tex]) => [id, { [SCREEN_TEXTURE_KEY]: tex }]));
}

describe("ScreenOutputs 開閉 (#282)", () => {
  test("toggle で開く: 専用 canvas を作りウィンドウへ渡す", () => {
    const { deps, windows } = makeFakes();
    const so = new ScreenOutputs(deps);
    expect(so.isOpen("s1")).toBe(false);
    expect(so.anyOpen()).toBe(false);
    so.toggle("s1");
    expect(so.isOpen("s1")).toBe(true);
    expect(so.anyOpen()).toBe(true);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.nodeId).toBe("s1");
    expect(windows[0]!.opened).toEqual({ fake: "canvas" } as unknown as HTMLCanvasElement);
  });

  test("toggle をもう一度で閉じる", () => {
    const { deps, windows } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.toggle("s1");
    so.toggle("s1");
    expect(so.isOpen("s1")).toBe(false);
    expect(windows[0]!.closed).toBe(true);
  });

  test("Screen 2 個で 2 系統が独立に開く", () => {
    const { deps, windows } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.toggle("s1");
    so.toggle("s2");
    expect(so.isOpen("s1")).toBe(true);
    expect(so.isOpen("s2")).toBe(true);
    expect(windows.map((w) => w.nodeId)).toEqual(["s1", "s2"]);
    so.toggle("s1");
    expect(so.isOpen("s1")).toBe(false);
    expect(so.isOpen("s2")).toBe(true);
  });

  test("開閉で onOpenStateChange が発火する（描画解像度/keepAlive の同期用）", () => {
    const { deps } = makeFakes();
    const so = new ScreenOutputs(deps);
    let calls = 0;
    so.onOpenStateChange = () => { calls++; };
    so.toggle("s1");
    expect(calls).toBe(1);
    so.toggle("s1");
    expect(calls).toBe(2);
  });

  test("ユーザがウィンドウを手動クローズしたら状態が同期される", () => {
    const { deps, windows } = makeFakes();
    const so = new ScreenOutputs(deps);
    let calls = 0;
    so.toggle("s1");
    so.onOpenStateChange = () => { calls++; };
    windows[0]!.simulateUserClose();
    expect(so.isOpen("s1")).toBe(false);
    expect(so.anyOpen()).toBe(false);
    expect(calls).toBe(1);
  });

  test("ポップアップブロック（open 後も isOpen=false）ならエントリを保持しない", () => {
    const { deps, windows } = makeFakes();
    const so = new ScreenOutputs(deps);
    // open() が win を得られない状況を再現（opened を立てない）
    windows.push; // noop
    const blockedDeps: ScreenOutputsDeps = {
      ...deps,
      createWindow: (nodeId) => {
        const w = deps.createWindow(nodeId) as FakeWindow;
        w.open = () => { /* ポップアップブロック: 開けない */ };
        return w;
      },
    };
    const so2 = new ScreenOutputs(blockedDeps);
    so2.toggle("s1");
    expect(so2.isOpen("s1")).toBe(false);
    expect(so2.anyOpen()).toBe(false);
    void so;
  });

  test("closeAll で全ウィンドウを閉じる", () => {
    const { deps, windows } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.toggle("s1");
    so.toggle("s2");
    so.closeAll();
    expect(so.anyOpen()).toBe(false);
    expect(windows.every((w) => w.closed)).toBe(true);
  });
});

describe("ScreenOutputs renderFrame (#282)", () => {
  test("開いている Screen の texture をワープ描画する（既定 4 隅＝恒等の逆行列）", () => {
    const { deps, draws } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.toggle("s1");
    const tex = { fake: "texture" };
    so.renderFrame(graphWith("s1"), outputsWith({ s1: tex }));
    expect(draws).toHaveLength(1);
    expect(draws[0]!.texture).toBe(tex);
    expect([...draws[0]!.invH]).toEqual([...IDENTITY_MAT3]);
  });

  test("4 隅 param から逆 homography を計算して渡す（平行移動 +0.5 の逆は -0.5）", () => {
    const { deps, draws } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.toggle("s1");
    const g = graphWith("s1");
    g.nodes[0]!.params = { tlX: 0.5, tlY: 0.5, trX: 1.5, trY: 0.5, blX: 0.5, blY: 1.5, brX: 1.5, brY: 1.5 };
    so.renderFrame(g, outputsWith({ s1: { t: 1 } }));
    const m = draws[0]!.invH;
    // 逆変換は (x,y) → (x-0.5, y-0.5)
    expect(m[0]).toBeCloseTo(1, 9);
    expect(m[2]! / m[8]!).toBeCloseTo(-0.5, 9);
    expect(m[5]! / m[8]!).toBeCloseTo(-0.5, 9);
  });

  test("texture が無い Screen は描画しない（閉じもしない）", () => {
    const { deps, draws } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.toggle("s1");
    so.renderFrame(graphWith("s1"), new Map());
    expect(draws).toHaveLength(0);
    expect(so.isOpen("s1")).toBe(true);
  });

  test("閉じている Screen は描画しない", () => {
    const { deps, draws } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.renderFrame(graphWith("s1"), outputsWith({ s1: {} }));
    expect(draws).toHaveLength(0);
  });

  test("グラフからノードが消えたら（削除/シーン切替）ウィンドウを閉じる", () => {
    const { deps, windows } = makeFakes();
    const so = new ScreenOutputs(deps);
    let calls = 0;
    so.toggle("s1");
    so.onOpenStateChange = () => { calls++; };
    so.renderFrame(graphWith("other"), new Map());
    expect(so.isOpen("s1")).toBe(false);
    expect(windows[0]!.closed).toBe(true);
    expect(calls).toBe(1);
  });

  test("4 隅 param の変化時のみ warp-state を子ウィンドウへ送る", () => {
    const { deps, windows } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.toggle("s1");
    const g = graphWith("s1");
    const outs = outputsWith({ s1: {} });
    so.renderFrame(g, outs);
    expect(windows[0]!.posted).toHaveLength(1);   // 初回は必ず送る
    expect(windows[0]!.posted[0]).toEqual({
      type: WARP_STATE_TYPE,
      screenId: "s1",
      corners: { tlX: 0, tlY: 0, trX: 1, trY: 0, blX: 0, blY: 1, brX: 1, brY: 1 },
    });
    so.renderFrame(g, outs);
    expect(windows[0]!.posted).toHaveLength(1);   // 変化なし＝送らない
    g.nodes[0]!.params = { tlX: 0.25 };
    so.renderFrame(g, outs);
    expect(windows[0]!.posted).toHaveLength(2);
    expect((windows[0]!.posted[1] as { corners: { tlX: number } }).corners.tlX).toBe(0.25);
  });
});

describe("ScreenOutputs ownsWindow (#282)", () => {
  test("管理中の出力ウィンドウの Window だけを認める（postMessage の e.source 検証）", () => {
    const { deps } = makeFakes();
    const so = new ScreenOutputs(deps);
    so.toggle("s1");
    const win = so.windowFor("s1");
    expect(win).not.toBeNull();
    expect(so.ownsWindow(win)).toBe(true);
    expect(so.ownsWindow({})).toBe(false);
    expect(so.ownsWindow(null)).toBe(false);
    so.toggle("s1");
    expect(so.ownsWindow(win)).toBe(false);
  });
});
