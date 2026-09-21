import { MisskeyStream, type StreamStatus } from "./misskeyStream.js";
import { extractEmojiOccurrences, type EmojiOccurrence } from "./noteEmoji.js";
import { getOrLoadEmojiImage, drawBullets, drawPlayer, drawPlayerBullets, drawCore } from "./render.js";
import { InputController } from "./input.js";
import { GameState, INITIAL_LIFE, type GameOverInfo } from "./game/loop.js";
import { formatTime } from "./format.js";
import { buildShareText, openShareForm } from "./share.js";
import { getHighScore, updateHighScore } from "./storage.js";
import { ReactionTracker } from "./reactionTracker.js";
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
} from "./flavor.js";
import type { Core } from "./game/entities.js";

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
const highScoreLine = $<HTMLParagraphElement>("#highScoreLine");
const retryButton = $<HTMLButtonElement>("#retryButton");
const shareButton = $<HTMLButtonElement>("#shareButton");
const densityWarning = $<HTMLDivElement>("#densityWarning");
const bootSequence = $<HTMLDivElement>("#bootSequence");
const fireButton = $<HTMLButtonElement>("#fireButton");
const coreMessage = $<HTMLDivElement>("#coreMessage");
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
  hudLife.textContent = `LIFE ${filled}${empty}`;
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
let game: GameState | null = null;
let input: InputController | null = null;
let pendingOccurrences: EmojiOccurrence[] = [];
let playerEmojiChosen = false;
let lastGameOverInfo: GameOverInfo | null = null;

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

// コア出現時のカットイン演出(東方Project的なボス登場演出)。雑魚(weak)は
// ひっきりなしに出現するので対象外にし、中ボス・強ボスの出現時だけ出す。
// 同時に複数体出現した場合に演出が重ならないよう、簡単なキューで直列化する。
const CUT_IN_SHOW_MS = 1300;
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
    if (game && !game.gameOver) {
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

function resizeCanvas(): void {
  canvas.width = Math.min(window.innerWidth, window.innerHeight * MAX_PLAY_AREA_ASPECT);
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);

// 実際の死因は、GameOverInfo.causeShortcode(=当たった弾の絵文字ショートコード、
// そのまま)をそのまま見出しにする。ゲーム側だけが異常に真剣なトーンを崩さない
// のが狙いなので、ふざけた文言は入れない。
function showGameOver(info: GameOverInfo): void {
  lastGameOverInfo = info;
  gameScreen.hidden = true;
  gameOverScreen.hidden = false;

  gameOverIntro.textContent = randomDeathIntro();
  gameOverStatus.textContent = `SYSTEM STATUS: ${randomSystemStatus()}`;

  gameOverCause.replaceChildren();
  if (info.causeImg) {
    const img = new Image();
    img.src = info.causeImg.src;
    img.className = "cause-emoji-img";
    gameOverCause.append(img);
  }
  const shortcodeLabel = document.createElement("span");
  shortcodeLabel.className = "cause-shortcode";
  shortcodeLabel.textContent = info.causeShortcode ?? "??? (不明)";
  gameOverCause.append(shortcodeLabel);

  resultScore.textContent = info.score.toLocaleString();
  resultTime.textContent = formatTime(info.survivedMs);

  const isNewHighScore = updateHighScore(info.score);
  highScoreLine.textContent = isNewHighScore
    ? "★ NEW HIGH SCORE ★"
    : `HIGH SCORE ${getHighScore().toLocaleString()}`;
}

function startRound(now: number): void {
  gameOverScreen.hidden = true;
  gameScreen.hidden = false;
  resizeCanvas();

  playerEmojiChosen = false;
  game = new GameState(
    canvas,
    {
      onLifeChange: renderLifeHearts,
      onScoreChange: (score) => {
        hudScore.textContent = `SCORE ${score.toLocaleString()}`;
      },
      onGameOver: showGameOver,
      onCoreDefeated: () => flashCoreMessage(randomCoreDefeatLine()),
      onCoreSpawned: (core) => enqueueCutIn(core),
      onLifeUp: () => flashCoreMessage(randomLifeUpLine()),
    },
    now,
    null,
  );
  renderLifeHearts(INITIAL_LIFE);
  hudScore.textContent = "SCORE 0";
  hudTime.textContent = "TIME 00:00.0";

  // 溜まっていた絵文字出現(接続直後〜自機決定前)をここで反映する。
  if (pendingOccurrences.length > 0) {
    maybeChooseShip(pendingOccurrences);
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
  const dtSec = Math.min((now - lastFrameAt) / 1000, 0.1);
  lastFrameAt = now;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (game && input && !game.gameOver) {
    game.update(dtSec, now, input);
    hudTime.textContent = `TIME ${formatTime(game.survivedMs(now))}`;
    // 見た目だけのハッタリ数値。ゲームの難易度・判定には一切関与しない。
    hudFake.textContent = `DENSITY ${fakeDensityPercent(now)}% / SYNC ${fakeSyncRate(now)}% / THREAT ${fakeThreatLevel(now)}`;
    for (const core of game.cores) drawCore(ctx, core);
    drawBullets(ctx, game.bullets, now);
    drawPlayerBullets(ctx, game.playerBullets);
    drawPlayer(ctx, game.player, now);
    densityWarning.hidden = !game.isStreamOverflowing(now);
  } else {
    densityWarning.hidden = true;
  }

  requestAnimationFrame(tick);
}

function startGame(host: string): void {
  titleScreen.hidden = true;
  gameScreen.hidden = false;
  resizeCanvas();
  input = new InputController(canvas);
  wireFireButton(input);
  runBootSequence();

  const now = performance.now();
  startRound(now);

  stream = new MisskeyStream(host, {
    onNote: (note) => {
      reactionTracker?.track(note.id);
      // リノートの場合、リノート自体だけでなく元投稿の方にもリアクションが
      // 付きうるので、そちらも合わせて追跡する。
      if (note.renote) reactionTracker?.track(note.renote.id);

      const occurrences = extractEmojiOccurrences(note);
      if (occurrences.length === 0) return;
      const t = performance.now();
      if (!playerEmojiChosen) {
        if (game) {
          maybeChooseShip(occurrences);
        } else {
          pendingOccurrences.push(...occurrences);
        }
      }
      game?.handleEmojiOccurrences(occurrences, t);
    },
    onStatusChange: (status) => {
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
    game?.handleEmojiOccurrences([reaction], performance.now());
  });
  stream.connect();
  scheduleGlitch();

  lastFrameAt = performance.now();
  requestAnimationFrame(tick);
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

retryButton.onclick = () => {
  startRound(performance.now());
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
