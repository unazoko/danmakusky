// 生配信のコメント欄のように、連合TLの投稿本文をリアルタイムに流し見せる
// 半透明パネル。プレイの邪魔にならないよう、ドラッグでの移動と表示/非表示の
// 切り替えができる(位置・表示状態はlocalStorageに保存し次回も復元する)。
//
// MFMはAshi@の「簡易表示」と同じ考え方で、装飾記号を取り除いたプレーン
// テキストのみを表示する(太字・回転等のフル装飾は実装しない)。カスタム
// 絵文字(:name:)だけは画像に差し替える。添付画像・動画は一切表示しない
// (本文とカスタム絵文字のみ)。
import { parse as parseMfm, type MfmNode } from "mfm-js";
import type { MisskeyNote } from "./misskeyStream.js";
import { createIcon } from "./icons.js";

const MAX_LINES = 30;
const VISIBLE_KEY = "danmakusky-comment-ticker-visible";
const POSITION_KEY = "danmakusky-comment-ticker-pos";

const EMOJI_SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

let container: HTMLDivElement;
let handle: HTMLDivElement;
let body: HTMLDivElement;
let closeButton: HTMLButtonElement;
let toggleButton: HTMLButtonElement;

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

// mfm-jsのASTから、装飾記号を取り除いた素のテキストへ変換する
// (Ashi@のmfmNodeToPlainTextと同じ考え方。未知のノード種別は子ノードだけを
// 連結するフォールバックにしておく)。
function mfmNodeToPlainText(node: MfmNode): string {
  switch (node.type) {
    case "text":
      return node.props.text;
    case "unicodeEmoji":
      return node.props.emoji;
    case "emojiCode":
      return `:${node.props.name}:`;
    case "mention":
      return node.props.acct ? `@${node.props.acct}` : "";
    case "hashtag":
      return `#${node.props.hashtag}`;
    case "url":
      return node.props.url;
    case "inlineCode":
      return node.props.code;
    case "mathInline":
      return node.props.formula;
    case "search":
      return node.props.query ?? "";
    default:
      return Array.isArray(node.children) ? node.children.map(mfmNodeToPlainText).join("") : "";
  }
}

// プレーンテキスト中の「:name:」をcontainerへの画像挿入に差し替えながら、
// それ以外はテキストノードとして追加していく。ノートのemojisは既に絶対URLへ
// 解決済み(noteEmoji.ts参照)なので、Ashi@と違い非同期取得は不要。
function appendTextWithEmojis(
  target: DocumentFragment,
  text: string,
  emojis: Record<string, string> | undefined,
): void {
  let lastIndex = 0;
  EMOJI_SHORTCODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = EMOJI_SHORTCODE_RE.exec(text))) {
    const url = emojis?.[m[1]];
    if (m.index > lastIndex) target.append(document.createTextNode(text.slice(lastIndex, m.index)));
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = `:${m[1]}:`;
      img.className = "comment-ticker-emoji";
      target.append(img);
    } else {
      target.append(document.createTextNode(m[0]));
    }
    lastIndex = EMOJI_SHORTCODE_RE.lastIndex;
  }
  if (lastIndex < text.length) target.append(document.createTextNode(text.slice(lastIndex)));
}

// ノート1件から、コメント欄の1行分(プレーンテキスト+絵文字画像)を組み立てる。
// 単純リノート(本文なし)は元投稿の本文を「RN:」を付けて表示し、
// 元投稿にも本文が無い(画像のみ等)場合は表示するものが無いのでnullを返す。
function buildLine(note: MisskeyNote): DocumentFragment | null {
  let text = note.text;
  let emojis = note.emojis;
  let prefix = "";
  if (!text && note.renote) {
    text = note.renote.text;
    emojis = note.renote.emojis;
    prefix = "RN: ";
  }
  if (!text) return null;

  let nodes: MfmNode[];
  try {
    nodes = parseMfm(text);
  } catch {
    const frag = document.createDocumentFragment();
    if (prefix) frag.append(document.createTextNode(prefix));
    appendTextWithEmojis(frag, text, emojis);
    return frag;
  }

  // コメント欄は1件1行にまとめたいので、改行はスペースに畳む。
  const plain = nodes
    .map(mfmNodeToPlainText)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return null;

  const frag = document.createDocumentFragment();
  if (prefix) frag.append(document.createTextNode(prefix));
  appendTextWithEmojis(frag, plain, emojis);
  return frag;
}

export function pushNoteToTicker(note: MisskeyNote): void {
  const line = buildLine(note);
  if (!line) return;

  // ノート同士の間に空行を1つ挟んで見やすくする(最初の1件目の前には不要)。
  if (body.childElementCount > 0) {
    const spacer = document.createElement("div");
    spacer.className = "comment-ticker-blank";
    spacer.textContent = " ";
    body.append(spacer);
  }

  const lineEl = document.createElement("div");
  lineEl.className = "comment-ticker-line";
  lineEl.append(line);
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
    const rect = container.getBoundingClientRect();
    const parentRect = container.parentElement?.getBoundingClientRect();
    originX = rect.left - (parentRect?.left ?? 0);
    originY = rect.top - (parentRect?.top ?? 0);
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
    const rect = container.getBoundingClientRect();
    const parentRect = container.parentElement?.getBoundingClientRect();
    localStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ x: rect.left - (parentRect?.left ?? 0), y: rect.top - (parentRect?.top ?? 0) }),
    );
  };
  handle.addEventListener("pointerup", stopDrag);
  handle.addEventListener("pointercancel", stopDrag);
}

export function initCommentTicker(): void {
  container = document.querySelector<HTMLDivElement>("#commentTicker")!;
  handle = document.querySelector<HTMLDivElement>("#commentTickerHandle")!;
  body = document.querySelector<HTMLDivElement>("#commentTickerBody")!;
  closeButton = document.querySelector<HTMLButtonElement>("#commentTickerCloseButton")!;
  toggleButton = document.querySelector<HTMLButtonElement>("#commentTickerToggleButton")!;

  closeButton.append(createIcon("x"));

  closeButton.onclick = () => setVisible(false);
  toggleButton.onclick = () => setVisible(!getVisible());

  setVisible(getVisible());
  restorePosition();
  wireDrag();
}
