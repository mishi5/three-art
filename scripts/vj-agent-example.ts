// #237: WS ブリッジのエージェント側サンプル。中継へ role:"agent" で接続し、
// cmd を 1 つ送って対応する result（同じ id）を待ち、JSON で表示する最小クライアント。
//
// 使い方: bun scripts/vj-agent-example.ts [--url ws://127.0.0.1:8787] <cmd> [argsJSON]
// 例:     bun scripts/vj-agent-example.ts getStatus
//         bun scripts/vj-agent-example.ts setParam '{"nodeId":"n1","paramId":"value","value":0.5}'
//         bun scripts/vj-agent-example.ts --url ws://127.0.0.1:8791 getScenes
// 終了コード: 0 = result.ok / 1 = result.ok:false / 2 = 接続失敗・タイムアウト・引数不正

const TIMEOUT_MS = 5000;

// ---- 引数パース ----
let url = "ws://127.0.0.1:8787";
const positional: string[] = [];
const argv = Bun.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a === "--url") {
    url = argv[++i] ?? url;
  } else if (a.startsWith("--url=")) {
    url = a.slice("--url=".length);
  } else {
    positional.push(a);
  }
}
const cmdName = positional[0];
if (!cmdName) {
  console.error("使い方: bun scripts/vj-agent-example.ts [--url ws://127.0.0.1:8787] <cmd> [argsJSON]");
  process.exit(2);
}
let args: Record<string, unknown> = {};
if (positional[1] !== undefined) {
  try {
    args = JSON.parse(positional[1]) as Record<string, unknown>;
  } catch (e) {
    console.error(`argsJSON が不正です: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}

// ---- 接続 → hello → cmd → 同じ id の result を待つ ----
const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ws = new WebSocket(url);
const timer = setTimeout(() => {
  console.error(`タイムアウト（${TIMEOUT_MS}ms）: 中継は起動していますか？ node-vj 側の AI ブリッジは ON ですか？`);
  process.exit(2);
}, TIMEOUT_MS);

ws.onopen = () => {
  ws.send(JSON.stringify({ type: "node-vj:hello", role: "agent" }));
  ws.send(JSON.stringify({ type: "node-vj:cmd", id, cmd: cmdName, args }));
};
ws.onmessage = (e) => {
  if (typeof e.data !== "string") return;
  let msg: { type?: unknown; id?: unknown; result?: unknown };
  try {
    msg = JSON.parse(e.data) as typeof msg;
  } catch {
    return;
  }
  if (msg.type !== "node-vj:result" || msg.id !== id) return; // 他 agent 宛は id で読み飛ばす
  clearTimeout(timer);
  console.log(JSON.stringify(msg.result, null, 2));
  ws.close();
  const ok = typeof msg.result === "object" && msg.result !== null && (msg.result as { ok?: unknown }).ok === true;
  process.exit(ok ? 0 : 1);
};
ws.onerror = () => {
  clearTimeout(timer);
  console.error(`接続に失敗しました: ${url}（中継: bun run relay）`);
  process.exit(2);
};
