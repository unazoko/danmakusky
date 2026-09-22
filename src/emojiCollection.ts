// 遭遇したカスタム絵文字をlocalStorageに記録する「絵文字コレクション」。
// URLをキーにする(連合先が異なると同じショートコードでも別画像になりうるため、
// render.tsの画像キャッシュと同じ方針)。
const COLLECTION_KEY = "danmakusky-emoji-collection";
// 際限なく増え続けないよう、件数はここで頭打ちにする。上限に達した状態で
// 新しい絵文字と出会った場合は、一番遭遇回数の少ないものを1件間引いて
// 枠を空ける(単に新規登録を拒否すると、上限到達後は二度と新しい絵文字が
// 記録されなくなってしまうため)。
const MAX_ENTRIES = 1024;

function makeRoomForNewEntry(data: Record<string, CollectionEntry>): void {
  if (Object.keys(data).length < MAX_ENTRIES) return;
  let leastUrl: string | null = null;
  let leastTotal = Infinity;
  for (const [url, entry] of Object.entries(data)) {
    const total = entry.count + (entry.defeatCount ?? 0);
    if (total < leastTotal) {
      leastTotal = total;
      leastUrl = url;
    }
  }
  if (leastUrl !== null) delete data[leastUrl];
}

export interface CollectionEntry {
  shortcode: string;
  url: string;
  count: number;
  // この絵文字の弾に撃墜された回数。古いデータには存在しないことがあるため、
  // 読み出し側はundefinedを0として扱うこと。
  defeatCount?: number;
}

// ページ読み込み中は一度だけlocalStorageから読み、以後はこのメモリ上の
// オブジェクトを直接書き換える(出現のたびにJSON.parseし直さないため)。
let cache: Record<string, CollectionEntry> | null = null;

function ensureLoaded(): Record<string, CollectionEntry> {
  if (!cache) {
    try {
      const raw = localStorage.getItem(COLLECTION_KEY);
      cache = raw ? JSON.parse(raw) : {};
    } catch {
      cache = {};
    }
  }
  return cache!;
}

export function recordEmojiEncounter(shortcode: string, url: string): void {
  const data = ensureLoaded();
  const existing = data[url];
  if (existing) {
    existing.count += 1;
  } else {
    makeRoomForNewEntry(data);
    data[url] = { shortcode, url, count: 1, defeatCount: 0 };
  }
  localStorage.setItem(COLLECTION_KEY, JSON.stringify(data));
}

// この絵文字の弾に撃墜された回数を1増やす。撃墜時の絵文字は必ず一度は
// recordEmojiEncounterで登録済みのはずだが、念のため未登録でも作成する。
export function recordEmojiDefeat(shortcode: string, url: string): void {
  const data = ensureLoaded();
  const existing = data[url];
  if (existing) {
    existing.defeatCount = (existing.defeatCount ?? 0) + 1;
  } else {
    makeRoomForNewEntry(data);
    data[url] = { shortcode, url, count: 0, defeatCount: 1 };
  }
  localStorage.setItem(COLLECTION_KEY, JSON.stringify(data));
}

// 出現回数の多い順に返す。
export function getCollection(): CollectionEntry[] {
  return Object.values(ensureLoaded()).sort((a, b) => b.count - a.count);
}

export function clearCollection(): void {
  cache = {};
  localStorage.removeItem(COLLECTION_KEY);
}
