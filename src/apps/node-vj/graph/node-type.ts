// ノード種別（NodeTypeDef）とレジストリ（ADR #59）。
// NodeTypeDef は振る舞い（evaluate）を持ち、保存対象には含めない。
// THREE / AudioFeatures は型のみ import（評価ロジック層は実行時 THREE 非依存を維持）。
import type * as THREE from "three";
import type { AudioFeatures } from "../../../core/types";
import type { PortType } from "./port-types";
import type { NodeInstance } from "./graph-doc";

/** visual/sink ノードがランタイムから受け取る環境（renderer/camera と毎フレーム audio）。
 *  #76: Visual は共有シーンでなく自分専用シーン(VisualSurface)へ描くため scene は持たない。 */
export interface NodeEnv {
  audio: AudioFeatures;
  /** PointCloud の pixelRatio / projection 算出に使う。 */
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
}

/** ノードのフレーム間永続状態（visual モジュールのインスタンス等）。 */
export type NodeState = unknown;

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
}

export type ParamKind = "number" | "int" | "boolean" | "enum" | "string";

export interface ParamDef {
  id: string;
  label: string;
  kind: ParamKind;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** true なら数値 param でも入力ポートを作らない（Number.value のような固定値ソース用）。 */
  noInput?: boolean;
}

/** evaluate に渡される文脈。入力値は接続解決済み（未接続は param フォールバック）。 */
export interface EvalContext {
  /** ランタイム経過秒。 */
  timeSec: number;
  /** 入力ポートの解決済み値を取得する。 */
  input(portId: string): unknown;
  /** ノード param 値を取得する。 */
  param(id: string): unknown;
  /** 評価中のノード実体。 */
  node: NodeInstance;
  /** このノードの永続状態（createState の戻り値）。visual/sink のみ利用。 */
  state?: NodeState;
  /** ランタイム環境（scene/audio）。visual/sink のみ利用。 */
  env?: NodeEnv;
}

export interface NodeTypeDef {
  type: string;
  category?: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** visual/output 系など副作用を持つ終端ノードは true。 */
  isSink?: boolean;
  /** visual/sink ノードの初期化（THREE オブジェクト生成・scene 追加等）。1 度だけ呼ばれる。 */
  createState?(env: NodeEnv): NodeState;
  /** createState で確保した資源の解放。 */
  disposeState?(state: NodeState, env: NodeEnv): void;
  /** 出力ポート id → 値。sink は空オブジェクトでよい。 */
  evaluate(ctx: EvalContext): Record<string, unknown>;
}

/** ノード種別のレジストリ。type をキーに NodeTypeDef を保持する。 */
export class NodeRegistry {
  private defs = new Map<string, NodeTypeDef>();

  register(def: NodeTypeDef): void {
    if (this.defs.has(def.type)) {
      throw new Error(`node type already registered: ${def.type}`);
    }
    this.defs.set(def.type, def);
  }

  get(type: string): NodeTypeDef | undefined {
    return this.defs.get(type);
  }

  require(type: string): NodeTypeDef {
    const def = this.defs.get(type);
    if (!def) throw new Error(`unknown node type: ${type}`);
    return def;
  }

  list(): NodeTypeDef[] {
    return [...this.defs.values()];
  }
}
