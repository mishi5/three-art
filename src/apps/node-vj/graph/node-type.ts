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
  /**
   * #127/#128: 全 audio ノードで共有する AudioContext。別 ctx の AudioNode 同士は
   * 繋げないため、音声入力/Mix/Output は必ずこの ctx を使う。runtime が遅延生成して配る。
   */
  audioContext: AudioContext;
  /** #152: 参照先シーンの合成テクスチャを引く（SceneInput 用。ランタイムが毎フレーム用意）。 */
  sceneTexture?(sceneId: string): unknown;
  /** #172: 参照先シーンとして評価中か（AudioOutput が destination 非接続にする等）。 */
  referencedScene?: boolean;
  /** #172: 参照先シーンの音声出力ノードをランタイムへ通知する。 */
  captureSceneAudio?(node: AudioNode): void;
  /** #172: 参照先シーンの音声出力（マージ gain）を引く（SceneInput 用）。 */
  sceneAudio?(sceneId: string): AudioNode | null;
  /** #179: 録画用の音声分岐先（MediaStreamAudioDestinationNode）。AudioOutput が destination と併せて接続する。 */
  recordingDestination?: AudioNode;
  /** #198: 編集音（モニター）の発音先バス。AudioOutput はこれを ctx.destination の代わりに使い、
   * ランタイムが monitorBus の出力先（既定デバイス ⇄ 選択デバイス）を 1 箇所で繋ぎ替える。未指定なら destination 直結。 */
  monitorBus?: AudioNode;
}

/** ノードのフレーム間永続状態（visual モジュールのインスタンス等）。 */
export type NodeState = unknown;

export interface PortDef {
  id: string;
  label: string;
  type: PortType;
  /** #114: マウスオーバー時に出すツールチップ説明（任意）。 */
  description?: string;
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
  /** #154: true ならノード UI に param 行を描かない（保存はする・assetId のような内部値用）。 */
  hidden?: boolean;
  /** #114: マウスオーバー時に出すツールチップ説明（任意）。 */
  description?: string;
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
  /** #114: マウスオーバー時に出すノード説明（任意）。 */
  description?: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** visual/output 系など副作用を持つ終端ノードは true。 */
  isSink?: boolean;
  /**
   * #99: ノード上のファイル選択 UI を出すノードの目印。accept は file ダイアログの
   * フィルタ（"video/*" / "audio/*" 等）。ランタイム state に loadFile(file) と
   * fileName: string|null を持つ前提。
   */
  fileInput?: { accept: string };
  /** #152: ノードに「シーン選択行」を出す目印（SceneInput）。params.sceneId に参照先シーン id を持つ。 */
  sceneInput?: boolean;
  /**
   * #205: ノード本体にパッドグリッド（rows×cols）を描く目印（MidiPad）。各パッドに音声ファイルを割り当て、
   * クリックでワンショット発音する。ランタイム state に loadPadFile/playPad/hasPad/padLabel を持つ前提。
   */
  padGrid?: { rows: number; cols: number };
  /**
   * #150: ノード上に値をランダム化するボタンを出す目印。クリックで paramId の param を
   * 同ノードの min/max param 範囲のランダム値に再ロールする（Number 用）。
   */
  randomButton?: { paramId: string };
  /** visual/sink ノードの初期化（THREE オブジェクト生成・scene 追加等）。1 度だけ呼ばれる。 */
  createState?(env: NodeEnv): NodeState;
  /**
   * #79: ノード隣接プレビューの描画ソース（video や合成済み canvas）。
   * texture 出力を持たないノード（PoseInput 等）が小窓を出すために使う。
   * 未開始・権限拒否などで表示できないときは null。
   */
  previewSource?(state: NodeState, node: NodeInstance): CanvasImageSource | null;
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
