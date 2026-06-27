// #198: 出力シーンの音声を別オーディオ出力デバイスへ発音するための純関数。
// ランタイムの配線判断（どのシーンの集約音声を別 dest へ流すか）と、デバイス選択 UI 用の
// 一覧整形を切り出してテスト可能にする。

/**
 * 別オーディオ出力デバイスへ分離発音すべきシーン id を返す（無ければ null）。
 * ポリシー: ピン時のみ分離。
 * - outputActive=false（出力していない）→ null
 * - effectiveOutputId === activeSceneId（編集に追従）→ null
 *   （追従中は編集シーンの音が既定デバイスで鳴っているため二重発音を避ける）
 * - それ以外（ピン中＝出力が編集と別シーン）→ そのシーン id を分離発音する
 */
export function outputAudioSourceId(opts: {
  outputActive: boolean;
  effectiveOutputId: string;
  activeSceneId: string;
}): string | null {
  const { outputActive, effectiveOutputId, activeSceneId } = opts;
  if (!outputActive) return null;
  if (effectiveOutputId === activeSceneId) return null;
  return effectiveOutputId;
}

export interface AudioOutputOption {
  deviceId: string;
  label: string;
}

/**
 * enumerateDevices() の結果から audiooutput のみを抽出し、デバイス選択 UI 用の一覧に整形する。
 * マイク権限が無いと label が空になるため、deviceId=default は「システム既定」、それ以外の
 * 空ラベルは連番（「音声出力 N」）でフォールバック名を振る。
 */
export function audioOutputOptions(devices: MediaDeviceInfo[]): AudioOutputOption[] {
  let fallbackN = 0;
  return devices
    .filter((d) => d.kind === "audiooutput")
    .map((d) => {
      if (d.label) return { deviceId: d.deviceId, label: d.label };
      if (d.deviceId === "default") return { deviceId: d.deviceId, label: "システム既定" };
      fallbackN += 1;
      return { deviceId: d.deviceId, label: `音声出力 ${fallbackN}` };
    });
}
