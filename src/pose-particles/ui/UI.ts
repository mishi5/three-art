import type { App } from "../App";
import { DisplayAudioSource } from "../audio/DisplayAudioSource";
import { FileAudioSource } from "../audio/FileAudioSource";
import { MicAudioSource } from "../audio/MicAudioSource";

type Mode = "none" | "file" | "mic" | "display";

const btnCss = `
  flex: 1; padding: 6px 8px; background: rgba(255,255,255,0.1);
  color: #fff; border: 1px solid rgba(255,255,255,0.2);
  border-radius: 4px; cursor: pointer; font-size: 12px;
`;

export class UI {
  private root: HTMLElement;
  private mode: Mode = "none";

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
        // user gesture 内で AudioContext を起動しておく
        const ctx = this.app.getOrCreateAudioContext();
        if (ctx.state === "suspended") await ctx.resume();
        await this.app.startPose();
        overlay.remove();
        this.showControlPanel();
      } catch (e) {
        err.style.display = "block";
        err.textContent =
          e instanceof Error ? e.message : "起動に失敗しました";
        btn.disabled = false;
        btn.textContent = "再試行";
      }
    });
  }

  private showControlPanel(): void {
    const panel = document.createElement("div");
    panel.style.cssText = `
      position: fixed; top: 16px; right: 16px;
      background: rgba(20,20,20,0.7); padding: 12px;
      border: 1px solid rgba(255,255,255,0.15); border-radius: 6px;
      color: #fff; font-family: system-ui; font-size: 12px;
      backdrop-filter: blur(4px); z-index: 50;
      display: flex; flex-direction: column; gap: 8px; min-width: 200px;
    `;
    panel.innerHTML = `
      <div style="display:flex;gap:4px">
        <button data-mode="file"    style="${btnCss}">ファイル</button>
        <button data-mode="mic"     style="${btnCss}">マイク</button>
        <button data-mode="display" style="${btnCss}">PC音声</button>
      </div>
      <div id="file-controls" style="display:none">
        <input id="file-input" type="file" accept="audio/*" style="font-size:11px;color:#ccc">
        <div id="file-status" style="margin-top:6px;opacity:0.7"></div>
      </div>
      <div id="mic-status" style="display:none;opacity:0.7">マイク使用中</div>
      <div id="display-status" style="display:none;opacity:0.7">PC音声 使用中</div>
      <div id="audio-error" style="color:#f88;display:none"></div>
    `;
    this.root.appendChild(panel);

    const fileCtrl = panel.querySelector("#file-controls") as HTMLDivElement;
    const fileInput = panel.querySelector("#file-input") as HTMLInputElement;
    const fileStatus = panel.querySelector("#file-status") as HTMLDivElement;
    const micStatus = panel.querySelector("#mic-status") as HTMLDivElement;
    const displayStatus = panel.querySelector("#display-status") as HTMLDivElement;
    const errBox = panel.querySelector("#audio-error") as HTMLDivElement;

    panel.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((b) => {
      b.addEventListener("click", () => {
        const mode = b.dataset.mode as Mode;
        fileCtrl.style.display = "none";
        micStatus.style.display = "none";
        displayStatus.style.display = "none";
        if (mode === "file") {
          fileCtrl.style.display = "block";
          this.switchToFile();
        } else if (mode === "mic") {
          micStatus.style.display = "block";
          this.switchToMic(errBox);
        } else if (mode === "display") {
          displayStatus.style.display = "block";
          displayStatus.textContent = "PC音声を取得中…";
          this.switchToDisplay(errBox, displayStatus);
        }
      });
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const ctx = this.app.getOrCreateAudioContext();
        const src = new FileAudioSource(ctx);
        await src.loadFromFile(file);
        await src.start();
        this.app.setAudio(src);
        await this.app.onSongLoaded(file);
        fileStatus.textContent = `再生中: ${file.name}`;
        errBox.style.display = "none";
      } catch (e) {
        errBox.style.display = "block";
        errBox.textContent = e instanceof Error ? e.message : "ファイル読込失敗";
      }
    });
  }

  private switchToFile(): void {
    this.app.setAudio(null);
    this.mode = "file";
  }

  private async switchToMic(errBox: HTMLElement): Promise<void> {
    try {
      const ctx = this.app.getOrCreateAudioContext();
      const mic = new MicAudioSource(ctx);
      await mic.start();
      this.app.setAudio(mic);
      this.mode = "mic";
      errBox.style.display = "none";
    } catch (e) {
      errBox.style.display = "block";
      errBox.textContent =
        e instanceof Error ? e.message : "マイク起動失敗";
      this.mode = "none";
    }
  }

  private async switchToDisplay(errBox: HTMLElement, statusEl: HTMLElement): Promise<void> {
    try {
      const ctx = this.app.getOrCreateAudioContext();
      const display = new DisplayAudioSource(ctx);
      await display.start();
      this.app.setAudio(display);
      this.mode = "display";
      statusEl.textContent = "PC音声 使用中";
      errBox.style.display = "none";
    } catch (e) {
      const msg = this.displayErrorMessage(e);
      errBox.style.display = "block";
      errBox.textContent = msg;
      statusEl.style.display = "none";
      this.mode = "none";
    }
  }

  private displayErrorMessage(e: unknown): string {
    if (e instanceof Error) {
      if (e.name === "NotAllowedError") return "PC音声の取得がキャンセルされました";
      if (e.name === "NotSupportedError") return "このブラウザは PC 音声取得に対応していません";
      return e.message;
    }
    return "PC音声の取得に失敗しました";
  }
}
