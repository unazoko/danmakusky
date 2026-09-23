// プレーンテキスト中の「:name:」を実際のカスタム絵文字画像(<img>)に
// 差し替えながら、それ以外はテキストノードとして追加していく。emojisは
// ショートコード→絶対URL(サーバー側で解決済み、note.emojis/user.emojis等と
// 同じ形式)。commentTicker.ts(連合TLコメント欄)・main.ts(カットインの
// 引用文)で共通利用する。
const EMOJI_SHORTCODE_RE = /:([a-zA-Z0-9_+-]+):/g;

export function appendTextWithEmojis(
  target: DocumentFragment,
  text: string,
  emojis: Record<string, string> | undefined,
  imgClassName: string,
): void {
  let lastIndex = 0;
  EMOJI_SHORTCODE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = EMOJI_SHORTCODE_RE.exec(text))) {
    const shortcode = m[1];
    const fullMatch = m[0];
    const url = emojis?.[shortcode];
    if (m.index > lastIndex) target.append(document.createTextNode(text.slice(lastIndex, m.index)));
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = `:${shortcode}:`;
      img.className = imgClassName;
      // 連合先の様々なインスタンスがホストする画像のため、ホットリンク制限・
      // 一時的な障害・投稿後の絵文字削除等で読み込みに失敗することがある。
      // その場合ブラウザ標準の壊れた画像アイコンのままにせず、
      // ":shortcode:"のテキストへフォールバックする(shortcode/fullMatchを
      // ループ変数mから切り離してキャプチャしておかないと、この非同期の
      // errorハンドラが呼ばれる頃にはmが次のマッチや null に進んでしまう)。
      img.addEventListener(
        "error",
        () => {
          if (img.isConnected) img.replaceWith(document.createTextNode(`:${shortcode}:`));
        },
        { once: true },
      );
      target.append(img);
    } else {
      target.append(document.createTextNode(fullMatch));
    }
    lastIndex = EMOJI_SHORTCODE_RE.lastIndex;
  }
  if (lastIndex < text.length) target.append(document.createTextNode(text.slice(lastIndex)));
}
