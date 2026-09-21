// 弾の初速(方向・速さ)を決めるパターン群(企画書§12)。
// 「東方Projectみたいな弾幕」という要望に合わせ、弾は発生時に速度ベクトルが
// 決まったら以降は等速直線運動のみ(発生後もプレイヤーを追い続ける誘導弾には
// しない)。これは東方を含む伝統的弾幕STGの基本で、「弾自体は単純だが配置と
// 物量で見せる」という設計に合う。
export interface Velocity {
  vx: number;
  vy: number;
}

const MIN_SPEED = 90;
const MAX_SPEED = 150;

function randomSpeed(): number {
  return MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
}

// 画面上方から下向きに広がる直線弾(企画書§12「1.直線弾」)。
// 出現位置が画面上端(spawner.ts参照)なので、真上や真横に飛んでは自機のいる
// 下方向にそもそも向かわない。角度を0〜π(下向き半円)に絞り、東方のように
// 「上から降ってくる」見た目にする。
export function straightBullet(): Velocity {
  const angle = Math.random() * Math.PI;
  const speed = randomSpeed();
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

// 発生時点のプレイヤー位置へ狙いを定める、いわゆる自機狙い弾
// (企画書§12「2.プレイヤー方向弾」)。発生後は誘導せず直進のみ。
export function aimedBullet(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): Velocity {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const dist = Math.hypot(dx, dy) || 1;
  const speed = randomSpeed();
  return { vx: (dx / dist) * speed, vy: (dy / dist) * speed };
}

// 1点から等間隔の放射状に広がる円形弾幕(企画書§12「3.円/螺旋系」)。
// baseAngleOffsetを発生ごとに少しずつずらして呼ぶと、リング状の弾幕が
// 少しずつ回転しながら発生する見た目になる。
export function circularBurst(count: number, baseAngleOffset = 0): Velocity[] {
  const speed = randomSpeed();
  const result: Velocity[] = [];
  for (let i = 0; i < count; i++) {
    const angle = baseAngleOffset + (Math.PI * 2 * i) / count;
    result.push({ vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed });
  }
  return result;
}

// 真の螺旋弾幕。上のcircularBurstは「1回で1つの輪を出す」ため、時間経過で
// 少しずつしか回転して見えない。こちらはコアから一定間隔で1〜数本の腕を
// 発射し続け、毎回わずかに角度をずらすことで、東方の螺旋弾幕のような
// 連続的に渦を巻く見た目を作る(呼び出し側=loop.tsが一定間隔で呼び、角度を
// 積算していく)。速度は毎回変えず固定にして、渦の形が乱れないようにする。
const SPIRAL_SPEED = 110;
export function spiralArmVelocities(armCount: number, baseAngle: number): Velocity[] {
  const result: Velocity[] = [];
  for (let i = 0; i < armCount; i++) {
    const angle = baseAngle + (Math.PI * 2 * i) / armCount;
    result.push({ vx: Math.cos(angle) * SPIRAL_SPEED, vy: Math.sin(angle) * SPIRAL_SPEED });
  }
  return result;
}
