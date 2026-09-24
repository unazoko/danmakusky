// 連合TLの投稿速度をnotes/min換算で計算する。短い窓の実測値を60秒換算する
// だけなので、表示上は1分ごとではなく投稿が来るたびに滑らかに変化する。
const WINDOW_MS = 12_000;

export class NoteRateTracker {
  private timestamps: number[] = [];
  // ラウンド中に観測した最大瞬間流量(結果画面表示用)。ratePerMinute()が
  // 呼ばれるたびに更新する(main.tsではプレイ中の毎フレーム呼ばれている)。
  private maxRatePerMinute = 0;

  record(now: number): void {
    this.timestamps.push(now);
    this.prune(now);
  }

  ratePerMinute(now: number): number {
    this.prune(now);
    const rate = Math.round((this.timestamps.length / WINDOW_MS) * 60_000);
    if (rate > this.maxRatePerMinute) this.maxRatePerMinute = rate;
    return rate;
  }

  getMaxRatePerMinute(): number {
    return this.maxRatePerMinute;
  }

  // ラウンド開始時に呼ぶ(接続自体は維持したまま、そのラウンド分の
  // 最大値だけをリセットする。直近の瞬間流量そのものは接続が続く限り
  // 引き継いで問題ないのでtimestampsはリセットしない)。
  resetMax(): void {
    this.maxRatePerMinute = 0;
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }
}
