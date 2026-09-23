// ボス出現カットイン演出の文言モード設定。localStorageに保存し、次回起動時も
// 維持する。画面録画等で他人の投稿本文が映り込むのを避けたい場合向けに、
// 常にflavor.tsのランダム文言(フレーバーテキスト)に置き換えるモードを
// 選べるようにする。デフォルトはOFF(実際の投稿本文を使う)。
const FLAVOR_MODE_KEY = "danmakusky-cutin-flavor-mode";

let flavorMode = localStorage.getItem(FLAVOR_MODE_KEY) === "1";

export function isCutInFlavorMode(): boolean {
  return flavorMode;
}

export function setCutInFlavorMode(next: boolean): void {
  flavorMode = next;
  localStorage.setItem(FLAVOR_MODE_KEY, next ? "1" : "0");
}
