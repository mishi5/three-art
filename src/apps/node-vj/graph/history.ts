// UNDO/REDO 履歴（#90・スナップショット方式）。
// 操作の「直前」に record(graph) を呼ぶ。undo は現状態を redo へ退避して
// 直前スナップショットを返す（復元は replaceGraph で行う）。
import type { GraphDoc } from "./graph-doc";

const HISTORY_LIMIT = 50;

export class History {
  private undoStack: GraphDoc[] = [];
  private redoStack: GraphDoc[] = [];

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** 変更直前の状態を記録する。redo 履歴は分岐するためクリア。 */
  record(g: GraphDoc): void {
    this.undoStack.push(structuredClone(g));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  /** 直前の record を取り消す（操作が失敗・無効だった場合用）。 */
  discardLast(): void {
    this.undoStack.pop();
  }

  /** 現状態 current を redo へ退避し、巻き戻し先スナップショットを返す。 */
  undo(current: GraphDoc): GraphDoc | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.redoStack.push(structuredClone(current));
    return snap;
  }

  /** 現状態 current を undo へ退避し、やり直し先スナップショットを返す。 */
  redo(current: GraphDoc): GraphDoc | null {
    const snap = this.redoStack.pop();
    if (!snap) return null;
    this.undoStack.push(structuredClone(current));
    return snap;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
