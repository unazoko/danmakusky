// BGM・効果音共通のミュート設定。
// 「音のON/OFFを記憶する」がONの場合のみミュート状態をlocalStorageに保存し、
// 次回起動時もそれを引き継ぐ(デフォルトON=記憶する)。OFFにした場合は保存を
// やめ、次回アクセス時は常にミュート(OFF)から始まる。
// また「記憶する」設定自体がまだ無い(≒保存済みミュート値も無い)初回訪問時は、
// 音が急に鳴って驚かせないようデフォルトはミュート。
const MUTE_KEY = "danmakusky-muted";
const REMEMBER_MUTE_KEY = "danmakusky-remember-mute";

let rememberMuted = localStorage.getItem(REMEMBER_MUTE_KEY) !== "0";

function loadInitialMuted(): boolean {
  if (!rememberMuted) return true;
  const stored = localStorage.getItem(MUTE_KEY);
  return stored === null ? true : stored === "1";
}

let muted = loadInitialMuted();
const listeners = new Set<(muted: boolean) => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  if (rememberMuted) localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  for (const listener of listeners) listener(muted);
}

export function toggleMuted(): void {
  setMuted(!muted);
}

export function onMuteChange(listener: (muted: boolean) => void): void {
  listeners.add(listener);
}

export function isRememberMuted(): boolean {
  return rememberMuted;
}

export function setRememberMuted(next: boolean): void {
  rememberMuted = next;
  localStorage.setItem(REMEMBER_MUTE_KEY, next ? "1" : "0");
}
