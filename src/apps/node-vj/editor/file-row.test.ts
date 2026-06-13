import { expect, test, describe } from "bun:test";
import { VideoFileInputNode } from "../nodes/VideoFileInputNode";
import { AudioFileInputNode } from "../nodes/AudioFileInputNode";
import { MicInputNode } from "../nodes/MicInputNode";
import {
  nodeHeight, fileRowRect, transportRowRect, hasFileRow, fileRowLabel,
  transportLayout, seekRatioAt, formatTime, ROW_H, NODE_WIDTH,
} from "./layout";
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

  test("fileInput 持ちノードは高さが file 行+transport 行ぶん（+2*ROW_H）増える", () => {
    const noFile = { ...VideoFileInputNode, fileInput: undefined };
    expect(nodeHeight(VideoFileInputNode)).toBe(nodeHeight(noFile) + 2 * ROW_H);
  });

  test("transport 行はノード最下行、file 行はその直上（どちらも全幅・ROW_H）", () => {
    const full = nodeHeight(VideoFileInputNode);
    const fr = fileRowRect(node, VideoFileInputNode)!;
    const tr = transportRowRect(node, VideoFileInputNode)!;
    expect(fr.x).toBe(10); expect(fr.w).toBe(NODE_WIDTH); expect(fr.h).toBe(ROW_H);
    expect(tr.x).toBe(10); expect(tr.w).toBe(NODE_WIDTH); expect(tr.h).toBe(ROW_H);
    // transport 行の下端 = ノード下端、file 行の下端 = transport 行の上端
    expect(tr.y + tr.h).toBeCloseTo(20 + full, 6);
    expect(fr.y + fr.h).toBeCloseTo(tr.y, 6);
  });

  test("fileInput 無しノードは fileRowRect / transportRowRect ともに null", () => {
    const mic: NodeInstance = { id: "m", type: "MicInput", params: {} };
    expect(fileRowRect(mic, MicInputNode)).toBeNull();
    expect(transportRowRect(mic, MicInputNode)).toBeNull();
  });
});

describe("transport レイアウト/ヘルパ (#99)", () => {
  const rect = { x: 100, y: 200, w: NODE_WIDTH, h: ROW_H };

  test("transportLayout: 再生ボタンの右にシークバー、いずれも rect 内", () => {
    const { button, seek } = transportLayout(rect);
    expect(button.x).toBeGreaterThanOrEqual(rect.x);
    expect(seek.x).toBeGreaterThan(button.x + button.w);
    expect(seek.x + seek.w).toBeLessThanOrEqual(rect.x + rect.w);
  });

  test("seekRatioAt: バー左端=0・右端=1・範囲外はクランプ", () => {
    const { seek } = transportLayout(rect);
    expect(seekRatioAt(seek.x, seek)).toBeCloseTo(0, 6);
    expect(seekRatioAt(seek.x + seek.w, seek)).toBeCloseTo(1, 6);
    expect(seekRatioAt(seek.x - 50, seek)).toBe(0);
    expect(seekRatioAt(seek.x + seek.w + 50, seek)).toBe(1);
  });

  test("formatTime: m:ss 形式・不正値は 0:00", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(-3)).toBe("0:00");
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
