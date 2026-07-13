// #283: node-vj の dev サーバ（明示ルート版）。
//   bun run dev:vj [port]   （既定 3000 / 環境変数 VJ_DEV_PORT でも指定可）
// 従来の `bun --hot ./node-vj.html`（単一 HTML）に obs.html を足すと、Bun の HTML dev サーバは
// ルートをファイル名ベース（/node-vj・/obs）へ切り替えてしまい、既存 URL
// （http://localhost:3000/）が 404 になる。既存 URL を壊さないため、このスクリプトで
// ルートを明示して両ページを配る。ビルド（dist）では obs.html が静的に /obs.html で配られる
// ので、dev でも同じパスを提供する。
//
// さらにクリーンフィードのシグナリング用 WS リレー（/cf-signal）をここで提供する。
// OBS のブラウザソースは OBS 内蔵の別ブラウザ（CEF）で動くため、BroadcastChannel では
// メインタブへ hello が届かない。受信したメッセージを**送信元以外の全接続へそのまま転送**
// する（中身は解釈しない）だけの単純なブロードキャストリレー。AI ブリッジの relay
// （scripts/vj-relay.ts・別ポート）とは別物で、dev サーバと同じポートのパスで分ける。
import nodeVj from "../node-vj.html";
import obs from "../obs.html";
import { CF_SIGNAL_PATH } from "../src/apps/node-vj/clean-feed-transport";

const port = Number(process.argv[2] ?? process.env.VJ_DEV_PORT ?? 3000);

/** WS リレーの pub/sub トピック（ws.publish は送信元自身には配らない）。 */
const CF_TOPIC = "cf-signal";

const server = Bun.serve({
  port,
  development: true,   // HMR（`bun --hot ./node-vj.html` 相当の開発体験）
  routes: {
    "/": nodeVj,
    "/node-vj": nodeVj,     // ファイル名ベースの URL でも開けるように
    "/obs.html": obs,       // #283: クリーンフィード（OBS ブラウザソース用）。dist と同じパス
    "/obs": obs,
  },
  // routes に無いパスのフォールバック。/cf-signal は WS へ upgrade する。
  fetch(req, srv) {
    if (new URL(req.url).pathname === CF_SIGNAL_PATH) {
      if (srv.upgrade(req)) return;   // upgrade 成功時はレスポンスを返さない
      return new Response("WebSocket upgrade required", { status: 400 });
    }
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.subscribe(CF_TOPIC);
    },
    message(ws, message) {
      // 送信元以外の全接続へそのまま転送（中身は解釈しない）。
      ws.publish(CF_TOPIC, message);
    },
    close(ws) {
      ws.unsubscribe(CF_TOPIC);
    },
  },
});

console.log(`[vj-dev] node-vj: http://localhost:${server.port}/`);
console.log(`[vj-dev] clean feed (OBS browser source): http://localhost:${server.port}/obs.html`);
console.log(`[vj-dev] clean feed signaling: ws://localhost:${server.port}${CF_SIGNAL_PATH}`);
