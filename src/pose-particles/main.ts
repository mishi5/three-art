import { App } from "./App";
import { UI } from "./ui/UI";

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not found");

const app = new App(canvas);
app.start();

const ui = new UI(app);
ui.showStartOverlay();

(window as unknown as { app: App }).app = app;
