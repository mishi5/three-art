// #177: postMessage 受け口。別コンテキスト（コンソール/iframe/拡張の同一オリジンページ等）
// から JSON コマンドを受け、AiApi へ dispatch して結果を送信元へ返信する。
// - 同一オリジン限定（event.origin === location.origin 以外は無視）
// - type が合わないメッセージは無視（他ライブラリの postMessage と衝突しない）
// - 未知 cmd / args 不正は { ok: false, error } で返信
import type { AiApi } from "./ai-api";

/** 受信メッセージの type（コマンド）。 */
export const CMD_TYPE = "node-vj:cmd";
/** 返信メッセージの type（結果）。 */
export const RESULT_TYPE = "node-vj:result";

/** 受信 data の検証結果（純関数 parseCommandMessage の戻り値）。 */
export type ParsedMessage =
  | { kind: "ignore" }
  | { kind: "invalid"; id: string | null; error: string }
  | { kind: "cmd"; id: string; cmd: string; args: Record<string, unknown> };

/**
 * 受信 data を検証する。type が CMD_TYPE でないものは ignore（返信しない）、
 * type が合うのに id/cmd/args の形が不正なものは invalid（エラー返信対象）。
 */
export function parseCommandMessage(data: unknown): ParsedMessage {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return { kind: "ignore" };
  const d = data as Record<string, unknown>;
  if (d.type !== CMD_TYPE) return { kind: "ignore" };
  const id = typeof d.id === "string" && d.id !== "" ? d.id : null;
  if (id === null) return { kind: "invalid", id: null, error: "id（空でない string）が必要です" };
  if (typeof d.cmd !== "string" || d.cmd === "") {
    return { kind: "invalid", id, error: "cmd（空でない string）が必要です" };
  }
  if (d.args !== undefined && (typeof d.args !== "object" || d.args === null || Array.isArray(d.args))) {
    return { kind: "invalid", id, error: "args はオブジェクトである必要があります" };
  }
  return { kind: "cmd", id, cmd: d.cmd, args: (d.args ?? {}) as Record<string, unknown> };
}

/** args 不正の共通エラー。 */
function badArgs(detail: string): { ok: false; error: string } {
  return { ok: false, error: `args 不正: ${detail}` };
}

/**
 * cmd 名で AiApi のメソッドへ振り分ける。args の必須キーはここで検証し、
 * 未知 cmd は { ok: false, error } を返す（throw しない）。
 */
export function dispatchCommand(api: AiApi, cmd: string, args: Record<string, unknown>): unknown {
  switch (cmd) {
    case "getGraphYaml":
      return api.getGraphYaml();
    case "getScenes":
      return api.getScenes();
    case "getNodeCatalog":
      return api.getNodeCatalog();
    case "getStatus":
      return api.getStatus();
    case "applyGraphYaml":
      if (typeof args.yaml !== "string") return badArgs("applyGraphYaml は { yaml: string } が必要です");
      return api.applyGraphYaml(args.yaml);
    case "setParam":
      if (typeof args.nodeId !== "string") return badArgs("setParam は { nodeId: string } が必要です");
      if (typeof args.paramId !== "string") return badArgs("setParam は { paramId: string } が必要です");
      if (!("value" in args)) return badArgs("setParam は { value } が必要です");
      return api.setParam(args.nodeId, args.paramId, args.value);
    case "switchScene":
      if (typeof args.sceneId !== "string") return badArgs("switchScene は { sceneId: string } が必要です");
      return api.switchScene(args.sceneId);
    default:
      return { ok: false, error: `unknown cmd: ${cmd}` };
  }
}

/** 返信先（Window / MessagePort 等を最小メンバで抽象化。テストではフェイクを使う）。 */
interface Poster {
  postMessage(message: unknown, options?: { targetOrigin?: string }): void;
}

/** installPostMessageBridge が要求する window の最小サーフェス（テスト注入用）。 */
export interface BridgeWindow extends Poster {
  location: { origin: string };
  addEventListener(type: "message", handler: (e: MessageEvent) => void): void;
  removeEventListener(type: "message", handler: (e: MessageEvent) => void): void;
}

/**
 * window に message リスナを張り、同一オリジンの CMD_TYPE メッセージを API へ
 * dispatch して結果を返信する。戻り値はリスナ解除関数。
 * 返信は event.source（無ければ win 自身）へ { type: RESULT_TYPE, id, result } を送る。
 */
export function installPostMessageBridge(api: AiApi, win: BridgeWindow = window): () => void {
  const handler = (event: MessageEvent): void => {
    // 同一オリジン限定（セキュリティ境界。別オリジンの iframe/ページからは操作不可）。
    if (event.origin !== win.location.origin) return;
    const parsed = parseCommandMessage(event.data);
    if (parsed.kind === "ignore") return;
    const reply = (id: string | null, result: unknown): void => {
      const target = (event.source ?? win) as unknown as Poster;
      target.postMessage({ type: RESULT_TYPE, id, result }, { targetOrigin: event.origin });
    };
    if (parsed.kind === "invalid") {
      reply(parsed.id, { ok: false, error: parsed.error });
      return;
    }
    let result: unknown;
    try {
      result = dispatchCommand(api, parsed.cmd, parsed.args);
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    reply(parsed.id, result);
  };
  win.addEventListener("message", handler);
  return () => win.removeEventListener("message", handler);
}
