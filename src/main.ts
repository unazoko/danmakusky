import { MisskeyStream, type StreamStatus } from "./misskeyStream.js";
import { extractEmojiOccurrences, type EmojiOccurrence } from "./noteEmoji.js";
import {
  getOrLoadEmojiImage,
  isImageReady,
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
import { getHighScore, updateHighScore } from "./storage.js";
import { ReactionTracker } from "./reactionTracker.js";
import { NoteRateTracker } from "./noteRate.js";
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
const backToTitleButton = $<HTMLButtonElement>("#backToTitleButton");
const retryButton = $<HTMLButtonElement>("#retryButton");
const shareButton = $<HTMLButtonElement>("#shareButton");
const densityWarning = $<HTMLDivElement>("#densityWarning");
const bootSequence = $<HTMLDivElement>("#bootSequence");
const fireButton = $<HTMLButtonElement>("#fireButton");
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

  playerEmojiChosen = presetShipImg !== null;
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
    presetShipImg,
  );
  renderLifeHearts(INITIAL_LIFE);
  hudScore.textContent = "SCORE 0";
  hudTime.textContent = "TIME 00:00.0";

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
      const t = gameNow();
      if (!playerEmojiChosen) {
        // ここに来る(playerEmojiChosenがfalseのまま)のは、進捗演出中もその後も
        // 自機を何も決められなかった場合(投稿もキャッシュも無かった)のみ。
        // 一度でも自機が決まったら(キャッシュ代役も含め)ここは二度と通らないため、
        // プレイ中に見た目が変わることはない。
        const picked = occurrences[Math.floor(Math.random() * occurrences.length)];
        chosenShipImg = getOrLoadEmojiImage(picked.url);
        playerEmojiChosen = true;
        if (game) game.player.emojiImg = chosenShipImg;
        if (isImageReady(chosenShipImg)) {
          shipReady = true;
        } else {
          const markReady = () => {
            shipReady = true;
          };
          chosenShipImg.addEventListener("load", markReady, { once: true });
          chosenShipImg.addEventListener("error", markReady, { once: true });
        }
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
    game?.handleEmojiOccurrences([reaction], gameNow());
  });
  stream.connect();

  runStartProgress(
    () => shipReady,
    () => {
      // chosenShipImgがあっても、その画像自体の読み込みがタイムアウトまでに
      // 間に合わなかった場合は表示できないままになってしまうので、その場合も
      // 「投稿が来なかった」場合と同様にキャッシュ済み絵文字へフォールバックする。
      if (chosenShipImg && isImageReady(chosenShipImg)) {
        revealGame(chosenShipImg);
        return;
      }
      // 既に読み込み済みの絵文字(コアの弾等で先に流れてきたもの)があれば
      // それを代役の自機にする。プレイ中に見た目が変わるのは不自然なので、
      // 一度これに決めたら(startRound内でpresetShipImgとして)以後は変えない。
      revealGame(randomCachedEmojiImage());
    },
  );
}

// 進捗演出が終わった後、実際にゲーム画面を表示してプレイを開始する。
function revealGame(shipImg: HTMLImageElement | null): void {
  titleScreen.hidden = true;
  input = new InputController(canvas);
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
  paused = false;
  pauseAccumulatedMs = 0;
  pauseOverlay.hidden = true;
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
}
function resumeGame(): void {
  if (!paused) return;
  pauseAccumulatedMs += performance.now() - pausedAt;
  paused = false;
  pauseOverlay.hidden = true;
  lastFrameAt = performance.now();
}

// STARTボタン押下時の起動演出。最初のSTART_PROGRESS_MIN_MSは演出として
// 必ず流れるが、その後はisReady()(=自機絵文字の選定・画像読込の完了)が
// trueになるまで進み切らない。ただし連合TLが静かで絵文字入り投稿がなかなか
// 来ない場合に無限に待たされないよう、START_PROGRESS_TIMEOUT_MSで打ち切る。
const START_PROGRESS_MIN_MS = 1400;
const START_PROGRESS_TIMEOUT_MS = 6000;
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

retryButton.onclick = () => {
  startRound(gameNow());
};

pauseButton.onclick = () => {
  if (paused) resumeGame();
  else pauseGame();
};
resumeButton.onclick = () => resumeGame();
pauseRetryButton.onclick = () => {
  paused = false;
  pauseOverlay.hidden = true;
  startRound(gameNow());
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
