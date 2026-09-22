// プレイ中(ラウンド中)だけ流れるBGM。1ラウンドにつき1曲をランダムに選び、
// ループ再生し続ける。次のラウンド(リトライ含む)ではまた別の曲が選ばれる。
const BGM_FILES = [
  "魔王魂 ループ サイバー01.mp3",
  "魔王魂 ループ サイバー02.mp3",
  "魔王魂 ループ サイバー14.mp3",
  "魔王魂 ループ サイバー16.mp3",
];

const NORMAL_VOLUME = 0.5;
// PAUSE中は「一時停止していることが分かる」程度まで下げる(消音にはしない)。
const PAUSED_VOLUME = 0.15;

let current: HTMLAudioElement | null = null;

export function playRandomBgm(): void {
  stopBgm();
  const file = BGM_FILES[Math.floor(Math.random() * BGM_FILES.length)];
  const audio = new Audio(encodeURI(`/sounds/bgm/${file}`));
  audio.loop = true;
  audio.volume = NORMAL_VOLUME;
  // ブラウザの自動再生ポリシーで拒否される場合があるが、無音のまま
  // プレイできても致命的ではないので黙って無視する。
  audio.play().catch(() => {});
  current = audio;
}

export function stopBgm(): void {
  if (!current) return;
  current.pause();
  current.currentTime = 0;
  current = null;
}

// PAUSE中は音量を下げ、再開したら元に戻す。再生自体は止めない
// (止めるとcurrentTimeが進み続けず自然だが、フェード無しの再開だと
// 曲が急に鳴りだして違和感があるため、音量だけ下げる方式にする)。
export function setBgmPaused(paused: boolean): void {
  if (!current) return;
  current.volume = paused ? PAUSED_VOLUME : NORMAL_VOLUME;
}
