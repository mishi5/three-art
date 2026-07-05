import * as THREE from "three";
import { expect, test, describe } from "bun:test";
import { FADE_GAMMA, FADE_PARAM, FADE_SMOOTH_TIME, clampFade, perceptualFade, readFade } from "./video-fade-logic";
import { VideoFileInputNode } from "./VideoFileInputNode";
import { VideoTextureSurface } from "../graph/video-surface";
import { paramInputs, isConnectableParam } from "../graph/node-ports";

describe("clampFade (#241)", () => {
  test("0..1 にクランプする", () => {
    expect(clampFade(0.4)).toBe(0.4);
    expect(clampFade(-0.5)).toBe(0);
    expect(clampFade(1.5)).toBe(1);
    expect(clampFade(0)).toBe(0);
    expect(clampFade(1)).toBe(1);
  });

  test("NaN・非有限は既定 1 に落とす", () => {
    expect(clampFade(Number.NaN)).toBe(1);
    expect(clampFade(Infinity)).toBe(1);
    expect(clampFade(-Infinity)).toBe(1);
  });
});

describe("perceptualFade (#241)", () => {
  test("端点を保存する（0→0, 1→1）", () => {
    expect(perceptualFade(0)).toBe(0);
    expect(perceptualFade(1)).toBe(1);
  });

  test("つまみ値を ^2.2 でリニア光へ変換（知覚リニア化）", () => {
    expect(perceptualFade(0.5)).toBeCloseTo(Math.pow(0.5, FADE_GAMMA));
    expect(perceptualFade(0.2)).toBeCloseTo(Math.pow(0.2, FADE_GAMMA));
  });

  test("単調増加・範囲外/NaN はクランプ後に変換", () => {
    expect(perceptualFade(0.3)).toBeGreaterThan(perceptualFade(0.2));
    expect(perceptualFade(2)).toBe(1);
    expect(perceptualFade(-1)).toBe(0);
    expect(perceptualFade(Number.NaN)).toBe(1);
  });
});

describe("readFade (#241)", () => {
  test("未設定は既定 1", () => {
    expect(readFade(() => undefined)).toBe(1);
  });

  test("数値・文字列数値を読んでクランプする", () => {
    expect(readFade(() => 0.3)).toBe(0.3);
    expect(readFade(() => "0.7")).toBe(0.7);
    expect(readFade(() => -1)).toBe(0);
    expect(readFade(() => 2)).toBe(1);
  });

  test("数値化できない値は既定 1", () => {
    expect(readFade(() => "abc")).toBe(1);
  });
});

describe("fade param 定義 (#241)", () => {
  test("number・0..1・step 0.01・既定 1", () => {
    expect(FADE_PARAM.kind).toBe("number");
    expect(FADE_PARAM.default).toBe(1);
    expect(FADE_PARAM.min).toBe(0);
    expect(FADE_PARAM.max).toBe(1);
    expect(FADE_PARAM.step).toBe(0.01);
  });

  test("VideoFileInput の params に fade がある", () => {
    expect(VideoFileInputNode.params.some((p) => p.id === "fade")).toBe(true);
  });

  test("他ノードから駆動できる（数値 param 入力ポート化に乗る）", () => {
    expect(isConnectableParam(FADE_PARAM)).toBe(true);
    expect(paramInputs(VideoFileInputNode).map((p) => p.id)).toContain("fade");
  });

  test("音声フェードの時定数は短くクリックを避ける（0 < tc <= 0.1s）", () => {
    expect(FADE_SMOOTH_TIME).toBeGreaterThan(0);
    expect(FADE_SMOOTH_TIME).toBeLessThanOrEqual(0.1);
  });
});

describe("VideoTextureSurface の fade 反映 (#241)", () => {
  type SurfaceInternals = { material: THREE.MeshBasicMaterial };

  test("既定はフェード無し（color=白）", () => {
    const s = new VideoTextureSurface();
    const mat = (s as unknown as SurfaceInternals).material;
    expect(mat.color.r).toBe(1);
    expect(mat.color.g).toBe(1);
    expect(mat.color.b).toBe(1);
    s.dispose();
  });

  test("setFade で material.color が (f^2.2,…) になる（リニア光乗算の知覚補正つき黒フェード）", () => {
    const s = new VideoTextureSurface();
    const mat = (s as unknown as SurfaceInternals).material;
    s.setFade(0.25);
    const expected = Math.pow(0.25, FADE_GAMMA);
    expect(mat.color.r).toBeCloseTo(expected);
    expect(mat.color.g).toBeCloseTo(expected);
    expect(mat.color.b).toBeCloseTo(expected);
    s.setFade(0); // 全黒
    expect(mat.color.r).toBe(0);
    s.setFade(1); // 原状
    expect(mat.color.r).toBe(1);
    s.dispose();
  });

  test("setFade は範囲外・NaN を安全側に丸める", () => {
    const s = new VideoTextureSurface();
    const mat = (s as unknown as SurfaceInternals).material;
    s.setFade(2);
    expect(mat.color.r).toBe(1);
    s.setFade(-1);
    expect(mat.color.r).toBe(0);
    s.setFade(Number.NaN); // 不正値は既定 1（従来描画）
    expect(mat.color.r).toBe(1);
    s.dispose();
  });
});
