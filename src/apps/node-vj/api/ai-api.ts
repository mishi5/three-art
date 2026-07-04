// #177: AI 操作インターフェース（サーバレス）。外部エージェント/LLM/スクリプトが
// node-vj を読取・操作するための型付きコマンド API。main.ts から依存（graph/registry/
// history/scene 操作/YAML 適用関数）をフック注入して結合を薄く保つ（ProjectIoHooks と同様）。
// すべての結果は JSON シリアライズ可能な { ok: boolean, ... } 形で返す（postMessage 往復可能）。
import type { GraphDoc } from "../graph/graph-doc";
import { findNode, GRAPH_VERSION } from "../graph/graph-doc";
import type { History } from "../graph/history";
import type { NodeRegistry, ParamDef, PortDef } from "../graph/node-type";
import { effectiveInputPorts } from "../graph/node-ports";
import { serializeGraph } from "../graph/serialize";

/** 失敗結果（全コマンド共通）。 */
export interface ApiError { ok: false; error: string }

/** getScenes の 1 シーン分。output は「実効出力」（ピン無し＝編集に追従ならアクティブが出力扱い）。 */
export interface SceneInfo { id: string; name: string; active: boolean; output: boolean }

/** getNodeCatalog のポート仕様（実効入力ポート＝宣言入力 ∪ 数値 param 由来入力を含む）。 */
export interface CatalogPort { id: string; type: string; label: string; description?: string }

/** getNodeCatalog の param 仕様。AI がグラフ YAML を書くための仕様書になる。 */
export interface CatalogParam {
  id: string;
  label: string;
  kind: string;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  description?: string;
}

export interface CatalogNode {
  type: string;
  category?: string;
  description?: string;
  inputs: CatalogPort[];
  outputs: CatalogPort[];
  params: CatalogParam[];
}

/** getStatus の 1 ノード分。outputs は直近評価値の要約（プリミティブはそのまま・他は型名）。 */
export interface StatusNode { id: string; type: string; outputs: Record<string, number | boolean | string> }

/** AI 向けコマンド API（window.nodeVj.api / postMessage の双方から呼ばれる）。 */
export interface AiApi {
  getGraphYaml(): { ok: true; yaml: string } | ApiError;
  getScenes(): { ok: true; scenes: SceneInfo[] } | ApiError;
  getNodeCatalog(): { ok: true; version: number; nodes: CatalogNode[] } | ApiError;
  getStatus(): {
    ok: true;
    activeSceneId: string;
    outputSceneId: string;
    nodeCount: number;
    nodes: StatusNode[];
  } | ApiError;
  applyGraphYaml(yaml: string): { ok: true; warnings: string[] } | ApiError;
  setParam(nodeId: string, paramId: string, value: unknown): { ok: true } | ApiError;
  switchScene(sceneId: string): { ok: true } | ApiError;
}

/** main.ts から注入する依存（既存クロージャの薄いラッパ）。 */
export interface AiApiHooks {
  /** 編集中の共有グラフ（live 参照。replaceGraph で中身が入れ替わる）。 */
  graph: GraphDoc;
  registry: NodeRegistry;
  /** setParam の履歴記録（スライダー編集と同じく変更直前に record）。 */
  history: Pick<History, "record">;
  /** runtime の直近評価結果（ノード id → 出力ポート値）。 */
  getOutputs(nodeId: string): Record<string, unknown> | undefined;
  scenes: {
    list(): { id: string; name: string }[];
    activeId(): string;
    /** 出力ピンのシーン id（null は編集に追従）。 */
    outputId(): string | null;
    /** シーン切替（scene-panel の切替と同じ経路。main.ts の sceneActions.switchTo）。 */
    switchTo(id: string): void;
  };
  /**
   * YAML を検証してワークスペースへ適用し warnings を返す（不正 YAML は throw）。
   * main.ts が preset 読込（graph-io-controls）と同じ経路で実装する。ただし履歴は
   * clear でなく record（AI 適用は Cmd+Z で戻せる）。
   */
  applyYaml(text: string): string[];
}

/** unknown エラーを ApiError にする。 */
function fail(e: unknown): ApiError {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

/**
 * 直近評価値を JSON セーフに要約する。number/boolean/string はそのまま
 * （非有限数は "NaN" 等の文字列）、オブジェクト等は "<型名>" に落とす。
 */
export function summarizeOutputValue(v: unknown): number | boolean | string {
  if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
  if (typeof v === "boolean" || typeof v === "string") return v;
  if (v === null) return "<null>";
  if (v === undefined) return "<undefined>";
  if (Array.isArray(v)) return `<Array(${v.length})>`;
  if (typeof v === "object") {
    // THREE.Texture は minify でクラス名が潰れても isTexture フラグで判別できる。
    if ((v as { isTexture?: boolean }).isTexture) return "<Texture>";
    const name = (v as object).constructor?.name;
    return `<${name && name !== "" ? name : "Object"}>`;
  }
  return `<${typeof v}>`;
}

/**
 * setParam の値検証。kind 不一致はエラー、number/int は min/max クランプ
 * （int は丸め）、enum は options を検証する。ok なら採用値を返す。
 */
export type ParamValidation = { ok: true; value: unknown } | ApiError;

export function validateParamValue(pd: ParamDef, value: unknown): ParamValidation {
  switch (pd.kind) {
    case "number":
    case "int": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, error: `param ${pd.id}: 有限の number が必要です（受領: ${typeof value}）` };
      }
      let v = pd.kind === "int" ? Math.round(value) : value;
      if (pd.min !== undefined) v = Math.max(pd.min, v);
      if (pd.max !== undefined) v = Math.min(pd.max, v);
      return { ok: true, value: v };
    }
    case "boolean":
      if (typeof value !== "boolean") {
        return { ok: false, error: `param ${pd.id}: boolean が必要です（受領: ${typeof value}）` };
      }
      return { ok: true, value };
    case "string":
      if (typeof value !== "string") {
        return { ok: false, error: `param ${pd.id}: string が必要です（受領: ${typeof value}）` };
      }
      return { ok: true, value };
    case "enum": {
      if (typeof value !== "string") {
        return { ok: false, error: `param ${pd.id}: string(enum) が必要です（受領: ${typeof value}）` };
      }
      if (pd.options && !pd.options.includes(value)) {
        return { ok: false, error: `param ${pd.id}: 不正な値 "${value}"（候補: ${pd.options.join(", ")}）` };
      }
      return { ok: true, value };
    }
  }
}

/** PortDef → JSON セーフなカタログ項目（description が無ければ fallback を使う）。 */
function toCatalogPort(p: PortDef, fallbackDescription?: string): CatalogPort {
  const out: CatalogPort = { id: p.id, type: p.type, label: p.label };
  const desc = p.description ?? fallbackDescription;
  if (desc !== undefined) out.description = desc;
  return out;
}

/**
 * registry から AI 向けノードカタログ（JSON セーフ）を作る。
 * inputs は接続検証と同じ「実効入力ポート」（宣言入力 ∪ 数値 param 由来入力・#74）。
 */
export function buildNodeCatalog(registry: NodeRegistry): CatalogNode[] {
  return registry.list().map((def) => {
    const paramDesc = new Map(def.params.map((p) => [p.id, p.description]));
    const node: CatalogNode = {
      type: def.type,
      inputs: effectiveInputPorts(def).map((p) => toCatalogPort(p, paramDesc.get(p.id))),
      outputs: def.outputs.map((p) => toCatalogPort(p)),
      params: def.params.map((p) => {
        const cp: CatalogParam = { id: p.id, label: p.label, kind: p.kind, default: p.default };
        if (p.min !== undefined) cp.min = p.min;
        if (p.max !== undefined) cp.max = p.max;
        if (p.step !== undefined) cp.step = p.step;
        if (p.options !== undefined) cp.options = [...p.options];
        if (p.description !== undefined) cp.description = p.description;
        return cp;
      }),
    };
    if (def.category !== undefined) node.category = def.category;
    if (def.description !== undefined) node.description = def.description;
    return node;
  });
}

/** フック注入で AI コマンド API を生成する。 */
export function createAiApi(hooks: AiApiHooks): AiApi {
  return {
    getGraphYaml() {
      try {
        return { ok: true, yaml: serializeGraph(hooks.graph) };
      } catch (e) {
        return fail(e);
      }
    },

    getScenes() {
      try {
        const activeId = hooks.scenes.activeId();
        // 出力ピン無し（編集に追従）ならアクティブシーンが実効出力。
        const outputId = hooks.scenes.outputId() ?? activeId;
        const scenes = hooks.scenes.list().map((s) => ({
          id: s.id,
          name: s.name,
          active: s.id === activeId,
          output: s.id === outputId,
        }));
        return { ok: true, scenes };
      } catch (e) {
        return fail(e);
      }
    },

    getNodeCatalog() {
      try {
        return { ok: true, version: GRAPH_VERSION, nodes: buildNodeCatalog(hooks.registry) };
      } catch (e) {
        return fail(e);
      }
    },

    getStatus() {
      try {
        const nodes: StatusNode[] = hooks.graph.nodes.map((n) => {
          const raw = hooks.getOutputs(n.id) ?? {};
          const outputs: Record<string, number | boolean | string> = {};
          for (const [port, value] of Object.entries(raw)) outputs[port] = summarizeOutputValue(value);
          return { id: n.id, type: n.type, outputs };
        });
        return {
          ok: true,
          activeSceneId: hooks.scenes.activeId(),
          outputSceneId: hooks.scenes.outputId() ?? hooks.scenes.activeId(),
          nodeCount: hooks.graph.nodes.length,
          nodes,
        };
      } catch (e) {
        return fail(e);
      }
    },

    applyGraphYaml(yaml) {
      if (typeof yaml !== "string") return { ok: false, error: "yaml (string) が必要です" };
      try {
        return { ok: true, warnings: hooks.applyYaml(yaml) };
      } catch (e) {
        return fail(e);
      }
    },

    setParam(nodeId, paramId, value) {
      try {
        const node = findNode(hooks.graph, nodeId);
        if (!node) return { ok: false, error: `node が見つかりません: ${nodeId}` };
        const def = hooks.registry.get(node.type);
        if (!def) return { ok: false, error: `未知の node type: ${node.type}` };
        const pd = def.params.find((p) => p.id === paramId);
        if (!pd) return { ok: false, error: `param が見つかりません: ${node.type}.${paramId}` };
        const v = validateParamValue(pd, value);
        if (!v.ok) return v;
        // 変更なしは履歴に積まない（NodeEditor.editParam の onCommit と同じ挙動）。
        if (node.params[paramId] === v.value) return { ok: true };
        hooks.history.record(hooks.graph);
        node.params[paramId] = v.value;
        return { ok: true };
      } catch (e) {
        return fail(e);
      }
    },

    switchScene(sceneId) {
      try {
        if (!hooks.scenes.list().some((s) => s.id === sceneId)) {
          return { ok: false, error: `scene が見つかりません: ${sceneId}` };
        }
        hooks.scenes.switchTo(sceneId);
        return { ok: true };
      } catch (e) {
        return fail(e);
      }
    },
  };
}
