// mfm-jsのAST(MfmNode[])を扱う共通ヘルパー。commentTicker.ts(連合TLコメント欄)・
// noteEmoji.ts(カットイン引用文)の両方で「装飾記号を取り除いたプレーン
// テキスト化」(Ashi@の「簡易表示」と同じ考え方)が必要なため、ここにまとめる。
import { parse as parseMfm, type MfmNode } from "mfm-js";

// パースに失敗した場合はnullを返す(呼び出し側でプレーンテキストへの
// フォールバック等、用途に応じた処理をさせる)。
export function parseMfmSafe(text: string): MfmNode[] | null {
  try {
    return parseMfm(text);
  } catch {
    return null;
  }
}

export interface PlainTextOptions {
  // trueの場合、URLノードを空文字にする(本文中のURLを表示したくない場合、
  // noteEmoji.ts: buildCutInText参照)。
  stripUrls?: boolean;
}

// 未知のノード種別は子ノードだけを連結するフォールバックにしておく
// (mfm-jsのバージョン差異で多少ノード種別が増減しても壊れにくいように)。
export function mfmNodeToPlainText(node: MfmNode, options: PlainTextOptions = {}): string {
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
      return options.stripUrls ? "" : node.props.url;
    case "inlineCode":
      return node.props.code;
    case "mathInline":
      return node.props.formula;
    case "search":
      return node.props.query ?? "";
    default:
      return Array.isArray(node.children) ? mfmNodesToPlainText(node.children, options) : "";
  }
}

export function mfmNodesToPlainText(nodes: MfmNode[], options: PlainTextOptions = {}): string {
  return nodes.map((n) => mfmNodeToPlainText(n, options)).join("");
}

// 本文中のどこか(ネストした装飾の中でも)にメンション記法が含まれるか。
// リプライ等、特定の相手に向けた投稿をカットインの引用対象から除外する
// 判定に使う(noteEmoji.ts参照)。
export function containsMention(nodes: MfmNode[]): boolean {
  for (const node of nodes) {
    if (node.type === "mention") return true;
    if (Array.isArray(node.children) && containsMention(node.children)) return true;
  }
  return false;
}
