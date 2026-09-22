// 効果音の再生。<audio>要素を毎回new Audio()で使い捨てにする実装だと、
// 同時に鳴らせるHTMLAudioElementの数に上限があるブラウザ(特にiOS Safari)で、
// 連射(射撃音)により上限を超えた瞬間から新しい音が鳴らなくなったり、
// 再生中のBGM(こちらも<audio>要素)まで巻き込まれて途切れることがある
// (本番環境で確認された不具合)。Web Audio APIでデコード済みの音声データ
// (AudioBuffer)をキャッシュし、再生のたびは軽量なAudioBufferSourceNodeを
// 作るだけにすることで、この上限を回避する。
import { isMuted } from "./audioSettings.js";

const SFX_VOLUME = 0.6;

let audioContext: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

// デコード済みのAudioBufferをファイル名ごとにキャッシュする
// (何度再生してもデコードは1回だけで済む)。
const bufferCache = new Map<string, Promise<AudioBuffer>>();
function loadBuffer(ctx: AudioContext, filename: string): Promise<AudioBuffer> {
  const cached = bufferCache.get(filename);
  if (cached) return cached;
  const promise = fetch(encodeURI(`/sounds/effects/${filename}`))
    .then((res) => res.arrayBuffer())
    .then((data) => ctx.decodeAudioData(data));
  bufferCache.set(filename, promise);
  return promise;
}

function playBuffer(ctx: AudioContext, buffer: AudioBuffer, volume: number): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(gain).connect(ctx.destination);
  source.start();
  return source;
}

function playSfx(filename: string, volume: number = SFX_VOLUME): void {
  if (isMuted()) return;
  const ctx = getAudioContext();
  // ブラウザの自動再生ポリシーでcontextがsuspendedのままのことがあるので、
  // 念のため毎回resumeを試みる(既にrunningなら何もしない)。
  void ctx.resume();
  loadBuffer(ctx, filename)
    .then((buffer) => {
      if (isMuted()) return; // デコード待ちの間にミュートされた場合は鳴らさない
      playBuffer(ctx, buffer, volume);
    })
    .catch(() => {});
}

// 再生完了(またはエラー・自動再生拒否)を待てる版。呼び出し側が「鳴り終わって
// から次の演出に進む」ような順序制御をしたい場合に使う。ミュート中は鳴らす
// 音自体が無いので、待たせずすぐ解決する。
function playSfxAwait(filename: string, volume: number = SFX_VOLUME): Promise<void> {
  if (isMuted()) return Promise.resolve();
  const ctx = getAudioContext();
  void ctx.resume();
  return loadBuffer(ctx, filename)
    .then(
      (buffer) =>
        new Promise<void>((resolve) => {
          if (isMuted()) {
            resolve();
            return;
          }
          const source = playBuffer(ctx, buffer, volume);
          source.onended = () => resolve();
        }),
    )
    .catch(() => {});
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
