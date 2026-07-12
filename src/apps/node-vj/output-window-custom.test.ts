// #282: OutputWindow の汎用化（window name / HTML の注入）テスト。
// 既定引数では #148 従来（name "node-vj-output"・buildOutputHtml）のまま。
import { describe, expect, test } from "bun:test";
import { registerHappyDom } from "../../test-setup/dom";

registerHappyDom();

const { OutputWindow, buildOutputHtml } = await import("./output-window");

// happy-dom の canvas.captureStream は MediaStream 互換でない値を返すため、
// captureStream を持たない fake を渡す（本体は typeof チェックで安全にスキップする）。
function makeCanvas(): HTMLCanvasElement {
  return {} as HTMLCanvasElement;
}

describe("OutputWindow のカスタム name / HTML (#282)", () => {
  test("既定は従来どおり（buildOutputHtml の内容が書かれる）", () => {
    const ow = new OutputWindow();
    ow.open(makeCanvas());
    const win = ow.contentWindow();
    expect(win).not.toBeNull();
    expect(win!.document.getElementById("out")?.tagName.toLowerCase()).toBe("video");
    ow.close();
    expect(ow.contentWindow()).toBeNull();
  });

  test("html 指定で任意のウィンドウ HTML を書ける（Screen 出力用）", () => {
    const ow = new OutputWindow({ name: "node-vj-screen-x", html: "<html><body><video id=\"out\"></video><div id=\"marker282\"></div></body></html>" });
    ow.open(makeCanvas());
    const win = ow.contentWindow();
    expect(win).not.toBeNull();
    expect(win!.document.getElementById("marker282")).not.toBeNull();
    ow.close();
  });

  test("buildOutputHtml は従来のまま（#148 無変更）", () => {
    expect(buildOutputHtml()).toContain("node-vj 出力");
  });
});
