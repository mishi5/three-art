# EdgeOverlay anchor の低分散順列化 (Issue #48)

対象 Issue: https://github.com/mishi5/three-art/issues/48

## 背景

`EdgeOverlay` は 256 個の anchor slot を constructor で確定し、実行時は先頭 `anchorCount` 個だけを使う。anchor index が空間位置と相関しているため、anchorCount が小さいと図形上部に edge が集中する。

- **sphere**: Fibonacci 球を `i / (MAX_ANCHORS-1)` でパラメータ化 → 先頭 N 個は北極 (y≈1) に集中
- **bones**: `anchorJoint[i] = i % NUM_JOINTS (=13)` → anchorCount < 13 で先頭ジョイント (頭/上半身) のみ
- **cube**: anchor 毎に独立な uniform 乱数を 4 つ持つだけなので問題なし (触らない)

## 方針: 案 B (bit-reversal 順列)

Issue 本文で示した案 B を採用。

256 = 2^8 なので 8 bit reversal で `perm: [0,256) → [0,256)` を作る。連続する `i=0..N-1` に対し `perm(i)` は [0, 256) を均等にカバー (Van der Corput 列の基数 2 版)。

constructor 内で `i` ベースで anchor 位置を決めていた箇所を `perm(i)` に差し替える:

- **sphere の Fibonacci** (L144-150): `y = 1 - (perm(i)/(N-1))*2`, `theta = PHI * perm(i)` で計算
- **bones の joint 割当て** (L131): `anchorJoint[i] = perm(i) % NUM_JOINTS`

`anchorPolyR` (cube), `anchorBonesOffset` (gaussian), `anchorSpikeFreq/Phase`, `anchorIsOutlier` は anchor index と空間位置が相関していないため触らない (= 既存挙動を保つ)。

### 案 A (実行時再サンプリング) を採らない理由

- anchorCount スライダーを動かすと anchor 集合が完全に入れ替わり、edge 接続も総入れ替えになる → 連続性が損なわれる
- kNN 再構築が無条件で走るのでコストも増える

案 B では、anchorCount を N→N+1 と増やしたとき、既存 N 個の anchor 位置は不変で、新規 1 個が追加されるだけ。

### bit-reversal の検証

- `perm` は bijection なので、anchorCount = 256 (MAX) の場合は元と同じ集合 (順序のみ違う)
- 先頭 4 個: `perm(0..3) = {0, 128, 64, 192}` → sphere の y は `{1, -0.004, 0.498, -0.506}` で両極＋赤道付近をカバー
- 先頭 13 個 (= NUM_JOINTS): 大半の joint をカバー (完全網羅ではないが、現状の "0..3 だけ" よりは大幅改善)

## 実装変更

`src/pose-particles/visuals/EdgeOverlay.ts`:

1. ファイル内ヘルパー `bitReverse8(i: number): number` を追加 (MAX_ANCHORS=256 専用)
2. constructor の loop 内で:
   - `const p = bitReverse8(i);` を取得
   - `anchorJoint[i] = p % NUM_JOINTS;` (bones)
   - Fibonacci の `i` を `p` に差し替え (sphere)

その他 (cube/offset/spike) は変更なし。

## テスト (TDD)

`src/pose-particles/visuals/EdgeOverlay.test.ts` に新規 describe を追加:

1. **sphere モード**: `anchorCount=4` で `getAnchorPosition(0..3)` の y 座標を集めると、max-min が 1.0 を超えること (現状: 全部 y≈1 付近で max-min ≈ 0.02)
2. **bones モード**: `anchorCount=4` で `anchorJoint` 相当の joint 集合 (= anchor が追従する joint) が単純な `{0,1,2,3}` ではないこと
   - 直接 anchorJoint を読めないので、joint pose を変えて anchor が動くかでチェック
3. **permutation 性**: `MAX_ANCHORS=256` 全 anchor の sphere y 集合が、現状実装の y 集合と同じ multiset であること (順序は違っても全体としては同じ点群)
4. **cube モード regression**: 既存挙動 (uniform 分布) が保たれること — `anchorCount=4` で 4 点が同一面に集まらないこと程度の sanity check
5. **bitReverse8 unit test**: `0→0, 1→128, 2→64, 3→192, 255→255` 等の既知値、および `[0..256)` を bijection でマップすること

## 影響範囲

- EdgeOverlay 既存テスト (twist 等) は `anchorPosition(1)` を読んでいる箇所がある。順列化で `anchor 1` の位置は変わるが、各テストは「twist OFF と ON での差分」「時刻 t での値の安定性」のような相対比較なので影響なし。実行して通れば OK。
- PointCloud (GLSL 側) はこの変更とは独立 (EdgeOverlay 専用の anchor)。影響なし。
- ランダマイズ・UI: anchorCount スライダーの range は変えない。

## 手順

1. テスト追加 (赤になることを確認)
2. `bitReverse8` 追加 + constructor 差し替え
3. 全テスト pass
4. commit / push / PR
