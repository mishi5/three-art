// #237: node-vj AI 操作の WS ブリッジ中継サーバ（dumb pipe）。
// [node-vj タブ] --ws--> [この中継 (127.0.0.1)] <--ws-- [AI エージェント]
// 機能を持たない純粋な中継: hello で役割を登録し、cmd を app へ・result を全 agent へ
// 原文のまま流すだけ（ルーティングは src/apps/node-vj/api/relay-router.ts・テスト済み）。
//
// 起動: bun run relay            （既定 port 8787）
//       bun run relay 8791       （第 1 引数で port 指定）
//       VJ_RELAY_PORT=8791 bun run relay
import type { ServerWebSocket } from "bun";
import { RelayRouter } from "../src/apps/node-vj/api/relay-router";

const port = Number(Bun.argv[2] ?? Bun.env.VJ_RELAY_PORT ?? 8787);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[vj-relay] 不正な port: ${Bun.argv[2] ?? Bun.env.VJ_RELAY_PORT}`);
  process.exit(1);
}

const router = new RelayRouter<ServerWebSocket<unknown>>();

const server = Bun.serve({
  hostname: "127.0.0.1", // ローカル限定（LAN からは接続不可）
  port,
  fetch(req, srv) {
    if (srv.upgrade(req)) return undefined;
    return new Response("node-vj relay: WebSocket でアクセスしてください", { status: 426 });
  },
  websocket: {
    message(ws, message) {
      const raw = typeof message === "string" ? message : message.toString();
      for (const send of router.handleMessage(ws, raw)) {
        send.to.send(send.data);
      }
    },
    close(ws) {
      router.handleClose(ws);
    },
  },
});

console.log(`[vj-relay] listening on ws://${server.hostname}:${server.port} (app: node-vj タブ / agent: 外部エージェント)`);
