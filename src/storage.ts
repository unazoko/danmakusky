// 最高スコアのみをlocalStorageへ保存する(企画書§28、MVPでは最高スコア程度でよい)。
// サーバーには一切保存しない。
const HIGH_SCORE_KEY = "danmakusky-high-score";

export function getHighScore(): number {
  const raw = localStorage.getItem(HIGH_SCORE_KEY);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

// 新しいスコアが既存の最高スコアを上回っていれば更新する。
// 戻り値は「今回、新記録を更新したかどうか」。
export function updateHighScore(score: number): boolean {
  const current = getHighScore();
  if (score <= current) return false;
  localStorage.setItem(HIGH_SCORE_KEY, String(score));
  return true;
}
