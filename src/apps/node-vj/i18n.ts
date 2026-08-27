// #244: 軽量 i18n モジュール（外部ライブラリなし）。
// UI クローム文言のカタログ { key: { ja, en } } と t(key, vars) ヘルパ。
// - 既定言語は ja（既存ユーザの見た目を変えない）。en 未翻訳は ja へフォールバック。
// - 未知キーはキー名をそのまま返す（表示が壊れない）。
// - 現在言語はモジュール内状態。main.ts 起動時（UI 構築前）に prefs から setLang する。
// - #254: ノード定義文言（description 等）は i18n-nodes.ts の NODE_CATALOG に分離し、
//   ここで merge して t() / resolveNodeText() から引く（i18n-nodes は型のみ逆参照＝循環なし）。
// 注意: モジュールロード時に評価される定数へ t() の結果を焼き込まないこと
// （setLang より先に評価され en にならない）。カタログキーを保持し、使用時に t() で解決する。

import { NODE_CATALOG } from "./i18n-nodes";

/** 対応言語。 */
export type Lang = "ja" | "en";

/** カタログ 1 項目。en を省略すると ja へフォールバックする。 */
export interface CatalogEntry {
  ja: string;
  en?: string;
}

/** カタログ（translate の純関数テスト用に任意のカタログを受けられる形）。 */
export type Catalog = Record<string, CatalogEntry>;

/** UI クローム文言カタログ。キーは「領域.名前」で揃える。 */
export const CATALOG = {
  // --- ツールバー（NodeEditor.buildToolbar） ---
  "toolbar.outputValues": { ja: "出力値: {state}", en: "Output values: {state}" },
  "toolbar.help": { ja: "操作方法", en: "Controls & shortcuts" },

  // --- サイドドック（side-dock） ---
  "panel.assets": { ja: "アセット", en: "Assets" },
  "panel.scenes": { ja: "シーン", en: "Scenes" },
  "panel.clipboard": { ja: "クリップボード", en: "Clipboard" },
  "panel.nodeAdd": { ja: "ノード追加", en: "Add Node" },
  "panel.controls": { ja: "コントロール", en: "Controls" },
  "panel.settings": { ja: "設定", en: "Settings" },
  "dock.pin.on": { ja: "ピン留め中（外側クリックで閉じない）", en: "Pinned (stays open on outside click)" },
  "dock.pin.off": { ja: "ピン留め（外側クリックで閉じなくする）", en: "Pin (keep open on outside click)" },
  "dock.collapse": { ja: "パネルを閉じる", en: "Close panel" },

  // --- ヘルプポップアップ（help-content） ---
  "help.section.panSelect": { ja: "マウス（パン・選択）", en: "Mouse (pan & select)" },
  "help.section.nodeWire": { ja: "マウス（ノード・接続）", en: "Mouse (nodes & wires)" },
  "help.section.keyboard": { ja: "キーボード", en: "Keyboard" },
  "help.keys.dragEmpty": { ja: "空白を左ドラッグ", en: "Left-drag empty space" },
  "help.keys.shiftDrag": { ja: "Shift+左ドラッグ", en: "Shift+left-drag" },
  "help.keys.spaceDrag": { ja: "Space+左ドラッグ", en: "Space+left-drag" },
  "help.keys.midRightDrag": { ja: "中・右ドラッグ", en: "Middle/right drag" },
  "help.keys.wheelPinch": { ja: "ホイール / ピンチ", en: "Wheel / pinch" },
  "help.keys.clickEmpty": { ja: "空白を左クリック", en: "Left-click empty space" },
  "help.keys.rightClick": { ja: "右クリック", en: "Right-click" },
  "help.desc.pan": { ja: "パン（表示位置の移動）", en: "Pan (move the view)" },
  "help.desc.boxSelect": { ja: "矩形選択", en: "Box select" },
  "help.desc.panOverNode": { ja: "パン（ノード上でも可）", en: "Pan (also over nodes)" },
  "help.desc.zoom": { ja: "ズーム（カーソル中心）", en: "Zoom (centered on cursor)" },
  "help.desc.deselect": { ja: "選択解除", en: "Clear selection" },
  "help.desc.contextMenu": {
    ja: "コンテキストメニュー（空白: ノード・ラベル追加 / ノード上: 複製・削除・名前編集）",
    en: "Context menu (empty: add node/label; on node: duplicate, delete, rename)",
  },
  "help.keys.dragNode": { ja: "ノードを左ドラッグ", en: "Left-drag a node" },
  "help.desc.moveNode": { ja: "移動（グループ所属はグループごと移動）", en: "Move (grouped nodes move together)" },
  "help.keys.cmdClick": { ja: "Cmd/Ctrl+クリック", en: "Cmd/Ctrl+click" },
  "help.desc.toggleSelect": { ja: "選択に追加 / 除外", en: "Add to / remove from selection" },
  "help.keys.dragFromOutput": { ja: "出力ポートからドラッグ", en: "Drag from an output port" },
  "help.desc.connect": { ja: "接続（param 行へのドロップでも接続）", en: "Connect (dropping onto a param row also connects)" },
  "help.keys.clickConnectedInput": { ja: "接続済み入力ポートをクリック", en: "Click a connected input port" },
  "help.desc.disconnect": { ja: "切断（ドラッグで別ポートへ付け替え）", en: "Disconnect (drag to rewire to another port)" },
  "help.keys.dragParam": { ja: "param 行を左右ドラッグ", en: "Drag a param row left/right" },
  "help.desc.slider": { ja: "スライダ編集（クリックで数値入力）", en: "Slider edit (click to type a value)" },
  "help.keys.eyeIcon": { ja: "タイトル右端の 👁", en: "👁 at the right of the title" },
  "help.desc.nodePreview": { ja: "ノードプレビュー小窓の表示切替", en: "Toggle the node preview window" },
  "help.keys.clickPreview": { ja: "右下プレビューをクリック", en: "Click the bottom-right preview" },
  "help.desc.fullscreen": { ja: "全画面表示の切替（Esc で解除）", en: "Toggle fullscreen (Esc to exit)" },
  "help.keys.space": { ja: "Space（押しながらドラッグ）", en: "Space (hold + drag)" },
  "help.desc.panShort": { ja: "パン", en: "Pan" },
  "help.keys.undo": { ja: "Cmd+Z / Shift+Cmd+Z", en: "Cmd+Z / Shift+Cmd+Z" },
  "help.desc.undoRedo": { ja: "元に戻す / やり直し", en: "Undo / redo" },
  "help.keys.delete": { ja: "Delete / Backspace", en: "Delete / Backspace" },
  "help.desc.deleteSel": { ja: "選択ノード・ラベルを削除", en: "Delete selected nodes & labels" },
  "help.keys.copyPaste": { ja: "Cmd+C / Cmd+V", en: "Cmd+C / Cmd+V" },
  "help.desc.copyPaste": { ja: "コピー / マウス位置へ貼り付け", en: "Copy / paste at mouse position" },
  "help.keys.group": { ja: "Cmd+G / Shift+Cmd+G", en: "Cmd+G / Shift+Cmd+G" },
  "help.desc.group": { ja: "グループ化 / グループ解除", en: "Group / ungroup" },
  "help.keys.zero": { ja: "0", en: "0" },
  "help.desc.resetZoom": { ja: "ズームを 100% に戻す", en: "Reset zoom to 100%" },
  "help.keys.esc": { ja: "Esc", en: "Esc" },
  "help.desc.escClose": { ja: "プレビュー全画面・ポップアップを閉じる", en: "Close fullscreen preview & popups" },

  // --- 設定パネル（settings-panel） ---
  "settings.section.panSelect": { ja: "パン / 矩形選択の操作", en: "Pan / box-select controls" },
  "settings.panMode.modern": { ja: "標準", en: "Standard" },
  "settings.panMode.modern.desc": {
    ja: "空白ドラッグ＝パン / Shift+ドラッグ＝矩形選択",
    en: "Drag empty space = pan / Shift+drag = box select",
  },
  "settings.panMode.legacy": { ja: "クラシック", en: "Classic" },
  "settings.panMode.legacy.desc": {
    ja: "空白ドラッグ＝矩形選択 / パンは Space+ドラッグ・中/右ボタン",
    en: "Drag empty space = box select / pan with Space+drag or middle/right button",
  },
  "settings.hint": {
    ja: "切替は即時反映・再読込後も保持されます",
    en: "Changes apply immediately and persist across reloads",
  },
  "settings.section.aiBridge": { ja: "AI ブリッジ", en: "AI Bridge" },
  "settings.aiBridge.status.disabled": { ja: "無効", en: "Disabled" },
  "settings.aiBridge.status.connecting": { ja: "接続中…", en: "Connecting…" },
  "settings.aiBridge.status.connected": { ja: "接続済", en: "Connected" },
  "settings.aiBridge.status.retrying": { ja: "再接続待ち", en: "Reconnecting" },
  "settings.aiBridge.urlTitle": {
    ja: "中継サーバの URL（bun run relay で起動）",
    en: "Relay server URL (start with: bun run relay)",
  },
  "settings.aiBridge.desc": {
    ja: "外部の AI エージェントがローカル中継（bun run relay）経由でグラフを操作できます",
    en: "Lets external AI agents control the graph via a local relay (bun run relay)",
  },
  "settings.section.language": { ja: "言語 / Language", en: "言語 / Language" },
  "settings.lang.reloadNote": { ja: "切替時に再読み込みします", en: "Reloads on switch" },

  // --- シーンパネル（scene-panel） ---
  "scenes.add": { ja: "＋ シーン追加", en: "＋ Add scene" },
  "scenes.badge.output": { ja: "● 出力", en: "● Output" },
  "scenes.badge.outputFollow": { ja: "● 出力(追従)", en: "● Output (follow)" },
  "scenes.badge.followTitle": { ja: "出力は編集シーンに追従中", en: "Output follows the edited scene" },
  "scenes.badge.pinnedTitle": { ja: "このシーンを出力中", en: "This scene is being output" },
  "scenes.output.unpin": { ja: "出力ピンを解除（編集に追従）", en: "Unpin output (follow editing)" },
  "scenes.output.pin": { ja: "このシーンを出力する", en: "Output this scene" },
  "scenes.duplicate": { ja: "複製", en: "Duplicate" },
  "scenes.delete": { ja: "削除", en: "Delete" },
  "scenes.deleteLast": { ja: "最後の 1 シーンは削除できません", en: "The last scene cannot be deleted" },

  // --- アセットパネル（asset-panel） ---
  "assets.add": { ja: "＋ ファイル追加", en: "＋ Add files" },
  "assets.empty": { ja: "（アセットなし）ファイルを D&D / 追加", en: "(No assets) Drop files here or use Add" },
  "assets.usage": { ja: "使用量: {usage}", en: "Storage: {usage}" },
  "assets.delete": { ja: "削除", en: "Delete" },
  "assets.toast.unsupported": { ja: "未対応のファイル: {name}", en: "Unsupported file: {name}" },
  "assets.toast.quota": {
    ja: "ストレージ容量を超えました。不要なアセットを削除してください。",
    en: "Storage quota exceeded. Delete unused assets.",
  },
  "assets.toast.addFailed": { ja: "追加に失敗: {name}", en: "Failed to add: {name}" },
  // #259: 行左端の種別アイコンの tooltip
  "assets.kind.image": { ja: "画像", en: "Image" },
  "assets.kind.video": { ja: "動画", en: "Video" },
  "assets.kind.audio": { ja: "音声", en: "Audio" },

  // --- クリップボードパネル（clipboard-panel / node-clipboard） ---
  "clipboard.hint": {
    ja: "Cmd+C でコピー → クリックで選択 / Cmd+V or ドラッグで貼付",
    en: "Cmd+C to copy → click to select / paste with Cmd+V or drag",
  },
  "clipboard.empty": { ja: "（コピー履歴なし）ノードを選んで Cmd+C", en: "(No copy history) Select nodes and press Cmd+C" },
  "clipboard.rowTitle": { ja: "クリックで選択 / ドラッグでエディタへ貼付", en: "Click to select / drag into the editor to paste" },
  "clipboard.meta.nodes": { ja: "{n} ノード", en: "{n} nodes" },
  "clipboard.meta.connections": { ja: " ・ {n} 接続", en: " ・ {n} connections" },
  "clipboard.current": { ja: "● 現在", en: "● Current" },
  "clipboard.label.empty": { ja: "(空)", en: "(empty)" },
  "clipboard.label.more": { ja: "{types} 他 {n} 件", en: "{types} +{n} more" },

  // --- ノード追加パネルの互換フィルタ（#258 エッジドロップ） ---
  "nodeAdd.filter.badge": { ja: "{type} に接続可能", en: "Connectable to {type}" },
  "nodeAdd.filter.clear": { ja: "解除", en: "Show all" },
  "nodeAdd.filter.clearTitle": {
    ja: "フィルタを解除して全ノードを表示",
    en: "Clear the filter and show all nodes",
  },
  "nodeAdd.filter.empty": { ja: "(接続可能なノードなし)", en: "(no connectable nodes)" },
  // #256: ノード検索。
  "nodeAdd.search.placeholder": { ja: "ノードを検索…", en: "Search nodes…" },
  "nodeAdd.search.empty": { ja: "(該当するノードなし)", en: "(no matching nodes)" },

  // --- コントロールパネル（main.ts の各セクション） ---
  "controls.section.input": { ja: "入力", en: "Input" },
  "controls.section.output": { ja: "出力・録画", en: "Output & Recording" },
  "controls.section.scene": { ja: "シーン", en: "Scene" },
  "controls.section.project": { ja: "プロジェクト", en: "Project" },
  "controls.inputStart": { ja: "▶ 入力開始 (mic/camera)", en: "▶ Start inputs (mic/camera)" },
  "controls.inputStop": { ja: "■ 入力停止 (camera)", en: "■ Stop inputs (camera)" },
  "controls.outputWindow.open": { ja: "🖥 出力ウィンドウ", en: "🖥 Output window" },
  "controls.outputWindow.close": { ja: "🖥 出力ウィンドウを閉じる", en: "🖥 Close output window" },
  "controls.record": { ja: "● 録画", en: "● Record" },
  "controls.recordStop": { ja: "■ 停止（録画中）", en: "■ Stop (recording)" },
  "controls.outAudio.title": {
    ja: "出力シーン（ピン中）の音声を発音するデバイス",
    en: "Device that plays the output (pinned) scene audio",
  },
  "controls.monAudio.title": {
    ja: "編集中シーンの音声（モニター）を発音するデバイス",
    en: "Device that plays the edited scene (monitor) audio",
  },
  "controls.outAudio.none": { ja: "🔈 出力音声: 分離しない", en: "🔈 Output audio: not separated" },
  "controls.monAudio.none": { ja: "🎧 モニター音声: 既定デバイス", en: "🎧 Monitor audio: default device" },

  // --- グラフ preset / プロジェクト保存読込（graph-io-controls） ---
  "graphIo.presetName": { ja: "preset 名", en: "Preset name" },
  "graphIo.selectLoad": { ja: "(読込...)", en: "(Load...)" },
  "graphIo.selectNone": { ja: "(保存なし)", en: "(No presets)" },
  "graphIo.save": { ja: "保存", en: "Save" },
  "graphIo.delete": { ja: "削除", en: "Delete" },
  "graphIo.exportYaml": { ja: "YAML書出", en: "Export YAML" },
  "graphIo.importYaml": { ja: "YAML読込", en: "Import YAML" },
  "graphIo.toast.loaded": { ja: "{source}: 読込完了", en: "{source}: loaded" },
  "graphIo.toast.loadedWarn": { ja: "{source}: 読込（警告 {n} 件）", en: "{source}: loaded ({n} warnings)" },
  "graphIo.toast.loadFailed": { ja: "{source}: 読込失敗（{error}）", en: "{source}: load failed ({error})" },
  "graphIo.toast.saved": { ja: "保存しました: {name}", en: "Saved: {name}" },
  "graphIo.toast.saveFailed": { ja: "保存失敗（{error}）", en: "Save failed ({error})" },
  "graphIo.toast.notFound": { ja: "見つかりません: {name}", en: "Not found: {name}" },
  "graphIo.toast.selectDelete": { ja: "削除する preset を選択してください", en: "Select a preset to delete" },
  "graphIo.toast.deleted": { ja: "削除しました: {name}", en: "Deleted: {name}" },
  "error.unknown": { ja: "不明なエラー", en: "unknown error" },
  "error.unknownShort": { ja: "不明", en: "unknown" },
  "project.save": { ja: "Proj保存", en: "Save Proj" },
  "project.saveTitle": { ja: "全シーンを 1 ファイル（.yaml）に保存", en: "Save all scenes to a single .yaml file" },
  "project.open": { ja: "Proj開く", en: "Open Proj" },
  "project.openTitle": {
    ja: "プロジェクト（全シーン）を読み込み、現在の状態を置き換える",
    en: "Load a project (all scenes), replacing the current state",
  },
  "project.toast.saved": { ja: "プロジェクトを保存しました", en: "Project saved" },
  "project.toast.saveFailed": { ja: "プロジェクト保存失敗（{error}）", en: "Project save failed ({error})" },
  "project.toast.loadedWarn": {
    ja: "{source}: 読込（警告 {n} 件・詳細はコンソール [project-io]）",
    en: "{source}: loaded ({n} warnings; see console [project-io])",
  },

  // --- コンテキストメニュー（NodeEditor） ---
  "menu.label.add": { ja: "＋ ラベル追加", en: "＋ Add label" },
  "menu.label.edit": { ja: "ラベル編集", en: "Edit label" },
  "menu.label.delete": { ja: "ラベル削除", en: "Delete label" },
  "menu.node.add": { ja: "ノードを追加", en: "Add node" },
  "menu.duplicate": { ja: "複製", en: "Duplicate" },
  "menu.duplicateN": { ja: "複製 ({n})", en: "Duplicate ({n})" },
  "menu.delete": { ja: "削除", en: "Delete" },
  "menu.deleteN": { ja: "削除 ({n})", en: "Delete ({n})" },
  "menu.nodeName.edit": { ja: "ノード名を編集", en: "Edit node name" },
  "menu.nodeName.set": { ja: "ノード名を設定", en: "Set node name" },
  "menu.groupName.edit": { ja: "グループ名編集", en: "Edit group name" },
  "menu.scene.select": { ja: "シーンを選択", en: "Select scene" },
  "menu.scene.none": { ja: "(選べるシーンなし)", en: "(no scenes available)" },

  // --- パッド（pad-overlay / NodeEditor のパッドメニュー） ---
  "pad.close": { ja: "✕ 閉じる (Esc)", en: "✕ Close (Esc)" },
  "pad.hint": {
    ja: "クリック=発音 / 右クリック=操作メニュー（割当・停止・再割当・解除）",
    en: "Click = play / right-click = actions (assign, stop, reassign, clear)",
  },
  "pad.cell.filledTitle": {
    ja: "クリックで発音 / 右クリックで操作（停止・再割当・解除）",
    en: "Click to play / right-click for actions (stop, reassign, clear)",
  },
  "pad.cell.emptyTitle": { ja: "右クリックで音声を割り当て", en: "Right-click to assign a sound" },
  "pad.menu.stopVoice": { ja: "■ このパッドを停止", en: "■ Stop this pad" },
  "pad.menu.reassign": { ja: "↻ 音声を再割り当て", en: "↻ Reassign sound" },
  "pad.menu.unassign": { ja: "✕ 割り当てを解除", en: "✕ Clear assignment" },
  "pad.menu.assign": { ja: "＋ 音声を割り当て", en: "＋ Assign sound" },

  // --- canvas 描画のノード内文言（layout / NodeEditor） ---
  "node.file.none": { ja: "ファイル未選択", en: "No file selected" },
  "node.scene.none": { ja: "(シーン未選択)", en: "(no scene selected)" },
  "node.scene.unknown": { ja: "(不明なシーン)", en: "(unknown scene)" },
  "node.tap.none": { ja: "記録なし", en: "No recording" },
  "node.tap.recording": { ja: "録音中 {n}打 {sec}s", en: "Recording {n} taps {sec}s" },
  "node.tap.playing": { ja: "{n}打 / {len}s ループ ▶{pos}s", en: "{n} taps / {len}s loop ▶{pos}s" },
  // #278: 停止/再生トグルで停止中（playhead 凍結）のステータス表示。playing とほぼ同内容に
  // 「■ 停止中」の接頭辞と ⏸（一時停止マーク）を付ける。
  "node.tap.stopped": { ja: "■ 停止中 {n}打 / {len}s ⏸{pos}s", en: "■ Stopped {n} taps / {len}s ⏸{pos}s" },
  "node.tap.clearBtn": { ja: "✕ クリア", en: "✕ Clear" },
  // #278: 停止/再生トグルボタン（playing 中は ⏸=停止、stopped 中は ▶=再開）。
  "node.tap.pauseBtn": { ja: "⏸", en: "⏸" },
  "node.tap.resumeBtn": { ja: "▶", en: "▶" },
  // #186: Automation（選択中に物理キー 'r' をホールドして記録）のステータス行/クリアボタン。
  "node.automation.none": { ja: "記録なし", en: "No recording" },
  "node.automation.recording": { ja: "録音中 {n}点 {sec}s", en: "Recording {n} pts {sec}s" },
  "node.automation.playing": { ja: "{len}s ループ ▶{pos}s", en: "{len}s loop ▶{pos}s" },
  // #278: 停止/再生トグルで停止中（playhead 凍結）のステータス表示。
  "node.automation.stopped": { ja: "■ 停止中 {len}s ⏸{pos}s", en: "■ Stopped {len}s ⏸{pos}s" },
  "node.automation.clearBtn": { ja: "✕ クリア", en: "✕ Clear" },
  // #278: 停止/再生トグルボタン（playing 中は ⏸=停止、stopped 中は ▶=再開）。
  "node.automation.pauseBtn": { ja: "⏸", en: "⏸" },
  "node.automation.resumeBtn": { ja: "▶", en: "▶" },
  // #270: BeatClock（TAP ボタン＋ BPM ステータス行）。
  "node.beatclock.tapBtn": { ja: "TAP", en: "TAP" },
  "node.beatclock.status": { ja: "{bpm} BPM", en: "{bpm} BPM" },
  "node.beatclock.none": { ja: "BPM --", en: "BPM --" },
  // #282: Screen の「⧉ 出力」トグル行（専用出力ウィンドウの開閉＋状態ラベル）。
  "node.screen.outputBtn": { ja: "⧉ 出力", en: "⧉ Output" },
  "node.screen.outputOn": { ja: "出力中", en: "Live" },
  "node.screen.outputOff": { ja: "未出力", en: "Off" },
  // #272: MIDI Learn 行（LEARN ボタン＋割当ステータス）と MIDI 接続状態。
  "node.midi.learnBtn": { ja: "LEARN", en: "LEARN" },
  "node.midi.learning": { ja: "操作待ち…", en: "waiting..." },
  "node.midi.assignedCc": { ja: "{ch} CC{num}", en: "{ch} CC{num}" },
  "node.midi.assignedNote": { ja: "{ch} note{num}", en: "{ch} note{num}" },
  "node.midi.omni": { ja: "omni", en: "omni" },
  "node.midi.channel": { ja: "ch{n}", en: "ch{n}" },
  "node.midi.unsupported": { ja: "MIDI 非対応", en: "MIDI unsupported" },
  "node.midi.denied": { ja: "MIDI 権限なし", en: "MIDI denied" },
  "node.midi.noDevice": { ja: "デバイスなし", en: "No device" },
  "node.midi.starting": { ja: "接続中…", en: "connecting..." },
  "node.randomBtn": { ja: "🎲 ランダム", en: "🎲 Random" },
  "label.default": { ja: "ラベル", en: "Label" },

  // --- 音声出力デバイス名のフォールバック（scene/output-audio） ---
  "audio.device.systemDefault": { ja: "システム既定", en: "System default" },
  "audio.device.fallback": { ja: "音声出力 {n}", en: "Audio output {n}" },
} as const satisfies Catalog;

/** UI クローム＋ノード文言を合成した実効カタログ（#254）。 */
const MERGED_CATALOG: Catalog = { ...CATALOG, ...NODE_CATALOG };

/** カタログのキー型（t のタイプミスをコンパイル時に検出する）。ノード文言キーも含む（#254）。 */
export type MsgKey = keyof typeof CATALOG | keyof typeof NODE_CATALOG;

/** 現在の UI 言語（モジュール内状態）。既定 ja。 */
let currentLang: Lang = "ja";

/** 現在言語を設定する（main.ts が起動時・UI 構築前に prefs から呼ぶ）。 */
export function setLang(lang: Lang): void {
  currentLang = lang;
}

/** 現在言語を返す。 */
export function getLang(): Lang {
  return currentLang;
}

/**
 * テンプレート中の {name} を vars で置換する純関数。
 * vars に無いプレースホルダはそのまま残す（表示が壊れない）。
 */
export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/**
 * カタログから文言を引く純関数。
 * en 未翻訳は ja へ、未知キーはキー名へフォールバックし、補間を適用する。
 */
export function translate(
  catalog: Catalog,
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const entry = catalog[key];
  const raw = entry ? (lang === "en" ? entry.en ?? entry.ja : entry.ja) : key;
  return interpolate(raw, vars);
}

/** 現在言語で UI 文言を引く。 */
export function t(key: MsgKey, vars?: Record<string, string | number>): string {
  return translate(MERGED_CATALOG, currentLang, key, vars);
}

/**
 * #254: ノード定義文言（description 等のカタログキー）を現在言語で解決する。
 * カタログに無い文字列はそのまま返す（未キー化の残存文言や動的文字列でも表示が壊れない）。
 * 表示点（tooltip / node-add-panel / getNodeCatalog）はすべてこれを通す。
 */
export function resolveNodeText(text: string): string {
  return translate(MERGED_CATALOG, currentLang, text);
}
