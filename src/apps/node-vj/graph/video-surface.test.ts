// #281: VideoTextureSurface の「別 video 要素への切替」対応のテスト。
// 従来は最初に渡された要素で VideoTexture をキャッシュし続け、ClipLauncher のように
// 途中で別の video 要素を渡す使い方だと古い映像のままになっていた。
// image 比較（videoTexture.image !== video）で dispose→作り直すことを検証する。
// THREE の CPU 側オブジェクトはそのまま使い、renderer と video だけ最小 fake で回す。
import * as THREE from "three";
import { expect, test, describe } from "bun:test";
import { VideoTextureSurface } from "./video-surface";

/** GPU を触らない範囲の fake renderer（render/RT 切替は no-op）。 */
function fakeRenderer(w = 64, h = 48): THREE.WebGLRenderer {
  return {
    domElement: { width: w, height: h },
    getRenderTarget: () => null,
    setRenderTarget() { /* no-op */ },
    clear() { /* no-op */ },
    render() { /* no-op */ },
  } as unknown as THREE.WebGLRenderer;
}

/** VideoTexture の image になるだけの fake video（instanceof に依存しない）。 */
function fakeVideo(w = 320, h = 240): HTMLVideoElement {
  return { videoWidth: w, videoHeight: h } as unknown as HTMLVideoElement;
}

type Internals = { videoTexture: THREE.VideoTexture | null; material: THREE.MeshBasicMaterial };

describe("#281 VideoTextureSurface: video 要素の切替", () => {
  test("同一要素なら VideoTexture を再生成しない（従来挙動）", () => {
    const s = new VideoTextureSurface();
    const renderer = fakeRenderer();
    const video = fakeVideo();
    s.render(renderer, video);
    const first = (s as unknown as Internals).videoTexture;
    expect(first).not.toBeNull();
    expect(first!.image).toBe(video);
    s.render(renderer, video);
    expect((s as unknown as Internals).videoTexture).toBe(first!);
    s.dispose();
  });

  test("別要素を渡すと古い texture を dispose して作り直す", () => {
    const s = new VideoTextureSurface();
    const renderer = fakeRenderer();
    const videoA = fakeVideo();
    const videoB = fakeVideo(640, 360);
    s.render(renderer, videoA);
    const first = (s as unknown as Internals).videoTexture!;
    let disposed = false;
    first.addEventListener("dispose", () => { disposed = true; });
    s.render(renderer, videoB);
    const second = (s as unknown as Internals).videoTexture!;
    expect(second).not.toBe(first);
    expect(second.image).toBe(videoB);
    expect(disposed).toBe(true);
    // material.map も新しい texture に張り替わっている。
    expect((s as unknown as Internals).material.map).toBe(second);
    s.dispose();
  });

  test("要素切替後も同一要素の再 render では再生成しない", () => {
    const s = new VideoTextureSurface();
    const renderer = fakeRenderer();
    const videoA = fakeVideo();
    const videoB = fakeVideo();
    s.render(renderer, videoA);
    s.render(renderer, videoB);
    const tex = (s as unknown as Internals).videoTexture;
    s.render(renderer, videoB);
    expect((s as unknown as Internals).videoTexture).toBe(tex!);
    s.dispose();
  });

  test("映像未着（videoWidth=0）は null のまま（texture を作らない）", () => {
    const s = new VideoTextureSurface();
    expect(s.render(fakeRenderer(), fakeVideo(0, 0))).toBeNull();
    expect((s as unknown as Internals).videoTexture).toBeNull();
    s.dispose();
  });
});
