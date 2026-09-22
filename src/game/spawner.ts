// 絵文字の出現イベントを「通常弾」へ変換する。流量制御(最大生成数/秒・
// 最大画面弾数)もここで行う。上限に達した分は単純に捨てず、次に生成できた
// ときの円形弾幕を強化する形で還元し、「流速が高いほど難しい」という基本
// コンセプトを保ったままゲームが完全に破綻しないようにする。
//
// 通常弾はコアの有無に関わらず画面上端から常に降ってくる(コアの攻撃は
// coreManager.tsが別途担当する)。また、直近の絵文字出現頻度(=連合TLの流速)を
// 記録し、コアの攻撃強度をスケールさせるための材料として公開する。
import type { EmojiOccurrence } from "../noteEmoji.js";
import type { Bullet } from "./entities.js";
import { createBulletId } from "./entities.js";
import {
  aimedBullet,
  circularBurst,
  straightBullet,
  homingMotion,
  orbitMotion,
  zigzagMotion,
  redirectMotion,
  delayedAccelMotion,
  splitterMotion,
  type Velocity,
} from "./patterns.js";
import { getOrLoadEmojiImage } from "../render.js";

const MAX_BULLETS_ON_SCREEN = 220;
const MAX_SPAWN_EVENTS_PER_SEC = 20;
const BULLET_SPRITE_SIZE = 28;
// 見た目(28px)よりはっきり小さい当たり判定にする。弾幕STGの定石で、
// 見た目では当たっているように見えても実際は避けられる状態を作れる。
const BULLET_HIT_RADIUS = 8;
const SPAWN_MARGIN_PX = 24;
const MAX_OVERFLOW_BONUS = 24;
// 残機回復弾として出す確率。
const LIFE_UP_CHANCE = 0.15;
// 直近何秒分の出現間隔を見て「流速」を計算するか。
const INTENSITY_WINDOW_MS = 8000;

export interface SpawnContext {
  now: number;
  canvasWidth: number;
  canvasHeight: number;
  playerX: number;
  playerY: number;
}

export class BulletSpawner {
  private spawnTimestamps: number[] = [];
  private overflowBonus = 0;
  // 直近でストリーム流量が生成上限を超えた時刻。警告表示演出向け。
  private lastOverflowAt = 0;
  // 流速計算用、直近の出現イベント時刻の記録(生成上限とは別に全件記録する)。
  private occurrenceTimestamps: number[] = [];

  // 「今、流速が生成上限を超えている(≒表示上の警告を出すべき)か」の目安。
  isOverflowing(now: number): boolean {
    return now - this.lastOverflowAt < 2000;
  }

  // 直近の絵文字出現頻度から求めた「難易度倍率」(0.5〜3倍程度)。
  // コアの攻撃間隔・移動速度等をこれでスケールし、連合TLの流速とゲーム難易度を
  // 連動させる。
  getStreamIntensity(now: number): number {
    const cutoff = now - INTENSITY_WINDOW_MS;
    while (this.occurrenceTimestamps.length > 0 && this.occurrenceTimestamps[0] < cutoff) {
      this.occurrenceTimestamps.shift();
    }
    const perSecond = this.occurrenceTimestamps.length / (INTENSITY_WINDOW_MS / 1000);
    // 経験的に、絵文字1個/秒くらいを「標準」とみなす。
    const BASELINE_PER_SEC = 1.0;
    return clamp(perSecond / BASELINE_PER_SEC, 0.5, 3);
  }

  trySpawnFromOccurrence(occurrence: EmojiOccurrence, ctx: SpawnContext, bullets: Bullet[]): void {
    this.occurrenceTimestamps.push(ctx.now);
    this.pruneOldTimestamps(ctx.now);

    if (bullets.length >= MAX_BULLETS_ON_SCREEN) return;

    if (this.spawnTimestamps.length >= MAX_SPAWN_EVENTS_PER_SEC) {
      this.overflowBonus = Math.min(this.overflowBonus + 1, MAX_OVERFLOW_BONUS);
      this.lastOverflowAt = ctx.now;
      return;
    }

    this.spawnTimestamps.push(ctx.now);
    const bonus = this.overflowBonus;
    this.overflowBonus = 0;

    const img = getOrLoadEmojiImage(occurrence.url);
    const origin = randomTopSpawnPoint(ctx.canvasWidth);

    if (Math.random() < LIFE_UP_CHANCE) {
      // 残機回復弾は捕まえられるよう、単純な直線(ほぼ真下)にする。
      const v = { vx: (Math.random() - 0.5) * 30, vy: 70 + Math.random() * 30 };
      bullets.push(
        makeBullet(img, occurrence.shortcode, origin, v, { kind: "linear" }, ctx.now, true),
      );
      return;
    }

    const roll = Math.random();
    if (bonus > 0 || roll < 0.12) {
      const spiralOffset = (ctx.now / 300) % (Math.PI * 2);
      for (const v of circularBurst(6 + bonus, spiralOffset)) {
        bullets.push(makeBullet(img, occurrence.shortcode, origin, v, { kind: "linear" }, ctx.now));
      }
      return;
    }

    if (roll < 0.30) {
      const v = aimedBullet(origin.x, origin.y, ctx.playerX, ctx.playerY);
      bullets.push(makeBullet(img, occurrence.shortcode, origin, v, { kind: "linear" }, ctx.now));
    } else if (roll < 0.45) {
      const v = straightBullet();
      bullets.push(makeBullet(img, occurrence.shortcode, origin, v, { kind: "linear" }, ctx.now));
    } else if (roll < 0.58) {
      const m = homingMotion(origin.x, origin.y, ctx.playerX, ctx.playerY);
      bullets.push(makeBullet(img, occurrence.shortcode, origin, m, m.behavior, ctx.now));
    } else if (roll < 0.70) {
      const m = orbitMotion(origin.x, origin.y);
      bullets.push(makeBullet(img, occurrence.shortcode, origin, m, m.behavior, ctx.now));
    } else if (roll < 0.82) {
      const m = zigzagMotion(ctx.now);
      bullets.push(makeBullet(img, occurrence.shortcode, origin, m, m.behavior, ctx.now));
    } else if (roll < 0.91) {
      const m = redirectMotion(ctx.now);
      bullets.push(makeBullet(img, occurrence.shortcode, origin, m, m.behavior, ctx.now));
    } else if (roll < 0.96) {
      const angle = Math.random() * Math.PI; // 停止後、下向き半円のどこかへ加速
      const m = delayedAccelMotion(ctx.now, angle);
      bullets.push(makeBullet(img, occurrence.shortcode, origin, m, m.behavior, ctx.now));
    } else {
      const angle = Math.random() * Math.PI;
      const m = splitterMotion(ctx.now, angle);
      bullets.push(makeBullet(img, occurrence.shortcode, origin, m, m.behavior, ctx.now));
    }
  }

  private pruneOldTimestamps(now: number): void {
    const cutoff = now - 1000;
    while (this.spawnTimestamps.length > 0 && this.spawnTimestamps[0] < cutoff) {
      this.spawnTimestamps.shift();
    }
  }
}

function makeBullet(
  img: HTMLImageElement,
  shortcode: string,
  origin: { x: number; y: number },
  v: Velocity,
  behavior: Bullet["behavior"],
  now: number,
  isLifeUp = false,
): Bullet {
  return {
    id: createBulletId(),
    img,
    shortcode,
    x: origin.x,
    y: origin.y,
    vx: v.vx,
    vy: v.vy,
    size: BULLET_SPRITE_SIZE,
    hitRadius: BULLET_HIT_RADIUS,
    spawnedAt: now,
    behavior,
    isLifeUp,
  };
}

// 東方Project等の伝統的な弾幕STGでは、弾は基本的に画面上方(敵がいる方向)から
// 飛んでくる。四方八方から均等に出現させると見た目が違いすぎるため、
// 出現位置を上端付近(左右にはみ出た斜め上も含む)に絞る。
function randomTopSpawnPoint(width: number): { x: number; y: number } {
  const horizontalMargin = width * 0.3;
  return {
    x: -horizontalMargin + Math.random() * (width + horizontalMargin * 2),
    y: -SPAWN_MARGIN_PX,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
