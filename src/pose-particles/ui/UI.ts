import type { App } from "../App";

export class UI {
  private root: HTMLElement;

  constructor(private app: App) {
    const root = document.getElementById("ui-root");
    if (!(root instanceof HTMLElement)) throw new Error("ui-root not found");
    this.root = root;
  }

  showStartOverlay(): void {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.85); z-index: 100;
      color: #fff; font-family: system-ui;
    `;
    overlay.innerHTML = `
      <div style="text-align:center;max-width:480px;padding:32px">
        <h1 style="font-weight:300;letter-spacing:0.05em;margin-bottom:24px">Pose × Audio Particles</h1>
        <p style="opacity:0.7;margin-bottom:32px;line-height:1.7">
          Webカメラの前に立ち、音楽と共に体を動かしてください。<br>
          観る人の身体は描画されず、空間に点と粒子が現れます。
        </p>
        <button id="start-btn" style="
          padding: 12px 32px; background: #fff; color: #000;
          border: none; border-radius: 4px; font-size: 16px;
          letter-spacing: 0.05em; cursor: pointer;
        ">開始</button>
        <p id="start-error" style="color:#f88;margin-top:16px;display:none"></p>
      </div>
    `;
    this.root.appendChild(overlay);

    const btn = overlay.querySelector("#start-btn") as HTMLButtonElement;
    const err = overlay.querySelector("#start-error") as HTMLParagraphElement;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "起動中...";
      try {
        await this.app.startPose();
        overlay.remove();
      } catch (e) {
        err.style.display = "block";
        err.textContent =
          e instanceof Error ? e.message : "カメラの起動に失敗しました";
        btn.disabled = false;
        btn.textContent = "再試行";
      }
    });
  }
}
