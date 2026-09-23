// プレイ中(ラウンド中)だけ流れるBGM。1ラウンドにつき1曲をランダムに選び、
// ループ再生し続ける。次のラウンド(リトライ含む)ではまた別の曲が選ばれる。
import { isMuted, onMuteChange } from "./audioSettings.js";

const BGM_FILES = [
  "魔王魂 ループ サイバー01.mp3",
  "魔王魂 ループ サイバー02.mp3",
  "魔王魂 ループ サイバー11.mp3",
  "魔王魂 ループ サイバー14.mp3",
  "魔王魂 ループ BGM ネオロック33.mp3",
  "魔王魂 ループ BGM ネオロック73.mp3",
];


const NORMAL_VOLUME = 0.35;
// PAUSE中は「一時停止していることが分かる」程度まで下げる(消音にはしない)。
const PAUSED_VOLUME = 0.08;

let current: HTMLAudioElement | null = null;
// ミュート中でも「本来鳴らすべき音量」は覚えておき、ミュート解除時に復元する。
let targetVolume = NORMAL_VOLUME;
// タブが非表示になった瞬間、実際に再生中だったかどうか(visibilitychange
// ハンドラ参照)。
let wasPlayingBeforeHide = false;

function applyVolume(): void {
  if (!current) return;
  current.volume = isMuted() ? 0 : targetVolume;
}

onMuteChange(applyVolume);

export function playRandomBgm(): void {
  stopBgm();
  const file = BGM_FILES[Math.floor(Math.random() * BGM_FILES.length)];
  const audio = new Audio(encodeURI(`/sounds/bgm/${file}`));
  audio.loop = true;
  targetVolume = NORMAL_VOLUME;
  current = audio;
  applyVolume();
  // ブラウザの自動再生ポリシーで拒否される場合があるが、無音のまま
  // プレイできても致命的ではないので黙って無視する。
  audio.play().catch(() => {});
}

export function stopBgm(): void {
  if (!current) return;
  current.pause();
  current.currentTime = 0;
  current = null;
  wasPlayingBeforeHide = false;
}

// PAUSE中は音量を下げ、再開したら元に戻す。再生自体は止めない
// (止めるとcurrentTimeが進み続けず自然だが、フェード無しの再開だと
// 曲が急に鳴りだして違和感があるため、音量だけ下げる方式にする)。
export function setBgmPaused(paused: boolean): void {
  targetVolume = paused ? PAUSED_VOLUME : NORMAL_VOLUME;
  applyVolume();
}

// タブが非表示(別タブを見ている・スマホの画面offなど)の間は再生を
// 完全に止め、戻ってきたら(元々鳴っていた場合のみ)再開する。無課金版
// YouTube等と同じ、画面を見ていない間は音を鳴らし続けないという方針。
// PAUSE中の音量ダッキング(setBgmPaused)とは独立した、実際の再生/停止
// レイヤーの制御なので、両者は競合しない。
function pauseForVisibility(): void {
  if (!current || current.paused) return;
  wasPlayingBeforeHide = true;
  current.pause();
}

function resumeForVisibility(): void {
  if (!current || !wasPlayingBeforeHide) return;
  wasPlayingBeforeHide = false;
  current.play().catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseForVisibility();
  else resumeForVisibility();
});
