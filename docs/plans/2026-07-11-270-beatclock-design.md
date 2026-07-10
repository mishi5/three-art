# #270 BeatClock（BPM ビートクロック）設計

対象 Issue: https://github.com/mishi5/three-art/issues/270

## 概要

BPM ベースのビートクロックノード `BeatClock` を新設し、既存 LFO 系ノード（Sine/Noise/Pulse）に
`sync` トリガ入力を追加する。映像側のトリガ/LFO を音楽のテンポ（拍）に同期させるための基盤。

- **BPM ソースは 3 系統**: 手動 `bpm` param／タップテンポ（ノード上の TAP ボタン＋ `tap` トリガ入力）／
  `onset` トリガ入力からの自動 BPM 推定。
- **出力**: `bpm`・`beats`（累積拍数）・`phase`（拍内位相 0..1）の number、`beat`（毎拍）・
  `div`（`division` param で選ぶ分周 1/4〜8 拍）の trigger。
- TapSequencer は #278 で追加済みの `reset` が sync 相当のため**変更しない**。

## BPM 推定アルゴリズム（beat-clock-logic.ts・純関数）

タップ/onset の時刻列 → `recentIntervals` → BPM 推定のパイプライン。**推定器はソース別に 2 つ**:
onset は `estimateBpm`（fold ＋ 中央値）、タップは `estimateBpmFromTaps`（fold なし・生の中央値）。

1. `recentIntervals(timesSec, gapResetSec=2.5)`: 隣接間隔列に変換。2.5s を超えるギャップで
   それ以前を捨てる（曲間の無音・タップのやり直しでバッファが汚れないように）。
2. `foldIntervalToBpmRange(intervalSec)`: 各間隔を ×2/÷2 で折り込み、倍テン/半テンの onset
   （8分打ち・2拍毎など）を同じテンポとして扱う。妥当域（`BPM_MIN=50`〜`BPM_MAX=250`）から
   1 オクターブ超離れた間隔（チャタリング・無音区間）は null で棄却。
3. `estimateBpm(intervals, minCount=3)`（onset 用）: fold 後の有効間隔が 3 未満なら null。
   中央値 → 60/median。中央値ベースなので単発の外れ値に頑健。
4. `estimateBpmFromTaps(intervals, minCount=3)`（タップ用）: fold せず生の間隔の中央値 →
   60/median。`TAP_BPM_MIN=30`〜`TAP_BPM_MAX=300`（bpm param の可動域）の外の間隔だけ棄却。

### fold の正規化帯（設計判断・onset のみ）

妥当域 50..250 は幅がオクターブ超（比 5 倍）あり、×2/÷2 の折り込み先として一意に定まらない
（例: 0.25s 間隔は 240BPM とも 120BPM とも読める）。そこで妥当域の幾何中心
√(50·250)≈111.8 を中心とする 1 オクターブ [≈79.1, ≈158.1) を代表帯とし、そこへ正規化する。
これで「8分打ち 0.25s → 120」「2拍毎 1.0s → 120」が成立する。トレードオフとして onset 推定の
BPM はこの帯に丸まる（例: 実テンポ 174 の曲は 87 と推定される）が、倍/半の関係なので拍位相の
同期用途では実害がない。

**タップには fold を適用しない**: タップは「ユーザが拍そのものを叩いた」明示入力で倍テン/半テンの
曖昧さがなく、fold すると帯外のテンポ（例: 174BPM）が半分に推定されてしまう。生の中央値をそのまま
採用し、帯外テンポもタップでそのまま指定できる（可動域 30〜300 は bpm param と同じ）。

## tap と onset の役割分担

- **tap（TAP ボタン / tap 入力）**: テンポ推定に加えて「タップ＝拍頭」として `beats` を最も近い
  整数拍へスナップ（phase を 0 に揃える）。スナップ時は分周判定の区間始端（prevBeats）も同じだけ
  動かし、スナップで判定区間が伸びることによる div の誤発火を防ぐ。
- **onset**: テンポのみ追従し **phase はいじらない**（onset は間隔が揺れるため位相まで合わせると
  ガタつく。拍頭はタップで合わせる運用）。推定値は係数 0.2 の指数平滑を掛けてから反映する。

推定 BPM は `ctx.node.params.bpm` へ 0.1 刻みで書き戻す（Automation の onCommit と同じ流儀＝
history 非経由）。スライダー表示にも反映され、YAML 永続化にも乗る。`bpm` は noInput を付けない
通常の number param なので、接続も手動ドラッグも可能。

## 分周トリガ（crossedDivision）

累積 `beats` の半開区間 `(prevBeats, curBeats]` が `divBeats` の倍数境界を跨いだかを
`floor(cur/div) > floor(prev/div)` で判定。半開区間なので連続フレームで二重発火せず、
コマ落ち（大きい dt）でも 1 回にまとまる。初回フレーム（dt=0）は cur<=prev で誤発火しない。

## 既存ノードの sync 入力の意味

| ノード | sync 受信時の挙動 |
| --- | --- |
| Sine | 位相 0（sin の立ち上がり）から再開（t0=実効 t を記録し、以後 t-t0 で発振） |
| Noise | noise3D の走査位置が原点（t=0 相当）に戻る |
| Pulse | そのフレームに即発火し、lastFire をリセット（拍頭アンカーの interval 周期になる） |
| TapSequencer | 変更なし（#278 の reset が同じ役割） |

### 後方互換の担保

Sine/Noise は従来ステートレスだったが、`{ t0, prevSync }` を持つ小さな Runtime を追加した。
**t0 初期値 0 なので sync 未接続時の出力式は従来と完全に同一**（既存テストは期待値変更なしで
パス）。state 未生成（旧テストなど）でも sync を無視して従来出力になる。Pulse も sync エッジが
来ない限り従来どおり。

## UI（NodeEditor）

- `node-type.ts` に `beatClock` フラグ（tapSequencer/automation と同じ目印方式）。
- `layout.ts`: `hasBeatClockRow`／`beatClockRowRect`（params 直下・1 行）／
  `beatClockRowLayout`（TAP ボタン幅 54＋ステータス）／`beatClockStatusLabel`（"120.0 BPM"）。
- `NodeEditor.ts`: TAP ボタンのヒットテスト → `onBeatClockTap`、描画はステータス行に
  ビートインジケータ（`phase < 0.2` のフレームだけ明るい ● ）＋ BPM 表示。タップ受付中
  （直近タップから 2.5s 以内）は枠と文字色を明るくする。
- `main.ts`: `runtime.getState(id)` への duck-type 配線（`tapNow()`/`status()`）。

## テスト

- `beat-clock-logic.test.ts`: fold（基準/8分/2拍/16分/境界/棄却）・estimateBpm（ジッタ・外れ値・
  minCount）・recentIntervals（ギャップリセット・防御）・crossedDivision（境界ちょうど・複数跨ぎ・
  初回フレーム）・divisionToBeats。
- `BeatClockNode.test.ts`: 定義・beats/phase 進行・beat/div 発火数・コマ落ち・タップテンポ
  （commit・位相スナップ・div 誤発火防止・エッジ検出・やり直し）・onset（テンポ追従・位相不変・
  指数平滑）・status・evaluate 統合（params.bpm 書き戻し 0.1 刻み）。
- `process-nodes.test.ts`／`param-generator.test.ts`: Sine/Noise/Pulse の sync（エッジ検出・
  押しっぱなし・未接続時の後方互換）。
- `layout.test.ts`: BeatClock 行の高さ・矩形・2 分割レイアウト・ステータスラベル。
