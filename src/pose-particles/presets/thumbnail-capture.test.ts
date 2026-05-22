import { describe, it, expect } from "bun:test";
import { captureThumbnail } from "./thumbnail-capture";

/**
 * 最低限のオフスクリーン canvas が無いと toDataURL が動かないので、bun の
 * グローバルに document を生やしておく必要がある場合のみ自前で stub する。
 * 通常 bun は OffscreenCanvas / document を持たないので、bufferToDataURL は
 * 「呼ばれた」ことだけ検証する内部 hook を使う。
 *
 * テスト戦略:
 *   - WebGLRenderTarget は three.js 本物を使い (Three.js は WebGL コンテキストが
 *     無くてもオブジェクト構築は通る)、renderer / scene / camera はメソッド呼び出しを
 *     記録する fake を渡す。
 *   - readRenderTargetPixels は buf に 0 を埋める fake。
 *   - encode 部は内部 hook (__encodeForTest) を差し替えて固定文字列を返す。
 */

type Call = { name: string; args: unknown[] };

function makeFakeRenderer(): { calls: Call[]; renderer: any } {
  const calls: Call[] = [];
  const renderer = {
    setRenderTarget(rt: unknown) { calls.push({ name: "setRenderTarget", args: [rt] }); },
    render(scene: unknown, camera: unknown) { calls.push({ name: "render", args: [scene, camera] }); },
    readRenderTargetPixels(rt: unknown, x: number, y: number, w: number, h: number, buf: Uint8Array) {
      calls.push({ name: "readRenderTargetPixels", args: [rt, x, y, w, h, buf.length] });
      buf.fill(0);
    },
  };
  return { calls, renderer };
}

describe("captureThumbnail", () => {
  it("renders into a fresh WebGLRenderTarget then disposes it (no leak)", () => {
    const { calls, renderer } = makeFakeRenderer();
    const scene = {} as any;
    const camera = {} as any;
    const url = captureThumbnail(renderer as any, scene, camera, {
      width: 8, height: 4,
      encode: (_buf, w, h) => `data:image/webp;base64,fake-${w}x${h}`,
    });
    // 呼び出し順: setRenderTarget(rt) → render(scene,camera) → readRenderTargetPixels(rt,...) → setRenderTarget(null)
    expect(calls.map((c) => c.name)).toEqual([
      "setRenderTarget",
      "render",
      "readRenderTargetPixels",
      "setRenderTarget",
    ]);
    // 1 回目は rt object、最後は null で reset
    expect(calls[0]!.args[0]).not.toBeNull();
    expect(calls[3]!.args[0]).toBeNull();
    // 戻り値が encode の出力
    expect(url).toBe("data:image/webp;base64,fake-8x4");
  });

  it("uses default size 256x144 when not specified", () => {
    const { calls, renderer } = makeFakeRenderer();
    captureThumbnail(renderer as any, {} as any, {} as any, {
      encode: (_buf, w, h) => `data:image/webp;base64,fake-${w}x${h}`,
    });
    const read = calls.find((c) => c.name === "readRenderTargetPixels")!;
    expect(read.args[3]).toBe(256);
    expect(read.args[4]).toBe(144);
  });

  it("passes a buffer of w*h*4 bytes to readRenderTargetPixels", () => {
    const { calls, renderer } = makeFakeRenderer();
    captureThumbnail(renderer as any, {} as any, {} as any, {
      width: 10, height: 5,
      encode: () => "x",
    });
    const read = calls.find((c) => c.name === "readRenderTargetPixels")!;
    expect(read.args[5]).toBe(10 * 5 * 4);
  });
});
