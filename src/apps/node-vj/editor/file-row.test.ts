import { expect, test, describe } from "bun:test";
import { VideoFileInputNode } from "../nodes/VideoFileInputNode";
import { AudioFileInputNode } from "../nodes/AudioFileInputNode";
import { MicInputNode } from "../nodes/MicInputNode";
import { nodeHeight, fileRowRect, hasFileRow, fileRowLabel, ROW_H, NODE_WIDTH } from "./layout";
import type { NodeInstance } from "../graph/graph-doc";

describe("file input ノードのマーカー (#99)", () => {
  test("VideoFileInput / AudioFileInput は fileInput.accept を持つ", () => {
    expect(VideoFileInputNode.fileInput?.accept).toBe("video/*");
    expect(AudioFileInputNode.fileInput?.accept).toBe("audio/*");
  });

  test("ファイル系でないノードは fileInput を持たない", () => {
    expect(MicInputNode.fileInput).toBeUndefined();
    expect(hasFileRow(MicInputNode)).toBe(false);
    expect(hasFileRow(VideoFileInputNode)).toBe(true);
  });
});

describe("file 行レイアウト (#99)", () => {
  const node: NodeInstance = { id: "n", type: "VideoFileInput", params: {}, position: { x: 10, y: 20 } };

  test("fileInput 持ちノードは高さが ROW_H ぶん増える", () => {
    const noFile = { ...VideoFileInputNode, fileInput: undefined };
    expect(nodeHeight(VideoFileInputNode)).toBe(nodeHeight(noFile) + ROW_H);
  });

  test("fileRowRect は params 直下の全幅行（高さ ROW_H）", () => {
    const r = fileRowRect(node, VideoFileInputNode)!;
    const full = nodeHeight(VideoFileInputNode);
    expect(r.x).toBe(10);
    expect(r.w).toBe(NODE_WIDTH);
    expect(r.h).toBe(ROW_H);
    // ノード下端の直上に位置する
    expect(r.y + r.h).toBeCloseTo(20 + full, 6);
  });

  test("fileInput 無しノードの fileRowRect は null", () => {
    const mic: NodeInstance = { id: "m", type: "MicInput", params: {} };
    expect(fileRowRect(mic, MicInputNode)).toBeNull();
  });
});

describe("fileRowLabel (#99)", () => {
  test("未選択は『ファイル未選択』", () => {
    expect(fileRowLabel(null)).toBe("ファイル未選択");
    expect(fileRowLabel(undefined)).toBe("ファイル未選択");
    expect(fileRowLabel("")).toBe("ファイル未選択");
  });
  test("ファイル名はそのまま返す", () => {
    expect(fileRowLabel("track01.mp3")).toBe("track01.mp3");
  });
});
