// 投稿本文からカスタム絵文字ショートコード(:blobcat: 等)を抜き出し、
// 同梱されている emojis (ショートコード→絶対URL、サーバー側で解決済み) と
// 突き合わせて実際に表示可能な絵文字だけを取り出す。
//
// note.emojisはEntityService側でcustomEmojiService.populateEmojis()により
// 解決済みのURLとして含んでいるため、ここで追加のAPI呼び出しは行わない。
//
// 投稿者の表示名からは抽出しない。投稿内容と無関係に弾が出る度合いが
// 強くなりすぎるため。
//
// 投稿を受信した時点で既に付いているリアクション(note.reactionEmojis)も
// 対象にする。ただしこれはMisskey側の仕様で、リモート(他インスタンス)の
// カスタム絵文字リアクションのみが対象で、ローカルのカスタム絵文字リアクションは
// 含まれない(取りこぼす)。今後リアルタイムに付くリアクションは別途
// reactionTracker.ts(subNote購読)で拾っているので、これはあくまで
// 「受信した瞬間、既に付いていた分」の穴埋め。
import { buildNoteUrl, parseReactionShortcode, type MisskeyNote } from "./misskeyStream.js";
import { parseMfmSafe, mfmNodesToPlainText, containsMention } from "./mfmPlainText.js";

export interface EmojiOccurrence {
  shortcode: string;
  url: string;
  // この絵文字の出所となったノートの永続リンク。結果画面の
  // 「あなたを撃墜したノートを見る」ボタン向け(main.ts参照)。
  noteUrl: string;
  // ボス出現カットインの引用文向け、装飾記号を取り除いた1行プレーン
  // テキスト(main.ts: playCutIn参照)。URLは含めない(取り除く)。
  // 以下の場合はnull(その場合カットインは従来通りflavor.tsのランダム
  // 文言にフォールバックする):
  // ・本文が無い(画像/動画だけの投稿等)
  // ・URLを取り除いた結果、本文が空になる(実質URLだけの投稿だった)
  // ・リプライ、またはメンションを含む(特定の相手に向けた投稿)
  // ・リアクション由来(リアクション自体には本文が無い)
  cutInText: string | null;
}

// Misskeyの絵文字記法は :shortcode: (英数字・アンダースコア・ハイフン・プラス)。
// リアクション等で使われる :shortcode@host: 形式は投稿本文/表示名には出てこないため考慮しない。
const SHORTCODE_PATTERN = /:([a-zA-Z0-9_+-]+):/g;

function extractFromText(
  text: string | null | undefined,
  emojis: Record<string, string> | undefined,
  noteUrl: string,
  cutInText: string | null,
): EmojiOccurrence[] {
  if (!text || !emojis) return [];

  const occurrences: EmojiOccurrence[] = [];
  for (const match of text.matchAll(SHORTCODE_PATTERN)) {
    const shortcode = match[1];
    const url = emojis[shortcode];
    if (url) occurrences.push({ shortcode, url, noteUrl, cutInText });
  }
  return occurrences;
}

function extractFromReactionEmojis(
  reactionEmojis: Record<string, string> | undefined,
  noteUrl: string,
  cutInText: string | null,
): EmojiOccurrence[] {
  if (!reactionEmojis) return [];
  return Object.entries(reactionEmojis).map(([name, url]) => ({
    shortcode: parseReactionShortcode(name),
    url,
    noteUrl,
    cutInText,
  }));
}

// カットイン演出の引用文として使えるかどうかを判定し、使えるなら装飾記号を
// 取り除いた1行プレーンテキストを返す。使えない場合(本文なし・URLのみ・
// リプライ/メンション・パース失敗)はnull。
// main.ts側でも、リアクション購読開始時(reactionTracker.track呼び出し時)に
// 同じ判定を先読みしておくために使う(reactionTracker.ts参照)。
export function buildCutInText(text: string | null | undefined, replyId: string | null | undefined): string | null {
  if (!text) return null;
  if (replyId) return null; // 構造的にリプライ(特定の相手に向けた投稿)

  const nodes = parseMfmSafe(text);
  if (!nodes) return null;
  if (containsMention(nodes)) return null; // 本文中にメンションがある(特定の相手に向けた投稿)

  // URLはカットインの引用文には表示しない(取り除く)。取り除いた結果
  // 本文が空になる場合(=実質URLだけの投稿だった場合)は、使える本文が
  // 無かったということなのでカットイン対象にしない。
  const plain = mfmNodesToPlainText(nodes, { stripUrls: true }).replace(/\s+/g, " ").trim();
  return plain || null;
}

export function extractEmojiOccurrences(note: MisskeyNote, host: string): EmojiOccurrence[] {
  const noteUrl = buildNoteUrl(host, note.id);
  const cutInText = buildCutInText(note.text, note.replyId);
  const occurrences = [
    ...extractFromText(note.text, note.emojis, noteUrl, cutInText),
    ...extractFromReactionEmojis(note.reactionEmojis, noteUrl, cutInText),
  ];

  // 単純リノートはtext/cwがnullで、本文の中身はnote.renoteに入っている
  // (misskeyStream.ts参照)。引用リノートは自分のtextに加えて元投稿の
  // 内容も持つため、両方から拾う。この場合の「出所ノート」は元投稿自身
  // (note.renote)なので、リンク・カットイン引用文もそちらを基準にする。
  if (note.renote) {
    const renoteUrl = buildNoteUrl(host, note.renote.id);
    const renoteCutInText = buildCutInText(note.renote.text, note.renote.replyId);
    occurrences.push(
      ...extractFromText(note.renote.text, note.renote.emojis, renoteUrl, renoteCutInText),
      ...extractFromReactionEmojis(note.renote.reactionEmojis, renoteUrl, renoteCutInText),
    );
  }

  return occurrences;
}
