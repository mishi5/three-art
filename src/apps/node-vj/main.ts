// node-vj アプリのエントリポイント（WIP）。
// Epic #56: ノードベース VJ アプリ。グラフ基盤・UI は #59 以降で実装する。
// 本ファイルは #58 時点では別 URL ビルドの動作確認用プレースホルダ。
const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not found");

const root = document.getElementById("ui-root");
if (root) {
  root.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
    "color:#fff;font-family:system-ui;text-align:center;";
  root.textContent = "node-vj (WIP) — ノードグラフ基盤は #59 以降で実装";
}

console.log("[node-vj] placeholder entry loaded");
