// 弾の初速・挙動を決めるパターン群。基本方針(発生時に軌道が決まったら単純)は
// 保ちつつ、一部のパターン(ゆっくり追尾・円運動・ジグザグ・急な方向転換・
// 分裂・停止後急加速)だけは、game/bulletMotion.tsが毎フレーム状態を進める。
import type { BulletBehavior } from "./entities.js";

export interface Velocity {
  vx: number;
  vy: number;
  // 発生点(コア本体の座標)からのオフセット。省略時は0(コアの位置から
  // そのまま発射)。収束リングのように、コアを囲む複数地点から一斉に
  // 発生させたいパターンで使う(coreManager.tsの弾生成時に加算する)。
  offsetX?: number;
  offsetY?: number;
}

export interface SpawnedMotion {
  vx: number;
  vy: number;
  behavior: BulletBehavior;
}

const MIN_SPEED = 90;
const MAX_SPEED = 150;

// 通常弾と同じ速度範囲(中・強ボスの回復弾が自機の移動中に直進するときにも
// 流用する、coreManager.ts参照)。
export function randomSpeed(): number {
  return MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
}

function velocityFromAngle(angle: number, speed: number): Velocity {
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

function angleTo(originX: number, originY: number, targetX: number, targetY: number): number {
  return Math.atan2(targetY - originY, targetX - originX);
}

// --- 発生後も直進のみ(従来通り) -------------------------------------------

// 画面上方から下向きに広がる直線弾。
export function straightBullet(): Velocity {
  const angle = Math.random() * Math.PI; // 下向き半円
  return velocityFromAngle(angle, randomSpeed());
}

// 自転しながら高速で直進する弾。軌道自体は直進のみで、自転は見た目だけ
// (render.ts側でspawnedAtからの経過時間とspinRadPerSecを使って毎フレーム
// 回転角を計算する、当たり判定には影響しない)。
const SPIN_BULLET_SPEED = 260;
const SPIN_RATE_RAD_PER_SEC = Math.PI * 6; // 1秒に3回転
export function spinningBullet(): Velocity & { spinRadPerSec: number } {
  const angle = Math.random() * Math.PI; // 下向き半円
  const spinRadPerSec = (Math.random() < 0.5 ? -1 : 1) * SPIN_RATE_RAD_PER_SEC;
  return { ...velocityFromAngle(angle, SPIN_BULLET_SPEED), spinRadPerSec };
}

// 発生時点のプレイヤー位置へ狙いを定める、いわゆる自機狙い弾。
// 発生後は誘導せず直進のみ。
export function aimedBullet(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): Velocity {
  return velocityFromAngle(angleTo(originX, originY, targetX, targetY), randomSpeed());
}

// 1点から等間隔の放射状に広がる円形弾幕。baseAngleOffsetを発生ごとに
// 少しずつずらして呼ぶと、リング状の弾幕が少しずつ回転しながら発生する
// 見た目になる。
export function circularBurst(count: number, baseAngleOffset = 0): Velocity[] {
  const speed = randomSpeed();
  const result: Velocity[] = [];
  for (let i = 0; i < count; i++) {
    const angle = baseAngleOffset + (Math.PI * 2 * i) / count;
    result.push(velocityFromAngle(angle, speed));
  }
  return result;
}

// 真の螺旋弾幕。コアから一定間隔で1〜数本の腕を発射し続け、毎回わずかに
// 角度をずらすことで、連続的に渦を巻く見た目を作る(呼び出し側=
// coreManager.tsが一定間隔で呼び、角度を積算していく)。
const SPIRAL_SPEED = 110;
export function spiralArmVelocities(armCount: number, baseAngle: number): Velocity[] {
  const result: Velocity[] = [];
  for (let i = 0; i < armCount; i++) {
    const angle = baseAngle + (Math.PI * 2 * i) / armCount;
    result.push(velocityFromAngle(angle, SPIRAL_SPEED));
  }
  return result;
}

// 同心円弾幕。半径の異なる複数のリングを一度に撃つ(見た目には近い半径の
// ものほど遅れて追いつく形になり、波紋のように広がる)。中ボスの攻撃用。
// 隣り合うリングを半歩分ずらすことで、放射状の「スポーク」ではなく
// 花びらが互い違いに重なるマンダラ状の見た目にする。baseAngleOffsetを
// 呼び出しごとに少しずつずらすと、リング全体がゆっくり回転しながら
// 連続発生する見た目になる(swarmManager.ts参照)。
export function concentricRingsVelocities(
  ringCount: number,
  perRingCount: number,
  baseAngleOffset = 0,
): Velocity[] {
  const result: Velocity[] = [];
  for (let ring = 0; ring < ringCount; ring++) {
    const speed = MIN_SPEED + (ring / Math.max(ringCount - 1, 1)) * (MAX_SPEED - MIN_SPEED);
    const angleOffset = baseAngleOffset + (ring % 2) * (Math.PI / perRingCount);
    for (let i = 0; i < perRingCount; i++) {
      const angle = angleOffset + (Math.PI * 2 * i) / perRingCount;
      result.push(velocityFromAngle(angle, speed));
    }
  }
  return result;
}

// 自機狙いではなく、こちらで指定した角度を中心にした扇状弾。プレイヤー位置に
// 依存させたくない(=模様そのものの規則性で見せたい)パターンで使う。
// baseAngleにcoreManager側で毎回わずかに増加させた値を渡し続けると、
// 隙間そのものが回転し続ける「風車の壁」のような見た目になる。
export function arcVelocities(
  count: number,
  spreadRad: number,
  baseAngle: number,
  speed: number = randomSpeed(),
): Velocity[] {
  const result: Velocity[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5; // -0.5〜0.5
    result.push(velocityFromAngle(baseAngle + t * spreadRad, speed));
  }
  return result;
}

// 収束リング。コアを囲む円周上の各点から、一斉に中心(コア)へ向けて弾を
// 撃つ。circularBurst(拡散)の逆再生のように、時間が経つにつれ輪が
// 縮んでいく「収束」演出(東方でもおなじみ)。
const CONVERGE_RADIUS_PX = 120;
const CONVERGE_SPEED = 120;
export function convergingRingVelocities(count: number, baseAngleOffset = 0): Velocity[] {
  const result: Velocity[] = [];
  for (let i = 0; i < count; i++) {
    const angle = baseAngleOffset + (Math.PI * 2 * i) / count;
    result.push({
      ...velocityFromAngle(angle + Math.PI, CONVERGE_SPEED), // 円周上の角度と逆向き=中心へ
      offsetX: Math.cos(angle) * CONVERGE_RADIUS_PX,
      offsetY: Math.sin(angle) * CONVERGE_RADIUS_PX,
    });
  }
  return result;
}

// 自機方向を中心とした扇状の拡散弾(自機狙い弾の束)。東方でよくある
// 「複数弾がまとまって自機を狙う」パターン。
export function aimedFanVelocities(
  count: number,
  spreadRad: number,
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): Velocity[] {
  const baseAngle = angleTo(originX, originY, targetX, targetY);
  const speed = randomSpeed();
  const result: Velocity[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1) - 0.5; // -0.5〜0.5
    result.push(velocityFromAngle(baseAngle + t * spreadRad, speed));
  }
  return result;
}

// 十字(4方向)弾。baseAngleを発生ごとに少しずつずらして呼ぶと、風車のように
// 回転しながら十字を撒き続ける見た目になる(東方の「風車」型弾幕を参考)。
const CROSS_SPEED = 120;
export function crossBurstVelocities(baseAngle: number): Velocity[] {
  const result: Velocity[] = [];
  for (let i = 0; i < 4; i++) {
    result.push(velocityFromAngle(baseAngle + (Math.PI / 2) * i, CROSS_SPEED));
  }
  return result;
}

// 花びら状(バラ曲線)の弾幕。同じ間隔の角度に発生させつつ、速さを
// sin(petals*角度)で周期的に変えることで、時間が経つにつれ花びらの形に
// 広がっていく(東方でおなじみの「flower」系弾幕)。
export function flowerBurstVelocities(
  count: number,
  petals: number,
  baseSpeed: number,
  amplitude: number,
  angleOffset = 0,
): Velocity[] {
  const result: Velocity[] = [];
  for (let i = 0; i < count; i++) {
    const angle = angleOffset + (Math.PI * 2 * i) / count;
    const speed = Math.max(baseSpeed + Math.sin(angle * petals) * amplitude, 20);
    result.push(velocityFromAngle(angle, speed));
  }
  return result;
}

// --- ここから毎フレーム状態を進める系(game/bulletMotion.ts参照) -----------

// ゆっくり追尾。初速はプレイヤー方向に緩く向け、以降は少しずつ曲げ続ける。
export function homingMotion(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): SpawnedMotion {
  const speed = randomSpeed() * 0.8; // 追尾弾は避ける猶予を作るためやや遅めにする
  const angle = angleTo(originX, originY, targetX, targetY);
  const v = velocityFromAngle(angle, speed);
  return {
    ...v,
    behavior: { kind: "homing", turnRateRadPerSec: (35 * Math.PI) / 180 },
  };
}

// 円運動。指定した発生点そのものから円運動を始める(発生点は円の中心ではなく
// 円周上の1点として扱う)。中心を発生点の真上や真下に置くと、発生点が画面上端
// ぎりぎり(y≈-24)にあるため円全体が「発生点のy座標より下には絶対行かない」
// 位置関係になり、実質ずっと画面外に留まってしまう。中心を画面内側
// (発生点よりだいぶ下)に置き、そこから発生点までの距離を半径として使うことで、
// 発生点から自然に画面内へ弧を描いて入ってくるようにしている。
export function orbitMotion(originX: number, originY: number): SpawnedMotion {
  const centerX = originX + (Math.random() - 0.5) * 60;
  const centerY = originY + 120 + Math.random() * 80; // 画面内側に中心を置く
  const dx = originX - centerX;
  const dy = originY - centerY;
  const radius = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx); // 発生点の角度から始める
  const angularSpeedRadPerSec = (Math.random() < 0.5 ? -1 : 1) * ((90 + Math.random() * 90) * Math.PI) / 180;
  return {
    vx: 0,
    vy: 0,
    behavior: { kind: "orbit", centerX, centerY, radius, angle, angularSpeedRadPerSec },
  };
}

// ジグザグ。基準方向(下向き寄り)に対して周期的に左右へ振れる。
export function zigzagMotion(now: number): SpawnedMotion {
  const baseAngle = Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3); // 概ね下向き
  const speed = randomSpeed();
  const v = velocityFromAngle(baseAngle, speed);
  return {
    ...v,
    behavior: {
      kind: "zigzag",
      baseAngle,
      speed,
      amplitudeRad: (30 + Math.random() * 20) * (Math.PI / 180),
      angularFreq: 3 + Math.random() * 2,
      startedAt: now,
    },
  };
}

// 急に方向転換。しばらく直進した後、その瞬間のプレイヤー方向へ急に曲がる。
export function redirectMotion(now: number): SpawnedMotion {
  const initialAngle = Math.random() * Math.PI; // 下向き半円で直進開始
  const speed = randomSpeed();
  const v = velocityFromAngle(initialAngle, speed);
  return {
    ...v,
    behavior: {
      kind: "redirect",
      triggerAt: now + 500 + Math.random() * 500,
      newAngle: 0, // 発動時にプレイヤー方向で上書きする(bulletMotion.ts参照)
      speed,
      triggered: false,
    },
  };
}

// 一定時間停止してから急加速。
export function delayedAccelMotion(now: number, targetAngle: number): SpawnedMotion {
  return {
    vx: 0,
    vy: 0,
    behavior: {
      kind: "delayedAccel",
      triggerAt: now + 700 + Math.random() * 500,
      angle: targetAngle,
      speed: randomSpeed() * 1.3,
      triggered: false,
    },
  };
}

// 一定角速度で弧を描き続ける(プレイヤー追尾はしない、曲がる向きは発生時に
// ランダムで固定)。homingと違い曲線が予測できる分、見た目重視のパターン。
export function curveMotion(): SpawnedMotion {
  const angle = Math.random() * Math.PI; // 下向き半円
  const speed = randomSpeed();
  const curveRadPerSec = (Math.random() < 0.5 ? -1 : 1) * ((50 + Math.random() * 60) * Math.PI) / 180;
  const v = velocityFromAngle(angle, speed);
  return { ...v, behavior: { kind: "curve", angle, speed, curveRadPerSec } };
}

// 速さがアコーディオンのように伸び縮みし続ける(方向は固定)。
export function pulseMotion(now: number): SpawnedMotion {
  const baseAngle = Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 2.5); // 概ね下向き
  const baseSpeed = randomSpeed();
  const amplitude = baseSpeed * (0.4 + Math.random() * 0.3);
  const v = velocityFromAngle(baseAngle, baseSpeed);
  return {
    ...v,
    behavior: {
      kind: "pulse",
      baseAngle,
      baseSpeed,
      amplitude,
      angularFreq: 2 + Math.random() * 2,
      startedAt: now,
    },
  };
}

// 発生直後はゆっくりだが、飛んでいる間ずっと加速し続ける(上限あり)。
export function accelMotion(): SpawnedMotion {
  const angle = Math.random() * Math.PI; // 下向き半円
  const speed = MIN_SPEED * 0.4;
  const v = velocityFromAngle(angle, speed);
  return {
    ...v,
    behavior: {
      kind: "accel",
      angle,
      speed,
      accelPxPerSec2: 220 + Math.random() * 140,
      maxSpeed: MAX_SPEED * 2.2,
    },
  };
}

// 複数方向への分裂。それまでは直進し、時間が来たら周囲へ分裂する。
export function splitterMotion(now: number, initialAngle: number): SpawnedMotion {
  const speed = randomSpeed();
  const v = velocityFromAngle(initialAngle, speed);
  return {
    ...v,
    behavior: {
      kind: "splitter",
      triggerAt: now + 600 + Math.random() * 400,
      splitCount: 5 + Math.floor(Math.random() * 3),
      speed: speed * 0.9,
      triggered: false,
    },
  };
}
