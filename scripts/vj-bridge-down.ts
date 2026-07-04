// #237: bridge:up で起動した AI ブリッジ一式（WS 中継 + dev サーバ）を停止する。
//   bun run bridge:down
// PID ファイルに記録された自前のプロセスのみを止める（他のサーバには触れない）。
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

const PID_FILE = join(tmpdir(), "node-vj-bridge.pids.json");

interface Rec { pid: number; port: number }

const data = (await Bun.file(PID_FILE)
  .json()
  .catch(() => null)) as { dev?: Rec; relay?: Rec } | null;
if (!data) {
  console.log(`[bridge:down] 起動記録がありません（${PID_FILE} なし）。停止対象なし。`);
  process.exit(0);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

for (const [label, rec] of Object.entries(data) as [string, Rec][]) {
  if (!rec || typeof rec.pid !== "number") continue;
  if (!alive(rec.pid)) {
    console.log(`[bridge:down] ${label} (pid ${rec.pid}) は既に停止しています`);
    continue;
  }
  process.kill(rec.pid, "SIGTERM");
  // 終了を最大 5 秒待ち、残っていれば SIGKILL。
  const start = Date.now();
  while (alive(rec.pid) && Date.now() - start < 5000) await Bun.sleep(200);
  if (alive(rec.pid)) {
    process.kill(rec.pid, "SIGKILL");
    console.log(`[bridge:down] ${label} (pid ${rec.pid}, port ${rec.port}) を強制停止しました`);
  } else {
    console.log(`[bridge:down] ${label} (pid ${rec.pid}, port ${rec.port}) を停止しました`);
  }
}

await unlink(PID_FILE).catch(() => {});
console.log(`[bridge:down] 完了`);
