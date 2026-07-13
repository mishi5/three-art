// #283: クリーンフィードページ（/obs.html）のエントリポイント。OBS のブラウザソースに
// このページの URL を入れると、メインタブの出力（クリーンフィード）が WebRTC で流れ込む。
// UI なし・黒背景・映像のみ全画面（object-fit: contain）。接続待ちの間だけ控えめな
// ステータステキストを出し、接続したら消す。切断時は自動で再接続を試みる
// （メインタブのリロードにも追従）。video は autoplay 許可のため muted（OBS 側は
// 「ページの音声を OBS で制御する」でページ内の WebRTC 音声を取り込める）。
// シグナリングは dev サーバの WS リレー（/cf-signal）を主経路に（OBS のブラウザソースは
// OBS 内蔵の別ブラウザで動くため BroadcastChannel はメインタブへ届かない）、
// BroadcastChannel を同一ブラウザ内のフォールバックとして併用する。
import { asPeerLike } from "./clean-feed";
import { BroadcastChannelTransport, WsSignalTransport, wsSignalUrl } from "./clean-feed-transport";
import { CleanFeedViewer, newViewerId } from "./clean-feed-viewer";

const video = document.getElementById("out");
const status = document.getElementById("status");
if (!(video instanceof HTMLVideoElement)) throw new Error("clean feed video not found");

const viewer = new CleanFeedViewer(
  {
    transports: [
      new WsSignalTransport(wsSignalUrl(location)),
      new BroadcastChannelTransport(),
    ],
    createPeerConnection: () => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      // デバッグ/E2E 用: 最新の PC を公開し、getStats で受信コーデック・fps・解像度を確認できるようにする。
      (window as unknown as { __cfPeer?: RTCPeerConnection }).__cfPeer = pc;
      return asPeerLike(pc);
    },
    onStream: (stream) => {
      video.srcObject = stream;
      void video.play().catch(() => { /* muted なので通常は autoplay 可。失敗しても track 到着で再生される */ });
    },
    onConnectedChange: (connected) => {
      if (status instanceof HTMLElement) status.style.display = connected ? "none" : "block";
    },
    scheduleHello: (fn, ms) => window.setInterval(fn, ms),
    cancelHello: (id) => window.clearInterval(id),
  },
  newViewerId(),
);
viewer.start();

// ページ終了時に publisher へ bye を届けて即片付けさせる（届かなくても pub 側は接続断で検知する）。
window.addEventListener("pagehide", () => viewer.dispose());
