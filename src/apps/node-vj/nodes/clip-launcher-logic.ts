// #281: ClipLauncher のアーム→切替判定（純関数）。
// パッド押下（pending）を「即時切替」するか「アーム（予約）して sync エッジ待ち」にするかを決める。
// sync 入力のエッジ検出（prev 管理）や pending の保持は Runtime 側の責務。

/** resolveLaunch の結果。switchTo=このフレームで切り替えるパッド、armed=予約保持中のパッド。 */
export interface LaunchResolution {
  switchTo: number | null;
  armed: number | null;
}

/**
 * #281: パッド押下の起動タイミングを解決する。
 * - pending なし → 何もしない。
 * - sync 未接続 → 即時切替（クオンタイズなし）。
 * - sync 接続・エッジなし → アームのまま保持（パッドは点滅表示）。
 * - sync 接続・立ち上がりエッジ → アームを消費して切替。
 */
export function resolveLaunch(
  pending: number | null,
  syncConnected: boolean,
  syncEdge: boolean,
): LaunchResolution {
  if (pending === null) return { switchTo: null, armed: null };
  if (!syncConnected || syncEdge) return { switchTo: pending, armed: null };
  return { switchTo: null, armed: pending };
}
