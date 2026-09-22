// ゲーム結果のMisskeyへの共有。
// Misskey Hubの「共有フォーム中継サービス」(https://misskey-hub.net/ja/docs/for-users/features/share-form/)
// へのリンクを開くだけで完結させる。ゲーム側はMisskey APIへの認証・投稿を
// 一切行わない(アクセストークンも保持しない)。
// ベースURL・パラメータ名(text/url)は公式ドキュメント・複数の解説記事で確認済み
// (例: https://misskey-hub.net/share/?title=...&text=...&url=...)。
// text/urlのみを使い、manualInstance等は使わない。
import { formatTime } from "./format.js";

const SHARE_FORM_BASE_URL = "https://misskey-hub.net/share/";

export interface ShareResultInput {
  score: number;
  survivedMs: number;
  causeShortcode: string | null;
}

// 被撃墜理由はカスタム絵文字のショートコードを:shortcode:記法ではなくそのままの
// 単語として載せる。共有先はユーザーが選ぶ任意のインスタンスであり、その
// インスタンスに同名のカスタム絵文字が存在するとは限らないため、:shortcode:の
// まま埋め込むと未解決のまま表示されてしまう(投稿先に依存しないプレーン
// テキストとして扱う)。
export function buildShareText(input: ShareResultInput): string {
  const cause = input.causeShortcode ?? "不明";
  return [
    "DANMAKUSKY(弾幕スキー)で遊びました。",
    "",
    `SCORE: ${input.score.toLocaleString()}`,
    `TIME: ${formatTime(input.survivedMs)}`,
    "",
    `被撃墜理由：${cause}`,
    "",
    "連合TLに敗北しました。",
  ].join("\n");
}

// ユーザーが「Misskeyに結果を投稿」ボタンを押したときだけ呼び出すこと。
// 自動投稿は絶対にしない。
export function openShareForm(text: string, gameUrl: string): void {
  const params = new URLSearchParams({ text, url: gameUrl });
  window.open(`${SHARE_FORM_BASE_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
}
