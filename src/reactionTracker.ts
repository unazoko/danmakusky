// 投稿に後から付くリアクションのカスタム絵文字も弾の材料にする。
// globalTimelineは非常に高頻度でノートが流れてくるため、見えた全ノートを
// 購読し続けると購読数が際限なく増えてしまう。同時追跡数に上限を設けて
// 古いものから追い出し(LRU)、かつ一定時間で自動的に購読解除する
// (投稿直後にリアクションが集中する傾向があり、それ以降は追う価値が薄いため)。
import type { CustomEmojiReaction, MisskeyStream } from "./misskeyStream.js";

const MAX_TRACKED_NOTES = 40;
const TRACK_DURATION_MS = 45_000;

interface CachedCutIn {
  text: string | null;
  emojis: Record<string, string> | undefined;
}

export class ReactionTracker {
  private readonly trackedOrder: string[] = [];
  private readonly timers = new Map<string, number>();
  // 追跡開始時点(=まだノート本文を持っている瞬間、main.ts: onNote参照)で
  // 先読みしておいたカットイン引用文・絵文字マップ。リアクションの
  // noteUpdatedイベント自体には本文が含まれない(追加のHTTPリクエストも
  // しない)ため、このキャッシュが無ければ常にnull/undefinedになってしまう。
  private readonly cutInByNoteId = new Map<string, CachedCutIn>();

  constructor(
    private readonly stream: MisskeyStream,
    private readonly onReaction: (r: CustomEmojiReaction) => void,
  ) {}

  track(noteId: string, cutInText: string | null, cutInEmojis: Record<string, string> | undefined): void {
    if (this.timers.has(noteId)) return;

    if (this.trackedOrder.length >= MAX_TRACKED_NOTES) {
      const oldest = this.trackedOrder.shift();
      if (oldest) this.untrack(oldest);
    }

    this.trackedOrder.push(noteId);
    this.cutInByNoteId.set(noteId, { text: cutInText, emojis: cutInEmojis });
    this.stream.subscribeToNoteReactions(noteId, (r) => {
      const cached = this.cutInByNoteId.get(noteId);
      this.onReaction({ ...r, cutInText: cached?.text ?? null, cutInEmojis: cached?.emojis });
    });
    const timer = window.setTimeout(() => this.untrack(noteId), TRACK_DURATION_MS);
    this.timers.set(noteId, timer);
  }

  private untrack(noteId: string): void {
    const timer = this.timers.get(noteId);
    if (timer !== undefined) window.clearTimeout(timer);
    this.timers.delete(noteId);
    this.cutInByNoteId.delete(noteId);

    const idx = this.trackedOrder.indexOf(noteId);
    if (idx !== -1) this.trackedOrder.splice(idx, 1);

    this.stream.unsubscribeFromNoteReactions(noteId);
  }
}
