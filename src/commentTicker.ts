// 生配信のコメント欄のように、連合TLの投稿本文をリアルタイムに流し見せる
// 半透明パネル。プレイの邪魔にならないよう、ドラッグでの移動と表示/非表示の
// 切り替えができる(位置・表示状態はlocalStorageに保存し次回も復元する)。
//
// MFMはAshi@の「簡易表示」と同じ考え方で、装飾記号を取り除いたプレーン
// テキストのみを表示する(太字・回転等のフル装飾は実装しない)。カスタム
// 絵文字(:name:)だけは画像に差し替える。添付画像・動画は一切表示しない
// (本文とカスタム絵文字のみ)。
import type { MisskeyNote, MisskeyUserLite } from "./misskeyStream.js";
import { createIcon } from "./icons.js";
import { parseMfmSafe, mfmNodesToPlainText } from "./mfmPlainText.js";
import { appendTextWithEmojis } from "./emojiText.js";

const MAX_LINES = 30;
const VISIBLE_KEY = "danmakusky-comment-ticker-visible";
const POSITION_KEY = "danmakusky-comment-ticker-pos";
const SIZE_KEY = "danmakusky-comment-ticker-size";

let container: HTMLDivElement;
let handle: HTMLDivElement;
let body: HTMLDivElement;
let closeButton: HTMLButtonElement;
let toggleButton: HTMLButtonElement;
let resizeHandle: HTMLDivElement;

function getVisible(): boolean {
  return localStorage.getItem(VISIBLE_KEY) !== "0";
}

// トグルボタンの見た目(アイコン・色)を、soundToggleButtonのON/OFF表示と
// 同じ考え方で切り替える(main.ts: updateSoundToggleButton参照)。
function updateToggleButton(visible: boolean): void {
  toggleButton.replaceChildren(createIcon(visible ? "message-square" : "message-square-off"));
  toggleButton.classList.toggle("is-off", !visible);
  toggleButton.setAttribute("aria-label", visible ? "連合TLコメント欄を隠す" : "連合TLコメント欄を表示する");
}

function setVisible(visible: boolean): void {
  localStorage.setItem(VISIBLE_KEY, visible ? "1" : "0");
  container.hidden = !visible;
  updateToggleButton(visible);
}

// ノート1件から、コメント欄の1件分(投稿者表示+プレーンテキスト・絵文字
// 画像の本文)を組み立てる。単純リノート(本文なし)は元投稿の投稿者・本文を
// 「RN:」を付けて表示し、元投稿にも本文が無い(画像のみ等)場合は表示する
// ものが無いのでnullを返す。
interface TickerEntry {
  header: DocumentFragment;
  body: DocumentFragment;
}

// 投稿者表示行を組み立てる。「表示名 @ユーザー名@インスタンス」の形式。
// 表示名が未設定のユーザーもいるため、その場合はacct部分だけにする。
// ローカルユーザー(user.host===null)はconnectedHost(接続先インスタンス)を
// 補って完全なacctにする。表示名中のカスタム絵文字(:name:)も本文と同じく
// 画像に差し替える(acct部分はユーザー名の仕様上絵文字記法を含み得ないので
// そのままテキストでよい)。
function buildAuthorFragment(user: MisskeyUserLite, connectedHost: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (user.name) {
    appendTextWithEmojis(frag, user.name, user.emojis, "comment-ticker-emoji");
    frag.append(document.createTextNode(" "));
  }
  frag.append(document.createTextNode(`@${user.username}@${user.host ?? connectedHost}`));
  return frag;
}

function buildEntry(note: MisskeyNote, connectedHost: string): TickerEntry | null {
  let text = note.text;
  let emojis = note.emojis;
  let user = note.user;
  let prefix = "";
  if (!text && note.renote) {
    text = note.renote.text;
    emojis = note.renote.emojis;
    user = note.renote.user;
    prefix = "RN: ";
  }
  if (!text) return null;

  const nodes = parseMfmSafe(text);
  // コメント欄は本文を1行にまとめたいので、改行はスペースに畳む
  // (パース失敗時は原文のまま、正規化は諦める)。
  const plain = nodes ? mfmNodesToPlainText(nodes).replace(/\s+/g, " ").trim() : text;
  if (!plain) return null;

  const bodyFrag = document.createDocumentFragment();
  if (prefix) bodyFrag.append(document.createTextNode(prefix));
  appendTextWithEmojis(bodyFrag, plain, emojis, "comment-ticker-emoji");

  return { header: buildAuthorFragment(user, connectedHost), body: bodyFrag };
}

export function pushNoteToTicker(note: MisskeyNote, connectedHost: string): void {
  const entry = buildEntry(note, connectedHost);
  if (!entry) return;

  // ノート同士の間に空行を1つ挟んで見やすくする(最初の1件目の前には不要)。
  if (body.childElementCount > 0) {
    const spacer = document.createElement("div");
    spacer.className = "comment-ticker-blank";
    spacer.textContent = " ";
    body.append(spacer);
  }

  const headerEl = document.createElement("div");
  headerEl.className = "comment-ticker-header";
  headerEl.append(entry.header);
  body.append(headerEl);

  const lineEl = document.createElement("div");
  lineEl.className = "comment-ticker-line";
  lineEl.append(entry.body);
  body.append(lineEl);

  while (body.querySelectorAll(".comment-ticker-line").length > MAX_LINES) {
    body.firstElementChild?.remove();
  }
  body.scrollTop = body.scrollHeight;
}

export function resetCommentTicker(): void {
  body.replaceChildren();
}

// パネルの位置をドラッグで自由に動かせるようにする(#gameScreen内に収まる
// よう毎回clampする)。位置はpx単位のtop/leftで保持し、リサイズ等で画面外に
// はみ出た場合も次回ドラッグ開始時に自然に収まる。
function clampPosition(x: number, y: number): { x: number; y: number } {
  const parent = container.parentElement;
  if (!parent) return { x, y };
  const maxX = Math.max(0, parent.clientWidth - container.offsetWidth);
  const maxY = Math.max(0, parent.clientHeight - container.offsetHeight);
  return { x: Math.min(Math.max(x, 0), maxX), y: Math.min(Math.max(y, 0), maxY) };
}

function applyPosition(x: number, y: number): void {
  container.style.left = `${x}px`;
  container.style.top = `${y}px`;
  container.style.right = "auto";
}

// containerの現在の画面上の位置を、親要素基準のx/yへ変換する
// (wireDrag・wireResizeHandle共通)。
function currentOffsetFromParent(): { x: number; y: number } {
  const rect = container.getBoundingClientRect();
  const parentRect = container.parentElement?.getBoundingClientRect();
  return { x: rect.left - (parentRect?.left ?? 0), y: rect.top - (parentRect?.top ?? 0) };
}

function restorePosition(): void {
  const raw = localStorage.getItem(POSITION_KEY);
  if (!raw) return;
  try {
    const { x, y } = JSON.parse(raw) as { x: number; y: number };
    if (typeof x === "number" && typeof y === "number") {
      const clamped = clampPosition(x, y);
      applyPosition(clamped.x, clamped.y);
    }
  } catch {
    // 壊れた保存値は無視し、デフォルト位置(CSS)のままにする。
  }
}

function wireDrag(): void {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  handle.addEventListener("pointerdown", (e) => {
    dragging = true;
    handle.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    const origin = currentOffsetFromParent();
    originX = origin.x;
    originY = origin.y;
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const { x, y } = clampPosition(originX + dx, originY + dy);
    applyPosition(x, y);
  });

  const stopDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(e.pointerId);
    localStorage.setItem(POSITION_KEY, JSON.stringify(currentOffsetFromParent()));
  };
  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
}

// パネル右下の隅をドラッグして自由にサイズ変更できるようにする。ブラウザ
// 標準のCSS resize:bothは、スマホFirefoxでタッチに反応しない・スマホ
// Chromeでは本文欄が下端までスクロールしていると同じ隅にあるスクロール
// バーに掴まれて反応しない、という問題があったため、移動(wireDrag)と
// 同じPointer Events方式で自前実装する。
function wireResizeHandle(): void {
  let resizing = false;
  let startX = 0;
  let startY = 0;
  let originWidth = 0;
  let originHeight = 0;

  resizeHandle.addEventListener("pointerdown", (e) => {
    resizing = true;
    resizeHandle.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    originWidth = container.offsetWidth;
    originHeight = container.offsetHeight;
    // 右下隅を掴んで広げたときに左上の角が固定されるよう、right基準の
    // デフォルト配置(未ドラッグ時)もこの時点でleft基準に変換しておく
    // (見た目の位置は変えず、以後はleft/topでのみ位置を扱うwireDragと
    // 同じ状態にする)。
    const origin = currentOffsetFromParent();
    applyPosition(origin.x, origin.y);
  });

  resizeHandle.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    // 実際のサイズはCSSのmin-width/max-width等で自動的にクランプされる
    // (ResizeObserver側で最終的な描画サイズを読んで保存する、wireResize参照)。
    container.style.width = `${originWidth + dx}px`;
    container.style.height = `${originHeight + dy}px`;
  });

  const stopResize = (e: PointerEvent): void => {
    if (!resizing) return;
    resizing = false;
    resizeHandle.releasePointerCapture(e.pointerId);
  };
  resizeHandle.addEventListener("pointerup", stopResize);
  resizeHandle.addEventListener("pointercancel", stopResize);
}

// サイズも位置と同様、localStorageに保存し次回も復元する。
function restoreSize(): void {
  const raw = localStorage.getItem(SIZE_KEY);
  if (!raw) return;
  try {
    const { width, height } = JSON.parse(raw) as { width: number; height: number };
    if (typeof width === "number" && typeof height === "number") {
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
    }
  } catch {
    // 壊れた保存値は無視し、デフォルトサイズ(CSS)のままにする。
  }
}

// wireResizeHandleによるサイズ変更(width/heightへの直接代入)はDOM
// イベントを発火しないため、ResizeObserverで検知して保存する。
function wireResize(): void {
  const observer = new ResizeObserver(() => {
    // パネルが非表示(祖先の#gameScreenがhidden等)の間はoffsetWidth/Heightが
    // 0になる。observe()した瞬間にもこの状態で1回発火するため、0x0を
    // 保存済みサイズの上書きとして扱わないようにする。
    const { offsetWidth, offsetHeight } = container;
    if (offsetWidth === 0 || offsetHeight === 0) return;
    localStorage.setItem(SIZE_KEY, JSON.stringify({ width: offsetWidth, height: offsetHeight }));
  });
  observer.observe(container);
}

export function initCommentTicker(): void {
  container = document.querySelector<HTMLDivElement>("#commentTicker")!;
  handle = document.querySelector<HTMLDivElement>("#commentTickerHandle")!;
  body = document.querySelector<HTMLDivElement>("#commentTickerBody")!;
  closeButton = document.querySelector<HTMLButtonElement>("#commentTickerCloseButton")!;
  toggleButton = document.querySelector<HTMLButtonElement>("#commentTickerToggleButton")!;
  resizeHandle = document.querySelector<HTMLDivElement>("#commentTickerResizeHandle")!;

  closeButton.append(createIcon("x"));

  closeButton.onclick = () => setVisible(false);
  toggleButton.onclick = () => setVisible(!getVisible());

  setVisible(getVisible());
  restorePosition();
  restoreSize();
  wireDrag();
  wireResizeHandle();
  wireResize();
}
