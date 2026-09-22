// BGM・効果音共通のミュート設定。localStorageに保存し、次回起動時も維持する。
// 初回訪問(保存値が無い)時は、音が急に鳴って驚かせないようデフォルトはミュート。
const MUTE_KEY = "danmakusky-muted";

const storedMuted = localStorage.getItem(MUTE_KEY);
let muted = storedMuted === null ? true : storedMuted === "1";
const listeners = new Set<(muted: boolean) => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  for (const listener of listeners) listener(muted);
}

export function toggleMuted(): void {
  setMuted(!muted);
}

export function onMuteChange(listener: (muted: boolean) => void): void {
  listeners.add(listener);
}
