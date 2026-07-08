// #229: 軽量な UI 設定（prefs）の localStorage 永続化。
// 全設定を 1 キー（node-vj.prefs.v1）の JSON オブジェクトにまとめる。
// 後続 Issue（#228 サイドバーのピン状態など）でも共用する前提の汎用モジュール:
// フィールド追加は Prefs 型・DEFAULT_PREFS・parsePrefs の検証を 1 行ずつ足すだけ。
import type { KvStorage } from "./graph/graph-store";
import type { PanSelectMode } from "./editor/pan-policy";
import type { Lang } from "./i18n";

export interface Prefs {
  /** #229: 空白左ドラッグの操作モード（modern=#207 現行 / legacy=#207 以前）。 */
  panMode: PanSelectMode;
  /** #228: サイドドック（左）のピン留め（true なら外側クリックで自動クローズしない）。 */
  dockPinned: boolean;
  /** #258: 右ドック（ノード追加パネル）のピン留め。左と独立に保持する。 */
  dockPinnedRight: boolean;
  /** #237: AI ブリッジ（WS）を有効にするか。外部プロセスへ口を開くため既定 false（opt-in）。 */
  wsBridgeEnabled: boolean;
  /** #237: AI ブリッジの中継サーバ URL。 */
  wsBridgeUrl: string;
  /** #244: UI 言語。既定 ja（既存ユーザの見た目を変えない）。切替はリロードで反映。 */
  lang: Lang;
}

export const DEFAULT_PREFS: Prefs = {
  panMode: "modern",
  dockPinned: false,
  dockPinnedRight: false,
  wsBridgeEnabled: false,
  wsBridgeUrl: "ws://localhost:8787",
  lang: "ja",
};

export const PREFS_KEY = "node-vj.prefs.v1";

/**
 * 保存された raw JSON を Prefs へ変換する純関数。
 * 壊れた JSON・オブジェクト以外・不正値はフィールド単位で既定値へフォールバックし、
 * 未知キーは捨てる（将来バージョンの JSON を読んでも余計なキーを持ち込まない）。
 */
export function parsePrefs(raw: string | null): Prefs {
  let obj: unknown = null;
  try {
    obj = raw ? JSON.parse(raw) : null;
  } catch {
    obj = null;
  }
  const src = obj !== null && typeof obj === "object" && !Array.isArray(obj)
    ? (obj as Record<string, unknown>)
    : {};
  const prefs: Prefs = { ...DEFAULT_PREFS };
  if (src.panMode === "modern" || src.panMode === "legacy") prefs.panMode = src.panMode;
  if (typeof src.dockPinned === "boolean") prefs.dockPinned = src.dockPinned;
  if (typeof src.dockPinnedRight === "boolean") prefs.dockPinnedRight = src.dockPinnedRight;
  if (typeof src.wsBridgeEnabled === "boolean") prefs.wsBridgeEnabled = src.wsBridgeEnabled;
  if (typeof src.wsBridgeUrl === "string" && src.wsBridgeUrl !== "") prefs.wsBridgeUrl = src.wsBridgeUrl;
  if (src.lang === "ja" || src.lang === "en") prefs.lang = src.lang;
  return prefs;
}

/** UI 設定を localStorage に保存/復元する（SceneStore / GraphStore と同パターン）。 */
export class PrefsStore {
  constructor(private readonly storage: KvStorage) {}

  load(): Prefs {
    return parsePrefs(this.storage.getItem(PREFS_KEY));
  }

  /** 部分更新（read-modify-write）。指定しなかったフィールドは保存値を保持する。 */
  save(patch: Partial<Prefs>): void {
    this.storage.setItem(PREFS_KEY, JSON.stringify({ ...this.load(), ...patch }));
  }
}
