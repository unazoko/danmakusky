// 企画書§32の1〜14(ストリーム接続〜結果共有)まで実装。
import { MisskeyStream, type StreamStatus } from "./misskeyStream.js";
import { extractEmojiOccurrences, type EmojiOccurrence } from "./noteEmoji.js";
import { getOrLoadEmojiImage, drawBullets, drawPlayer, drawPlayerBullets, drawCore } from "./render.js";
import { InputController } from "./input.js";
import { GameState, type GameOverInfo } from "./game/loop.js";
import { formatTime } from "./format.js";
import { buildShareText, openShareForm } from "./share.js";
import { getHighScore, updateHighScore } from "./storage.js";
import { ReactionTracker } from "./reactionTracker.js";

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
const canvas = $<HTMLCanvasElement>("#gameCanvas");
const ctx = canvas.getContext("2d")!;

const INITIAL_LIFE = 3;

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
  connecting: "CONNECTING TO FEDERATION...",
  online: "STREAM ONLINE",
  "idle-timeout": "STREAM SILENT (配信されていない可能性があります)",
  reconnecting: "RECONNECTING...",
  closed: "STREAM CLOSED",
};

let stream: MisskeyStream | null = null;
let reactionTracker: ReactionTracker | null = null;
let game: GameState | null = null;
let input: InputController | null = null;
let pendingOccurrences: EmojiOccurrence[] = [];
let playerEmojiChosen = false;
let lastGameOverInfo: GameOverInfo | null = null;

// 起動時の演出(企画書§23)。裏側では既にストリーム接続・ゲームが進行して
// よく、あくまで見た目の飾り。実際のストリーム状態(接続中/オンライン/
// 無音)に文言を連動させることで、それらしさを保ちつつ嘘は言わないようにする。
function runBootSequence(): void {
  bootSequence.hidden = false;
  bootSequence.classList.remove("fade-out");
  bootSequence.innerHTML = "MISSKEY DANMAKU<br /><br />INITIALIZING STREAM...";
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

function showGameOver(info: GameOverInfo): void {
  lastGameOverInfo = info;
  gameScreen.hidden = true;
  gameOverScreen.hidden = false;

  gameOverCause.replaceChildren();
  if (info.causeImg) {
    const img = new Image();
    img.src = info.causeImg.src;
    img.className = "cause-emoji-img";
    gameOverCause.append(img);
  } else {
    gameOverCause.textContent = "??? (弾に当たった)";
  }
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
      onCoreDefeated: () => flashCoreMessage("CORE DESTROYED"),
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

// 自機は取得済みカスタム絵文字からランダムに1つ選ぶ(企画書§9)。
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
    if (game.core) drawCore(ctx, game.core);
    drawBullets(ctx, game.bullets);
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

// 企画書§27.4: 投稿は必ずこのボタンを押したユーザー操作からのみ行う。
shareButton.onclick = () => {
  if (!lastGameOverInfo) return;
  const text = buildShareText({
    score: lastGameOverInfo.score,
    survivedMs: lastGameOverInfo.survivedMs,
    causeShortcode: lastGameOverInfo.causeShortcode,
  });
  openShareForm(text, location.href);
};
