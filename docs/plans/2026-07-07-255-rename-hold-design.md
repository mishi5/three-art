# #255 シーン名のダブルクリック編集が自動保存の再描画で中断される — 設計

Issue: https://github.com/mishi5/three-art/issues/255

## 問題

`main.ts` の 5 秒ごと自動保存 `snapshotActiveScene()` → `sceneManager.updateActiveGraph()` →
`commit()` が onChange を発火し、シーンパネル（`scene/scene-panel.ts`）の
`onChange(() => render())` がリスト全体を作り直すため、ダブルクリックで表示中の
リネーム用 `<input>` が破壊される。編集が 5 秒周期に当たると即座に通常表示へ戻る。

## 方針（保存と UI 再描画の分離のみ。自動保存の周期・onChange の発火自体は変えない）

- シーンパネルに「編集中」フラグを持たせ、編集中に来た再描画要求は実行せず
  dirty フラグだけ立てて保留する。
- 編集終了（Enter 確定 / Escape キャンセル / blur 確定）でフラグを下ろし、
  保留していた render を flush する。rename 自体が onChange を出すので通常は
  自然に再描画されるが、キャンセル時・保留分の反映漏れがないようにする。

## 保留ロジック（純粋な状態機械として切り出しテスト）

`scene-panel.ts` に `createRenderHold(render)` を export する。

```ts
interface RenderHold {
  beginEdit(): void;        // 編集開始。以後 request() は保留
  endEdit(): void;          // 編集終了。保留があれば render を 1 回 flush
  request(): void;          // 再描画要求。編集中なら dirty を立てるだけ
  editing(): boolean;       // 編集中か（shouldDeferRender 相当の判定）
}
```

状態は `editing` / `dirty` の 2 bit のみ。

| 状態 | request() | endEdit() |
| --- | --- | --- |
| 非編集中 | 即 render | 何もしない |
| 編集中・dirty=false | dirty=true | render しない |
| 編集中・dirty=true | （据え置き） | render を 1 回実行し dirty クリア |

## 組み込み（mountScenePanel）

- `actions.onChange(() => render())` → `actions.onChange(() => hold.request())`。
- dblclick で input を出すとき `hold.beginEdit()`。
- 編集終了は Enter（確定）/ Escape（キャンセル）/ blur（確定）の 3 経路を
  `finish(apply)` に一本化し、`finished` フラグで一度だけ実行する
  （render で input が外れた際の blur による二重 rename / 二重 render を防ぐ）。
  - `finish` は `hold.endEdit()`（保留 flush）→ 確定なら `actions.rename()`
    （onChange 経由で再描画）、キャンセル・空文字なら `render()` で表示復元。

## テスト（scene-panel.test.ts / happy-dom）

- `createRenderHold` の状態遷移（上表）。
- DOM: 編集中に onChange（自動保存相当）が来ても input が生き残り値も保持される。
- DOM: 編集終了後（Escape キャンセル時）に保留していた render が走り最新状態が反映される。
- DOM: Enter / blur で rename が呼ばれる。Escape では呼ばれない。
