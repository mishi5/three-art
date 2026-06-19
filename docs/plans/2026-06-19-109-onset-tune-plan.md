# #109 onset 発火チューニング（平滑化・しきい値 param 化）

対象 Issue: https://github.com/mishi5/three-art/issues/109

親 Epic: #56 / 関連: #107（onset 修正）, #100（AudioInput 分割）, #110/#111/#112（trigger 消費ノード）

## 背景
node-vj の audio ノードは onset 判定に**生 bass**＋**固定しきい値 0.12 / cooldown 0.12** を渡しており、
ビートでもほとんど発火しない。pose-particles は **EMA 平滑化 bass ＋可変 onsetThreshold/onsetCooldown**
で同じ `OnsetDetector`（delta>threshold 方式）を使っている。

## 方針（pose-particles 先例に倣う・node-vj 内に閉じる）
1. `OnsetTracker` に bass の**軽い EMA 平滑化**を入れる（単発スパイク誤検出を抑える。初回は prime して
   起動直後の誤発火を防止）。
2. `onsetThreshold` / `onsetCooldown` を **audio ノードの param 化**（`ONSET_PARAMS` を 3 ノードで共有）。
   既定しきい値を 0.12→**0.06** に下げて素の感度を上げる。
3. 共有 `OnsetDetector`（pose-particles と共用）は**変更しない**。

## 変更
- `audio-feature-logic.ts`:
  - `OnsetTracker.detect(bass, t, threshold, cooldown)` に変更。内部で EMA 平滑化（follow 0.5）後 OnsetDetector へ。
  - `DEFAULT_ONSET_THRESHOLD=0.06` / `DEFAULT_ONSET_COOLDOWN=0.12` / `ONSET_PARAMS: ParamDef[]` を export。
  - `LiveAudioRuntime.detectOnset(bass, t, threshold, cooldown)`。
- `MicInputNode` / `DisplayAudioInputNode` / `AudioFileInputNode`:
  - `params: [...ONSET_PARAMS]`。evaluate で `ctx.param("onsetThreshold"/"onsetCooldown")` を detectOnset へ渡す。
  - AudioFileInputRuntime.detectOnset も同シグネチャに。

## TDD（合成 bass 系列・純粋）
- prime 後の無音/定常では発火しない（起動直後の誤発火なし）。
- bass ステップ上昇で発火する。cooldown 内の連続ステップは 1 回だけ。
- しきい値ゲート: 小さいステップは既定 0.06 で不発、しきい値を下げると発火。
- ノード: `ONSET_PARAMS`（onsetThreshold/onsetCooldown）を 3 ノードが持つ。

## 確認
- 自動テストは合成系列。実音（マイク/ファイル）での発火は手動確認（onset→Flash 等で目視）。
