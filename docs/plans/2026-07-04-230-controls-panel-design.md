# #230 下部コントロールバーの整理: サイドドック「コントロール」パネルへ移設

Issue: https://github.com/mishi5/three-art/issues/230

## 目的

下部に固定表示していた 2 本のバー（左: 入力/出力/録画/音声デバイス、右: グラフ保存/読込・
プロジェクト保存/読込）はコントロールが増えて横に並びきらなくなった。
全コントロールを既存サイドドック（`editor/side-dock.ts`）の新パネル
**「コントロール」** へ移設し、下部バー自体を撤去する。縦配置なので幅の問題は解消する。

## 方針

- **DOM の移設のみ**。各ボタン/セレクトのハンドラ・ロジック（録画トグル、デバイス列挙、
  preset 一覧の再構築等）は従来のまま変えない。要素の参照（`syncRecBtn` 等）も
  同じ要素を指し続けるため動的更新は壊れない。
- パネルの mount は `buildSideDock` 起動時に 1 度だけ呼ばれる（非表示でも DOM は生成済み）
  ため、録画中トグルの表示更新・devicechange での select 再構築は従来どおり動く。
- 入力開始/録画などの user gesture 必須操作は、パネル内ボタンのクリックで従来どおり満たせる。

## 構成

### 1. `editor/controls-panel.ts`（新規）

- `ControlsSection { title, mount(host) }` — セクション見出し + 内容の構築は呼び出し側。
- `controlsPanelDef(sections): SidePanelDef` — id `controls`・タイトル「コントロール」・
  スライダー（ミキサー）風 SVG アイコン。セクションを縦に並べる
  （見出しスタイルは settings-panel に合わせる）。
- テスト: `controls-panel.test.ts`（happy-dom）— def のメタ、見出しの順序、
  各セクション mount がパネル内の host で 1 回ずつ呼ばれること。

### 2. `editor/graph-io-bar.ts` → `editor/graph-io-controls.ts`（改名・縦積み化）

固定バー生成をやめ、host（パネルのセクション）へ構築する 2 関数に分割する。
ハンドラ（`applyYaml`・`syncList`・toast・DL 処理）は従来のまま。

- `mountGraphPresetControls(host, graph, registry, store, history, onLoad?)`
  — preset 名 input / [保存][削除] / 読込 select / [YAML書出][YAML読込]。
  input・select は `width:100%`、ボタン行は flex 等幅でパネル幅に収める。
- `mountProjectControls(host, project: ProjectIoHooks)` — [Proj保存][Proj開く]。

### 3. `main.ts`（変更）

- 下部左バー（`bar` div・`position:fixed;left:8px;bottom:8px`）を撤去し、
  中身を mount 関数へ移す:
  - `mountInputControls(host)` — ▶ 入力開始 (mic/camera) / ■ 入力停止 (camera)
  - `mountOutputControls(host)` — 🖥 出力ウィンドウ / ● 録画 /
    🎧 モニター音声 select / 🔈 出力音声 select（隠し `<audio>` 2 本は従来どおり body 直下）
- `buildGraphIoBar(...)` 呼び出しを撤去し、`GraphStore`・`ProjectIoHooks` を
  コントロールパネルのセクション mount へ渡す。
- `buildSideDock` のパネル並びは
  **アセット / シーン / クリップボード / コントロール / 設定**。
  コントロールパネルのセクションは **入力 / 出力・録画 / シーン / プロジェクト**。

### 4. 下部バー前提レイアウトの追随

- `side-dock.ts`: `BOTTOM = 48`（下部バーの上に載せる） → `0`（最下端まで）。
- PiP プレビューの `bottom: 56px`（バーの上） → `12px`（`right: 12px` と対称）。
  `node-vj.html` の初期スタイルと `main.ts` `applyPreviewSize()` の小窓復帰の両方。
- 全画面プレビュー（#136）は画面全体を占有する既存動作のまま（変更なし）。

## テスト

- 新規: `editor/controls-panel.test.ts`（DOM・happy-dom）。
- 既存テストは変更なしで全件パスを維持（graph-io-bar にテストは無い）。
- ボタン配線・録画・デバイス列挙は従来コードの移設のため手動 / Playwright 確認。
