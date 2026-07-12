// #283: クリーンフィード（OBS ブラウザソース向け WebRTC ミラー）のシグナリングプロトコル。
// メインタブ（publisher）と /obs.html（viewer）が同一オリジンの BroadcastChannel で
// SDP / ICE candidate を交換する（同一マシン完結・シグナリングサーバ/STUN 不要）。
// メッセージは検証付きパース（parseCleanFeedMessage）を通してから扱う。

/** シグナリング用 BroadcastChannel のチャンネル名。 */
export const CLEAN_FEED_CHANNEL = "node-vj:clean-feed";

/** viewer→pub: 接続要求。未接続の間は定期再送する（publisher 出現待ち・リロード追従）。 */
export interface CleanFeedHello {
  type: "cf:hello";
  viewerId: string;
}

/** pub→viewer: SDP offer。 */
export interface CleanFeedOffer {
  type: "cf:offer";
  viewerId: string;
  sdp: string;
}

/** viewer→pub: SDP answer。 */
export interface CleanFeedAnswer {
  type: "cf:answer";
  viewerId: string;
  sdp: string;
}

/** 双方向: ICE candidate 中継。from で送信元（pub / viewer）を区別する。 */
export interface CleanFeedIce {
  type: "cf:ice";
  viewerId: string;
  from: "pub" | "viewer";
  candidate: RTCIceCandidateInit;
}

/** 双方向: どちらかの終了（pub 終了時は接続中 viewer ぶん送る）。 */
export interface CleanFeedBye {
  type: "cf:bye";
  viewerId: string;
}

export type CleanFeedMessage =
  | CleanFeedHello
  | CleanFeedOffer
  | CleanFeedAnswer
  | CleanFeedIce
  | CleanFeedBye;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * BroadcastChannel で受けた生メッセージを検証付きでパースする。
 * 不正（型不一致・必須フィールド欠落）は null を返す＝型ガードとして機能する。
 */
export function parseCleanFeedMessage(raw: unknown): CleanFeedMessage | null {
  if (!isRecord(raw)) return null;
  if (!nonEmptyString(raw.viewerId)) return null;
  const viewerId = raw.viewerId;
  switch (raw.type) {
    case "cf:hello":
      return { type: "cf:hello", viewerId };
    case "cf:bye":
      return { type: "cf:bye", viewerId };
    case "cf:offer":
      if (!nonEmptyString(raw.sdp)) return null;
      return { type: "cf:offer", viewerId, sdp: raw.sdp };
    case "cf:answer":
      if (!nonEmptyString(raw.sdp)) return null;
      return { type: "cf:answer", viewerId, sdp: raw.sdp };
    case "cf:ice": {
      if (raw.from !== "pub" && raw.from !== "viewer") return null;
      if (!isRecord(raw.candidate)) return null;
      return { type: "cf:ice", viewerId, from: raw.from, candidate: raw.candidate as RTCIceCandidateInit };
    }
    default:
      return null;
  }
}
