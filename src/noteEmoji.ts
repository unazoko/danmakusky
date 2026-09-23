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

export interface EmojiOccurrence {
  shortcode: string;
  url: string;
  // この絵文字の出所となったノートの永続リンク。結果画面の
  // 「あなたを撃墜したノートを見る」ボタン向け(main.ts参照)。
  noteUrl: string;
}

// Misskeyの絵文字記法は :shortcode: (英数字・アンダースコア・ハイフン・プラス)。
// リアクション等で使われる :shortcode@host: 形式は投稿本文/表示名には出てこないため考慮しない。
const SHORTCODE_PATTERN = /:([a-zA-Z0-9_+-]+):/g;

function extractFromText(
  text: string | null | undefined,
  emojis: Record<string, string> | undefined,
  noteUrl: string,
): EmojiOccurrence[] {
  if (!text || !emojis) return [];

  const occurrences: EmojiOccurrence[] = [];
  for (const match of text.matchAll(SHORTCODE_PATTERN)) {
    const shortcode = match[1];
    const url = emojis[shortcode];
    if (url) occurrences.push({ shortcode, url, noteUrl });
  }
  return occurrences;
}

function extractFromReactionEmojis(
  reactionEmojis: Record<string, string> | undefined,
  noteUrl: string,
): EmojiOccurrence[] {
  if (!reactionEmojis) return [];
  return Object.entries(reactionEmojis).map(([name, url]) => ({
    shortcode: parseReactionShortcode(name),
    url,
    noteUrl,
  }));
}

export function extractEmojiOccurrences(note: MisskeyNote, host: string): EmojiOccurrence[] {
  const noteUrl = buildNoteUrl(host, note.id);
  const occurrences = [
    ...extractFromText(note.text, note.emojis, noteUrl),
    ...extractFromReactionEmojis(note.reactionEmojis, noteUrl),
  ];

  // 単純リノートはtext/cwがnullで、本文の中身はnote.renoteに入っている
  // (misskeyStream.ts参照)。引用リノートは自分のtextに加えて元投稿の
  // 内容も持つため、両方から拾う。この場合の「出所ノート」は元投稿自身
  // (note.renote)なので、リンクもそちらのURLにする。
  if (note.renote) {
    const renoteUrl = buildNoteUrl(host, note.renote.id);
    occurrences.push(
      ...extractFromText(note.renote.text, note.renote.emojis, renoteUrl),
      ...extractFromReactionEmojis(note.renote.reactionEmojis, renoteUrl),
    );
  }

  return occurrences;
}
