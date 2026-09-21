// 連合TLの投稿速度をnotes/min換算で計算する。短い窓の実測値を60秒換算する
// だけなので、表示上は1分ごとではなく投稿が来るたびに滑らかに変化する。
const WINDOW_MS = 12_000;

export class NoteRateTracker {
  private timestamps: number[] = [];

  record(now: number): void {
    this.timestamps.push(now);
    this.prune(now);
  }

  ratePerMinute(now: number): number {
    this.prune(now);
    return Math.round((this.timestamps.length / WINDOW_MS) * 60_000);
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }
}
