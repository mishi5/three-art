# #110 Envelope ノード（trigger→減衰 number）

対象 Issue: https://github.com/mishi5/three-art/issues/110

親 Epic: #56 / 関連: #107（onset 修正）, #109（onset チューニング）

## 目的
`onset` 等の trigger を受け、発火の瞬間に立ち上がって時間で減衰する number を出力する process ノード。
これ 1 つで「ビート → 任意の number param」が成立する（trigger 消費ノードの最初の 1 つ）。

## 仕様
- 入力: `trigger`（trigger 型。本ノードが trigger 入力を持つ最初のノード）。
- params: `attack`（秒, 既定 0.01）/ `release`（秒, 既定 0.3）。#74 により数値 param は自動で入力ポート化。
- 出力: `number`（0..1）。
- 挙動（AD エンベロープ, `ctx.timeSec` ベース）:
  - trigger の**立ち上がりエッジ**（false→true）で `triggerTime = t`（再トリガー＝リセット）。
  - `elapsed = t - triggerTime`。`attack` で 0→1 ランプ、その後 `release` で 1→0 減衰、以降 0。
  - onset は 1 フレームパルスだが、複数フレーム true の trigger 源でも誤再発火しないようエッジ検出する。

## 純関数
`envelopeValue(elapsed, attack, release): number`
- elapsed<0 → 0
- attack>0 かつ elapsed<attack → elapsed/attack
- d=elapsed-attack; d<release → release>0 ? 1-d/release : 0
- それ以外 → 0
（attack=0 は即 1 から release、attack=release=0 は 0）

## 状態
`EnvelopeRuntime { triggerTime=-Infinity; prevTrigger=false }`（createState）。

## TDD
- `envelopeValue`: 発火直後 1 付近 / attack 中の線形 / release 中の線形減衰 / 終了後 0 / elapsed<0 で 0 / attack=0。
- ノード定義: type=Envelope, category=process, input `trigger`(trigger), output `number`, params attack/release。
- evaluate のフレーム駆動: 発火で立ち上がり→減衰→0、再トリガーでリセット、立ち上がりエッジのみ発火。
- trigger 型が消費される最初のノードである確認（isCompatible は既存のまま）。

## 影響
- 既存ノード・型に変更なし（trigger 型・isCompatible は #101 以前から定義済み）。registry の process 群へ登録。
