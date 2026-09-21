// 自機・弾のエンティティ定義。
// 自機・弾ともに見た目はカスタム絵文字画像そのものだが、当たり判定は見た目より
// 大幅に小さい円にする(企画書§20「見た目では当たっているように見えるが実は
// 避けている」状態を作れるようにする、東方Project由来の弾幕ゲームの定石)。

export interface Player {
  x: number;
  y: number;
  spriteSize: number;
  hitRadius: number;
  emojiImg: HTMLImageElement | null;
  // この時刻(performance.now())まで無敵。被弾直後に同じフレームで何度も
  // 判定されて残機が溶けるのを防ぐ(東方含む弾幕ゲームの定石)。
  invincibleUntil: number;
  // 東方の「低速移動(Shift)」に相当。trueの間は移動速度が落ち、当たり判定の
  // 目安となる小さな点を表示する。
  focused: boolean;
}

export interface Bullet {
  id: number;
  img: HTMLImageElement;
  shortcode: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hitRadius: number;
  spawnedAt: number;
}

// Misskeyの投稿流を弾幕として放つ「コア」。東方のボスに相当する。
// これを自機の弾で撃破しないと、投稿由来の弾幕が止まらない
// (=撃破するまで弾が出続ける、企画書には無いが今回追加した要素)。
export interface Core {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spriteSize: number;
  hitRadius: number;
  img: HTMLImageElement;
}

// 自機が撃つ弾。見た目は絵文字ではなく単純な光弾にする
// (画面上の大量の絵文字弾と見分けやすくするため)。
export interface PlayerBullet {
  id: number;
  x: number;
  y: number;
  vy: number;
}

let nextBulletId = 1;
export function createBulletId(): number {
  return nextBulletId++;
}
