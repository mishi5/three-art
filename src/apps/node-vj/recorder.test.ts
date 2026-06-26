import { expect, test, describe } from "bun:test";
import { pickRecorderMimeType, recordingFileName, RECORDER_MIME_CANDIDATES } from "./recorder";

describe("pickRecorderMimeType", () => {
  test("全対応なら最優先（vp9,opus）", () => {
    expect(pickRecorderMimeType(() => true)).toBe("video/webm;codecs=vp9,opus");
  });
  test("vp9 非対応なら vp8,opus にフォールバック", () => {
    const ok = (m: string) => !m.includes("vp9");
    expect(pickRecorderMimeType(ok)).toBe("video/webm;codecs=vp8,opus");
  });
  test("webm のみ対応なら video/webm", () => {
    const ok = (m: string) => m === "video/webm";
    expect(pickRecorderMimeType(ok)).toBe("video/webm");
  });
  test("どれも非対応なら空文字", () => {
    expect(pickRecorderMimeType(() => false)).toBe("");
  });
  test("候補は webm コンテナのみ", () => {
    expect(RECORDER_MIME_CANDIDATES.every((m) => m.startsWith("video/webm"))).toBe(true);
  });
});

describe("recordingFileName", () => {
  test("YYYYMMDD-HHMMSS で 0 埋め", () => {
    // ローカル時刻の各桁を 0 埋めする（月は 0-index なので +1）。
    const d = new Date(2026, 5, 3, 9, 4, 7); // 2026-06-03 09:04:07
    expect(recordingFileName(d)).toBe("node-vj-20260603-090407.webm");
  });
  test("2 桁はそのまま", () => {
    const d = new Date(2026, 11, 25, 23, 59, 58);
    expect(recordingFileName(d)).toBe("node-vj-20261225-235958.webm");
  });
});
