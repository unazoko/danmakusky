// 表示用フォーマットの共通処理。main.ts/share.ts双方で同じ形式を使うため、
// ここを唯一の情報源にする(重複定義を避ける)。
export function formatTime(ms: number): string {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
}
