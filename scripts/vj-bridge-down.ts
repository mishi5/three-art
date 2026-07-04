// #237: bridge:up で起動した AI ブリッジ一式（WS 中継 + dev サーバ）を停止する。
//   bun run bridge:down            … 記録されている全セットを停止
//   bun run bridge:down <devPort>  … その dev ポートのセットだけ停止
// PID ファイル（tmp・dev ポート単位）に記録された自前のプロセスのみを止める（他のサーバには触れない）。
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readdir, unlink } from "node:fs/promises";
import { PID_PREFIX, PID_SUFFIX, bridgePidFile, type BridgePids } from "./vj-bridge-pids";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 1 セットぶんの PID ファイルを読み、記録されたプロセスを停止してファイルを消す。 */
async function stopSet(pidFile: string): Promise<boolean> {
  const data = (await Bun.file(pidFile)
    .json()
    .catch(() => null)) as Partial<BridgePids> | null;
  if (!data) return false;
  for (const [label, rec] of Object.entries(data)) {
    if (!rec || typeof rec.pid !== "number") continue;
    if (!alive(rec.pid)) {
      console.log(`[bridge:down] ${label} (pid ${rec.pid}, port ${rec.port}) は既に停止しています`);
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
  await unlink(pidFile).catch(() => {});
  return true;
}

const portArg = process.argv[2];
let targets: string[];
if (portArg) {
  targets = [bridgePidFile(Number(portArg))];
} else {
  // 記録されている全セット（node-vj-bridge.<port>.pids.json）を対象にする。
  const names = await readdir(tmpdir()).catch(() => [] as string[]);
  targets = names
    .filter((n) => n.startsWith(PID_PREFIX) && n.endsWith(PID_SUFFIX))
    .map((n) => join(tmpdir(), n));
}

let stopped = 0;
for (const f of targets) {
  if (await stopSet(f)) stopped++;
}
if (stopped === 0) {
  console.log(`[bridge:down] 起動記録がありません（${portArg ? `devPort=${portArg}` : "全セット"}）。停止対象なし。`);
} else {
  console.log(`[bridge:down] 完了（${stopped} セット）`);
}
