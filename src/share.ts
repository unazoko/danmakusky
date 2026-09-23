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

// 被撃墜理由は:shortcode:記法のまま埋め込む。共有先はユーザーが選ぶ任意の
// インスタンスであり、そのインスタンスに同名のカスタム絵文字が無ければ
// 単に:shortcode:という文字列のまま表示されるだけ(ゲーム的な不都合はない)。
// それより、投稿先にたまたま同名の絵文字があれば実際にレンダリングされて
// 面白い、というビジュアル面のメリットを優先する。
export function buildShareText(input: ShareResultInput): string {
  const cause = input.causeShortcode ?? "不明";
  return [
    "**連合TL弾幕スキー**　で遊びました。",
    "--------------",
    `SCORE: ${input.score.toLocaleString()}`,
    `TIME: ${formatTime(input.survivedMs)}`,
    `:${cause}: に撃墜されました。`,
    "--------------",
    "#DANMAKUSKY",
    "",
  ].join("\n");
}

// ユーザーが「Misskeyに結果を投稿」ボタンを押したときだけ呼び出すこと。
// 自動投稿は絶対にしない。
export function openShareForm(text: string, gameUrl: string): void {
  const params = new URLSearchParams({ text, url: gameUrl });
  window.open(`${SHARE_FORM_BASE_URL}?${params.toString()}`, "_blank", "noopener,noreferrer");
}
