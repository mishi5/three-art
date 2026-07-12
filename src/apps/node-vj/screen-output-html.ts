// #282: Screen 専用出力ウィンドウの HTML 生成。#148 の buildOutputHtml と同じ土台
// （黒背景・UI なし・object-fit: contain の video・クリック全画面）に、コーナーピンワープの
// 調整モード（物理キー 'w' でトグル・4 隅ハンドルのドラッグ）を追加する。
// 別ウィンドウの自己完結 HTML のため文言は直書き・contain 矩形ロジックは editor/fit.ts の
// containRect と同等をインライン実装する（重複許容。テストは親側の純関数で担保）。
// ドラッグ値は window.opener への postMessage（warp-messages.ts のプロトコル）で親へ送り、
// 親からの warp-state メッセージでハンドル位置を同期する（undo・ノード上の手入力にも追従）。

/** Screen ノード id → 出力ウィンドウの window name（メイン出力 "node-vj-output" と衝突しない）。 */
export function screenOutputWindowName(nodeId: string): string {
  return `node-vj-screen-${nodeId}`;
}

/**
 * Screen 専用出力ウィンドウの HTML。screenId は postMessage の宛先識別に埋め込む
 * （JSON.stringify ＋ "<" エスケープで script 終端・クォート破壊を防ぐ）。
 */
export function buildScreenOutputHtml(screenId: string): string {
  const idJson = JSON.stringify(screenId).replace(/</g, "\\u003c");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>node-vj 出力 (Screen)</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background:#000; overflow: hidden; cursor: pointer; }
  #out { width: 100vw; height: 100vh; object-fit: contain; background:#000; display: block; }
  #hint { position: fixed; left: 0; right: 0; bottom: 8px; text-align: center; color: #888; font: 12px system-ui; pointer-events: none; }
  #frame { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh; pointer-events: none; display: none; }
  .handle { position: fixed; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
            border: 2px solid #fff; box-sizing: border-box; cursor: grab; display: none; touch-action: none; }
</style>
</head>
<body>
<video id="out" autoplay muted playsinline></video>
<svg id="frame"><polygon id="poly" fill="none" stroke="#4fc3f7" stroke-width="1.5" stroke-dasharray="6 4"></polygon></svg>
<div class="handle" data-corner="tl" style="background:#ff6b6b"></div>
<div class="handle" data-corner="tr" style="background:#6bcb77"></div>
<div class="handle" data-corner="bl" style="background:#4d96ff"></div>
<div class="handle" data-corner="br" style="background:#ffd93d"></div>
<div id="hint">クリックで全画面 / w: ワープ調整</div>
<script>
(function () {
  var screenId = ${idJson};
  var video = document.getElementById("out");
  var hint = document.getElementById("hint");
  var frame = document.getElementById("frame");
  var poly = document.getElementById("poly");
  var handles = document.querySelectorAll(".handle");
  var adjust = false;
  var dragging = null; // ドラッグ中の corner 名（"tl" 等）。null は非ドラッグ。
  // 4 隅の正規化座標（親の Screen params と同じ表現）。親からの warp-state で同期される。
  var corners = { tl: {x:0,y:0}, tr: {x:1,y:0}, bl: {x:0,y:1}, br: {x:1,y:1} };

  // editor/fit.ts の containRect と同等（object-fit: contain の実表示矩形）。
  function containRect(sw, sh, dw, dh) {
    if (sw <= 0 || sh <= 0) return { x: 0, y: 0, w: dw, h: dh };
    var s = Math.min(dw / sw, dh / sh);
    var w = sw * s, h = sh * s;
    return { x: (dw - w) / 2, y: (dh - h) / 2, w: w, h: h };
  }
  function videoRect() {
    return containRect(video.videoWidth || 16, video.videoHeight || 9, window.innerWidth, window.innerHeight);
  }
  function layout() {
    var r = videoRect();
    var pts = [];
    // 外周は tl→tr→br→bl の順で結ぶ。
    var order = ["tl", "tr", "br", "bl"];
    for (var i = 0; i < handles.length; i++) {
      var el = handles[i];
      var c = corners[el.getAttribute("data-corner")];
      el.style.left = (r.x + c.x * r.w) + "px";
      el.style.top = (r.y + c.y * r.h) + "px";
    }
    for (var j = 0; j < order.length; j++) {
      var p = corners[order[j]];
      pts.push((r.x + p.x * r.w) + "," + (r.y + p.y * r.h));
    }
    poly.setAttribute("points", pts.join(" "));
  }
  function setAdjust(on) {
    adjust = on;
    for (var i = 0; i < handles.length; i++) handles[i].style.display = on ? "block" : "none";
    frame.style.display = on ? "block" : "none";
    hint.textContent = on
      ? "ドラッグで 4 隅を合わせ込み / w: ワープ調整を終了"
      : "クリックで全画面 / w: ワープ調整";
    hint.style.display = "";
    if (on) layout();
  }
  function send(corner, x, y, phase) {
    if (!window.opener || window.opener.closed) return;
    window.opener.postMessage(
      { type: "node-vj:warp", screenId: screenId, corner: corner, x: x, y: y, phase: phase }, "*");
  }
  function clamp(v) { return Math.max(-0.5, Math.min(1.5, v)); }
  function endDrag() {
    if (!dragging) return;
    var c = corners[dragging];
    send(dragging, c.x, c.y, "end");
    dragging = null;
  }

  for (var i = 0; i < handles.length; i++) {
    (function (el) {
      el.addEventListener("pointerdown", function (e) {
        if (!adjust) return;
        e.stopPropagation();
        e.preventDefault();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        dragging = el.getAttribute("data-corner");
        var c = corners[dragging];
        send(dragging, c.x, c.y, "start");
      });
    })(handles[i]);
  }
  window.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    // trackpad は指を離しても pointerup を落とすことがある（#167）。buttons で終了を検知する。
    if (e.buttons === 0) { endDrag(); return; }
    var r = videoRect();
    if (!(r.w > 0) || !(r.h > 0)) return;
    var c = corners[dragging];
    c.x = clamp((e.clientX - r.x) / r.w);
    c.y = clamp((e.clientY - r.y) / r.h);
    layout();
    send(dragging, c.x, c.y, "move");
  });
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("blur", endDrag);

  // 物理キー 'w' で調整モードをトグル（IME の e.key 問題 #167 を避け e.code で判定）。
  window.addEventListener("keydown", function (e) {
    if (e.code === "KeyW") setAdjust(!adjust);
  });

  // 親からの 4 隅同期（undo・ノード上の手入力・初期状態）。ドラッグ中の隅には適用しない
  // （丸め往復によるハンドルのジッタ防止。ドラッグ終了後の次回同期で揃う）。
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.type !== "node-vj:warp-state" || d.screenId !== screenId || !d.corners) return;
    var keys = ["tl", "tr", "bl", "br"];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === dragging) continue;
      var x = d.corners[k + "X"], y = d.corners[k + "Y"];
      if (typeof x === "number" && isFinite(x)) corners[k].x = x;
      if (typeof y === "number" && isFinite(y)) corners[k].y = y;
    }
    if (adjust) layout();
  });

  window.addEventListener("resize", layout);
  video.addEventListener("loadedmetadata", layout);

  document.body.addEventListener("click", function () {
    if (adjust) return; // 調整モード中は誤爆防止のため全画面トグルを止める
    var el = document.documentElement;
    if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen(); }
    else { if (document.exitFullscreen) document.exitFullscreen(); }
  });
})();
</` + `script>
</body>
</html>`;
}
