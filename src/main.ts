import { marked } from "marked";
import { MisskeyStream, type StreamStatus } from "./misskeyStream.js";
import { extractEmojiOccurrences, type EmojiOccurrence } from "./noteEmoji.js";
import {
  getOrLoadEmojiImage,
  randomCachedEmojiImage,
  drawBullets,
  drawPlayer,
  drawPlayerBullets,
  drawCore,
} from "./render.js";
import { InputController } from "./input.js";
import { GameState, INITIAL_LIFE, type GameOverInfo } from "./game/loop.js";
import { formatTime } from "./format.js";
import { buildShareText, openShareForm } from "./share.js";
import { getHighScore, updateHighScore, clearHighScore } from "./storage.js";
import { ReactionTracker } from "./reactionTracker.js";
import { NoteRateTracker } from "./noteRate.js";
import {
  recordEmojiEncounter,
  recordEmojiDefeat,
  getCollection,
  clearCollection,
  type CollectionEntry,
} from "./emojiCollection.js";
import { Starfield } from "./starfield.js";
import { playRandomBgm, stopBgm, setBgmPaused } from "./bgm.js";
import { isMuted, toggleMuted, onMuteChange } from "./audioSettings.js";
import { createIcon } from "./icons.js";
import {
  playStartScreenSfx,
  playResultSfx,
  playPlayerDownSfx,
  playWeakOrMidBossDownSfx,
  playStrongBossDownSfx,
  playGrazeSfx,
  playShotSfx,
  playLifeUpSfx,
} from "./sfx.js";
import {
  cutInTierLabel,
  fakeDensityPercent,
  fakeSyncRate,
  fakeThreatLevel,
  randomBootFlavorLine,
  randomCoreDefeatLine,
  randomCutInQuote,
  randomDeathIntro,
  randomGlitchLine,
  randomLifeUpLine,
  randomSystemStatus,
  START_PROGRESS_LABELS,
} from "./flavor.js";
import type { Core } from "./game/entities.js";
// 確認ダイアログ・ライセンス情報の本文はビルド時に埋め込む(?rawで文字列として取り込む)。
import clearDataConfirmMd from "./docs/データ削除確認.md?raw";
import licenseMd from "./docs/ライセンス情報.md?raw";

function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

const titleScreen = $<HTMLDivElement>("#titleScreen");
const gameScreen = $<HTMLDivElement>("#gameScreen");
const gameOverScreen = $<HTMLDivElement>("#gameOverScreen");
const instanceInput = $<HTMLInputElement>("#instanceInput");
const startButton = $<HTMLButtonElement>("#startButton");
const titleError = $<HTMLParagraphElement>("#titleError");
const hudStatus = $<HTMLSpanElement>("#hudStatus");
const hudScore = $<HTMLSpanElement>("#hudScore");
const hudLife = $<HTMLSpanElement>("#hudLife");
const hudTime = $<HTMLSpanElement>("#hudTime");
const gameOverCause = $<HTMLParagraphElement>("#gameOverCause");
const resultScore = $<HTMLElement>("#resultScore");
const resultTime = $<HTMLElement>("#resultTime");
const resultGraze = $<HTMLElement>("#resultGraze");
const hudGraze = $<HTMLSpanElement>("#hudGraze");
const hudScoreBonus = $<HTMLSpanElement>("#hudScoreBonus");
const highScoreLine = $<HTMLParagraphElement>("#highScoreLine");
const backToTitleButton = $<HTMLButtonElement>("#backToTitleButton");
const retryButton = $<HTMLButtonElement>("#retryButton");
const shareButton = $<HTMLButtonElement>("#shareButton");
const densityWarning = $<HTMLDivElement>("#densityWarning");
const bootSequence = $<HTMLDivElement>("#bootSequence");
const fireButton = $<HTMLButtonElement>("#fireButton");
const soundToggleButton = $<HTMLButtonElement>("#soundToggleButton");
const soundToggleIcon = $<HTMLSpanElement>("#soundToggleIcon");
const collectionButtonIcon = $<HTMLSpanElement>("#collectionButtonIcon");
collectionButtonIcon.append(createIcon("book-open"));

const startButtonIcon = $<HTMLSpanElement>("#startButtonIcon");
const pauseButtonIcon = $<HTMLSpanElement>("#pauseButtonIcon");
const collectionCloseButtonIcon = $<HTMLSpanElement>("#collectionCloseButtonIcon");
const collectionDetailCloseButtonIcon = $<HTMLSpanElement>("#collectionDetailCloseButtonIcon");
const licenseCloseButtonIcon = $<HTMLSpanElement>("#licenseCloseButtonIcon");
const licenseButtonIcon = $<HTMLSpanElement>("#licenseButtonIcon");
const clearDataButtonIcon = $<HTMLSpanElement>("#clearDataButtonIcon");

startButtonIcon.append(createIcon("play"));
collectionCloseButtonIcon.append(createIcon("x"));
collectionDetailCloseButtonIcon.append(createIcon("x"));
licenseCloseButtonIcon.append(createIcon("x"));
licenseButtonIcon.append(createIcon("copyright"));
clearDataButtonIcon.append(createIcon("trash-2"));
// 一時停止ボタンだけは状態(再生中/一時停止中)に応じてアイコンを切り替える
// (初期状態は必ず再生中なので、ここでは固定でpauseアイコンを入れておく。
// 以後の切り替えはpauseGame/resumeGame側のupdatePauseButtonIcon呼び出しで行う)。
pauseButtonIcon.append(createIcon("pause"));
function updatePauseButtonIcon(): void {
  pauseButtonIcon.replaceChildren(createIcon(paused ? "play" : "pause"));
}
const coreMessage = $<HTMLDivElement>("#coreMessage");
const hudRate = $<HTMLSpanElement>("#hudRate");
const hudFake = $<HTMLSpanElement>("#hudFake");
const glitchOverlay = $<HTMLDivElement>("#glitchOverlay");
const gameOverIntro = $<HTMLParagraphElement>("#gameOverIntro");
const gameOverStatus = $<HTMLParagraphElement>("#gameOverStatus");
const cutIn = $<HTMLDivElement>("#cutIn");
const cutInImg = $<HTMLImageElement>("#cutInImg");
const cutInLabel = $<HTMLSpanElement>("#cutInLabel");
const cutInName = $<HTMLSpanElement>("#cutInName");
const cutInQuote = $<HTMLSpanElement>("#cutInQuote");
const canvas = $<HTMLCanvasElement>("#gameCanvas");
const ctx = canvas.getContext("2d")!;
const startProgress = $<HTMLDivElement>("#startProgress");
const startProgressLabel = $<HTMLDivElement>("#startProgressLabel");
const startProgressFill = $<HTMLDivElement>("#startProgressFill");
const startProgressPercent = $<HTMLSpanElement>("#startProgressPercent");
const pauseButton = $<HTMLButtonElement>("#pauseButton");
const pauseOverlay = $<HTMLDivElement>("#pauseOverlay");
const resumeButton = $<HTMLButtonElement>("#resumeButton");
const pauseRetryButton = $<HTMLButtonElement>("#pauseRetryButton");
const pauseBackToTitleButton = $<HTMLButtonElement>("#pauseBackToTitleButton");
const collectionButton = $<HTMLButtonElement>("#collectionButton");
const collectionOverlay = $<HTMLDivElement>("#collectionOverlay");
const collectionList = $<HTMLDivElement>("#collectionList");
const collectionCloseButton = $<HTMLButtonElement>("#collectionCloseButton");
const collectionDetailOverlay = $<HTMLDivElement>("#collectionDetailOverlay");
const collectionDetailImg = $<HTMLImageElement>("#collectionDetailImg");
const collectionDetailShortcode = $<HTMLParagraphElement>("#collectionDetailShortcode");
const collectionDetailCount = $<HTMLElement>("#collectionDetailCount");
const collectionDetailDefeat = $<HTMLElement>("#collectionDetailDefeat");
const collectionDetailCloseButton = $<HTMLButtonElement>("#collectionDetailCloseButton");
const clearDataButton = $<HTMLButtonElement>("#clearDataButton");
const clearDataOverlay = $<HTMLDivElement>("#clearDataOverlay");
const clearDataMessage = $<HTMLDivElement>("#clearDataMessage");
const clearDataCancelButton = $<HTMLButtonElement>("#clearDataCancelButton");
const clearDataConfirmButton = $<HTMLButtonElement>("#clearDataConfirmButton");
const licenseButton = $<HTMLButtonElement>("#licenseButton");
const licenseOverlay = $<HTMLDivElement>("#licenseOverlay");
const licenseContent = $<HTMLDivElement>("#licenseContent");
const licenseCloseButton = $<HTMLButtonElement>("#licenseCloseButton");

// 確認ダイアログ・ライセンス情報のMarkdownをHTMLへ変換しcontainerへ差し込む。
// 内容はdanmakusky自身がビルド時に同梱する文書(利用者の入力ではない)なので、
// サニタイズせずそのままinnerHTMLへ描画してよい。
function renderMarkdownDocInto(container: HTMLElement, markdown: string): void {
  container.innerHTML = marked.parse(markdown, { async: false }) as string;
  // markedはリンクにtarget/relを付けないため、タップでゲームから離脱しない
  // よう(新しいタブで開くよう)ここで補う。
  for (const a of container.querySelectorAll("a[href]")) {
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
}

renderMarkdownDocInto(clearDataMessage, clearDataConfirmMd);
renderMarkdownDocInto(licenseContent, licenseMd);

function normalizeHost(raw: string): string | null {
  const trimmed = raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!trimmed || /\s/.test(trimmed)) return null;
  return trimmed;
}

function renderLifeHearts(life: number): void {
  const filled = "♥".repeat(Math.max(life, 0));
  const empty = "♡".repeat(Math.max(INITIAL_LIFE - life, 0));
  const maxLabel = life >= INITIAL_LIFE ? " MAX" : "";
  hudLife.textContent = `LIFE ${filled}${empty}${maxLabel}`;
}

const STATUS_LABELS: Record<StreamStatus, string> = {
  connecting: "ESTABLISHING FEDERATION UPLINK...",
  online: "UPLINK STABLE // STREAM ONLINE",
  "idle-timeout": "SIGNAL LOST (無音: 別インスタンスを推奨)",
  reconnecting: "UPLINK UNSTABLE // RECONNECTING...",
  closed: "UPLINK TERMINATED",
};

let stream: MisskeyStream | null = null;
let reactionTracker: ReactionTracker | null = null;
let noteRateTracker: NoteRateTracker | null = null;
let game: GameState | null = null;
let input: InputController | null = null;
let pendingOccurrences: EmojiOccurrence[] = [];
let playerEmojiChosen = false;
let lastGameOverInfo: GameOverInfo | null = null;
// tick()・scheduleGlitch()の自己再帰を止めるためのフラグ。スタート画面に
// 戻ったときにここをfalseにすると、次に予定されている分で自然に止まる。
let gameSessionActive = false;
// 進捗演出中はbootSequenceがまだ非表示でappendBootLineが素通りするため、
// 演出が実際に表示された時点(revealGame)で状態を復元できるよう覚えておく。
let currentStreamStatus: StreamStatus = "connecting";
// 一時停止中はgame.update()を呼ばない(=時間経過そのものを止める)ことで、
// スコア・生存時間・弾の動きなど全てを凍結する。ストリーム受信自体は続くが、
// onNote側でこのフラグを見て内容を無視するため、新しい弾も生成されない。
let paused = false;
let pausedAt = 0;
// ゲームロジックに渡す「仮想時計」の、実時間からの累積補正量。一時停止していた
// 実時間ぶんを再開時にここへ足し込み、以後gameNow()から差し引く。GameState・
// coreManager・spawner・bulletMotion側の全タイマーはここで渡すnowを基準に
// 動いているため、呼び出し側でperformance.now()の代わりにこれを使うだけで、
// 停止していた時間がスコアや弾の再攻撃タイマーに一気に反映される事態を防げる。
let pauseAccumulatedMs = 0;
function gameNow(): number {
  return performance.now() - pauseAccumulatedMs;
}

// 起動時の演出。裏側では既にストリーム接続・ゲームが進行していてよく、
// あくまで見た目の飾り。実際のストリーム状態(接続中/オンライン/無音)に
// 文言を連動させることで、それらしさを保ちつつ嘘は言わないようにする。
function runBootSequence(): void {
  bootSequence.hidden = false;
  bootSequence.classList.remove("fade-out");
  bootSequence.innerHTML = `DANMAKUSKY<br /><br />${randomBootFlavorLine()}<br />INITIALIZING FEDERATED STREAM...`;
}
function appendBootLine(line: string): void {
  if (bootSequence.hidden) return;
  bootSequence.innerHTML += `<br />${line}`;
}
function finishBootSequence(finalLine: string): void {
  if (bootSequence.hidden) return;
  appendBootLine(finalLine);
  bootSequence.classList.add("fade-out");
  window.setTimeout(() => {
    bootSequence.hidden = true;
  }, 600);
}

// スマホ用の発射ボタン。押している間だけ発射する(東方のZキー連射と同じ、
// input.ts: FIRE_KEYS参照)。
function wireFireButton(input: InputController): void {
  const start = (ev: Event) => {
    ev.preventDefault();
    input.setFireButtonHeld(true);
  };
  const stop = () => input.setFireButtonHeld(false);
  fireButton.addEventListener("pointerdown", start);
  fireButton.addEventListener("pointerup", stop);
  fireButton.addEventListener("pointerleave", stop);
  fireButton.addEventListener("pointercancel", stop);
}

let coreMessageHideTimer: ReturnType<typeof setTimeout> | undefined;
function flashCoreMessage(text: string): void {
  clearTimeout(coreMessageHideTimer);
  coreMessage.textContent = text;
  coreMessage.hidden = false;
  coreMessageHideTimer = setTimeout(() => {
    coreMessage.hidden = true;
  }, 1800);
}

// ボス撃破・満タン時の残機回復弾など、まとまった加点があった瞬間だけSCOREの
// 右に一瞬表示する。表示中に次の加点が来た場合は、新しい方を優先して
// 表示し直す(タイマーもリセットする)。
let scoreBonusHideTimer: ReturnType<typeof setTimeout> | undefined;
function flashScoreBonus(amount: number): void {
  clearTimeout(scoreBonusHideTimer);
  hudScoreBonus.textContent = `(+${amount.toLocaleString()})`;
  hudScoreBonus.hidden = false;
  scoreBonusHideTimer = setTimeout(() => {
    hudScoreBonus.hidden = true;
  }, 800);
}

// コア出現時のカットイン演出(東方Project的なボス登場演出)。雑魚(weak)は
// ひっきりなしに出現するので対象外にし、中ボス・強ボスの出現時だけ出す。
// 同時に複数体出現した場合に演出が重ならないよう、簡単なキューで直列化する。
const CUT_IN_SHOW_MS = 1400;
const CUT_IN_TRANSITION_MS = 400;
const cutInQueue: Core[] = [];
let cutInPlaying = false;

function enqueueCutIn(core: Core): void {
  if (core.tier === "weak") return;
  cutInQueue.push(core);
  processCutInQueue();
}

function processCutInQueue(): void {
  if (cutInPlaying || cutInQueue.length === 0) return;
  const core = cutInQueue.shift()!;
  playCutIn(core);
}

function playCutIn(core: Core): void {
  cutInPlaying = true;
  cutInImg.src = core.img.src;
  cutInLabel.textContent = cutInTierLabel(core.tier);
  cutInName.textContent = core.shortcode ? `:${core.shortcode}:` : "???";
  cutInQuote.textContent = randomCutInQuote(core.tier);
  cutIn.dataset.tier = core.tier;
  cutIn.hidden = false;
  // 一度hidden解除してからclass付与しないとtransitionが発火しないため、次フレームに回す。
  requestAnimationFrame(() => cutIn.classList.add("show"));

  window.setTimeout(() => {
    cutIn.classList.remove("show");
    window.setTimeout(() => {
      cutIn.hidden = true;
      cutInPlaying = false;
      processCutInQueue();
    }, CUT_IN_TRANSITION_MS);
  }, CUT_IN_SHOW_MS);
}

// ゲームの進行には一切影響しない、意味のない一言を挟む演出。忘れた頃に
// ちらっと出る程度の頻度・長さに抑え、プレイの邪魔にならないようにする。
let glitchHideTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleGlitch(): void {
  const delay = 10000 + Math.random() * 15000;
  window.setTimeout(() => {
    if (!gameSessionActive) return;
    if (game && !game.gameOver && !paused) {
      clearTimeout(glitchHideTimer);
      glitchOverlay.textContent = randomGlitchLine();
      glitchOverlay.hidden = false;
      glitchHideTimer = setTimeout(() => {
        glitchOverlay.hidden = true;
      }, 900);
    }
    scheduleGlitch();
  }, delay);
}

// 東方Project等の伝統的弾幕STGは画面が縦長基調(横長にはならない)。
// 横に広いウィンドウ(PCのブラウザ等)でもプレイエリアが横長にならないよう、
// 幅を高さの80%までに制限する(canvas自体はCSS側で中央寄せにしている、
// style.css: #gameScreen参照)。
const MAX_PLAY_AREA_ASPECT = 0.8; // 幅 / 高さ の上限

// 「宇宙を飛んでいる」感じを出す背景の星々。ゲーム画面が出る前(タイトルの
// 裏)から動かしても問題ないので、初回のresizeCanvas呼び出し時に作る。
let starfield: Starfield | null = null;

function resizeCanvas(): void {
  canvas.width = Math.min(window.innerWidth, window.innerHeight * MAX_PLAY_AREA_ASPECT);
  canvas.height = window.innerHeight;
  if (starfield) starfield.resize(canvas.width, canvas.height);
  else starfield = new Starfield(canvas.width, canvas.height);
}
window.addEventListener("resize", resizeCanvas);

// 絵文字ショートコードは空白を含まないため、長いと折り返せずに枠から
// はみ出す。まずフォントサイズを少しずつ縮めて収めることを試み、
// 最小サイズでも収まらない極端に長いケースはCSS側のoverflow-wrapに任せる。
const CAUSE_SHORTCODE_MAX_FONT_REM = 1.6;
const CAUSE_SHORTCODE_MIN_FONT_REM = 0.85;
function fitCauseShortcodeFontSize(el: HTMLElement): void {
  const maxWidth = el.parentElement?.clientWidth ?? 0;
  if (maxWidth === 0) return;

  // CSS側のoverflow-wrapによる折り返しが先に効いてしまうと、常に
  // (折り返し後の)1行分の幅までしか測れず、縮小が一切発動しなくなる。
  // 測定・縮小の間だけ折り返しを止め、1行としての本来の幅で判定する。
  el.style.whiteSpace = "nowrap";
  let size = CAUSE_SHORTCODE_MAX_FONT_REM;
  for (;;) {
    el.style.fontSize = `${size}rem`;
    if (el.scrollWidth <= maxWidth || size <= CAUSE_SHORTCODE_MIN_FONT_REM) break;
    size = Math.round((size - 0.1) * 10) / 10;
  }
  // 最小サイズでも収まらない極端に長いケースは、折り返しを戻して
  // overflow-wrapに任せる(はみ出すよりは折り返した方がまし)。
  el.style.whiteSpace = "";
}

// 実際の死因は、GameOverInfo.causeShortcode(=当たった弾の絵文字ショートコード、
// そのまま)をそのまま見出しにする。ゲーム側だけが異常に真剣なトーンを崩さない
// のが狙いなので、ふざけた文言は入れない。
function showGameOver(info: GameOverInfo): void {
  lastGameOverInfo = info;
  stopBgm();
  gameScreen.hidden = true;

  gameOverIntro.textContent = randomDeathIntro();
  gameOverStatus.textContent = `SYSTEM STATUS: ${randomSystemStatus()}`;

  gameOverCause.replaceChildren();
  if (info.causeImg) {
    const img = new Image();
    img.src = info.causeImg.src;
    img.className = "cause-emoji-img";
    gameOverCause.append(img);
    // 絵文字コレクション側にも「これに撃墜された回数」として記録する。
    recordEmojiDefeat(info.causeShortcode ?? "不明", info.causeImg.src);
  }
  const shortcodeLabel = document.createElement("span");
  shortcodeLabel.className = "cause-shortcode";
  shortcodeLabel.textContent = info.causeShortcode ?? "??? (不明)";
  gameOverCause.append(shortcodeLabel);

  resultScore.textContent = info.score.toLocaleString();
  resultTime.textContent = formatTime(info.survivedMs);
  resultGraze.textContent = info.grazeCount.toLocaleString();

  const isNewHighScore = updateHighScore(info.score);
  highScoreLine.textContent = isNewHighScore
    ? "★ NEW HIGH SCORE ★"
    : `HIGH SCORE ${getHighScore().toLocaleString()}`;

  // 自機撃墜.mp3が鳴り終わってから結果画面を表示する(fitCauseShortcodeFontSizeは
  // 実際にレイアウトされていないと幅を測れないため、表示後に呼ぶ)。
  playPlayerDownSfx().then(() => {
    gameOverScreen.hidden = false;
    fitCauseShortcodeFontSize(shortcodeLabel);
    playResultSfx();
  });
}

// presetShipImgを渡した場合(ゲーム初回開始時、進捗演出中に選定・読込済みの
// 自機画像、またはそれが間に合わなかったときのキャッシュからの代役)は
// それをそのまま自機として確定し、以降のプレイ中は変えない(プレイ中に
// 自機の見た目が変わるのは不自然なため)。渡さなかった場合のみ、最初に
// 届いた投稿で自機を決める(onNote内のロジック、またはこの下のpending処理)。
// もう一度遊ぶ(retry)では何も渡さず、その場で新しく抽選し直す。
function startRound(now: number, presetShipImg: HTMLImageElement | null = null): void {
  gameOverScreen.hidden = true;
  gameScreen.hidden = false;
  resizeCanvas();
  playRandomBgm();

  playerEmojiChosen = presetShipImg !== null;
  game = new GameState(
    canvas,
    {
      onLifeChange: renderLifeHearts,
      onScoreChange: (score) => {
        hudScore.textContent = `SCORE ${score.toLocaleString()}`;
      },
      onGameOver: showGameOver,
      onCoreDefeated: (core) => {
        flashCoreMessage(randomCoreDefeatLine());
        if (core.tier === "strong") playStrongBossDownSfx();
        else playWeakOrMidBossDownSfx();
      },
      onCoreSpawned: (core) => enqueueCutIn(core),
      onLifeUp: () => {
        flashCoreMessage(randomLifeUpLine());
        playLifeUpSfx();
      },
      onGrazeChange: (count) => {
        hudGraze.textContent = `GRAZE ${count.toLocaleString()}`;
        playGrazeSfx();
      },
      onScoreBonus: (amount) => flashScoreBonus(amount),
      onPlayerShoot: () => playShotSfx(),
    },
    now,
    presetShipImg,
  );
  renderLifeHearts(INITIAL_LIFE);
  hudScore.textContent = "SCORE 0";
  hudTime.textContent = "TIME 00:00.0";
  hudGraze.textContent = "GRAZE 0";
  clearTimeout(scoreBonusHideTimer);
  hudScoreBonus.hidden = true;

  // 溜まっていた絵文字出現(接続直後〜自機決定前)をここで反映する。
  if (pendingOccurrences.length > 0) {
    if (!presetShipImg) maybeChooseShip(pendingOccurrences);
    game.handleEmojiOccurrences(pendingOccurrences, now);
    pendingOccurrences = [];
  }
}

// 自機は取得済みカスタム絵文字からランダムに1つ選ぶ。
// ゲーム開始直後、最初に流れてきた投稿から選ぶ。
function maybeChooseShip(occurrences: EmojiOccurrence[]): void {
  if (playerEmojiChosen || !game || occurrences.length === 0) return;
  const picked = occurrences[Math.floor(Math.random() * occurrences.length)];
  game.player.emojiImg = getOrLoadEmojiImage(picked.url);
  playerEmojiChosen = true;
}

let lastFrameAt = performance.now();
function tick(now: number): void {
  if (!gameSessionActive) return;

  const dtSec = Math.min((now - lastFrameAt) / 1000, 0.1);
  lastFrameAt = now;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!paused) starfield?.update(dtSec);
  starfield?.draw(ctx);

  if (game && input && !game.gameOver) {
    if (!paused) {
      const t = gameNow();
      game.update(dtSec, t, input);
      hudRate.textContent = `TL ${noteRateTracker?.ratePerMinute(now) ?? 0} notes/min`;
      hudTime.textContent = `TIME ${formatTime(game.survivedMs(t))}`;
      // 見た目だけのハッタリ数値。ゲームの難易度・判定には一切関与しない。
      hudFake.textContent = `DENSITY ${fakeDensityPercent(now)}% / SYNC ${fakeSyncRate(now)}% / THREAT ${fakeThreatLevel(now)}`;
    }
    // 一時停止中も、直前のフレームの状態をそのまま描画し続ける(フリーズ画面)。
    for (const core of game.cores) drawCore(ctx, core);
    drawBullets(ctx, game.bullets, now);
    drawPlayerBullets(ctx, game.playerBullets);
    drawPlayer(ctx, game.player, now);
    densityWarning.hidden = paused || !game.isStreamOverflowing(now);
  } else {
    densityWarning.hidden = true;
  }

  requestAnimationFrame(tick);
}

// ストリーム接続・自機絵文字の選定と画像読込は、進捗演出(runStartProgress)の
// 裏側で先に済ませておく。ゲーム画面を実際に表示する(revealGame)のは、
// 自機画像の準備ができてから(=自機が一瞬透明で始まる、を防ぐ)。
function startGame(host: string): void {
  gameSessionActive = true;
  playerEmojiChosen = false;
  pendingOccurrences = [];
  currentStreamStatus = "connecting";
  paused = false;
  pauseAccumulatedMs = 0;
  updatePauseButtonIcon();

  let chosenShipImg: HTMLImageElement | null = null;
  let shipReady = false;

  noteRateTracker = new NoteRateTracker();
  stream = new MisskeyStream(host, {
    onNote: (note) => {
      // 一時停止中は投稿を完全に無視する(時間を本当に止めるため。再開後に
      // 溜め込んだ分をまとめて反映する、といったこともしない)。
      if (paused) return;
      noteRateTracker?.record(performance.now());
      reactionTracker?.track(note.id);
      // リノートの場合、リノート自体だけでなく元投稿の方にもリアクションが
      // 付きうるので、そちらも合わせて追跡する。
      if (note.renote) reactionTracker?.track(note.renote.id);

      const occurrences = extractEmojiOccurrences(note);
      if (occurrences.length === 0) return;
      for (const o of occurrences) {
        recordEmojiEncounter(o.shortcode, o.url);
        // 選ばれなかった絵文字も含めて読み込みだけは進めておく。自機候補
        // (chosenShipImg)がタイムアウトまでに読み込み終わらなかった場合、
        // ここで先読みした分がrandomCachedEmojiImage()のフォールバック候補になる。
        getOrLoadEmojiImage(o.url);
      }
      const t = gameNow();
      if (!playerEmojiChosen) {
        // ここに来る(playerEmojiChosenがfalseのまま)のは、進捗演出中もその後も
        // 自機を何も決められなかった場合(投稿もキャッシュも無かった)のみ。
        // 一度でも自機が決まったら(キャッシュ代役も含め)ここは二度と通らないため、
        // プレイ中に見た目が変わることはない。
        const picked = occurrences[Math.floor(Math.random() * occurrences.length)];
        const candidate = getOrLoadEmojiImage(picked.url);
        chosenShipImg = candidate;
        playerEmojiChosen = true;
        if (game) game.player.emojiImg = candidate;
        // 画像そのもののダウンロード完了は待たない。決まった時点で確定でき、
        // 見た目は他の弾・コアの絵文字と同じく読み込み終わり次第自然に表示
        // される(ネットワークが遅くてもプログレス演出を長引かせずに済む)。
        shipReady = true;
        // ただし画像そのものが壊れている/読み込みに失敗した場合は、確定した
        // ままだと自機がずっと非表示になってしまうので、選び直せるよう
        // 状態を巻き戻す(次に届く投稿で再抽選される)。
        candidate.addEventListener(
          "error",
          () => {
            playerEmojiChosen = false;
            chosenShipImg = null;
          },
          { once: true },
        );
      }
      if (game) game.handleEmojiOccurrences(occurrences, t);
      else pendingOccurrences.push(...occurrences);
    },
    onStatusChange: (status) => {
      currentStreamStatus = status;
      hudStatus.textContent = STATUS_LABELS[status];
      if (status === "connecting" || status === "reconnecting") {
        appendBootLine("CONNECTING TO FEDERATION...");
      } else if (status === "online") {
        appendBootLine("STREAM ONLINE");
        appendBootLine("");
        appendBootLine(`EMOJI DENSITY: ${fakeDensityPercent(performance.now())}%`);
        appendBootLine(`THREAT LEVEL: ${fakeThreatLevel(performance.now())}`);
        finishBootSequence("GOOD LUCK.");
      } else if (status === "idle-timeout") {
        finishBootSequence("NO SIGNAL (別のインスタンスも試してみてください)");
      }
    },
  });
  reactionTracker = new ReactionTracker(stream, (reaction) => {
    if (paused) return;
    recordEmojiEncounter(reaction.shortcode, reaction.url);
    game?.handleEmojiOccurrences([reaction], gameNow());
  });
  stream.connect();

  runStartProgress(
    () => shipReady,
    () => {
      if (chosenShipImg) {
        revealGame(chosenShipImg);
        return;
      }
      // タイムアウトまでに投稿が1件も来なかった場合のみここに来る。既に
      // 読み込み済みの絵文字(コアの弾等で先に流れてきたもの)があればそれを
      // 代役の自機にする。プレイ中に見た目が変わるのは不自然なので、一度
      // これに決めたら(startRound内でpresetShipImgとして)以後は変えない。
      revealGame(randomCachedEmojiImage());
    },
  );
}

// 進捗演出が終わった後、実際にゲーム画面を表示してプレイを開始する。
function revealGame(shipImg: HTMLImageElement | null): void {
  titleScreen.hidden = true;
  input = new InputController(canvas);
  input.setFireButtonElement(fireButton);
  wireFireButton(input);
  runBootSequence();

  // ストリームの状態遷移は進捗演出中(bootSequenceがまだ非表示)に既に
  // 起きている場合があるため、appendBootLineのイベント任せにはできない。
  // 現在の状態から、いま表示すべき行を組み立て直す。
  if (currentStreamStatus === "online") {
    appendBootLine("STREAM ONLINE");
    appendBootLine("");
    appendBootLine(`EMOJI DENSITY: ${fakeDensityPercent(performance.now())}%`);
    appendBootLine(`THREAT LEVEL: ${fakeThreatLevel(performance.now())}`);
    finishBootSequence("GOOD LUCK.");
  } else if (currentStreamStatus === "idle-timeout") {
    finishBootSequence("NO SIGNAL (別のインスタンスも試してみてください)");
  } else {
    appendBootLine("CONNECTING TO FEDERATION...");
  }

  startRound(gameNow(), shipImg);
  scheduleGlitch();

  lastFrameAt = performance.now();
  requestAnimationFrame(tick);
}

// タイトル画面に戻る。ストリーム接続・ゲームループ・演出タイマーを全て
// 終了させ、次にSTARTを押したときにまっさらな状態から始められるようにする。
function backToTitle(): void {
  gameSessionActive = false;
  stopBgm();
  paused = false;
  pauseAccumulatedMs = 0;
  pauseOverlay.hidden = true;
  updatePauseButtonIcon();
  stream?.disconnect();
  stream = null;
  reactionTracker = null;
  noteRateTracker = null;
  game = null;
  input?.dispose();
  input = null;
  pendingOccurrences = [];
  playerEmojiChosen = false;

  gameOverScreen.hidden = true;
  gameScreen.hidden = true;
  titleScreen.hidden = false;
  titleError.hidden = true;
  playStartScreenSfx();
}

// 一時停止/再開。tick側はgame.update()を呼ばないことで弾の動き等を凍結するが、
// それだけだとGameState内部のstartedAt等は実時刻のまま進んでしまい、再開した
// 瞬間に停止していた分がまとめてスコア・生存時間・弾の再攻撃タイマーに反映されて
// しまう。それを防ぐため、停止していた実時間をpauseAccumulatedMsに積み上げ、
// 以後gameNow()で差し引く。
function pauseGame(): void {
  if (!game || game.gameOver || paused) return;
  paused = true;
  pausedAt = performance.now();
  pauseOverlay.hidden = false;
  setBgmPaused(true);
  updatePauseButtonIcon();
}
function resumeGame(): void {
  if (!paused) return;
  pauseAccumulatedMs += performance.now() - pausedAt;
  paused = false;
  pauseOverlay.hidden = true;
  lastFrameAt = performance.now();
  setBgmPaused(false);
  updatePauseButtonIcon();
}

// STARTボタン押下時の起動演出。最初のSTART_PROGRESS_MIN_MSは演出として
// 必ず流れるが、その後はisReady()(=自機に使う絵文字が決まったか。画像自体の
// ダウンロード完了は待たない、他の弾・コア同様読み込み次第自然に表示される)が
// trueになるまで進み切らない。ただし連合TLが静かで絵文字入り投稿がなかなか
// 来ない場合に無限に待たされないよう、START_PROGRESS_TIMEOUT_MSで打ち切る。
const START_PROGRESS_MIN_MS = 1400;
const START_PROGRESS_TIMEOUT_MS = 8000;
function runStartProgress(isReady: () => boolean, onComplete: () => void): void {
  startProgress.hidden = false;
  const startedAt = performance.now();
  let labelIndex = -1;

  function frame(now: number): void {
    const elapsed = now - startedAt;
    const timedOut = elapsed > START_PROGRESS_TIMEOUT_MS;
    const ready = elapsed >= START_PROGRESS_MIN_MS && (isReady() || timedOut);

    // 最初のMIN_MSで90%まで演出的に埋め、以降は自機画像の準備待ちとして
    // 90〜99%の間をゆっくり進め続ける(準備でき次第100%へ)。
    const introRatio = Math.min(elapsed / START_PROGRESS_MIN_MS, 1) * 0.9;
    const waitRatio = (Math.min(Math.max(elapsed - START_PROGRESS_MIN_MS, 0), START_PROGRESS_TIMEOUT_MS) / START_PROGRESS_TIMEOUT_MS) * 0.09;
    const displayRatio = ready ? 1 : introRatio + waitRatio;

    startProgressFill.style.width = `${displayRatio * 100}%`;
    startProgressPercent.textContent = `${Math.floor(displayRatio * 100)}%`;

    const nextLabelIndex = Math.min(
      Math.floor(displayRatio * START_PROGRESS_LABELS.length),
      START_PROGRESS_LABELS.length - 1,
    );
    if (nextLabelIndex !== labelIndex) {
      labelIndex = nextLabelIndex;
      startProgressLabel.textContent = START_PROGRESS_LABELS[labelIndex];
    }

    if (ready) {
      startProgress.hidden = true;
      onComplete();
    } else {
      requestAnimationFrame(frame);
    }
  }
  requestAnimationFrame(frame);
}

startButton.onclick = () => {
  const host = normalizeHost(instanceInput.value);
  if (!host) {
    titleError.hidden = false;
    titleError.textContent = "インスタンスのホスト名を入力してください(例: misskey.io)";
    return;
  }
  titleError.hidden = true;
  startGame(host);
};

backToTitleButton.onclick = () => {
  backToTitle();
};

// 音声のON/OFF。画面右上に常時表示し、どの画面からでも切り替えられる。
function updateSoundToggleButton(): void {
  const muted = isMuted();
  soundToggleIcon.replaceChildren(createIcon(muted ? "volume-x" : "volume-2"));
  soundToggleButton.classList.toggle("is-muted", muted);
  soundToggleButton.setAttribute("aria-label", muted ? "音声をONにする" : "音声をOFFにする");
}
updateSoundToggleButton();
onMuteChange(updateSoundToggleButton);
soundToggleButton.onclick = () => toggleMuted();

// retryも初回開始と同じく、次の投稿が届くまで自機なしで始まってしまう
// (プレイ中ずっと投稿が来ないインスタンスだと特に目立つ)のを避けるため、
// 読み込み済みのキャッシュから自機を再抽選する。
retryButton.onclick = () => {
  startRound(gameNow(), randomCachedEmojiImage());
};

pauseButton.onclick = () => {
  if (paused) resumeGame();
  else pauseGame();
};
resumeButton.onclick = () => resumeGame();
pauseRetryButton.onclick = () => {
  paused = false;
  pauseOverlay.hidden = true;
  updatePauseButtonIcon();
  startRound(gameNow(), randomCachedEmojiImage());
};
pauseBackToTitleButton.onclick = () => {
  backToTitle();
};

// PCではEscキーでも一時停止/再開できるようにする(ゲームオーバー中は無視)。
window.addEventListener("keydown", (ev) => {
  if (ev.code !== "Escape" || !game || game.gameOver) return;
  ev.preventDefault();
  if (paused) resumeGame();
  else pauseGame();
});

// 起動直後は最初からタイトル画面が表示されているので、ここで1回鳴らす
// (ブラウザの自動再生ポリシー上、ユーザー操作前だと再生がブロックされる
// ことがあるが、その場合は黙って鳴らないだけで致命的ではない)。
playStartScreenSfx();

function renderCollection(): void {
  const entries = getCollection();
  collectionList.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "collection-empty";
    empty.textContent = "まだ何も記録されていません。プレイして絵文字と出会おう。";
    collectionList.append(empty);
    return;
  }
  for (const entry of entries) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "collection-entry";
    const img = document.createElement("img");
    img.src = entry.url;
    img.alt = entry.shortcode;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = `${entry.count.toLocaleString()}回`;
    const shortcode = document.createElement("span");
    shortcode.className = "shortcode";
    shortcode.textContent = entry.shortcode;
    el.append(img, count, shortcode);
    el.onclick = () => showCollectionDetail(entry);
    collectionList.append(el);
  }
}

function showCollectionDetail(entry: CollectionEntry): void {
  collectionDetailImg.src = entry.url;
  collectionDetailImg.alt = entry.shortcode;
  collectionDetailShortcode.textContent = entry.shortcode;
  collectionDetailCount.textContent = entry.count.toLocaleString();
  collectionDetailDefeat.textContent = (entry.defeatCount ?? 0).toLocaleString();
  collectionDetailOverlay.hidden = false;
}

collectionButton.onclick = () => {
  renderCollection();
  collectionOverlay.hidden = false;
};
collectionCloseButton.onclick = () => {
  collectionOverlay.hidden = true;
};
collectionDetailCloseButton.onclick = () => {
  collectionDetailOverlay.hidden = true;
};

licenseButton.onclick = () => {
  licenseOverlay.hidden = false;
};
licenseCloseButton.onclick = () => {
  licenseOverlay.hidden = true;
};

clearDataButton.onclick = () => {
  clearDataOverlay.hidden = false;
};
clearDataCancelButton.onclick = () => {
  clearDataOverlay.hidden = true;
};
clearDataConfirmButton.onclick = () => {
  clearHighScore();
  clearCollection();
  clearDataOverlay.hidden = true;
};

// 投稿は必ずこのボタンを押したユーザー操作からのみ行う(自動投稿は絶対にしない)。
shareButton.onclick = () => {
  if (!lastGameOverInfo) return;
  const text = buildShareText({
    score: lastGameOverInfo.score,
    survivedMs: lastGameOverInfo.survivedMs,
    causeShortcode: lastGameOverInfo.causeShortcode,
  });
  openShareForm(text, location.href);
};
