import { App } from "./App";

const canvas = document.getElementById("canvas");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas not found");

const app = new App(canvas);
app.start();

// dev 用：window から触れるように
(window as unknown as { app: App }).app = app;
