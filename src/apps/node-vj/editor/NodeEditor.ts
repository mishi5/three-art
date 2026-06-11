// Canvas2D ノードエディタ。ノードの配置・移動・接続・切断・param 編集を行う。
// 座標計算は layout.ts を共有し、描画とヒット判定の整合を保つ。
import {
  addConnection, addNode, findNode, removeConnection, removeNode,
  type Connection, type GraphDoc, type NodeInstance,
} from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";
import { isCompatible, type PortType } from "../graph/port-types";
import { signalInputs, isParamInput } from "../graph/node-ports";
import {
  NODE_WIDTH, TITLE_H, ROW_H, PORT_R, nodeRect,
  inputPortPos, outputPortPos, paramRowY, paramPortPos, resolveInputPortPos,
  previewButtonRect, previewWindowRect,
} from "./layout";
import { hitTest } from "./hit-test";
import { openParamInput } from "./param-overlay";
import { formatPortValue } from "./port-format";
import { absoluteSliderValue, scrubValue, fillRatio, isAbsoluteSlider } from "./slider-logic";
import type { ParamDef } from "../graph/node-type";

/** スライダドラッグで編集できる param（数値のみ。enum/boolean/string はクリック編集）。 */
function isParamEditableBySlider(pd: ParamDef): boolean {
  return pd.kind === "number" || pd.kind === "int";
}

const PORT_COLORS: Record<PortType, string> = {
  number: "#7fd1ff", vec2: "#9aff9a", vec3: "#9aff9a", color: "#ffd27f",
  pose: "#ff9af0", audio: "#ffec7f", texture: "#c79aff", trigger: "#ff7f7f",
};
const CATEGORY_COLORS: Record<string, string> = {
  input: "#2a4a6a", process: "#3a5a3a", visual: "#5a3a5a", output: "#5a3a3a",
};

type Drag =
  | { kind: "node"; id: string; dx: number; dy: number }
  | { kind: "wire"; fromNode: string; fromPort: string; type: PortType }
  | { kind: "pan"; startX: number; startY: number; ox: number; oy: number }
  // param 行のスライダドラッグ候補。moved=false のまま up したらクリック（数値入力）扱い。
  | { kind: "param"; nodeId: string; paramIndex: number; moved: boolean; startX: number; lastX: number }
  | null;

/** クリックとドラッグを分ける移動量しきい値 (px)。 */
const DRAG_THRESHOLD = 3;

let idCounter = 0;
function genId(prefix: string): string { return `${prefix}${Date.now().toString(36)}_${++idCounter}`; }

export class NodeEditor {
  private ctx: CanvasRenderingContext2D;
  private offset = { x: 60, y: 60 };
  private drag: Drag = null;
  private cursor = { x: 0, y: 0 };
  private selected: string | null = null;
  private rafId: number | null = null;
  private toolbar: HTMLDivElement;
  /** 出力ポート横のライブ値表示（デバッグ用）。既定 OFF、ツールバーで切替。 */
  private showOutputValues = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private graph: GraphDoc,
    private registry: NodeRegistry,
    /** 出力ポートのライブ値を引く（GraphRuntime の直近評価結果）。任意。 */
    private getOutputs?: (nodeId: string) => Record<string, unknown> | undefined,
    /** プレビュー小窓用 canvas を引く（#77、GraphRuntime の読み戻し結果）。任意。 */
    private getPreviewCanvas?: (nodeId: string) => HTMLCanvasElement | undefined,
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
    bar.style.cssText =
      "position:fixed;left:8px;top:8px;display:flex;gap:6px;flex-wrap:wrap;z-index:150;" +
      "font:12px system-ui;";
    for (const def of this.registry.list()) {
      const btn = document.createElement("button");
      btn.textContent = "+ " + def.type;
      btn.style.cssText =
        "background:#1c1c22;color:#ddd;border:1px solid #444;border-radius:4px;padding:4px 8px;cursor:pointer;";
      btn.addEventListener("click", () => this.addNodeOfType(def.type));
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
    hint.textContent = "  ドラッグ=移動 / 出力●→入力●=接続 / 入力●クリック=切断 / param クリック=編集 / Del=削除";
    hint.style.cssText = "color:#888;align-self:center;";
    bar.appendChild(hint);
    document.body.appendChild(bar);
    return bar;
  }

  addNodeOfType(type: string): void {
    const def = this.registry.require(type);
    const node: NodeInstance = {
      id: genId("n"),
      type,
      params: Object.fromEntries(def.params.map((p) => [p.id, p.default])),
      position: {
        x: -this.offset.x + 120 + Math.round((idCounter % 5) * 24),
        y: -this.offset.y + 120 + Math.round((idCounter % 5) * 24),
      },
    };
    addNode(this.graph, node);
    this.selected = node.id;
  }

  // --- pointer 座標 → world 座標 ---
  private toWorld(e: PointerEvent): { x: number; y: number } {
    return { x: e.clientX - this.offset.x, y: e.clientY - this.offset.y };
  }

  private onDown = (e: PointerEvent): void => {
    const w = this.toWorld(e);
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
        if (existing) removeConnection(this.graph, existing.id);
      }
      return;
    }
    if (hit?.kind === "param") {
      // すぐには編集を開かず、ドラッグ（スライダ）かクリック（数値入力）かを up で判定する。
      this.selected = hit.node.id;
      this.drag = {
        kind: "param", nodeId: hit.node.id, paramIndex: hit.paramIndex,
        moved: false, startX: w.x, lastX: w.x,
      };
      return;
    }
    if (hit?.kind === "node") {
      // #77: texture 出力を持つノードのタイトル右端 👁 はプレビュー小窓のトグル。
      const def = this.registry.get(hit.node.type);
      if (def?.outputs.some((p) => p.type === "texture")) {
        const b = previewButtonRect(hit.node);
        if (w.x >= b.x && w.x <= b.x + b.w && w.y >= b.y && w.y <= b.y + b.h) {
          hit.node.preview = !hit.node.preview;
          return;
        }
      }
      this.selected = hit.node.id;
      const p = hit.node.position ?? { x: 0, y: 0 };
      this.drag = { kind: "node", id: hit.node.id, dx: w.x - p.x, dy: w.y - p.y };
      return;
    }
    this.selected = null;
    this.drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: this.offset.x, oy: this.offset.y };
  };

  private onMove = (e: PointerEvent): void => {
    this.cursor = this.toWorld(e);
    if (!this.drag) return;
    if (this.drag.kind === "node") {
      const node = findNode(this.graph, this.drag.id);
      if (node) node.position = { x: this.cursor.x - this.drag.dx, y: this.cursor.y - this.drag.dy };
    } else if (this.drag.kind === "pan") {
      this.offset.x = this.drag.ox + (e.clientX - this.drag.startX);
      this.offset.y = this.drag.oy + (e.clientY - this.drag.startY);
    } else if (this.drag.kind === "param") {
      this.dragParam(this.drag);
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
    if (this.drag?.kind === "param" && !this.drag.moved) {
      // ドラッグなし＝クリック → 従来の数値入力/選択オーバーレイを開く。
      const node = findNode(this.graph, this.drag.nodeId);
      if (node) this.editParam(e, node, this.drag.paramIndex);
    }
    if (this.drag?.kind === "wire") {
      const w = this.toWorld(e);
      // 遮蔽つき判定: 手前ノードの本体に隠れた入力ポートへは接続しない。
      const target = hitTest(this.graph.nodes, this.registry, w.x, w.y);
      if (target?.kind === "port" && target.portKind === "input" && isCompatible(this.drag.type, target.type)) {
        const conn: Connection = {
          id: genId("c"),
          from: { node: this.drag.fromNode, port: this.drag.fromPort },
          to: { node: target.node.id, port: target.port },
        };
        addConnection(this.graph, this.registry, conn);
      }
    }
    this.drag = null;
  };

  private onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected) {
      removeNode(this.graph, this.selected);
      this.selected = null;
    }
  };

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

  private editParam(e: PointerEvent, node: NodeInstance, paramIndex: number): void {
    const def = this.registry.require(node.type);
    const pd = def.params[paramIndex]!;
    openParamInput({
      screenX: (node.position?.x ?? 0) + this.offset.x + 56,
      screenY: paramRowY(node, def, paramIndex) + this.offset.y - 9,
      width: NODE_WIDTH - 64,
      value: node.params[pd.id] ?? pd.default,
      kind: pd.kind,
      options: pd.options,
      onCommit: (v) => { node.params[pd.id] = v; },
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
    ctx.strokeStyle = node.id === this.selected ? "#ffd27f" : "#444";
    ctx.lineWidth = node.id === this.selected ? 2 : 1;
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

    // #77: texture 出力を持つノードはタイトル右端に 👁（プレビュー小窓トグル）
    if (def.outputs.some((p) => p.type === "texture")) {
      const b = previewButtonRect(node);
      ctx.fillStyle = node.preview ? "#6c9" : "rgba(255,255,255,0.35)";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("\u{1F441}", b.x + b.w / 2, b.y + b.h / 2 + 1);
      ctx.textAlign = "left";
      ctx.font = "13px system-ui";
      if (node.preview) {
        const w = previewWindowRect(node);
        ctx.fillStyle = "#000";
        ctx.fillRect(w.x, w.y, w.w, w.h);
        const pc = this.getPreviewCanvas?.(node.id);
        if (pc) ctx.drawImage(pc, w.x, w.y, w.w, w.h);
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
    // params（数値 param は左辺に接続ドット）
    def.params.forEach((p, i) => {
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
    this.toolbar.remove();
  }
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
