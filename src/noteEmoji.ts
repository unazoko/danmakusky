// 投稿本文からカスタム絵文字ショートコード(:blobcat: 等)を抜き出し、
// 同梱されている emojis (ショートコード→絶対URL、サーバー側で解決済み) と
// 突き合わせて実際に表示可能な絵文字だけを取り出す(企画書§7・§8)。
//
// note.emojisはEntityService側でcustomEmojiService.populateEmojis()により
// 解決済みのURLとして含んでいるため、ここで追加のAPI呼び出しは行わない。
//
// (投稿者の表示名からの抽出は一度試したが、「投稿内容と無関係に弾が出る」
// 度合いが強すぎるという判断でやめた。)
//
// 投稿を受信した時点で既に付いているリアクション(note.reactionEmojis)も
// 対象にする。ただしこれはMisskey側の仕様で、リモート(他インスタンス)の
// カスタム絵文字リアクションのみが対象で、ローカルのカスタム絵文字リアクションは
// 含まれない(取りこぼす)。今後リアルタイムに付くリアクションは別途
// reactionTracker.ts(subNote購読)で拾っているので、これはあくまで
// 「受信した瞬間、既に付いていた分」の穴埋め。
import { parseReactionShortcode, type MisskeyNote } from "./misskeyStream.js";

export interface EmojiOccurrence {
  shortcode: string;
  url: string;
}

// Misskeyの絵文字記法は :shortcode: (英数字・アンダースコア・ハイフン・プラス)。
// リアクション等で使われる :shortcode@host: 形式は投稿本文/表示名には出てこないため考慮しない。
const SHORTCODE_PATTERN = /:([a-zA-Z0-9_+-]+):/g;

function extractFromText(
  text: string | null | undefined,
  emojis: Record<string, string> | undefined,
): EmojiOccurrence[] {
  if (!text || !emojis) return [];

  const occurrences: EmojiOccurrence[] = [];
  for (const match of text.matchAll(SHORTCODE_PATTERN)) {
    const shortcode = match[1];
    const url = emojis[shortcode];
    if (url) occurrences.push({ shortcode, url });
  }
  return occurrences;
}

function extractFromReactionEmojis(
  reactionEmojis: Record<string, string> | undefined,
): EmojiOccurrence[] {
  if (!reactionEmojis) return [];
  return Object.entries(reactionEmojis).map(([name, url]) => ({
    shortcode: parseReactionShortcode(name),
    url,
  }));
}

export function extractEmojiOccurrences(note: MisskeyNote): EmojiOccurrence[] {
  const occurrences = [
    ...extractFromText(note.text, note.emojis),
    ...extractFromReactionEmojis(note.reactionEmojis),
  ];

  // 単純リノートはtext/cwがnullで、本文の中身はnote.renoteに入っている
  // (misskeyStream.ts参照)。引用リノートは自分のtextに加えて元投稿の
  // 内容も持つため、両方から拾う。
  if (note.renote) {
    occurrences.push(
      ...extractFromText(note.renote.text, note.renote.emojis),
      ...extractFromReactionEmojis(note.renote.reactionEmojis),
    );
  }

  return occurrences;
}
