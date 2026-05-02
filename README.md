# Pose × Audio Particles

体の動き（Webcam ポーズ検出）と音楽（ファイル / マイク）に反応するモノクロームの 3D 点群作品。

## 要件

- Bun 1.2+
- WebGL 対応のモダンブラウザ（Chrome / Safari / Firefox の最新版）
- Webcam とマイク（任意）

## 起動

```bash
bun install
bun --hot ./pose-particles.html
```

ブラウザで表示された URL を開き、「開始」ボタンを押してカメラ権限を許可する。

## 操作

- 右上のパネルで音源を切り替え
  - **ファイル**：ローカルの mp3 / m4a などを選択
  - **マイク**：マイク入力をそのまま解析

## ビルド

```bash
bun build ./pose-particles.html --outdir dist --minify
```

## テスト

```bash
bun test
```

## 設計

設計仕様：[docs/superpowers/specs/2026-04-29-pose-audio-particle-art-design.md](docs/superpowers/specs/2026-04-29-pose-audio-particle-art-design.md)
