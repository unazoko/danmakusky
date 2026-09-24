// ゲーム結果の外部SNSへの共有。
// Misskeyは「共有フォーム中継サービス」(https://misskey-hub.net/ja/docs/for-users/features/share-form/)、
// Bluesky・Xはそれぞれ公式の投稿コンポーザーへのリンク(いわゆるWeb Intent)を
// 開くだけで完結させる。いずれも認証・API呼び出しは一切行わない
// (アクセストークンも保持しない)。
//
// - Misskey: https://misskey-hub.net/share/?text=...&url=...(公式ドキュメント・
//   複数の解説記事で確認済み)。
// - Bluesky: https://bsky.app/intent/compose?text=...(公式のシェアリンク。
//   url専用パラメータは無いため、本文にURLを含める)。
// - X(旧Twitter): https://x.com/intent/tweet?text=...&url=...(公式のWeb Intent)。
//
// 3サービスとも文言を個別に調整できるよう、テンプレートは
// buildMisskeyShareText/buildBlueskyShareText/buildXShareTextに分けている
// (現時点ではすべて同じ内容)。
import { formatTime } from "./format.js";

const MISSKEY_SHARE_FORM_BASE_URL = "https://misskey-hub.net/share/";
const BLUESKY_INTENT_BASE_URL = "https://bsky.app/intent/compose";
const X_INTENT_BASE_URL = "https://x.com/intent/tweet";

export interface ShareResultInput {
  score: number;
  survivedMs: number;
  causeShortcode: string | null;
  grazeCount: number;
  maxNotesPerMinute: number;
}

// 被撃墜理由は:shortcode:記法のまま埋め込む。共有先はユーザーが選ぶ任意の
// インスタンス(またはSNS)であり、同名のカスタム絵文字が無ければ単に
// :shortcode:という文字列のまま表示されるだけ(ゲーム的な不都合はない)。
// それより、投稿先にたまたま同名の絵文字があれば実際にレンダリングされて
// 面白い、というビジュアル面のメリットを優先する。
export function buildMisskeyShareText(input: ShareResultInput): string {
  const cause = input.causeShortcode ?? "不明";
  return [
    "**連合TL弾幕スキー**　で遊びました。",
    "--------------",
    `TIME: ${formatTime(input.survivedMs)}`,
    `SCORE: ${input.score.toLocaleString()}`,
    `GRAZE: ${input.grazeCount.toLocaleString()}`,
    `MTR: ${input.maxNotesPerMinute.toLocaleString()} notes/min`,
    `:${cause}: に撃墜されました。`,
    "--------------",
    "#DANMAKUSKY",
    "",
  ].join("\n");
}

export function buildBlueskyShareText(input: ShareResultInput): string {
  const cause = input.causeShortcode ?? "不明";
  return [
    "「連合TL弾幕スキー」で遊びました。",
    "--------------",
    `TIME: ${formatTime(input.survivedMs)}`,
    `SCORE: ${input.score.toLocaleString()}`,
    `GRAZE: ${input.grazeCount.toLocaleString()}`,
    `MTR: ${input.maxNotesPerMinute.toLocaleString()} notes/min`,
    `:${cause}: に撃墜されました。`,
    "--------------",
    "#DANMAKUSKY",
    "",
  ].join("\n");
}

export function buildXShareText(input: ShareResultInput): string {
  const cause = input.causeShortcode ?? "不明";
  return [
    "「連合TL弾幕スキー」で遊びました。",
    "--------------",
    `TIME: ${formatTime(input.survivedMs)}`,
    `SCORE: ${input.score.toLocaleString()}`,
    `GRAZE: ${input.grazeCount.toLocaleString()}`,
    `MTR: ${input.maxNotesPerMinute.toLocaleString()} notes/min`,
    `:${cause}: に撃墜されました。`,
    "--------------",
    "#DANMAKUSKY",
    "",
  ].join("\n");
}

// ユーザーが各「◯◯に投稿する」ボタンを押したときだけ呼び出すこと。
// 自動投稿は絶対にしない。

export function openMisskeyShareForm(text: string, gameUrl: string): void {
  const params = new URLSearchParams({ text, url: gameUrl });
  window.open(`${MISSKEY_SHARE_FORM_BASE_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
}

export function openBlueskyShareForm(text: string, gameUrl: string): void {
  // Blueskyのコンポーザーにはurl専用パラメータが無いため、本文にURLを含める。
  const params = new URLSearchParams({ text: `${text}\n${gameUrl}` });
  window.open(`${BLUESKY_INTENT_BASE_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
}

export function openXShareForm(text: string, gameUrl: string): void {
  const params = new URLSearchParams({ text, url: gameUrl });
  window.open(`${X_INTENT_BASE_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
}
