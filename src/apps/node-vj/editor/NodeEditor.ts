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
  inputPortPos, outputPortPos, paramRowY, paramPortPos, resolveInputPortPos, dist2,
} from "./layout";
import { openParamInput } from "./param-overlay";
import { formatPortValue } from "./port-format";

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
  | null;

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

  constructor(
    private canvas: HTMLCanvasElement,
    private graph: GraphDoc,
    private registry: NodeRegistry,
    /** 出力ポートのライブ値を引く（GraphRuntime の直近評価結果）。任意。 */
    private getOutputs?: (nodeId: string) => Record<string, unknown> | undefined,
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

  private hitPort(wx: number, wy: number): { node: string; port: string; kind: "input" | "output"; type: PortType } | null {
    const r2 = (PORT_R + 4) * (PORT_R + 4);
    for (const node of this.graph.nodes) {
      const def = this.registry.get(node.type);
      if (!def) continue;
      // signal 入力（上部行）
      const sig = signalInputs(def);
      for (let i = 0; i < sig.length; i++) {
        const pos = inputPortPos(node, i);
        if (dist2(wx, wy, pos.x, pos.y) <= r2)
          return { node: node.id, port: sig[i]!.id, kind: "input", type: sig[i]!.type };
      }
      // 出力
      for (let i = 0; i < def.outputs.length; i++) {
        const pos = outputPortPos(node, i);
        if (dist2(wx, wy, pos.x, pos.y) <= r2)
          return { node: node.id, port: def.outputs[i]!.id, kind: "output", type: def.outputs[i]!.type };
      }
      // 数値 param の行ドット（入力）
      for (let i = 0; i < def.params.length; i++) {
        if (!isParamInput(def, def.params[i]!.id)) continue;
        const pos = paramPortPos(node, def, i);
        if (dist2(wx, wy, pos.x, pos.y) <= r2)
          return { node: node.id, port: def.params[i]!.id, kind: "input", type: "number" };
      }
    }
    return null;
  }

  private hitParam(wx: number, wy: number): { node: NodeInstance; paramIndex: number } | null {
    for (const node of this.graph.nodes) {
      const def = this.registry.get(node.type);
      if (!def) continue;
      const r = nodeRect(node, def);
      if (wx < r.x || wx > r.x + r.w) continue;
      for (let i = 0; i < def.params.length; i++) {
        const y = paramRowY(node, def, i);
        if (Math.abs(wy - y) <= ROW_H / 2) return { node, paramIndex: i };
      }
    }
    return null;
  }

  private hitNode(wx: number, wy: number): NodeInstance | null {
    // 後ろ（描画順で上）のノードを優先するため逆順
    for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
      const node = this.graph.nodes[i]!;
      const def = this.registry.get(node.type);
      if (!def) continue;
      const r = nodeRect(node, def);
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return node;
    }
    return null;
  }

  private onDown = (e: PointerEvent): void => {
    const w = this.toWorld(e);
    const port = this.hitPort(w.x, w.y);
    if (port) {
      if (port.kind === "output") {
        this.drag = { kind: "wire", fromNode: port.node, fromPort: port.port, type: port.type };
      } else {
        // 入力ポート: 接続済みなら切断
        const existing = this.graph.connections.find(
          (c) => c.to.node === port.node && c.to.port === port.port,
        );
        if (existing) removeConnection(this.graph, existing.id);
      }
      return;
    }
    const param = this.hitParam(w.x, w.y);
    if (param) { this.editParam(e, param.node, param.paramIndex); return; }

    const node = this.hitNode(w.x, w.y);
    if (node) {
      this.selected = node.id;
      const p = node.position ?? { x: 0, y: 0 };
      this.drag = { kind: "node", id: node.id, dx: w.x - p.x, dy: w.y - p.y };
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
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (this.drag?.kind === "wire") {
      const w = this.toWorld(e);
      const target = this.hitPort(w.x, w.y);
      if (target && target.kind === "input" && isCompatible(this.drag.type, target.type)) {
        const conn: Connection = {
          id: genId("c"),
          from: { node: this.drag.fromNode, port: this.drag.fromPort },
          to: { node: target.node, port: target.port },
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

    ctx.font = "11px system-ui";
    // signal 入力ポート（上部）
    signalInputs(def).forEach((p, i) => {
      const pos = inputPortPos(node, i);
      this.drawPort(pos.x, pos.y, p.type);
      ctx.fillStyle = "#bbb"; ctx.textAlign = "left";
      ctx.fillText(p.label, pos.x + 10, pos.y);
    });
    // output ports（ライブ値があればポート右に表示）
    const outputs = this.getOutputs?.(node.id);
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
      const val = node.params[p.id] ?? p.default;
      ctx.fillStyle = "#222";
      ctx.fillRect(r.x + 6, y - ROW_H / 2 + 2, r.w - 12, ROW_H - 4);
      ctx.fillStyle = "#9ab"; ctx.textAlign = "left";
      ctx.fillText(p.label, r.x + 12, y);
      ctx.fillStyle = "#fff"; ctx.textAlign = "right";
      ctx.fillText(String(val), r.x + r.w - 10, y);
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
