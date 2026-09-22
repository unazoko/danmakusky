// 効果音の単発再生。BGMと違って毎回使い捨てのAudioを作る(同じ効果音が
// 重なって鳴ってもきちんと重ねて再生できるようにするため)。
import { isMuted } from "./audioSettings.js";

const SFX_VOLUME = 0.6;

function playSfx(filename: string, volume: number = SFX_VOLUME): void {
  if (isMuted()) return;
  const audio = new Audio(encodeURI(`/sounds/effects/${filename}`));
  audio.volume = volume;
  // ブラウザの自動再生ポリシーで拒否される場合があるが、鳴らなくても
  // 致命的ではないので黙って無視する。
  audio.play().catch(() => {});
}

// 再生完了(またはエラー・自動再生拒否)を待てる版。呼び出し側が「鳴り終わって
// から次の演出に進む」ような順序制御をしたい場合に使う。ミュート中は鳴らす
// 音自体が無いので、待たせずすぐ解決する。
function playSfxAwait(filename: string, volume: number = SFX_VOLUME): Promise<void> {
  if (isMuted()) return Promise.resolve();
  return new Promise((resolve) => {
    const audio = new Audio(encodeURI(`/sounds/effects/${filename}`));
    audio.volume = volume;
    const done = () => resolve();
    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener("error", done, { once: true });
    audio.play().catch(done);
  });
}

export function playStartScreenSfx(): void {
  playSfx("スタート画面.mp3", 1.0);
}

export function playResultSfx(): void {
  playSfx("結果.mp3", 0.8);
}

// 残機がなくなった瞬間(ゲームオーバー確定時)に1回だけ鳴らす。結果画面は
// これが鳴り終わってから表示するため、Promiseを返す。
export function playPlayerDownSfx(): Promise<void> {
  return playSfxAwait("自機撃墜.mp3");
}

export function playWeakOrMidBossDownSfx(): void {
  playSfx("弱・中ボス撃墜.mp3", 1.0);
}

export function playStrongBossDownSfx(): void {
  playSfx("強ボス撃墜.mp3", 1.0);
}

export function playGrazeSfx(): void {
  playSfx("グレイズ.mp3", 0.6);
}

export function playShotSfx(): void {
  playSfx("射撃.mp3", 0.85);
}

export function playLifeUpSfx(): void {
  playSfx("残機回復.mp3", 0.85);
}
