// #240: AudioNode タップ（分岐接続）の差分管理。
// SceneInput が参照先シーンの集約音声（merge gain）を自分の解析 analyser へタップするとき、
// タップ元の同一性は変わり得る（sceneId 変更 / sceneRes 破棄→再生成 / アクティブ切替 #174 /
// 参照先消滅で null）。毎フレーム connect せず「前回接続ノードと比較し、変化時のみ
// disconnect→connect」で追従する（runtime.updateOutputAudioRouting #198 と同じパターン）。
// 不変条件（#198）: 論理的に忘れる（差し替え・dispose）＝ 必ず物理 disconnect。

/** target（解析 analyser 等）への入力タップを 1 本だけ差分管理する。 */
export class AudioNodeTap {
  private connected: AudioNode | null = null;

  constructor(private readonly target: AudioNode) {}

  /** 現在タップ中のソース（未接続は null）。 */
  get current(): AudioNode | null {
    return this.connected;
  }

  /** タップ元を src へ追従させる。同一なら何もしない。旧接続は物理 disconnect する。 */
  update(src: AudioNode | null): void {
    if (src === this.connected) return;
    if (this.connected) {
      try { this.connected.disconnect(this.target); } catch { /* already disconnected（merge 破棄済み等） */ }
    }
    if (src) {
      try { src.connect(this.target); } catch { /* ignore */ }
    }
    this.connected = src;
  }

  /** タップを解除する（state dispose 時に必ず呼ぶ）。 */
  dispose(): void {
    this.update(null);
  }
}
