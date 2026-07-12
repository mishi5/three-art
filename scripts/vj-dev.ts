// #283: node-vj の dev サーバ（明示ルート版）。
//   bun run dev:vj [port]   （既定 3000 / 環境変数 VJ_DEV_PORT でも指定可）
// 従来の `bun --hot ./node-vj.html`（単一 HTML）に obs.html を足すと、Bun の HTML dev サーバは
// ルートをファイル名ベース（/node-vj・/obs）へ切り替えてしまい、既存 URL
// （http://localhost:3000/）が 404 になる。既存 URL を壊さないため、このスクリプトで
// ルートを明示して両ページを配る。ビルド（dist）では obs.html が静的に /obs.html で配られる
// ので、dev でも同じパスを提供する。
import nodeVj from "../node-vj.html";
import obs from "../obs.html";

const port = Number(process.argv[2] ?? process.env.VJ_DEV_PORT ?? 3000);

const server = Bun.serve({
  port,
  development: true,   // HMR（`bun --hot ./node-vj.html` 相当の開発体験）
  routes: {
    "/": nodeVj,
    "/node-vj": nodeVj,     // ファイル名ベースの URL でも開けるように
    "/obs.html": obs,       // #283: クリーンフィード（OBS ブラウザソース用）。dist と同じパス
    "/obs": obs,
  },
});

console.log(`[vj-dev] node-vj: http://localhost:${server.port}/`);
console.log(`[vj-dev] clean feed (OBS browser source): http://localhost:${server.port}/obs.html`);
