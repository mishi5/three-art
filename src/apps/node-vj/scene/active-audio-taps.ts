// #198: アクティブシーンの音声タップ累積を防ぐヘルパ。
// アクティブシーンの AudioOutput は共有 gain（activeAudioMerge）へタップされる。アクティブシーンを
// 切り替えるとき、帳簿（connected Set）を clear するだけで物理 disconnect を怠ると、旧シーンの
// AudioOutput.gain が merge へ繋がったまま残り、出力シーンが旧アクティブを参照する構成で
// フィードバックループ（merge → SceneInput → AudioOutput.gain → merge）を作りフランジングが鳴る。
// 不変条件「論理的に忘れる ＝ 必ず物理 disconnect」を 1 箇所に閉じ込める。

/** connected の全ノードを merge から物理 disconnect し、Set を空にする（merge=null でも安全）。 */
export function resetActiveAudioTaps(connected: Set<AudioNode>, merge: AudioNode | null): void {
  if (merge) {
    for (const node of connected) {
      try { node.disconnect(merge); } catch { /* already disconnected */ }
    }
  }
  connected.clear();
}
