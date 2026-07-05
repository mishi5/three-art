// #237: AI ブリッジ一式（WS 中継 + node-vj dev サーバ）をバックグラウンド起動する。
//   bun run bridge:up [devPort] [relayPort]   （既定 3000 / 8787）
// 起動した PID は tmp の PID ファイル（dev ポート単位）に記録し、bridge:down で停止する。
// ポート別記録なので、別ポート指定で複数セットを同時に動かしても記録は被らない。
// 既に対象ポートが使用中の場合は「他のサーバを殺さない」ため起動せずエラー終了する。
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { bridgePidFile, type BridgePids } from "./vj-bridge-pids";

const REPO_ROOT = join(import.meta.dir, "..");

const portArgs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const devPort = Number(portArgs[0] ?? process.env.VJ_DEV_PORT ?? 3000);
const relayPort = Number(portArgs[1] ?? process.env.VJ_RELAY_PORT ?? 8787);

/**
 * ポートに TCP 接続できるか（listen 中か）。
 * Bun の HTML dev サーバは IPv6（::1）で listen するため、IPv4/IPv6 の両方を試す
 * （127.0.0.1 だけだと dev サーバ起動済みでも false になる）。
 */
async function portInUse(port: number): Promise<boolean> {
  for (const hostname of ["127.0.0.1", "::1"]) {
    try {
      const sock = await Bun.connect({ hostname, port, socket: { data() {}, error() {} } });
      sock.end();
      return true;
    } catch {
      // このスタックでは接続不可。次を試す。
    }
  }
  return false;
}

/** cond が true になるまで poll（timeoutMs 超過で false）。 */
async function waitFor(cond: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return true;
    await Bun.sleep(300);
  }
  return false;
}

const PID_FILE = bridgePidFile(devPort);

/** pid が生きているか。 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 既存 PID ファイル（同じ dev ポート）があれば、その**記録済みプロセスを停止してから**起動し直す。
// worktree を移って bridge:up し直すと古いコードのサーバが自動で入れ替わる。
// PID 記録の無い（＝ユーザ管理の）サーバは下のポートチェックで従来どおり中止し、決して殺さない。
const existing = (await Bun.file(PID_FILE)
  .json()
  .catch(() => null)) as Partial<BridgePids> | null;
if (existing) {
  for (const [label, rec] of Object.entries(existing)) {
    if (!rec || typeof rec.pid !== "number" || !alive(rec.pid)) continue;
    process.kill(rec.pid, "SIGTERM");
    const start = Date.now();
    while (alive(rec.pid) && Date.now() - start < 5000) await Bun.sleep(200);
    if (alive(rec.pid)) process.kill(rec.pid, "SIGKILL");
    console.log(`[bridge:up] 既存セットの ${label} (pid ${rec.pid}, port ${rec.port}) を停止しました`);
  }
  await unlink(PID_FILE).catch(() => {});
  // 停止直後はポート解放に少し掛かることがあるので、空くのを待ってから下のチェックへ。
  await waitFor(async () => !(await portInUse(devPort)) && !(await portInUse(relayPort)), 3000);
}

// ポート使用中なら起動しない（ユーザ管理のサーバを巻き込まない）。
for (const [label, port] of [["dev", devPort], ["relay", relayPort]] as const) {
  if (await portInUse(port)) {
    console.error(`[bridge:up] port ${port} (${label}) は使用中です。起動を中止します（既存サーバは触りません）。`);
    console.error(`[bridge:up] 別ポートで起動する場合: bun run bridge:up <devPort> <relayPort>`);
    process.exit(1);
  }
}

// 中継 → dev サーバの順に detached で起動（親が終了しても生存）。
// 子の出力は tmp のログへ残す（起動失敗の原因調査用・ポート別）。
const relayLog = Bun.file(join(tmpdir(), `node-vj-bridge.${relayPort}.relay.log`));
const devLog = Bun.file(join(tmpdir(), `node-vj-bridge.${devPort}.dev.log`));
const relay = Bun.spawn(["bun", join(REPO_ROOT, "scripts", "vj-relay.ts"), String(relayPort)], {
  cwd: REPO_ROOT,
  stdin: "ignore",
  stdout: relayLog,
  stderr: relayLog,
});
relay.unref();
// 注意: --port は html ファイルより前に置く（後置は無視され既定 3000 で立つ）。
const dev = Bun.spawn(["bun", "--hot", "--port", String(devPort), join(REPO_ROOT, "node-vj.html")], {
  cwd: REPO_ROOT,
  stdin: "ignore",
  stdout: devLog,
  stderr: devLog,
});
dev.unref();

// 起動を待つ（listen 開始まで）。失敗したら双方を殺して終了する。
const relayOk = await waitFor(() => portInUse(relayPort), 10_000);
const devOk = await waitFor(() => portInUse(devPort), 15_000);
if (!relayOk || !devOk) {
  console.error(`[bridge:up] 起動に失敗しました (relay=${relayOk} dev=${devOk})。プロセスを停止します。`);
  try { relay.kill(); } catch { /* 既に死んでいれば無視 */ }
  try { dev.kill(); } catch { /* 同上 */ }
  process.exit(1);
}

const pids: BridgePids = {
  dev: { pid: dev.pid, port: devPort },
  relay: { pid: relay.pid, port: relayPort },
};
await Bun.write(PID_FILE, JSON.stringify(pids, null, 2));

const url = `http://localhost:${devPort}/`;
// macOS ではブラウザでページまで開く（--no-open で抑止・他 OS は URL 案内のみ）。
const noOpen = process.argv.includes("--no-open");
if (!noOpen && process.platform === "darwin") {
  Bun.spawn(["open", url], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
}

console.log(`[bridge:up] 起動しました`);
console.log(`  dev   : ${url}  (pid ${dev.pid})`);
console.log(`  relay : ws://127.0.0.1:${relayPort}   (pid ${relay.pid})`);
console.log(`  次へ  : ${noOpen ? "ブラウザで開き、" : "開いたページで"}設定パネル「AI ブリッジ」を ON（URL: ws://localhost:${relayPort}）`);
console.log(`  停止  : bun run bridge:down（全セット）/ bun run bridge:down ${devPort}（このセットのみ）`);
