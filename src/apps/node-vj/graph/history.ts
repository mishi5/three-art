// UNDO/REDO 履歴（#90・スナップショット方式）。
// 操作の「直前」に record(graph) を呼ぶ。undo は現状態を redo へ退避して
// 直前スナップショットを返す（復元は replaceGraph で行う）。
// #151: シーン別トラックに対応（useScene で切替・切替で履歴を保持）。既定トラックで後方互換。
import type { GraphDoc } from "./graph-doc";

const HISTORY_LIMIT = 50;
const DEFAULT_KEY = "__default__";

interface Track { undo: GraphDoc[]; redo: GraphDoc[]; }

export class History {
  private tracks = new Map<string, Track>();
  private activeKey = DEFAULT_KEY;

  private cur(): Track {
    let t = this.tracks.get(this.activeKey);
    if (!t) { t = { undo: [], redo: [] }; this.tracks.set(this.activeKey, t); }
    return t;
  }

  get canUndo(): boolean { return this.cur().undo.length > 0; }
  get canRedo(): boolean { return this.cur().redo.length > 0; }

  /** 変更直前の状態を記録する。redo 履歴は分岐するためクリア。 */
  record(g: GraphDoc): void {
    const t = this.cur();
    t.undo.push(structuredClone(g));
    if (t.undo.length > HISTORY_LIMIT) t.undo.shift();
    t.redo = [];
  }

  /** 直前の record を取り消す（操作が失敗・無効だった場合用）。 */
  discardLast(): void { this.cur().undo.pop(); }

  /** 現状態 current を redo へ退避し、巻き戻し先スナップショットを返す。 */
  undo(current: GraphDoc): GraphDoc | null {
    const t = this.cur();
    const snap = t.undo.pop();
    if (!snap) return null;
    t.redo.push(structuredClone(current));
    return snap;
  }

  /** 現状態 current を undo へ退避し、やり直し先スナップショットを返す。 */
  redo(current: GraphDoc): GraphDoc | null {
    const t = this.cur();
    const snap = t.redo.pop();
    if (!snap) return null;
    t.undo.push(structuredClone(current));
    return snap;
  }

  clear(): void { const t = this.cur(); t.undo = []; t.redo = []; }

  /** #151: アクティブな履歴トラックを切り替える（無ければ空で作成）。 */
  useScene(sceneId: string): void {
    this.activeKey = sceneId;
    if (!this.tracks.has(sceneId)) this.tracks.set(sceneId, { undo: [], redo: [] });
  }

  /** #151: シーン削除時にそのトラックを破棄する。 */
  removeScene(sceneId: string): void {
    this.tracks.delete(sceneId);
    if (this.activeKey === sceneId) this.activeKey = DEFAULT_KEY;
  }
}
