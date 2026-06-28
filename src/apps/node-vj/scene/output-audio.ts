// #198: 出力シーンの音声を別オーディオ出力デバイスへ発音するための純関数。
// ランタイムの配線判断（どのシーンの集約音声を別 dest へ流すか）と、デバイス選択 UI 用の
// 一覧整形を切り出してテスト可能にする。

/**
 * 別オーディオ出力デバイス（プログラム）へ発音すべきシーン id を返す（無ければ null）。
 * ポリシー: 出力中なら常に出力シーンを出力デバイスへ。
 * - outputActive=false（出力していない）→ null
 * - outputActive=true → 出力シーン id（effectiveOutputId）を返す。
 *   編集中シーンと一致（出力シーンをエディタ表示中／追従）していても出力デバイスから発音する。
 *   編集音（モニター）は monitorBus 経由で別系統へ流れるため、二重発音はモニター/出力を別デバイスに
 *   分けることで解消する（同一デバイスを選んだ場合のみ重複しうる＝ユーザー運用で回避）。
 */
export function outputAudioSourceId(opts: {
  outputActive: boolean;
  effectiveOutputId: string;
  /** 互換のため受け取るが未使用（出力中は編集中シーンと一致しても出力デバイスへ発音する）。 */
  activeSceneId?: string;
}): string | null {
  const { outputActive, effectiveOutputId } = opts;
  if (!outputActive) return null;
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
