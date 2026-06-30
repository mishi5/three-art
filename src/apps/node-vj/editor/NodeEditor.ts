// Canvas2D ノードエディタ。ノードの配置・移動・接続・切断・param 編集を行う。
// 座標計算は layout.ts を共有し、描画とヒット判定の整合を保つ。
import {
  addConnection, addNode, findNode, removeConnection, removeNode, replaceGraph,
  createGroup, removeGroup, groupOfNode, addLabel, removeLabel,
  type Connection, type GraphDoc, type NodeInstance, type TextLabel,
} from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { isCompatible, type PortType } from "../graph/port-types";
import { signalInputs, isParamInput } from "../graph/node-ports";
import {
  NODE_WIDTH, TITLE_H, ROW_H, PORT_R, nodeRect,
  inputPortPos, outputPortPos, paramRowY, paramPortPos, resolveInputPortPos,
  previewButtonRect, previewWindowRect, hasFileRow, fileRowRect, fileRowLabel,
  transportRowRect, transportLayout, seekRatioAt, formatTime, randomRowRect,
  hasSceneRow, sceneRowRect, sceneRowLabel,
  outputScaleChipRect, CATEGORY_COLORS,
  hasPadGrid, padRect, padIndexAt, padExpandButtonRect, padStopButtonRect,
} from "./layout";
import { getOutputScale, setOutputScale, formatScale, DEFAULT_OUTPUT_SCALE } from "../graph/output-scale";
import { randomInRange } from "./random-value";
import { hitTest } from "./hit-test";
import { tooltipForHit, tooltipBox, wrapLines, nodeMenuTooltipContent, type TooltipContent } from "./tooltip";
import { screenToWorld, worldToScreen, zoomAt } from "./viewport";
import { groupNodesByCategory } from "./node-menu";
import { duplicateNodes } from "../graph/duplicate";
import { CLIP_MIME, makeClipItem, pasteClip, type NodeClipboard } from "./node-clipboard";
import { renderClipThumbnail } from "./clip-thumbnail";
import type { History } from "../graph/history";
import { nodesInRect, normRect } from "./selection";
import { backgroundPointerDrag } from "./pan-policy";
import { openParamInput } from "./param-overlay";
import { formatPortValue } from "./port-format";
import { containRect } from "./fit";
import { absoluteSliderValue, scrubValue, fillRatio, isAbsoluteSlider } from "./slider-logic";
import { isToggleParam, toggleOnValue, toggledValue } from "./toggle-param";
import type { ParamDef } from "../graph/node-type";

/** スライダドラッグで編集できる param（数値のみ。enum/boolean/string はクリック編集）。 */
function isParamEditableBySlider(pd: ParamDef): boolean {
  return pd.kind === "number" || pd.kind === "int";
}

/** 👁 プレビューを持つノードか（texture 出力 or previewSource、#77/#79）。 */
export function nodeHasPreview(def: { outputs: { type: string }[]; previewSource?: unknown }): boolean {
  return def.outputs.some((p) => p.type === "texture") || typeof def.previewSource === "function";
}

const PORT_COLORS: Record<PortType, string> = {
  number: "#7fd1ff", vec2: "#9aff9a", vec3: "#9aff9a", color: "#ffd27f",
  pose: "#ff9af0", signal: "#ffec7f", texture: "#c79aff", trigger: "#ff7f7f",
  points: "#7fffd4", audio: "#ffb37f",
};
type Drag =
  // 選択グループの一括移動。anchors は各ノードの「カーソル→ノード位置」オフセット。
  | { kind: "group"; anchors: Map<string, { dx: number; dy: number }>; moved: boolean }
  // 配線ドラッグ。#178: 入力ポートの既存エッジを掴んだ場合は regrab=true（履歴記録済み・移動なしは切断のまま）。
  | { kind: "wire"; fromNode: string; fromPort: string; type: PortType; startX: number; startY: number; recorded?: boolean; regrab?: boolean }
  // #167: bySpace=true は Space 押下で始めたパン。Space を離したら（buttons の状態に依らず）終了する。
  | { kind: "pan"; startX: number; startY: number; ox: number; oy: number; bySpace: boolean }
  // 矩形選択（#83: 空白左ドラッグ → #207: Shift+左ドラッグに変更）。start は world 座標。
  | { kind: "rect"; startX: number; startY: number }
  // param 行のスライダドラッグ候補。moved=false のまま up したらクリック（数値入力）扱い。
  | { kind: "param"; nodeId: string; paramIndex: number; moved: boolean; recorded: boolean; startX: number; lastX: number }
  // #99: transport 行シークバーのドラッグ（クリック/スクラブで seek）。
  | { kind: "seek"; nodeId: string; seek: { x: number; w: number }; duration: number }
  // #176: 自由ラベルのドラッグ移動。dx/dy はカーソル→ラベル原点のオフセット。
  | { kind: "label"; id: string; dx: number; dy: number; moved: boolean }
  | null;

/** #176: ノード名をノード上端からどれだけ上に表示するか（px・world）。グループ枠もこの分だけ上へ広げる。 */
const NODE_NAME_DY = 6;
/** #176: ノード名の概算行高（グループ枠の上方向拡張に使う）。 */
const NODE_NAME_H = 16;

/** クリックとドラッグを分ける移動量しきい値 (px)。 */
const DRAG_THRESHOLD = 3;

/** #114: ホバー開始からツールチップ表示までの待ち時間 (ms)。 */
const TOOLTIP_DELAY_MS = 450;
// #203: ノード追加メニュー項目の hover ツールチップ表示までの待ち時間。
const MENU_TOOLTIP_DELAY_MS = 500;

let idCounter = 0;
function genId(prefix: string): string { return `${prefix}${Date.now().toString(36)}_${++idCounter}`; }

export class NodeEditor {
  private ctx: CanvasRenderingContext2D;
  private offset = { x: 60, y: 60 };
  /** #92: ワークスペースのズーム倍率（screen = world * scale + offset）。 */
  private scale = 1;
  private drag: Drag = null;
  private cursor = { x: 0, y: 0 };
  /** #114: 直近のポインタのスクリーン座標（ツールチップ配置に使う）。 */
  private pointer = { x: 0, y: 0 };
  /** #114: 現在ホバー中のツールチップ内容と開始時刻 (performance.now)。未ホバーは null。 */
  private hover: { content: TooltipContent; sinceMs: number } | null = null;
  private selectedIds = new Set<string>();
  /** #176: 選択中の自由ラベル id（ノード選択 selectedIds とは別管理＝グループ化対象にしない）。 */
  private selectedLabelId: string | null = null;
  /** Space 押下中は常にパン（#207: 空白左ドラッグは既定でパン、Shift+左ドラッグで矩形選択）。 */
  private spaceDown = false;
  private rafId: number | null = null;
  private toolbar: HTMLDivElement;
  /** #103: 右クリック/ツールバーのコンテキストメニュー（開いていなければ null）。 */
  private contextMenu: HTMLDivElement | null = null;
  /** #103: 開いているフライアウトサブメニュー（カテゴリ → 型一覧）。 */
  private submenu: HTMLDivElement | null = null;
  /** #166: 現在のメニューを開いたトグルボタン。再押下クローズの判定に使う（右クリックメニューは null）。 */
  private menuAnchor: HTMLElement | null = null;
  // #203: ノード追加メニュー項目のホバー説明ツールチップ（DOM・遅延表示）。
  private menuTooltipEl: HTMLDivElement | null = null;
  private menuTooltipTimer: number | null = null;
  /** 出力ポート横のライブ値表示（デバッグ用）。既定 OFF、ツールバーで切替。 */
  private showOutputValues = false;
  /** #154: アセットパネルから canvas へ D&D されたときのコールバック（world 座標）。任意。 */
  onDropAsset?: (assetId: string, worldX: number, worldY: number) => void;
  /** #206: ノードのアプリ内クリップボード（Cmd+C コピー / Cmd+V 貼付 / パネルからのドロップ貼付）。任意。 */
  clipboard?: NodeClipboard;
  /** #205: 音入りパッドのクリック（ワンショット発音）。任意。 */
  onHitPad?: (nodeId: string, padIndex: number) => void;
  /** #205: 空パッドのクリック / Shift+クリック（ファイル割当ダイアログ）。任意。 */
  onAssignPad?: (nodeId: string, padIndex: number) => void;
  /** #205: 音入りパッドの Alt+クリック（割当解除＝空に戻す）。任意。 */
  onUnassignPad?: (nodeId: string, padIndex: number) => void;
  /** #205: 音入りパッドの Cmd/Ctrl+クリック（そのパッドの発音中の音だけ止める）。任意。 */
  onStopPadVoice?: (nodeId: string, padIndex: number) => void;
  /** #205: パッドの状態（割当済みか・短縮ラベル）を引く。任意。 */
  padCellInfo?: (nodeId: string, padIndex: number) => { filled: boolean; label: string | null } | undefined;
  /** #205: 拡大表示ボタン（⛶）。画面全体のパッドオーバーレイを開く。任意。 */
  onExpandPad?: (nodeId: string) => void;
  /** #205: 全停止ボタン（■）。発音中の音をすべて止める。任意。 */
  onStopPad?: (nodeId: string) => void;
  /** #205: アセットをパッド上にドロップして割当（再割当も上書き）。任意。 */
  onDropAssetToPad?: (nodeId: string, padIndex: number, assetId: string) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private graph: GraphDoc,
    private registry: NodeRegistry,
    /** UNDO/REDO 履歴（#90）。編集系操作の直前に record する。 */
    private history: History,
    /** 出力ポートのライブ値を引く（GraphRuntime の直近評価結果）。任意。 */
    private getOutputs?: (nodeId: string) => Record<string, unknown> | undefined,
    /** プレビュー小窓の描画ソースを引く（#77/#79、GraphRuntime）。任意。 */
    private getPreviewSource?: (nodeId: string) => CanvasImageSource | undefined,
    /** #99: ファイル選択をそのノードのランタイムへ読み込ませる。任意。 */
    private loadFileIntoNode?: (nodeId: string, file: File) => void,
    /** #99: ノードの現在のファイル名を引く（ランタイム state）。任意。 */
    private getFileName?: (nodeId: string) => string | null | undefined,
    /** #99: 再生コントロール（transport 行）。任意。 */
    private playback?: {
      get: (nodeId: string) => { playing: boolean; current: number; duration: number } | null;
      toggle: (nodeId: string) => void;
      seek: (nodeId: string, t: number) => void;
    },
    /** #152: SceneInput のシーン選択（行クリックでドロップダウン）。任意。 */
    private sceneSelect?: {
      options: (nodeId: string) => { id: string; name: string }[]; // 循環候補は除外済み
      current: (nodeId: string) => string | null;                  // 表示名（未選択 null）
      choose: (nodeId: string, sceneId: string) => void;
    },
  ) {
    const c = canvas.getContext("2d");
    if (!c) throw new Error("2d context unavailable");
    this.ctx = c;
    this.resize();
    window.addEventListener("resize", this.resize);
    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    // #167: フォーカスが外れたら Space 押下状態をリセット（keyup 取りこぼしでパンが残る不具合の防止）。
    window.addEventListener("blur", this.onBlur);
    // 右ドラッグパンのためコンテキストメニューを抑止
    canvas.addEventListener("contextmenu", this.onContextMenu);
    // #92: ホイール/ピンチでズーム（passive:false で preventDefault するため）
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    // #154: アセットパネルからの D&D 受け口（dataTransfer に asset id があれば world 座標で通知）。
    canvas.addEventListener("dragover", this.onDragOver);
    canvas.addEventListener("drop", this.onDrop);
    this.toolbar = this.buildToolbar();
    this.loop();
  }

  private resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + "px";
    this.canvas.style.height = window.innerHeight + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement("div");
    // right:8 で viewport 幅に収め、ノード増加時は複数行に折り返す（重なり防止）。
    bar.style.cssText =
      "position:fixed;left:8px;right:8px;top:8px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;z-index:150;" +
      "font:12px system-ui;";
    // #103: カテゴリボタン → クリックでそのカテゴリの型ドロップダウンを開く（階層化）。
    for (const group of groupNodesByCategory(this.registry.list())) {
      const btn = document.createElement("button");
      btn.textContent = group.category + " ▾";
      btn.style.cssText =
        "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 10px;cursor:pointer;text-transform:capitalize;";
      btn.addEventListener("click", () => this.showCategoryDropdown(btn, group));
      bar.appendChild(btn);
    }
    // デバッグ: 出力ポート横のライブ値表示トグル（既定 OFF）。
    const dbg = document.createElement("button");
    const syncDbg = (): void => {
      dbg.textContent = `出力値: ${this.showOutputValues ? "ON" : "OFF"}`;
      dbg.style.cssText =
        "background:#1c1c22;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;" +
        `color:${this.showOutputValues ? "#6c9" : "#888"};`;
    };
    syncDbg();
    dbg.addEventListener("click", () => { this.showOutputValues = !this.showOutputValues; syncDbg(); });
    bar.appendChild(dbg);
    const hint = document.createElement("span");
    hint.textContent = "  右クリック=メニュー / 空白ドラッグ=パン / Shift+ドラッグ=矩形選択 / Space・右ドラッグ=パン / ホイール=ズーム / 0=ズーム100% / Cmd+C=コピー / Cmd+V=貼付 / Del=削除";
    hint.style.cssText = "color:#888;align-self:center;";
    bar.appendChild(hint);
    document.body.appendChild(bar);
    return bar;
  }

  /**
   * #181: 指定ノード群を描画順の最前面（graph.nodes 配列の末尾）へ移動する。
   * 描画/ヒットは配列後方が前面。相対順序は保つ。history には積まない（z 順だけの変更）。
   */
  private bringNodesToFront(ids: Set<string>): void {
    if (ids.size === 0) return;
    const front = this.graph.nodes.filter((n) => ids.has(n.id));
    if (front.length === 0) return;
    const rest = this.graph.nodes.filter((n) => !ids.has(n.id));
    this.graph.nodes = [...rest, ...front];
  }

  addNodeOfType(type: string, worldPos?: { x: number; y: number }): string {
    const def = this.registry.require(type);
    // #92/#103: world 座標へ配置。worldPos 指定（右クリック）はその位置、未指定は画面左上付近。
    const jitter = Math.round((idCounter % 5) * 24);
    const w = worldPos ?? screenToWorld(120 + jitter, 120 + jitter, this.offset, this.scale);
    const node: NodeInstance = {
      id: genId("n"),
      type,
      params: Object.fromEntries(def.params.map((p) => [p.id, p.default])),
      position: { x: w.x, y: w.y },
    };
    this.history.record(this.graph);
    addNode(this.graph, node);
    this.selectedIds = new Set([node.id]);
    return node.id;
  }

  // --- pointer 座標 → world 座標（#92: ズーム反映）---
  private toWorld(e: PointerEvent): { x: number; y: number } {
    return screenToWorld(e.clientX, e.clientY, this.offset, this.scale);
  }

  /**
   * #92: ホイール/トラックパッドのピンチ（ctrl+wheel）でカーソル中心ズーム。
   * deltaY を指数に通して滑らかに拡縮し、カーソル下の点を画面上で固定する。
   */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // ピンチ（ctrlKey）は感度を上げる。通常ホイールは控えめに。
    const k = e.ctrlKey ? 0.01 : 0.0015;
    const factor = Math.exp(-e.deltaY * k);
    const r = zoomAt(e.clientX, e.clientY, this.offset, this.scale, factor);
    this.offset = r.offset;
    this.scale = r.scale;
    this.hover = null; // ズーム中はツールチップを消す
  };

  /** #154/#206: asset id / クリップ項目を運ぶ D&D を受け入れる（ドロップ可否を示すため preventDefault）。 */
  private onDragOver = (e: DragEvent): void => {
    const t = e.dataTransfer?.types;
    if (t && (t.includes("application/x-node-vj-asset") || t.includes(CLIP_MIME))) e.preventDefault();
  };

  /** #154: asset / #206: クリップ項目をドロップ位置（world 座標）へ貼り付ける。 */
  private onDrop = (e: DragEvent): void => {
    // #206: クリップ履歴項目のドロップ＝その位置に貼り付け、貼付ノードを選択・current に。
    const clipId = e.dataTransfer?.getData(CLIP_MIME);
    if (clipId && this.clipboard) {
      e.preventDefault();
      const item = this.clipboard.get(clipId);
      if (item) {
        this.history.record(this.graph);
        const w = screenToWorld(e.clientX, e.clientY, this.offset, this.scale);
        this.selectedIds = new Set(pasteClip(this.graph, this.registry, item, genId, { at: w }));
        this.clipboard.setCurrent(clipId);
      }
      return;
    }
    const id = e.dataTransfer?.getData("application/x-node-vj-asset");
    if (!id) return;
    e.preventDefault();
    const w = screenToWorld(e.clientX, e.clientY, this.offset, this.scale);
    // #205: MidiPad のパッド上へドロップしたら、そのパッドへ割当（再割当も上書き）。
    const hit = hitTest(this.graph.nodes, this.registry, w.x, w.y);
    if (hit?.kind === "node") {
      const def = this.registry.get(hit.node.type);
      if (def?.padGrid) {
        const idx = padIndexAt(hit.node, def, w.x, w.y);
        if (idx !== null) {
          this.onDropAssetToPad?.(hit.node.id, idx, id);
          return;
        }
      }
    }
    this.onDropAsset?.(id, w.x, w.y);
  };

  /** #114: カーソル下のノード/param/ポートの説明を引き、ホバー状態を更新する。 */
  private updateHover(): void {
    // #154: ポインタ直下の最前面要素が canvas でない（パネル等のオーバーレイ上）ならホバーを出さない。
    if (typeof document !== "undefined" && document.elementFromPoint) {
      const top = document.elementFromPoint(this.pointer.x, this.pointer.y);
      if (top && top !== this.canvas) { this.hover = null; return; }
    }
    const hit = hitTest(this.graph.nodes, this.registry, this.cursor.x, this.cursor.y);
    const content = tooltipForHit(hit, this.registry);
    if (!content) {
      this.hover = null;
      return;
    }
    // 同じ対象に留まっている間は開始時刻を維持し、別対象へ移ったら計り直す。
    if (this.hover && this.hover.content.title === content.title && this.hover.content.body === content.body) {
      return;
    }
    this.hover = { content, sinceMs: performance.now() };
  }

  private onDown = (e: PointerEvent): void => {
    const w = this.toWorld(e);
    // パン: 中ボタン / 右ボタン / Space+左ドラッグ（ノード上でもこれらはパン）。
    // 空白左ドラッグは下の背景分岐でパン、Shift+左ドラッグで矩形選択（#207）。
    if (e.button !== 0 || this.spaceDown) {
      // Space 押下で始めたパンは、Space を離した時点で終了させる（#167）。
      const bySpace = e.button === 0 && this.spaceDown;
      this.drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: this.offset.x, oy: this.offset.y, bySpace };
      return;
    }
    // #176: 自由ラベルは最前面。クリックで選択＋ドラッグ移動を開始する（ノード選択は解除）。
    const lab = this.labelAt(w.x, w.y);
    if (lab) {
      this.selectedLabelId = lab.id;
      this.selectedIds = new Set();
      this.drag = { kind: "label", id: lab.id, dx: w.x - lab.x, dy: w.y - lab.y, moved: false };
      return;
    }
    // #176: ラベル以外を操作したらラベル選択は解除。
    this.selectedLabelId = null;
    // #80: 遮蔽つき統一ヒットテスト。最前面ノードがイベントを所有する。
    const hit = hitTest(this.graph.nodes, this.registry, w.x, w.y);
    if (hit?.kind === "port") {
      if (hit.portKind === "output") {
        this.drag = { kind: "wire", fromNode: hit.node.id, fromPort: hit.port, type: hit.type, startX: e.clientX, startY: e.clientY };
      } else {
        // 入力ポート: 接続済みなら、そのエッジを掴んで付け替えられるようにする（#178）。
        // 履歴記録のうえ一旦切断し、元の出力ポートから配線ドラッグを開始。別の入力へドロップで付け替え、
        // 動かさなければ（クリック）切断のまま（従来の「クリックで切断」を維持）。
        const existing = this.graph.connections.find(
          (c) => c.to.node === hit.node.id && c.to.port === hit.port,
        );
        if (existing) {
          this.history.record(this.graph);
          removeConnection(this.graph, existing.id);
          const fromNode = findNode(this.graph, existing.from.node);
          const fromDef = fromNode ? this.registry.get(fromNode.type) : undefined;
          const outType = fromDef?.outputs.find((p) => p.id === existing.from.port)?.type ?? hit.type;
          this.drag = {
            kind: "wire", fromNode: existing.from.node, fromPort: existing.from.port, type: outType,
            startX: e.clientX, startY: e.clientY, recorded: true, regrab: true,
          };
        }
      }
      return;
    }
    if (hit?.kind === "param") {
      // すぐには編集を開かず、ドラッグ（スライダ）かクリック（数値入力）かを up で判定する。
      this.selectedIds = new Set([hit.node.id]);
      this.drag = {
        kind: "param", nodeId: hit.node.id, paramIndex: hit.paramIndex,
        moved: false, recorded: false, startX: w.x, lastX: w.x,
      };
      return;
    }
    if (hit?.kind === "node") {
      // #77: texture 出力を持つノードのタイトル右端 👁 はプレビュー小窓のトグル。
      const def = this.registry.get(hit.node.type);
      if (def && nodeHasPreview(def)) {
        const b = previewButtonRect(hit.node);
        if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) {
          hit.node.preview = !hit.node.preview;
          return;
        }
      }
      // #205: MidiPad タイトルバーの拡大（⛶）/ 全停止（■）ボタン。
      if (def?.padGrid) {
        const eb = padExpandButtonRect(hit.node);
        if (w.x >= eb.x && w.x <= eb.x + eb.w && w.y >= eb.y && w.y <= eb.y + eb.h) {
          this.onExpandPad?.(hit.node.id);
          return;
        }
        const sb = padStopButtonRect(hit.node);
        if (w.x >= sb.x && w.x <= sb.x + sb.w && w.y >= sb.y && w.y <= sb.y + sb.h) {
          this.onStopPad?.(hit.node.id);
          return;
        }
      }
      // #205: パッドグリッドの左クリックは発音のみ（音入りパッド）。割当/停止/解除は右クリックメニュー。
      if (def?.padGrid) {
        const idx = padIndexAt(hit.node, def, w.x, w.y);
        if (idx !== null) {
          if (this.padCellInfo?.(hit.node.id, idx)?.filled) this.onHitPad?.(hit.node.id, idx);
          return; // パッド上クリックはノードドラッグへ流さない
        }
      }
      // #99: ファイル行クリックで OS ファイルダイアログを開く（pointerdown の user gesture 内）。
      if (def?.fileInput) {
        const fr = fileRowRect(hit.node, def);
        if (fr && w.x >= fr.x && w.x <= fr.x + fr.w && w.y >= fr.y && w.y <= fr.y + fr.h) {
          this.openFileDialog(hit.node.id, def.fileInput.accept);
          return;
        }
        // #99: transport 行（再生/停止ボタン・シークバー）。
        const tr = transportRowRect(hit.node, def);
        if (tr && w.y >= tr.y && w.y <= tr.y + tr.h) {
          const { button, seek } = transportLayout(tr);
          if (w.x >= button.x && w.x <= button.x + button.w) {
            this.playback?.toggle(hit.node.id);
            return;
          }
          const pb = this.playback?.get(hit.node.id);
          if (pb && pb.duration > 0) {
            this.playback?.seek(hit.node.id, seekRatioAt(w.x, seek) * pb.duration);
            this.drag = { kind: "seek", nodeId: hit.node.id, seek, duration: pb.duration };
          }
          return;
        }
      }
      // #152: シーン選択行クリックで参照シーンのドロップダウンを開く。
      if (def?.sceneInput) {
        const sr = sceneRowRect(hit.node, def);
        if (sr && w.x >= sr.x && w.x <= sr.x + sr.w && w.y >= sr.y && w.y <= sr.y + sr.h) {
          this.openSceneMenu(hit.node.id, sr);
          return;
        }
      }
      // #150: 🎲ランダムボタン行クリックで value を min/max 範囲のランダム値に再ロール。
      if (def?.randomButton) {
        const rr = randomRowRect(hit.node, def);
        if (rr && w.x >= rr.x && w.x <= rr.x + rr.w && w.y >= rr.y && w.y <= rr.y + rr.h) {
          this.history.record(this.graph);
          const n = hit.node;
          const min = Number(n.params.min ?? 0);
          const max = Number(n.params.max ?? 1);
          n.params[def.randomButton.paramId] = Math.round(randomInRange(min, max, Math.random()) * 1000) / 1000;
          return;
        }
      }
      // #208: number 出力の倍率チップクリックで倍率入力を開く。
      if (def) {
        for (let oi = 0; oi < def.outputs.length; oi++) {
          const op = def.outputs[oi]!;
          if (op.type !== "number") continue;
          const chip = outputScaleChipRect(hit.node, oi);
          if (w.x >= chip.x && w.x <= chip.x + chip.w && w.y >= chip.y && w.y <= chip.y + chip.h) {
            this.editOutputScale(hit.node, op.id, chip);
            return;
          }
        }
      }
      // Cmd/Ctrl+クリック = 選択トグル（ドラッグは開始しない）
      if (e.metaKey || e.ctrlKey) {
        if (this.selectedIds.has(hit.node.id)) this.selectedIds.delete(hit.node.id);
        else this.selectedIds.add(hit.node.id);
        return;
      }
      // 未選択ノードなら選択に置き換え。#175: グループ所属ならグループ全体を選択（一括移動）。
      if (!this.selectedIds.has(hit.node.id)) {
        const gr = groupOfNode(this.graph, hit.node.id);
        this.selectedIds = new Set(gr ? gr.nodeIds : [hit.node.id]);
      }
      const anchors = new Map<string, { dx: number; dy: number }>();
      for (const id of this.selectedIds) {
        const n = findNode(this.graph, id);
        const p = n?.position ?? { x: 0, y: 0 };
        anchors.set(id, { dx: w.x - p.x, dy: w.y - p.y });
      }
      // #181: 操作したノードを最前面（描画順＝配列末尾）へ。history には積まない
      // （移動を始めれば group ドラッグの記録に乗る／クリックだけなら記録されない＝undo 対象外）。
      this.bringNodesToFront(this.selectedIds);
      this.drag = { kind: "group", anchors, moved: false };
      return;
    }
    // 背景（#207）: Shift+左ドラッグは矩形選択、それ以外（空白左ドラッグ）はパン。確定は up。
    if (backgroundPointerDrag({ button: e.button, shiftKey: e.shiftKey, spaceDown: this.spaceDown }) === "rect") {
      this.drag = { kind: "rect", startX: w.x, startY: w.y };
    } else {
      this.drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: this.offset.x, oy: this.offset.y, bySpace: false };
    }
  };

  private onMove = (e: PointerEvent): void => {
    this.cursor = this.toWorld(e);
    this.pointer = { x: e.clientX, y: e.clientY };
    // #167: ドラッグ中のはずなのにボタンが押されていない move が来たら pointerup を取りこぼしている
    // （macOS トラックパッドで指を止めて離すと pointerup が来ず、以後の指移動でパンが続く）。
    // ここで up とみなしてドラッグを終了し、空移動でパン/矩形選択が継続しないようにする。
    if (this.drag && e.buttons === 0) {
      this.onUp(e);
      return;
    }
    if (!this.drag) {
      this.updateHover();
      return;
    }
    // ドラッグ中はツールチップを出さない。
    this.hover = null;
    if (this.drag.kind === "group") {
      if (!this.drag.moved) {
        // ドラッグ全体を 1 操作として、最初に動いた時点で記録（クリックだけでは積まない）
        this.history.record(this.graph);
        this.drag.moved = true;
      }
      for (const [id, a] of this.drag.anchors) {
        const node = findNode(this.graph, id);
        if (node) node.position = { x: this.cursor.x - a.dx, y: this.cursor.y - a.dy };
      }
    } else if (this.drag.kind === "pan") {
      // #167: Space 始動パンは「今 Space を押しているか」で挙動を切り替える。
      // trackpad は指を離しても buttons:1 のまま・pointerup を落とすため、pointerdown 時に
      // パン/矩形を固定すると stale な状態が残る。Space を離したら矩形選択へ即切替する。
      if (this.drag.bySpace && !this.spaceDown) {
        this.drag = { kind: "rect", startX: this.cursor.x, startY: this.cursor.y };
      } else {
        this.offset.x = this.drag.ox + (e.clientX - this.drag.startX);
        this.offset.y = this.drag.oy + (e.clientY - this.drag.startY);
      }
    } else if (this.drag.kind === "rect") {
      // #167: 矩形選択中に Space を押したらパンへ切替（現在地を基準にジャンプなく開始）。
      if (this.spaceDown) {
        this.drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: this.offset.x, oy: this.offset.y, bySpace: true };
      }
      // それ以外は cursor 更新のみ（矩形は描画/確定時に start→cursor で算出）。
    } else if (this.drag.kind === "param") {
      this.dragParam(this.drag);
    } else if (this.drag.kind === "seek") {
      this.playback?.seek(this.drag.nodeId, seekRatioAt(this.cursor.x, this.drag.seek) * this.drag.duration);
    } else if (this.drag.kind === "label") {
      // #176: 自由ラベルの移動。最初に動いた時点で履歴記録。
      const lab = this.graph.labels?.find((l) => l.id === (this.drag as { id: string }).id);
      if (lab) {
        if (!this.drag.moved) { this.history.record(this.graph); this.drag.moved = true; }
        lab.x = this.cursor.x - this.drag.dx;
        lab.y = this.cursor.y - this.drag.dy;
      }
    }
  };

  /** param 行のスライダドラッグ。しきい値を超えたら値を更新する。 */
  private dragParam(drag: Extract<NonNullable<Drag>, { kind: "param" }>): void {
    if (!drag.moved && Math.abs(this.cursor.x - drag.startX) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const node = findNode(this.graph, drag.nodeId);
    if (!node) return;
    const def = this.registry.get(node.type);
    const pd = def?.params[drag.paramIndex];
    if (!def || !pd || !isParamEditableBySlider(pd)) return;
    // 接続中はドラッグで変更しない（上流値が支配）。
    if (this.resolveConnectedValue(node, pd.id) !== undefined) return;
    if (!drag.recorded) {
      // スライダドラッグ全体を 1 操作として記録
      this.history.record(this.graph);
      drag.recorded = true;
    }
    if (isAbsoluteSlider(pd)) {
      const r = nodeRect(node, def);
      node.params[pd.id] = absoluteSliderValue(this.cursor.x, r.x + 6, r.w - 12, pd);
    } else {
      const current = Number(node.params[pd.id] ?? pd.default) || 0;
      node.params[pd.id] = scrubValue(current, this.cursor.x - drag.lastX, pd);
    }
    drag.lastX = this.cursor.x;
  }

  private onUp = (e: PointerEvent): void => {
    // #103: 右クリック（移動なし）はコンテキストメニュー。右ドラッグはパンのまま。
    if (this.drag?.kind === "pan" && e.button === 2 &&
        Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) < DRAG_THRESHOLD) {
      this.drag = null;
      this.openContextMenu(e);
      return;
    }
    if (this.drag?.kind === "rect") {
      // 矩形確定。移動なし（クリック）は選択解除になる（空矩形は何も拾わない）。
      const w = this.toWorld(e);
      const rect = normRect(this.drag.startX, this.drag.startY, w.x, w.y);
      this.selectedIds = new Set(nodesInRect(this.graph.nodes, this.registry, rect));
    }
    // #207: 空白を左クリック（移動なしのパン）したら選択解除。
    // 従来は「空白左ドラッグ＝矩形」で移動なし＝空矩形→解除だった挙動を、パン化後も維持する。
    if (this.drag?.kind === "pan" && !this.drag.bySpace && e.button === 0 &&
        Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) < DRAG_THRESHOLD) {
      this.selectedIds = new Set();
      this.selectedLabelId = null;
    }
    if (this.drag?.kind === "param" && !this.drag.moved) {
      // ドラッグなし＝クリック → 従来の数値入力/選択オーバーレイを開く。
      const node = findNode(this.graph, this.drag.nodeId);
      if (node) this.editParam(e, node, this.drag.paramIndex);
    }
    // #176: ラベルのクリック（移動なし）は選択のみ（選択は onDown で設定済み）。
    //       編集は右クリックメニュー「ラベル編集」または新規作成時に行う。
    if (this.drag?.kind === "wire") {
      const drag = this.drag;
      const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) >= DRAG_THRESHOLD;
      // #178: 入力エッジを掴んだだけで動かさなかった場合はクリック＝切断のまま（再接続しない）。
      if (drag.regrab && !moved) {
        this.drag = null;
        return;
      }
      const w = this.toWorld(e);
      // 遮蔽つき判定: 手前ノードの本体に隠れた入力ポートへは接続しない。
      const target = hitTest(this.graph.nodes, this.registry, w.x, w.y);
      // ドット直上だけでなく param 行へのドロップも、その行の入力ポート扱いにする
      // （#84: 小さなドットを外して「動作しない」となる摩擦を解消）。
      let drop: { node: string; port: string; type: PortType } | null = null;
      if (target?.kind === "port" && target.portKind === "input") {
        drop = { node: target.node.id, port: target.port, type: target.type };
      } else if (target?.kind === "param") {
        const def = this.registry.get(target.node.type);
        const pd = def?.params[target.paramIndex];
        if (def && pd && isParamInput(def, pd.id)) {
          drop = { node: target.node.id, port: pd.id, type: "number" };
        }
      }
      if (drop && isCompatible(drag.type, drop.type)) {
        const conn: Connection = {
          id: genId("c"),
          from: { node: drag.fromNode, port: drag.fromPort },
          to: { node: drop.node, port: drop.port },
        };
        // regrab は down で切断を記録済み（再接続は同一操作の一部）。新規ドラッグのみここで記録する。
        if (!drag.recorded) this.history.record(this.graph);
        const res = addConnection(this.graph, this.registry, conn);
        if (!res.ok && !drag.recorded) this.history.discardLast(); // 無効な接続は操作として積まない（regrab は切断記録を残す）
      }
    }
    this.drag = null;
  };

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    // #167: 物理キーで判定する。IME 有効時は keyup の e.key が " " でなく "Process" 等になり
    // e.key === " " では keyup を取りこぼして spaceDown が残る（日本語環境で多発）。e.code は不変。
    if (e.code === "Space") this.spaceDown = true;
    // #92: "0" でズームを 100% に戻す（画面中心を固定）。
    if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
      const r = zoomAt(window.innerWidth / 2, window.innerHeight / 2, this.offset, this.scale, 1 / this.scale);
      this.offset = r.offset;
      this.scale = r.scale;
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && this.selectedIds.size > 0) {
      this.history.record(this.graph);
      for (const id of this.selectedIds) removeNode(this.graph, id);
      this.selectedIds = new Set();
    }
    // #176: ラベル選択中の Delete で当該ラベルを削除。
    if ((e.key === "Delete" || e.key === "Backspace") && this.selectedLabelId) {
      this.history.record(this.graph);
      removeLabel(this.graph, this.selectedLabelId);
      this.selectedLabelId = null;
    }
    // #90: Cmd+Z = UNDO / Shift+Cmd+Z = REDO（Cmd のみ。Ctrl 系は割り当てない）
    if (e.metaKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const snap = e.shiftKey ? this.history.redo(this.graph) : this.history.undo(this.graph);
      if (snap) {
        // preview は履歴対象外の表示状態。スナップショットに含まれてしまうため、
        // 現存ノードの preview を復元後に引き継ぐ（削除 UNDO で復活するノードは
        // スナップショット時の値のままにする）。
        const prevPreview = new Map(this.graph.nodes.map((n) => [n.id, n.preview]));
        replaceGraph(this.graph, snap);
        for (const node of this.graph.nodes) {
          if (prevPreview.has(node.id)) node.preview = prevPreview.get(node.id);
        }
        // 消えたノードを選択から除外
        const alive = new Set(this.graph.nodes.map((n) => n.id));
        this.selectedIds = new Set([...this.selectedIds].filter((id) => alive.has(id)));
      }
      return;
    }
    // #206: Cmd/Ctrl+C で選択ノード＋内部接続をクリップボードへコピー（履歴に積む）。貼付は Cmd+V。
    if ((e.metaKey || e.ctrlKey) && e.key === "c" && this.selectedIds.size > 0 && this.clipboard) {
      e.preventDefault();
      const item = makeClipItem(this.graph, this.selectedIds, genId);
      if (item) {
        item.thumbnail = renderClipThumbnail(item.nodes, item.connections, this.registry); // #206: ミニ配置図
        this.clipboard.add(item);
      }
    }
    // #206: Cmd/Ctrl+V で現在のクリップ項目をマウス位置へ貼り付け、貼付ノードを選択状態にする。
    if ((e.metaKey || e.ctrlKey) && e.key === "v" && this.clipboard) {
      const item = this.clipboard.current();
      if (item) {
        e.preventDefault();
        this.history.record(this.graph);
        const w = screenToWorld(this.pointer.x, this.pointer.y, this.offset, this.scale);
        this.selectedIds = new Set(pasteClip(this.graph, this.registry, item, genId, { at: w }));
      }
    }
    // #175: Cmd/Ctrl+G でグループ化、Shift 併用で選択ノードの所属グループを解除。
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (e.shiftKey) {
        const groupIds = new Set<string>();
        for (const id of this.selectedIds) { const gr = groupOfNode(this.graph, id); if (gr) groupIds.add(gr.id); }
        if (groupIds.size > 0) {
          this.history.record(this.graph);
          for (const gid of groupIds) removeGroup(this.graph, gid);
        }
      } else if (this.selectedIds.size >= 2) {
        this.history.record(this.graph);
        createGroup(this.graph, genId("g"), [...this.selectedIds]);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    // #167: e.code で判定（IME 経由の keyup は e.key が " " にならず取りこぼすため）。
    // #167: Space 始動パンは drag を保持したまま「Space を押している間だけ」動かす（onMove で判定）。
    // drag を捨てるとトラックパッドで pointerup が来ない場合に再パンが始められず無反応になるため。
    if (e.code === "Space") this.spaceDown = false;
  };

  /** #167: ウィンドウ blur で Space 押下状態を解除する（keyup を取りこぼしてもパンが残らないように）。 */
  private onBlur = (): void => {
    this.spaceDown = false;
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault(); // ネイティブメニューは出さない（独自メニューを onUp で出す）
  };

  /** #103: 右クリック位置にコンテキストメニューを開く。ノード上ならノード操作、空白なら追加メニュー。 */
  private openContextMenu(e: PointerEvent): void {
    const w = this.toWorld(e);
    // #176: ラベル上なら編集/削除メニュー。
    const lab = this.labelAt(w.x, w.y);
    if (lab) { this.showLabelMenu(e.clientX, e.clientY, lab); return; }
    const hit = hitTest(this.graph.nodes, this.registry, w.x, w.y);
    if (hit && hit.kind !== "port") {
      // #205: MidiPad のパッド上で右クリックしたらパッド操作メニュー（割当/停止/解除）。
      const def = this.registry.get(hit.node.type);
      if (def?.padGrid) {
        const idx = padIndexAt(hit.node, def, w.x, w.y);
        if (idx !== null) { this.showPadMenu(e.clientX, e.clientY, hit.node.id, idx); return; }
      }
      this.showNodeMenu(e.clientX, e.clientY, hit.node);
    } else {
      this.showAddMenu(e.clientX, e.clientY, w);
    }
  }

  /** #205: パッドの右クリックメニュー。空=割当 / 音入り=再生・停止・再割当・解除。 */
  private showPadMenu(screenX: number, screenY: number, nodeId: string, padIndex: number): void {
    const menu = this.buildMenu(screenX, screenY);
    const filled = this.padCellInfo?.(nodeId, padIndex)?.filled ?? false;
    if (filled) {
      this.addMenuItem(menu, "■ このパッドを停止", () => this.onStopPadVoice?.(nodeId, padIndex));
      this.addMenuItem(menu, "↻ 音声を再割り当て", () => this.onAssignPad?.(nodeId, padIndex));
      this.addMenuItem(menu, "✕ 割り当てを解除", () => this.onUnassignPad?.(nodeId, padIndex));
    } else {
      this.addMenuItem(menu, "＋ 音声を割り当て", () => this.onAssignPad?.(nodeId, padIndex));
    }
  }

  /** #176: 自由ラベルの右クリックメニュー（編集/削除）。 */
  private showLabelMenu(screenX: number, screenY: number, lab: TextLabel): void {
    const menu = this.buildMenu(screenX, screenY);
    this.addMenuItem(menu, "ラベル編集", () => this.editLabel(lab));
    this.addMenuItem(menu, "ラベル削除", () => { this.history.record(this.graph); removeLabel(this.graph, lab.id); });
  }

  /** メニュー DOM の土台を作る（既存メニューは閉じる）。 */
  private buildMenu(screenX: number, screenY: number): HTMLDivElement {
    this.closeContextMenu();
    const menu = document.createElement("div");
    menu.style.cssText =
      `position:fixed;left:${screenX}px;top:${screenY}px;z-index:300;background:#16161c;` +
      "border:1px solid #444;border-radius:6px;padding:4px;font:12px system-ui;color:#ddd;" +
      "max-height:80vh;overflow:auto;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:120px;";
    // メニュー外クリックで閉じる（次フレームから購読し、開いた右クリック up を拾わない）。
    setTimeout(() => window.addEventListener("pointerdown", this.closeOnOutside, true), 0);
    this.contextMenu = menu;
    document.body.appendChild(menu);
    return menu;
  }

  private addMenuLabel(menu: HTMLElement, text: string): void {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = "color:#666;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;padding:4px 8px 2px;";
    menu.appendChild(el);
  }

  /** #152: SceneInput のシーン選択ドロップダウン（循環候補は除外済みの options）。 */
  private openSceneMenu(nodeId: string, rowWorld: { x: number; y: number; w: number; h: number }): void {
    const opts = this.sceneSelect?.options(nodeId) ?? [];
    const s = worldToScreen(rowWorld.x, rowWorld.y + rowWorld.h, this.offset, this.scale);
    const menu = this.buildMenu(s.x, s.y);
    this.addMenuLabel(menu, "シーンを選択");
    if (opts.length === 0) { this.addMenuLabel(menu, "(選べるシーンなし)"); return; }
    for (const o of opts) this.addMenuItem(menu, o.name, () => this.sceneSelect?.choose(nodeId, o.id));
  }

  private addMenuItem(menu: HTMLElement, text: string, onClick: () => void, tooltipType?: string): void {
    const item = document.createElement("div");
    item.textContent = text;
    item.style.cssText = "padding:4px 10px;border-radius:4px;cursor:pointer;white-space:nowrap;";
    item.addEventListener("mouseenter", () => {
      item.style.background = "#2a2a36";
      if (tooltipType) this.scheduleMenuTooltip(item, tooltipType); // #203: ノード説明
    });
    item.addEventListener("mouseleave", () => {
      item.style.background = "transparent";
      this.hideMenuTooltip();
    });
    item.addEventListener("click", () => { this.closeContextMenu(); onClick(); });
    menu.appendChild(item);
  }

  /** #203: メニュー項目に一定時間 hover でノードの説明ツールチップを出す（DOM・画面端回避）。 */
  private scheduleMenuTooltip(item: HTMLElement, type: string): void {
    this.hideMenuTooltip();
    this.menuTooltipTimer = window.setTimeout(() => this.showMenuTooltip(item, type), MENU_TOOLTIP_DELAY_MS);
  }

  private showMenuTooltip(item: HTMLElement, type: string): void {
    const content = nodeMenuTooltipContent(this.registry.get(type));
    if (!content) return;
    const el = document.createElement("div");
    el.style.cssText =
      "position:fixed;z-index:400;max-width:280px;background:#0d0d12;border:1px solid #555;" +
      "border-radius:6px;padding:6px 8px;font:12px system-ui;color:#ccc;pointer-events:none;" +
      "box-shadow:0 4px 16px rgba(0,0,0,0.6);white-space:normal;line-height:1.45;";
    const title = document.createElement("div");
    title.textContent = content.title;
    title.style.cssText = "color:#e8c34a;font-weight:600;margin-bottom:2px;";
    el.appendChild(title);
    if (content.body) {
      const body = document.createElement("div");
      body.textContent = content.body;
      el.appendChild(body);
    }
    if (content.ports) {
      const ports = document.createElement("div");
      ports.textContent = content.ports;
      ports.style.cssText = "color:#888;margin-top:3px;font-size:11px;";
      el.appendChild(ports);
    }
    document.body.appendChild(el);
    // 項目の右上を基準に、画面端を避けて配置（tooltipBox 純関数を流用）。
    const r = item.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const box = tooltipBox(r.right, r.top, b.width, b.height, window.innerWidth, window.innerHeight, 6, 6);
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    this.menuTooltipEl = el;
  }

  private hideMenuTooltip(): void {
    if (this.menuTooltipTimer !== null) { window.clearTimeout(this.menuTooltipTimer); this.menuTooltipTimer = null; }
    if (this.menuTooltipEl) { this.menuTooltipEl.remove(); this.menuTooltipEl = null; }
  }

  /** 階層メニューのカテゴリ行（ホバーで型のサブメニューを開く）。 */
  private addCategoryRow(menu: HTMLElement, group: { category: string; types: string[] }, worldPos?: { x: number; y: number }): void {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;justify-content:space-between;gap:12px;padding:4px 10px;border-radius:4px;cursor:default;white-space:nowrap;";
    const name = document.createElement("span"); name.textContent = group.category;
    const arrow = document.createElement("span"); arrow.textContent = "▸"; arrow.style.color = "#888";
    row.append(name, arrow);
    row.addEventListener("mouseenter", () => {
      row.style.background = "#2a2a36";
      const r = row.getBoundingClientRect();
      this.openSubmenu(r.right - 2, r.top - 4, group.types, worldPos);
    });
    row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
    menu.appendChild(row);
  }

  /** カテゴリ行のホバーで開く型一覧サブメニュー（フライアウト）。 */
  private openSubmenu(x: number, y: number, types: string[], worldPos?: { x: number; y: number }): void {
    this.closeSubmenu();
    const sub = document.createElement("div");
    sub.style.cssText =
      `position:fixed;left:${x}px;top:${y}px;z-index:301;background:#16161c;` +
      "border:1px solid #444;border-radius:6px;padding:4px;font:12px system-ui;color:#ddd;" +
      "max-height:80vh;overflow:auto;box-shadow:0 4px 16px rgba(0,0,0,0.5);min-width:120px;";
    for (const type of types) {
      this.addMenuItem(sub, "+ " + type, () => this.addNodeOfType(type, worldPos), type);
    }
    this.submenu = sub;
    document.body.appendChild(sub);
    // 画面端からはみ出す場合は左側・上側へ寄せる。
    const r = sub.getBoundingClientRect();
    if (r.right > window.innerWidth) sub.style.left = `${Math.max(4, x - r.width - (this.contextMenu?.offsetWidth ?? 140))}px`;
    if (r.bottom > window.innerHeight) sub.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`;
  }

  /** 空白右クリック: カテゴリ階層の追加メニュー（型はサブメニュー）。選んだ type を world 位置に生成。 */
  private showAddMenu(screenX: number, screenY: number, worldPos: { x: number; y: number }): void {
    const menu = this.buildMenu(screenX, screenY);
    // #176: ラベル追加（クリック位置に空ラベルを作りインライン編集）。
    this.addMenuItem(menu, "＋ ラベル追加", () => {
      this.history.record(this.graph);
      const lab = { id: genId("L"), x: worldPos.x, y: worldPos.y, text: "ラベル" };
      addLabel(this.graph, lab);
      this.editLabel(lab);
    });
    this.addMenuLabel(menu, "ノードを追加");
    for (const group of groupNodesByCategory(this.registry.list())) {
      this.addCategoryRow(menu, group, worldPos);
    }
  }

  /** ツールバーのカテゴリボタン押下: そのカテゴリの型ドロップダウンを下に開く。 */
  private showCategoryDropdown(anchor: HTMLElement, group: { category: string; types: string[] }): void {
    if (this.contextMenu) { this.closeContextMenu(); return; } // 同じボタン再押下で閉じる
    const r = anchor.getBoundingClientRect();
    const menu = this.buildMenu(r.left, r.bottom + 4);
    // #166: このボタン上の pointerdown では closeOnOutside で閉じず、click のトグルに委ねる。
    this.menuAnchor = anchor;
    for (const type of group.types) {
      this.addMenuItem(menu, "+ " + type, () => this.addNodeOfType(type), type);
    }
  }

  /** ノード上右クリック: 複製・削除。対象が未選択なら単独選択にしてから操作する。 */
  private showNodeMenu(screenX: number, screenY: number, node: NodeInstance): void {
    if (!this.selectedIds.has(node.id)) this.selectedIds = new Set([node.id]);
    const menu = this.buildMenu(screenX, screenY);
    const n = this.selectedIds.size;
    this.addMenuItem(menu, n > 1 ? `複製 (${n})` : "複製", () => {
      this.history.record(this.graph);
      const newIds = duplicateNodes(this.graph, this.selectedIds, genId, 24);
      this.selectedIds = new Set(newIds);
    });
    this.addMenuItem(menu, n > 1 ? `削除 (${n})` : "削除", () => {
      this.history.record(this.graph);
      for (const id of this.selectedIds) removeNode(this.graph, id);
      this.selectedIds = new Set();
    });
    // #176: ノード名の編集。表示位置（ノード上部）に近い位置でインライン編集する。
    this.addMenuItem(menu, node.name ? "ノード名を編集" : "ノード名を設定", () => {
      this.editText((node.position?.x ?? 0) + 2, (node.position?.y ?? 0) - NODE_NAME_DY, node.name ?? "", (v) => {
        const t = v.trim();
        this.history.record(this.graph);
        if (t === "") delete node.name; else node.name = t;
      });
    });
    // #176: グループ名編集（所属グループがあるときのみ）。
    const gr = groupOfNode(this.graph, node.id);
    if (gr) {
      this.addMenuItem(menu, "グループ名編集", () => {
        this.editText((node.position?.x ?? 0), (node.position?.y ?? 0) - 6, gr.name ?? "", (v) => {
          const t = v.trim();
          this.history.record(this.graph);
          if (t === "") delete gr.name; else gr.name = t;
        });
      });
    }
  }

  private closeOnOutside = (e: PointerEvent): void => {
    const t = e.target as Node;
    const inMenu = this.contextMenu?.contains(t) || this.submenu?.contains(t);
    // #166: トグルボタン自身の上では閉じない（click のトグルが閉じる役を担うため・二重発火で再オープンするのを防ぐ）。
    const onAnchor = this.menuAnchor?.contains(t) ?? false;
    if (!inMenu && !onAnchor) this.closeContextMenu();
  };

  private closeSubmenu(): void {
    this.hideMenuTooltip(); // #203: サブメニュー消滅時にツールチップも消す
    if (!this.submenu) return;
    this.submenu.remove();
    this.submenu = null;
  }

  private closeContextMenu(): void {
    this.closeSubmenu();
    if (!this.contextMenu) return;
    window.removeEventListener("pointerdown", this.closeOnOutside, true);
    this.contextMenu.remove();
    this.contextMenu = null;
    this.menuAnchor = null;
  }

  /**
   * param 入力ポートが接続されていれば、上流ノードの直近ライブ出力値を返す。
   * 未接続（または値未評価）は undefined。
   */
  private resolveConnectedValue(node: NodeInstance, paramId: string): unknown {
    const c = this.graph.connections.find(
      (cc) => cc.to.node === node.id && cc.to.port === paramId,
    );
    if (!c) return undefined;
    return this.getOutputs?.(c.from.node)?.[c.from.port];
  }

  /** #99: ノード単位のファイル選択。一時的な input[type=file] を生成して開く。 */
  private openFileDialog(nodeId: string, accept: string): void {
    if (!this.loadFileIntoNode) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) this.loadFileIntoNode?.(nodeId, file);
      input.remove();
    });
    // キャンセル時も DOM に残さない（対応ブラウザのみ発火）。
    input.addEventListener("cancel", () => input.remove());
    input.click();
  }

  private editParam(e: PointerEvent, node: NodeInstance, paramIndex: number): void {
    const def = this.registry.require(node.type);
    const pd = def.params[paramIndex]!;
    // 2 値 enum はトグルボタン化（select オーバーレイを出さず即反転）。
    if (isToggleParam(pd)) {
      this.history.record(this.graph);
      node.params[pd.id] = toggledValue(pd, node.params[pd.id] ?? pd.default);
      return;
    }
    // #92: ズーム反映。world 座標をスクリーンへ変換し、幅・フォントも scale 倍にして
    // canvas 上の param 行に重なるようにする。
    const s = worldToScreen((node.position?.x ?? 0) + 56, paramRowY(node, def, paramIndex), this.offset, this.scale);
    openParamInput({
      screenX: s.x,
      screenY: s.y - 9 * this.scale,
      width: (NODE_WIDTH - 64) * this.scale,
      fontPx: 12 * this.scale,
      value: node.params[pd.id] ?? pd.default,
      kind: pd.kind,
      options: pd.options,
      onCommit: (v) => {
        if (node.params[pd.id] === v) return;
        this.history.record(this.graph);
        node.params[pd.id] = v;
      },
    });
  }

  /** #208: number 出力ポートの倍率チップを描く（既定 1 は控えめ、それ以外は強調）。 */
  private drawScaleChip(rect: { x: number; y: number; w: number; h: number }, scale: number): void {
    const ctx = this.ctx;
    const active = scale !== DEFAULT_OUTPUT_SCALE;
    ctx.save();
    ctx.fillStyle = active ? "#2f5a44" : "#23272c";
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 4);
    ctx.fill();
    ctx.strokeStyle = active ? "#5cc99a" : "#3a4048";
    ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = active ? "#bfeede" : "#5a626b";
    ctx.font = "10px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(formatScale(scale), rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.restore();
  }

  /** #208: 倍率チップをクリックしたとき、数値入力オーバーレイで倍率を編集する。 */
  private editOutputScale(node: NodeInstance, portId: string, chip: { x: number; y: number; w: number; h: number }): void {
    const s = worldToScreen(chip.x, chip.y + chip.h / 2, this.offset, this.scale);
    openParamInput({
      screenX: s.x,
      screenY: s.y - 9 * this.scale,
      width: 64 * this.scale,
      fontPx: 11 * this.scale,
      value: getOutputScale(node, portId),
      kind: "number",
      onCommit: (v) => {
        const next = typeof v === "number" && Number.isFinite(v) ? v : DEFAULT_OUTPUT_SCALE;
        if (getOutputScale(node, portId) === next) return;
        this.history.record(this.graph);
        setOutputScale(node, portId, next);
      },
    });
  }

  // ===== #176: ラベル（自由ラベル / ノードラベル / グループ名）=====

  /** world 座標 (wx,wy) にある自由ラベルを返す（テキスト矩形で簡易判定・後ろのものを優先）。 */
  private labelAt(wx: number, wy: number): TextLabel | undefined {
    const labels = this.graph.labels;
    if (!labels) return undefined;
    const ctx = this.ctx;
    ctx.font = "13px system-ui";
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i]!;
      const w = ctx.measureText(l.text || "ラベル").width + 12;
      const h = 20;
      if (wx >= l.x - 6 && wx <= l.x - 6 + w && wy >= l.y - h + 4 && wy <= l.y + 4) return l;
    }
    return undefined;
  }

  /** 任意位置にインライン文字入力を開く（ラベル/ノードラベル/グループ名の編集に共用）。 */
  private editText(worldX: number, worldY: number, value: string, onCommit: (v: string) => void): void {
    const s = worldToScreen(worldX, worldY, this.offset, this.scale);
    openParamInput({
      screenX: s.x, screenY: s.y - 9 * this.scale, width: 160 * this.scale, fontPx: 12 * this.scale,
      value, kind: "string",
      onCommit: (v) => onCommit(typeof v === "string" ? v : String(v ?? "")),
    });
  }

  /** 自由ラベルのテキストを編集する（空にすると削除）。 */
  private editLabel(lab: TextLabel): void {
    this.editText(lab.x, lab.y, lab.text, (v) => {
      const t = v.trim();
      this.history.record(this.graph);
      if (t === "") removeLabel(this.graph, lab.id);
      else lab.text = t;
    });
  }

  // --- 描画 ---
  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    this.draw();
  };

  /** #175: 各グループのメンバー外接矩形と名前を背面に描く。 */
  private drawGroups(): void {
    const groups = this.graph.groups;
    if (!groups) return;
    const ctx = this.ctx;
    const PAD = 12;
    ctx.font = "12px system-ui";
    for (const gr of groups) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
      for (const id of gr.nodeIds) {
        const n = findNode(this.graph, id);
        const def = n && this.registry.get(n.type);
        if (!n || !def) continue;
        const r = nodeRect(n, def);
        // #176: ノード名はノード上部に出るため、枠がはみ出さないよう上方向と幅を名前ぶん広げる。
        const topWithName = n.name ? r.y - NODE_NAME_DY - NODE_NAME_H : r.y;
        const rightWithName = n.name ? Math.max(r.x + r.w, r.x + 2 + ctx.measureText(n.name).width) : r.x + r.w;
        minX = Math.min(minX, r.x); minY = Math.min(minY, topWithName);
        maxX = Math.max(maxX, rightWithName); maxY = Math.max(maxY, r.y + r.h);
        any = true;
      }
      if (!any) continue;
      const x = minX - PAD, y = minY - PAD, w = (maxX - minX) + PAD * 2, h = (maxY - minY) + PAD * 2;
      ctx.fillStyle = "rgba(127,209,255,0.05)";
      ctx.strokeStyle = "rgba(127,209,255,0.35)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, y, w, h, 8);
      ctx.fill();
      ctx.stroke();
      if (gr.name) {
        ctx.fillStyle = "rgba(180,220,255,0.85)";
        ctx.font = "12px system-ui"; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
        ctx.fillText(gr.name, x + 4, y - 2);
        ctx.textBaseline = "middle";
      }
    }
  }

  /** #176: 自由ラベルを world 空間に描く（薄い角丸背景＋テキスト）。 */
  private drawLabels(): void {
    const labels = this.graph.labels;
    if (!labels) return;
    const ctx = this.ctx;
    ctx.font = "13px system-ui"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    for (const l of labels) {
      const text = l.text || "ラベル";
      const tw = ctx.measureText(text).width;
      const selected = this.selectedLabelId === l.id;
      // 当たり判定が分かるよう常に枠を描く。選択時はノード同様にハイライト。
      ctx.fillStyle = "rgba(20,20,26,0.7)";
      roundRect(ctx, l.x - 6, l.y - 16, tw + 12, 20, 4);
      ctx.fill();
      ctx.strokeStyle = selected ? "#ffd27f" : "rgba(255,233,168,0.4)";
      ctx.lineWidth = selected ? 2 : 1;
      ctx.stroke();
      ctx.fillStyle = "#ffe9a8";
      ctx.fillText(text, l.x, l.y - 6);
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "#0c0c10";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.translate(this.offset.x, this.offset.y);
    ctx.scale(this.scale, this.scale); // #92: ズーム

    // #175: グループの外接枠（ノード/配線の背面）
    this.drawGroups();
    // 配線
    for (const c of this.graph.connections) this.drawWire(c);
    // ドラッグ中の配線
    const drag = this.drag;
    if (drag?.kind === "wire") {
      const fromNode = findNode(this.graph, drag.fromNode);
      const def = fromNode ? this.registry.get(fromNode.type) : undefined;
      if (fromNode && def) {
        const i = def.outputs.findIndex((p) => p.id === drag.fromPort);
        const pos = outputPortPos(fromNode, i < 0 ? 0 : i);
        this.bezier(pos.x, pos.y, this.cursor.x, this.cursor.y, PORT_COLORS[drag.type]);
      }
    }
    // ノード
    for (const node of this.graph.nodes) this.drawNode(node);
    // #176: 自由ラベル（ノードの上に描く）
    this.drawLabels();
    // 矩形選択のオーバーレイ
    if (drag?.kind === "rect") {
      const r = normRect(drag.startX, drag.startY, this.cursor.x, this.cursor.y);
      ctx.fillStyle = "rgba(127,209,255,0.10)";
      ctx.strokeStyle = "rgba(127,209,255,0.7)";
      ctx.lineWidth = 1;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    ctx.restore();
    // #114: ツールチップは offset 変換の外（スクリーン座標）で最前面に描く。
    this.drawTooltip();
  }

  /** #114: ホバー継続が一定時間を超えたら、カーソル付近に説明ツールチップを描く。 */
  private drawTooltip(): void {
    const hover = this.hover;
    if (!hover || this.drag) return;
    if (performance.now() - hover.sinceMs < TOOLTIP_DELAY_MS) return;

    const ctx = this.ctx;
    const PAD = 8;
    const MAX_W = 280;
    const TITLE_FONT = "bold 12px system-ui";
    const BODY_FONT = "12px system-ui";
    const LINE_H = 16;

    // 本文を最大幅で折り返し、箱サイズを決める。
    ctx.font = BODY_FONT;
    const bodyLines = wrapLines(hover.content.body, MAX_W, (s) => ctx.measureText(s).width);
    ctx.font = TITLE_FONT;
    const titleW = ctx.measureText(hover.content.title).width;
    ctx.font = BODY_FONT;
    const bodyW = bodyLines.reduce((m, ln) => Math.max(m, ctx.measureText(ln).width), 0);
    const innerW = Math.min(MAX_W, Math.max(titleW, bodyW));
    const w = innerW + PAD * 2;
    const h = PAD * 2 + LINE_H + bodyLines.length * LINE_H;

    const box = tooltipBox(this.pointer.x, this.pointer.y, w, h, window.innerWidth, window.innerHeight);

    ctx.save();
    // 背景
    ctx.fillStyle = "rgba(20,20,26,0.96)";
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    roundRect(ctx, box.x, box.y, box.w, box.h, 5);
    ctx.fill();
    ctx.stroke();
    // テキスト
    ctx.textBaseline = "top";
    let ty = box.y + PAD;
    ctx.font = TITLE_FONT;
    ctx.fillStyle = "#ffd27f";
    ctx.fillText(hover.content.title, box.x + PAD, ty);
    ty += LINE_H;
    ctx.font = BODY_FONT;
    ctx.fillStyle = "#ddd";
    for (const ln of bodyLines) {
      ctx.fillText(ln, box.x + PAD, ty);
      ty += LINE_H;
    }
    ctx.restore();
  }

  private drawWire(c: Connection): void {
    const fromNode = findNode(this.graph, c.from.node);
    const toNode = findNode(this.graph, c.to.node);
    const fromDef = fromNode && this.registry.get(fromNode.type);
    const toDef = toNode && this.registry.get(toNode.type);
    if (!fromNode || !toNode || !fromDef || !toDef) return;
    const oi = fromDef.outputs.findIndex((p) => p.id === c.from.port);
    const b = resolveInputPortPos(toNode, toDef, c.to.port);
    if (oi < 0 || !b) return;
    const a = outputPortPos(fromNode, oi);
    this.bezier(a.x, a.y, b.x, b.y, PORT_COLORS[fromDef.outputs[oi]!.type]);
  }

  private bezier(ax: number, ay: number, bx: number, by: number, color: string): void {
    const ctx = this.ctx;
    const dx = Math.max(40, Math.abs(bx - ax) * 0.5);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(ax + dx, ay, bx - dx, by, bx, by);
    ctx.stroke();
  }

  private drawNode(node: NodeInstance): void {
    const ctx = this.ctx;
    const def = this.registry.get(node.type);
    if (!def) return;
    const r = nodeRect(node, def);
    // body
    ctx.fillStyle = "#16161c";
    ctx.strokeStyle = this.selectedIds.has(node.id) ? "#ffd27f" : "#444";
    ctx.lineWidth = this.selectedIds.has(node.id) ? 2 : 1;
    roundRect(ctx, r.x, r.y, r.w, r.h, 6);
    ctx.fill();
    ctx.stroke();
    // title
    ctx.fillStyle = CATEGORY_COLORS[def.category ?? ""] ?? "#333";
    roundRectTop(ctx, r.x, r.y, r.w, TITLE_H, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "13px system-ui";
    ctx.textBaseline = "middle";
    ctx.fillText(def.type, r.x + 8, r.y + TITLE_H / 2);
    // #176: ノード名はノードの上部にグループ名と同じスタイルで全文表示（タイトル内併記はしない）。
    if (node.name) {
      ctx.fillStyle = "rgba(180,220,255,0.9)"; ctx.font = "12px system-ui"; ctx.textBaseline = "bottom"; ctx.textAlign = "left";
      ctx.fillText(node.name, r.x + 2, r.y - NODE_NAME_DY + 4);
      ctx.textBaseline = "middle"; ctx.font = "13px system-ui";
    }

    // #77/#79: プレビュー対象ノードはタイトル右端に 👁（小窓トグル）
    if (nodeHasPreview(def)) {
      const b = previewButtonRect(node);
      drawEyeIcon(ctx, b.x + b.w / 2, b.y + b.h / 2, Boolean(node.preview));
      if (node.preview) {
        const w = previewWindowRect(node);
        ctx.fillStyle = "#000";
        ctx.fillRect(w.x, w.y, w.w, w.h);
        const src = this.getPreviewSource?.(node.id);
        if (src) {
          // video 等はソース寸法から contain でレターボックス描画
          const sw = (src as HTMLVideoElement).videoWidth ?? (src as HTMLCanvasElement).width ?? w.w;
          const sh = (src as HTMLVideoElement).videoHeight ?? (src as HTMLCanvasElement).height ?? w.h;
          const fit = containRect(Number(sw) || w.w, Number(sh) || w.h, w.w, w.h);
          ctx.drawImage(src, w.x + fit.x, w.y + fit.y, fit.w, fit.h);
        } else {
          // 未開始・権限拒否・テクスチャ未着のプレースホルダ
          ctx.fillStyle = "#666";
          ctx.font = "11px system-ui";
          ctx.textAlign = "center";
          ctx.fillText("no signal", w.x + w.w / 2, w.y + w.h / 2);
          ctx.textAlign = "left";
          ctx.font = "13px system-ui";
        }
        ctx.strokeStyle = "#6c9";
        ctx.lineWidth = 1;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
      }
    }

    ctx.font = "11px system-ui";
    // signal 入力ポート（上部）
    signalInputs(def).forEach((p, i) => {
      const pos = inputPortPos(node, i);
      this.drawPort(pos.x, pos.y, p.type);
      ctx.fillStyle = "#bbb"; ctx.textAlign = "left";
      ctx.fillText(p.label, pos.x + 10, pos.y);
    });
    // output ports（ライブ値はデバッグトグル ON のときのみ表示）
    const outputs = this.showOutputValues ? this.getOutputs?.(node.id) : undefined;
    def.outputs.forEach((p, i) => {
      const pos = outputPortPos(node, i);
      this.drawPort(pos.x, pos.y, p.type);
      // #208: number 出力は右端に倍率チップを描き、ラベルはその左へ寄せて重なりを避ける。
      let labelRight = pos.x - 10;
      if (p.type === "number") {
        const chip = outputScaleChipRect(node, i);
        this.drawScaleChip(chip, getOutputScale(node, p.id));
        labelRight = chip.x - 4;
      }
      ctx.fillStyle = "#bbb"; ctx.textAlign = "right";
      ctx.fillText(p.label, labelRight, pos.y);
      if (outputs) {
        const txt = formatPortValue(outputs[p.id], p.type);
        if (txt) {
          ctx.fillStyle = "#6c9"; ctx.textAlign = "left";
          ctx.fillText(txt, pos.x + 10, pos.y);
        }
      }
    });
    ctx.textAlign = "left";
    // params（数値 param は左辺に接続ドット）。#154: hidden param（assetId 等）は描かない。
    def.params.forEach((p, i) => {
      if (p.hidden) return;
      const y = paramRowY(node, def, i);
      ctx.fillStyle = "#222";
      ctx.fillRect(r.x + 6, y - ROW_H / 2 + 2, r.w - 12, ROW_H - 4);
      // 接続中は上流のライブ値を表示（手動値は無視されるため）。未接続は手動値。
      const live = this.resolveConnectedValue(node, p.id);
      // min/max を持つ数値 param はスライダのフィルバーを敷く（接続中はライブ値で）。
      if (isParamEditableBySlider(p)) {
        const fillVal = typeof live === "number" ? live : Number(node.params[p.id] ?? p.default);
        const ratio = Number.isFinite(fillVal) ? fillRatio(fillVal, p) : null;
        if (ratio !== null) {
          ctx.fillStyle = typeof live === "number" ? "#1d3a30" : "#2a3a4a";
          ctx.fillRect(r.x + 6, y - ROW_H / 2 + 2, (r.w - 12) * ratio, ROW_H - 4);
        }
      }
      ctx.fillStyle = "#9ab"; ctx.textAlign = "left";
      ctx.fillText(p.label, r.x + 12, y);
      if (live !== undefined) {
        ctx.fillStyle = "#6c9"; ctx.textAlign = "right";
        ctx.fillText(formatPortValue(live, "number") || String(live), r.x + r.w - 10, y);
      } else if (isToggleParam(p)) {
        const val = String(node.params[p.id] ?? p.default);
        const on = val === toggleOnValue(p);
        const pw = 34, ph = ROW_H - 8;
        const pxr = r.x + r.w - 10 - pw;
        ctx.fillStyle = on ? "#2f6b4f" : "#333";
        roundRect(ctx, pxr, y - ph / 2, pw, ph, ph / 2);
        ctx.fill();
        // ノブ
        ctx.fillStyle = on ? "#9fe" : "#888";
        ctx.beginPath();
        ctx.arc(on ? pxr + pw - ph / 2 : pxr + ph / 2, y, ph / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "#fff"; ctx.textAlign = "right";
        ctx.fillText(String(node.params[p.id] ?? p.default), r.x + r.w - 10, y);
      }
      ctx.textAlign = "left";
      if (isParamInput(def, p.id)) {
        const pos = paramPortPos(node, def, i);
        this.drawPort(pos.x, pos.y, "number");
      }
    });
    // #99: ファイル選択行（クリックで OS ダイアログ）。現在のファイル名 or「ファイル未選択」。
    if (hasFileRow(def)) {
      const fr = fileRowRect(node, def)!;
      const selected = Boolean(this.getFileName?.(node.id));
      ctx.fillStyle = selected ? "#243042" : "#262630";
      roundRect(ctx, fr.x + 6, fr.y + 2, fr.w - 12, fr.h - 4, 4);
      ctx.fill();
      ctx.strokeStyle = "#4a5566"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#9ab"; ctx.textAlign = "left"; ctx.font = "11px system-ui";
      ctx.fillText("📁", fr.x + 12, fr.y + fr.h / 2);
      const label = fileRowLabel(this.getFileName?.(node.id));
      ctx.fillStyle = selected ? "#cfe" : "#888";
      const maxW = fr.w - 38;
      ctx.fillText(ellipsizeEnd(ctx, label, maxW), fr.x + 30, fr.y + fr.h / 2);

      // transport 行: 再生/停止ボタン・進捗付きシークバー・現在時刻。
      const tr = transportRowRect(node, def)!;
      const { button, seek } = transportLayout(tr);
      const pb = this.playback?.get(node.id);
      const dur = pb?.duration ?? 0;
      const cur = pb?.current ?? 0;
      const playing = Boolean(pb?.playing);
      // ボタン
      ctx.fillStyle = dur > 0 ? "#9ab" : "#555";
      drawTransportIcon(ctx, button, playing);
      // シークバー（背景＋進捗）
      ctx.fillStyle = "#2a2a33";
      roundRect(ctx, seek.x, seek.y, seek.w, seek.h, seek.h / 2);
      ctx.fill();
      if (dur > 0) {
        const ratio = Math.max(0, Math.min(cur / dur, 1));
        ctx.fillStyle = "#6c9";
        roundRect(ctx, seek.x, seek.y, Math.max(seek.h, seek.w * ratio), seek.h, seek.h / 2);
        ctx.fill();
      }
      // 現在時刻
      ctx.fillStyle = "#9ab"; ctx.textAlign = "right"; ctx.font = "10px system-ui";
      ctx.fillText(formatTime(cur), tr.x + tr.w - 6, tr.y + tr.h / 2);
      ctx.textAlign = "left";
    }
    // #152: シーン選択行（クリックで参照シーンのドロップダウン）。
    if (hasSceneRow(def)) {
      const sr = sceneRowRect(node, def)!;
      const name = this.sceneSelect?.current(node.id) ?? null;
      ctx.fillStyle = name ? "#243042" : "#262630";
      roundRect(ctx, sr.x + 6, sr.y + 2, sr.w - 12, sr.h - 4, 4);
      ctx.fill();
      ctx.strokeStyle = "#4a5566"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#9ab"; ctx.textAlign = "left"; ctx.font = "11px system-ui";
      ctx.fillText(ellipsizeEnd(ctx, sceneRowLabel(name), sr.w - 24), sr.x + 12, sr.y + sr.h / 2);
    }
    // #205: パッドグリッド（4×4）。音入り=色付き＋短縮ラベル、空=暗色。
    if (hasPadGrid(def)) {
      // タイトルバーに拡大（⛶）/ 全停止（■）ボタンを描く。
      const eb = padExpandButtonRect(node);
      ctx.fillStyle = "#2a2a36";
      roundRect(ctx, eb.x, eb.y, eb.w, eb.h, 3); ctx.fill();
      ctx.fillStyle = "#cfeede"; ctx.font = "12px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("⛶", eb.x + eb.w / 2, eb.y + eb.h / 2 + 0.5);
      const sb = padStopButtonRect(node);
      ctx.fillStyle = "#3a2a2a";
      roundRect(ctx, sb.x, sb.y, sb.w, sb.h, 3); ctx.fill();
      ctx.fillStyle = "#e9a0a0";
      ctx.fillRect(sb.x + sb.w / 2 - 4, sb.y + sb.h / 2 - 4, 8, 8); // ■
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const grid = def.padGrid!;
      const count = grid.rows * grid.cols;
      ctx.font = "9px system-ui";
      for (let i = 0; i < count; i++) {
        const pr = padRect(node, def, i);
        if (!pr) continue;
        const info = this.padCellInfo?.(node.id, i);
        const filled = info?.filled ?? false;
        ctx.fillStyle = filled ? "#2f5a44" : "#1e2228";
        roundRect(ctx, pr.x, pr.y, pr.w, pr.h, 4);
        ctx.fill();
        ctx.strokeStyle = filled ? "#5cc99a" : "#3a4048";
        ctx.lineWidth = 1; ctx.stroke();
        const label = filled ? (info?.label ?? null) : null;
        ctx.fillStyle = filled ? "#cfeede" : "#586068";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const text = label ?? String(i + 1);
        ctx.fillText(ellipsizeEnd(ctx, text, pr.w - 6), pr.x + pr.w / 2, pr.y + pr.h / 2);
      }
      ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = "11px system-ui";
    }
    // #150: 🎲ランダムボタン行。
    if (def.randomButton) {
      const rr = randomRowRect(node, def)!;
      ctx.fillStyle = "#2a2433";
      roundRect(ctx, rr.x + 6, rr.y + 2, rr.w - 12, rr.h - 4, 4);
      ctx.fill();
      ctx.strokeStyle = "#5a4a66"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#cbe"; ctx.textAlign = "center"; ctx.font = "11px system-ui";
      ctx.fillText("🎲 ランダム", rr.x + rr.w / 2, rr.y + rr.h / 2);
      ctx.textAlign = "left";
    }
  }

  private drawPort(x: number, y: number, type: PortType): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, PORT_R, 0, Math.PI * 2);
    ctx.fillStyle = PORT_COLORS[type];
    ctx.fill();
    ctx.strokeStyle = "#111"; ctx.lineWidth = 1; ctx.stroke();
  }

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener("resize", this.resize);
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("dragover", this.onDragOver);
    this.canvas.removeEventListener("drop", this.onDrop);
    this.closeContextMenu();
    this.toolbar.remove();
  }
}

/** プレビュートグルの目アイコン（#77）。絵文字は色制御不可で見栄えが悪いためベクタ描画。 */
function drawEyeIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, on: boolean): void {
  const color = on ? "#6c9" : "rgba(255,255,255,0.45)";
  const w = 7;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.3;
  // まぶた（上下の弧）
  ctx.beginPath();
  ctx.moveTo(cx - w, cy);
  ctx.quadraticCurveTo(cx, cy - 9, cx + w, cy);
  ctx.quadraticCurveTo(cx, cy + 9, cx - w, cy);
  ctx.closePath();
  ctx.stroke();
  // 瞳（ON は大きく塗る）
  ctx.beginPath();
  ctx.arc(cx, cy, on ? 2.4 : 1.6, 0, Math.PI * 2);
  ctx.fill();
}

/** 再生(▶)/一時停止(⏸) アイコンをボタン矩形中央にベクタ描画（現 fillStyle を使う）。 */
function drawTransportIcon(
  ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, playing: boolean,
): void {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const s = Math.min(b.w, b.h) * 0.5;
  if (playing) {
    const bw = s * 0.32;
    ctx.fillRect(cx - s / 2, cy - s / 2, bw, s);
    ctx.fillRect(cx + s / 2 - bw, cy - s / 2, bw, s);
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - s / 2, cy - s / 2);
    ctx.lineTo(cx + s / 2, cy);
    ctx.lineTo(cx - s / 2, cy + s / 2);
    ctx.closePath();
    ctx.fill();
  }
}

/** 末尾を … で切り詰めて maxWidth に収める（収まればそのまま）。 */
function ellipsizeEnd(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxWidth) s = s.slice(0, -1);
  return s + "…";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundRectTop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
