// happy-dom 登録ヘルパ。DOM が必要なテストファイルから一度だけ呼ぶ。
// Issue #34: preload にすると localStorage 等の globalThis 書換テストが
// readonly で落ちるため、テストファイル個別に呼ぶ方式とした。
import { GlobalRegistrator } from "@happy-dom/global-registrator";

let registered = false;

export function registerHappyDom(): void {
  if (registered) return;
  if (typeof globalThis.document === "undefined") {
    GlobalRegistrator.register();
  }
  registered = true;
}
