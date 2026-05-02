import { App } from "./App";
import { UI } from "./ui/UI";

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not found");

if (!canvas.getContext("webgl2") && !canvas.getContext("webgl")) {
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;
                height:100vh;color:#fff;font-family:system-ui;text-align:center">
      <p>このブラウザは WebGL に対応していません。</p>
    </div>
  `;
  throw new Error("WebGL not supported");
}

const app = new App(canvas);
app.start();

const ui = new UI(app);
ui.showStartOverlay();

(window as unknown as { app: App }).app = app;
