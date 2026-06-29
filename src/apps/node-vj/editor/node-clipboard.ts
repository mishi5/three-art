// #206: ノードのアプリ内クリップボード（純ロジック + 履歴ストア）。
// Cmd+C で選択ノード＋内部接続を「クリップ項目」として履歴に積み、Cmd+V / ドロップで貼り付ける。
// クリップ項目はシーン非依存の部分グラフ（元 id のまま保持し、貼付時に再 id する）。永続化はしない。
import { addConnection, addNode, type Connection, type GraphDoc, type NodeInstance } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";

/** クリップ項目のドラッグに使う dataTransfer 型（asset の application/x-node-vj-asset と別系統）。 */
export const CLIP_MIME = "application/x-node-vj-clip";

/** 履歴の既定保持件数（古いものから捨てる）。 */
export const DEFAULT_CLIP_LIMIT = 24;

/** クリップ項目（シーン非依存の部分グラフ）。nodes/connections は元 id のまま保持する。 */
export interface ClipItem {
  id: string;
  nodes: NodeInstance[];
  connections: Connection[];
  /** 一覧表示用ラベル（生成時に確定）。 */
  label: string;
  /** #206: ミニ配置図サムネイルの data URL（生成は editor 側・任意）。 */
  thumbnail?: string;
}

/** 貼り付け位置の指定。at（左上を合わせる world 座標）優先、無ければ offset（元位置からの平行移動）。 */
export interface PasteOpts {
  at?: { x: number; y: number };
  offset?: number;
}

/**
 * 選択ノードと、その内部接続（両端が選択内）だけを deep clone で抜き出す。
 * 外部との接続（選択外→選択内 / 選択内→選択外）は含めない（シーン横断で貼れるよう自己完結させる）。
 */
export function extractClip(
  graph: GraphDoc,
  selectedIds: ReadonlySet<string>,
): { nodes: NodeInstance[]; connections: Connection[] } {
  const nodes = graph.nodes
    .filter((n) => selectedIds.has(n.id))
    .map((n) => structuredClone(n));
  const connections = graph.connections
    .filter((c) => selectedIds.has(c.from.node) && selectedIds.has(c.to.node))
    .map((c) => structuredClone(c));
  return { nodes, connections };
}

/** 配置オフセット（元位置 → 配置位置の平行移動量）を求める。 */
function pasteDelta(nodes: readonly NodeInstance[], opts: PasteOpts): { x: number; y: number } {
  if (opts.at) {
    let minX = Infinity;
    let minY = Infinity;
    for (const n of nodes) {
      if (!n.position) continue;
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
    }
    // 位置を持たない場合は at をそのまま原点に。
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: opts.at.x, y: opts.at.y };
    return { x: opts.at.x - minX, y: opts.at.y - minY };
  }
  const off = opts.offset ?? 24;
  return { x: off, y: off };
}

/**
 * クリップ項目をグラフへ貼り付ける。ノードを再 id・内部接続を新 id へ remap し、
 * position を at（左上合わせ）or offset で移動する。registry 検証つきで接続を張る。
 * 追加した新ノード id を返す（空/不正は []）。item 自体は変更しない。
 */
export function pasteClip(
  graph: GraphDoc,
  registry: NodeRegistry,
  item: ClipItem,
  genId: (prefix: string) => string,
  opts: PasteOpts = {},
): string[] {
  if (item.nodes.length === 0) return [];
  const delta = pasteDelta(item.nodes, opts);
  const idMap = new Map<string, string>(); // 元 id → 新 id
  for (const node of item.nodes) {
    const clone = structuredClone(node);
    clone.id = genId("n");
    if (node.position) clone.position = { x: node.position.x + delta.x, y: node.position.y + delta.y };
    idMap.set(node.id, clone.id);
    addNode(graph, clone);
  }
  for (const conn of item.connections) {
    const from = idMap.get(conn.from.node);
    const to = idMap.get(conn.to.node);
    if (!from || !to) continue; // 内部接続のみ想定（両端が再 id 対象）
    addConnection(graph, registry, {
      id: genId("c"),
      from: { node: from, port: conn.from.port },
      to: { node: to, port: conn.to.port },
    });
  }
  return [...idMap.values()];
}

/** 一覧表示用ラベル（ノード種別/件数）。例: "Number, Add" / "A, B 他 2 件"。 */
export function clipLabel(nodes: readonly NodeInstance[]): string {
  if (nodes.length === 0) return "(空)";
  const types = nodes.map((n) => n.type);
  if (nodes.length <= 3) return types.join(", ");
  return `${types.slice(0, 2).join(", ")} 他 ${nodes.length - 2} 件`;
}

/** 選択からクリップ項目を生成する（空選択は null）。 */
export function makeClipItem(
  graph: GraphDoc,
  selectedIds: ReadonlySet<string>,
  genId: (prefix: string) => string,
): ClipItem | null {
  const { nodes, connections } = extractClip(graph, selectedIds);
  if (nodes.length === 0) return null;
  return { id: genId("clip"), nodes, connections, label: clipLabel(nodes) };
}

/**
 * クリップ履歴ストア（セッション内のみ・永続化しない）。
 * add で先頭に積み、上限を超えた古い項目を捨てる。current は「Cmd+V で貼る対象」。
 */
export class NodeClipboard {
  private items: ClipItem[] = [];
  private currentId: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly limit: number = DEFAULT_CLIP_LIMIT) {}

  /** 新規クリップを先頭に積み、current に設定する。上限超過分は末尾（古い側）から捨てる。 */
  add(item: ClipItem): void {
    this.items.unshift(item);
    if (this.items.length > this.limit) this.items.length = this.limit;
    this.currentId = item.id;
    this.emit();
  }

  /** 新しい順の一覧。 */
  list(): readonly ClipItem[] {
    return this.items;
  }

  get(id: string): ClipItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** Cmd+V の貼付対象。 */
  current(): ClipItem | undefined {
    return this.currentId === null ? undefined : this.get(this.currentId);
  }

  /** 現在の current id（一覧の強調表示に使う）。 */
  currentItemId(): string | null {
    return this.current() ? this.currentId : null;
  }

  /** current を切り替える（存在しない id は無視）。 */
  setCurrent(id: string): void {
    if (!this.items.some((i) => i.id === id)) return;
    this.currentId = id;
    this.emit();
  }

  /** 変更通知（パネル再描画用）。返り値で解除。 */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}
