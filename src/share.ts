// ゲーム結果のMisskeyへの共有(企画書§26・§27、2026-09-21改訂版)。
// Misskey Hubの「共有フォーム中継サービス」(https://misskey-hub.net/ja/docs/for-users/features/share-form/)
// へのリンクを開くだけで完結させる。ゲーム側はMisskey APIへの認証・投稿を
// 一切行わない(アクセストークンも保持しない)。
// ベースURL・パラメータ名(text/url)は公式ドキュメント・複数の解説記事で確認済み
// (例: https://misskey-hub.net/share/?title=...&text=...&url=...)。
// MVPでは企画書§27.5の指示通りtext/urlのみを使い、manualInstance等は使わない。
import { formatTime } from "./format.js";

const SHARE_FORM_BASE_URL = "https://misskey-hub.net/share/";

export interface ShareResultInput {
  score: number;
  survivedMs: number;
  causeShortcode: string | null;
}

// 企画書§21・§25の例に合わせ、撃墜理由はカスタム絵文字のショートコードを
// :shortcode: 記法ではなくそのままの単語として載せる。共有先はユーザーが
// 選ぶ任意のインスタンスであり、そのインスタンスに同名のカスタム絵文字が
// 存在するとは限らないため、:shortcode:のまま埋め込むと未解決のまま
// 表示されてしまう(投稿先に依存しないプレーンテキストとして扱う)。
export function buildShareText(input: ShareResultInput): string {
  const cause = input.causeShortcode ?? "不明";
  return [
    "Misskey弾幕で遊びました。",
    "",
    `SCORE: ${input.score.toLocaleString()}`,
    `TIME: ${formatTime(input.survivedMs)}`,
    "",
    `撃墜理由：${cause}`,
    "",
    "連合TLに敗北しました。",
  ].join("\n");
}

// ユーザーが「Misskeyに結果を投稿」ボタンを押したときだけ呼び出すこと
// (企画書§27.4「投稿は必ずユーザー操作で行う」)。
export function openShareForm(text: string, gameUrl: string): void {
  const params = new URLSearchParams({ text, url: gameUrl });
  window.open(`${SHARE_FORM_BASE_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
}
