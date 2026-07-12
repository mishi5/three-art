// #282: Screen 専用出力ウィンドウの HTML 生成テスト（ワープ調整 UI 込み）。
import { describe, expect, test } from "bun:test";
import { buildScreenOutputHtml, screenOutputWindowName } from "./screen-output-html";

describe("buildScreenOutputHtml (#282)", () => {
  const html = buildScreenOutputHtml("screen_1");

  test("映像のみ全画面: object-fit:contain の video（#148 と同じ土台）", () => {
    expect(html).toContain("<video");
    expect(html).toContain("object-fit: contain");
    expect(html).toContain("autoplay");
    expect(html).toContain("muted");
    expect(html).toContain("playsinline");
    expect(html).toContain("requestFullscreen");
  });

  test("screenId が JSON 文字列として埋め込まれる", () => {
    expect(html).toContain('"screen_1"');
    const weird = buildScreenOutputHtml('a"b<\\/script>');
    // JSON.stringify + < エスケープで script 終端やクォート破壊を起こさない
    expect(weird).not.toContain("</script></script>");
    expect(weird).toContain('\\"');
  });

  test("ワープ調整モードのトグルは物理キー（e.code === 'KeyW'）で判定する（#167: e.key を使わない）", () => {
    expect(html).toContain('e.code === "KeyW"');
    expect(html).not.toMatch(/e\.key\s*===/);
  });

  test("4 隅のハンドル（data-corner=tl/tr/bl/br）と外周ラインを持つ", () => {
    for (const c of ["tl", "tr", "bl", "br"]) expect(html).toContain(`data-corner="${c}"`);
    expect(html).toContain("<polygon");
  });

  test("親へのドラッグ通知: node-vj:warp を opener へ postMessage する", () => {
    expect(html).toContain("node-vj:warp");
    expect(html).toContain("window.opener");
    expect(html).toContain("postMessage");
    for (const phase of ["start", "move", "end"]) expect(html).toContain(`"${phase}"`);
  });

  test("親からの状態同期: node-vj:warp-state を受けてハンドル位置を更新する", () => {
    expect(html).toContain("node-vj:warp-state");
    expect(html).toContain("addEventListener(\"message\"");
  });

  test("trackpad の pointerup 取りこぼし対策（#167）: buttons === 0 でドラッグ終了", () => {
    expect(html).toContain("buttons === 0");
  });

  test("ヒントにワープ調整キーと全画面の導線を表示する", () => {
    expect(html).toContain("w: ワープ調整");
    expect(html).toContain("全画面");
  });
});

describe("screenOutputWindowName (#282)", () => {
  test("Screen ノード id ごとにユニークな window name（既存メイン出力 'node-vj-output' と衝突しない）", () => {
    expect(screenOutputWindowName("abc")).toBe("node-vj-screen-abc");
    expect(screenOutputWindowName("abc")).not.toBe("node-vj-output");
    expect(screenOutputWindowName("a")).not.toBe(screenOutputWindowName("b"));
  });
});
