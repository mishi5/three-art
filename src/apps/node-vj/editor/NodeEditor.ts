// Canvas2D ノードエディタ。ノードの配置・移動・接続・切断・param 編集を行う。
// 座標計算は layout.ts を共有し、描画とヒット判定の整合を保つ。
import {
  addConnection, addNode, findNode, removeConnection, removeNode, replaceGraph,
  type Connection, type GraphDoc, type NodeInstance,
} from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { isCompatible, type PortType } from "../graph/port-types";
import { signalInputs, isParamInput } from "../graph/node-ports";
import {
  NODE_WIDTH, TITLE_H, ROW_H, PORT_R, nodeRect,
  inputPortPos, outputPortPos, paramRowY, paramPortPos, resolveInputPortPos,
  previewButtonRect, previewWindowRect, hasFileRow, fileRowRect, fileRowLabel,
  transportRowRect, transportLayout, seekRatioAt, formatTime, randomRowRect,
} from "./layout";
import { randomInRange } from "./random-value";
import { hitTest } from "./hit-test";
import { tooltipForHit, tooltipBox, wrapLines, type TooltipContent } from "./tooltip";
import { screenToWorld, worldToScreen, zoomAt } from "./viewport";
import { groupNodesByCategory } from "./node-menu";
import { duplicateNodes } from "../graph/duplicate";
import type { History } from "../graph/history";
import { nodesInRect, normRect } from "./selection";
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
const CATEGORY_COLORS: Record<string, string> = {
  input: "#2a4a6a", process: "#3a5a3a", visual: "#5a3a5a", effect: "#3a4a5a", output: "#5a3a3a",
};

type Drag =
  // 選択グループの一括移動。anchors は各ノードの「カーソル→ノード位置」オフセット。
  | { kind: "group"; anchors: Map<string, { dx: number; dy: number }>; moved: boolean }
  | { kind: "wire"; fromNode: string; fromPort: string; type: PortType }
  | { kind: "pan"; startX: number; startY: number; ox: number; oy: number }
  // 空白ドラッグの矩形選択（#83）。start は world 座標。
  | { kind: "rect"; startX: number; startY: number }
  // param 行のスライダドラッグ候補。moved=false のまま up したらクリック（数値入力）扱い。
  | { kind: "param"; nodeId: string; paramIndex: number; moved: boolean; recorded: boolean; startX: number; lastX: number }
  // #99: transport 行シークバーのドラッグ（クリック/スクラブで seek）。
  | { kind: "seek"; nodeId: string; seek: { x: number; w: number }; duration: number }
  | null;

/** クリックとドラッグを分ける移動量しきい値 (px)。 */
const DRAG_THRESHOLD = 3;

/** #114: ホバー開始からツールチップ表示までの待ち時間 (ms)。 */
const TOOLTIP_DELAY_MS = 450;

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
  /** Space 押下中は空白ドラッグをパンにする（#83 で空白ドラッグは矩形選択に変更）。 */
  private spaceDown = false;
  private rafId: number | null = null;
  private toolbar: HTMLDivElement;
  /** #103: 右クリック/ツールバーのコンテキストメニュー（開いていなければ null）。 */
  private contextMenu: HTMLDivElement | null = null;
  /** #103: 開いているフライアウトサブメニュー（カテゴリ → 型一覧）。 */
  private submenu: HTMLDivElement | null = null;
  /** #166: 現在のメニューを開いたトグルボタン。再押下クローズの判定に使う（右クリックメニューは null）。 */
  private menuAnchor: HTMLElement | null = null;
  /** 出力ポート横のライブ値表示（デバッグ用）。既定 OFF、ツールバーで切替。 */
  private showOutputValues = false;
  /** #154: アセットパネルから canvas へ D&D されたときのコールバック（world 座標）。任意。 */
  onDropAsset?: (assetId: string, worldX: number, worldY: number) => void;

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
    hint.textContent = "  右クリック=メニュー / 空白ドラッグ=矩形選択 / Space|右ドラッグ=パン / ホイール=ズーム / 0=ズーム100% / Cmd+C=複製 / Del=削除";
    hint.style.cssText = "color:#888;align-self:center;";
    bar.appendChild(hint);
    document.body.appendChild(bar);
    return bar;
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

  /** #154: asset id を運ぶ D&D のみ受け入れる（ドロップ可否を示すため preventDefault）。 */
  private onDragOver = (e: DragEvent): void => {
    if (e.dataTransfer?.types.includes("application/x-node-vj-asset")) e.preventDefault();
  };

  /** #154: ドロップ位置（world 座標）と asset id を onDropAsset へ通知する。 */
  private onDrop = (e: DragEvent): void => {
    const id = e.dataTransfer?.getData("application/x-node-vj-asset");
    if (!id) return;
    e.preventDefault();
    const w = screenToWorld(e.clientX, e.clientY, this.offset, this.scale);
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
    // パン: Space+左ドラッグ / 中ボタン / 右ボタン（#83 で空白左ドラッグは矩形選択に変更）。
    if (e.button !== 0 || this.spaceDown) {
      this.drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: this.offset.x, oy: this.offset.y };
      return;
    }
    // #80: 遮蔽つき統一ヒットテスト。最前面ノードがイベントを所有する。
    const hit = hitTest(this.graph.nodes, this.registry, w.x, w.y);
    if (hit?.kind === "port") {
      if (hit.portKind === "output") {
        this.drag = { kind: "wire", fromNode: hit.node.id, fromPort: hit.port, type: hit.type };
      } else {
        // 入力ポート: 接続済みなら切断
        const existing = this.graph.connections.find(
          (c) => c.to.node === hit.node.id && c.to.port === hit.port,
        );
        if (existing) {
          this.history.record(this.graph);
          removeConnection(this.graph, existing.id);
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
      // Cmd/Ctrl+クリック = 選択トグル（ドラッグは開始しない）
      if (e.metaKey || e.ctrlKey) {
        if (this.selectedIds.has(hit.node.id)) this.selectedIds.delete(hit.node.id);
        else this.selectedIds.add(hit.node.id);
        return;
      }
      // 未選択ノードなら単独選択に置き換え、選択済みならグループのままドラッグ
      if (!this.selectedIds.has(hit.node.id)) this.selectedIds = new Set([hit.node.id]);
      const anchors = new Map<string, { dx: number; dy: number }>();
      for (const id of this.selectedIds) {
        const n = findNode(this.graph, id);
        const p = n?.position ?? { x: 0, y: 0 };
        anchors.set(id, { dx: w.x - p.x, dy: w.y - p.y });
      }
      this.drag = { kind: "group", anchors, moved: false };
      return;
    }
    // 空白: 矩形選択を開始（確定は up）
    this.drag = { kind: "rect", startX: w.x, startY: w.y };
  };

  private onMove = (e: PointerEvent): void => {
    this.cursor = this.toWorld(e);
    this.pointer = { x: e.clientX, y: e.clientY };
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
      this.offset.x = this.drag.ox + (e.clientX - this.drag.startX);
      this.offset.y = this.drag.oy + (e.clientY - this.drag.startY);
    } else if (this.drag.kind === "param") {
      this.dragParam(this.drag);
    } else if (this.drag.kind === "seek") {
      this.playback?.seek(this.drag.nodeId, seekRatioAt(this.cursor.x, this.drag.seek) * this.drag.duration);
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
    if (this.drag?.kind === "param" && !this.drag.moved) {
      // ドラッグなし＝クリック → 従来の数値入力/選択オーバーレイを開く。
      const node = findNode(this.graph, this.drag.nodeId);
      if (node) this.editParam(e, node, this.drag.paramIndex);
    }
    if (this.drag?.kind === "wire") {
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
      if (drop && isCompatible(this.drag.type, drop.type)) {
        const conn: Connection = {
          id: genId("c"),
          from: { node: this.drag.fromNode, port: this.drag.fromPort },
          to: { node: drop.node, port: drop.port },
        };
        this.history.record(this.graph);
        const res = addConnection(this.graph, this.registry, conn);
        if (!res.ok) this.history.discardLast(); // 無効な接続は操作として積まない
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
    // #83: Cmd/Ctrl+C で選択ノードを即複製（+24px）し、複製群を選択状態にする。
    if ((e.metaKey || e.ctrlKey) && e.key === "c" && this.selectedIds.size > 0) {
      e.preventDefault();
      this.history.record(this.graph);
      const newIds = duplicateNodes(this.graph, this.selectedIds, genId, 24);
      this.selectedIds = new Set(newIds);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    // #167: e.code で判定（IME 経由の keyup は e.key が " " にならず取りこぼすため）。
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
    const hit = hitTest(this.graph.nodes, this.registry, w.x, w.y);
    if (hit && hit.kind !== "port") {
      this.showNodeMenu(e.clientX, e.clientY, hit.node);
    } else {
      this.showAddMenu(e.clientX, e.clientY, w);
    }
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

  private addMenuItem(menu: HTMLElement, text: string, onClick: () => void): void {
    const item = document.createElement("div");
    item.textContent = text;
    item.style.cssText = "padding:4px 10px;border-radius:4px;cursor:pointer;white-space:nowrap;";
    item.addEventListener("mouseenter", () => { item.style.background = "#2a2a36"; });
    item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
    item.addEventListener("click", () => { this.closeContextMenu(); onClick(); });
    menu.appendChild(item);
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
      this.addMenuItem(sub, "+ " + type, () => this.addNodeOfType(type, worldPos));
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
      this.addMenuItem(menu, "+ " + type, () => this.addNodeOfType(type));
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
  }

  private closeOnOutside = (e: PointerEvent): void => {
    const t = e.target as Node;
    const inMenu = this.contextMenu?.contains(t) || this.submenu?.contains(t);
    // #166: トグルボタン自身の上では閉じない（click のトグルが閉じる役を担うため・二重発火で再オープンするのを防ぐ）。
    const onAnchor = this.menuAnchor?.contains(t) ?? false;
    if (!inMenu && !onAnchor) this.closeContextMenu();
  };

  private closeSubmenu(): void {
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

  // --- 描画 ---
  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    this.draw();
  };

  private draw(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = "#0c0c10";
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.translate(this.offset.x, this.offset.y);
    ctx.scale(this.scale, this.scale); // #92: ズーム

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
      ctx.fillStyle = "#bbb"; ctx.textAlign = "right";
      ctx.fillText(p.label, pos.x - 10, pos.y);
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
