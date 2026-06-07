import { describe, it, expect } from "bun:test";
import { captureThumbnail } from "./thumbnail-capture";

/**
 * テスト戦略:
 *   - 実画面の OutputPass / tone mapping を経由したサムネ描画を再現するため、
 *     captureThumbnail は EffectComposer (RenderPass + OutputPass) を内部で
 *     構築する。bun + happy-dom には本物の WebGL コンテキストが無いので、
 *     その経路は `__captureForTest` フックで差し替えてテストする。
 *   - encode 部は既存の `encode` フックで差し替え、合成 data URL を返す。
 */

describe("captureThumbnail", () => {
  it("delegates rendering to __captureForTest and forwards the buffer to encode", () => {
    const calls: Array<{ w: number; h: number; rendererSeen: unknown }> = [];
    const fakeBuf = new Uint8Array(8 * 4 * 4);
    fakeBuf[0] = 42; // encode に渡るか追跡できる印
    const url = captureThumbnail(
      { __renderer: true } as any,
      { __scene: true } as any,
      { __camera: true } as any,
      {
        width: 8,
        height: 4,
        __captureForTest: (renderer, _scene, _camera, w, h) => {
          calls.push({ w, h, rendererSeen: renderer });
          return fakeBuf;
        },
        encode: (buf, w, h, mime, quality) =>
          `data:${mime};fake;${w}x${h};${quality};firstByte=${buf[0]}`,
      },
    );
    expect(calls.length).toBe(1);
    expect(calls[0]!.w).toBe(8);
    expect(calls[0]!.h).toBe(4);
    expect((calls[0]!.rendererSeen as { __renderer: boolean }).__renderer).toBe(true);
    expect(url).toBe("data:image/webp;fake;8x4;0.7;firstByte=42");
  });

  it("uses default size 256x144 when not specified", () => {
    let seenW = 0;
    let seenH = 0;
    captureThumbnail({} as any, {} as any, {} as any, {
      __captureForTest: (_r, _s, _c, w, h) => {
        seenW = w;
        seenH = h;
        return new Uint8Array(w * h * 4);
      },
      encode: () => "",
    });
    expect(seenW).toBe(256);
    expect(seenH).toBe(144);
  });

  it("passes scene and camera through to the capture step", () => {
    const scene = { __id: "scene-x" } as any;
    const camera = { __id: "camera-y" } as any;
    let receivedScene: any = null;
    let receivedCamera: any = null;
    captureThumbnail({} as any, scene, camera, {
      width: 2,
      height: 2,
      __captureForTest: (_r, s, c, w, h) => {
        receivedScene = s;
        receivedCamera = c;
        return new Uint8Array(w * h * 4);
      },
      encode: () => "",
    });
    expect(receivedScene.__id).toBe("scene-x");
    expect(receivedCamera.__id).toBe("camera-y");
  });

  it("returns whatever encode returns", () => {
    const url = captureThumbnail({} as any, {} as any, {} as any, {
      width: 1,
      height: 1,
      __captureForTest: (_r, _s, _c, w, h) => new Uint8Array(w * h * 4),
      encode: () => "data:image/png;base64,sentinel",
    });
    expect(url).toBe("data:image/png;base64,sentinel");
  });

  it("forwards mime and quality from options into encode", () => {
    let seenMime = "";
    let seenQuality = -1;
    captureThumbnail({} as any, {} as any, {} as any, {
      width: 1,
      height: 1,
      mime: "image/png",
      quality: 0.42,
      __captureForTest: (_r, _s, _c, w, h) => new Uint8Array(w * h * 4),
      encode: (_b, _w, _h, mime, q) => {
        seenMime = mime;
        seenQuality = q;
        return "";
      },
    });
    expect(seenMime).toBe("image/png");
    expect(seenQuality).toBe(0.42);
  });
});
