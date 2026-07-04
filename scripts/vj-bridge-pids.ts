// #237: bridge:up / bridge:down が共有する PID 記録の置き場所。
// dev ポート単位のファイル名にすることで、別ポートの複数セットを同時に動かしても
// 記録が被らない（down は全記録を対象にできる）。
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface BridgePids {
  dev: { pid: number; port: number };
  relay: { pid: number; port: number };
}

/** PID ファイル名の共通接頭辞（down が全セットを列挙するのに使う）。 */
export const PID_PREFIX = "node-vj-bridge.";
export const PID_SUFFIX = ".pids.json";

/** dev ポート単位の PID ファイルパス。 */
export function bridgePidFile(devPort: number): string {
  return join(tmpdir(), `${PID_PREFIX}${devPort}${PID_SUFFIX}`);
}
