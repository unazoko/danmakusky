// 絵文字の出現イベントを弾へ変換する。企画書§15の流量制御
// (最大生成数/秒・最大画面弾数)をここで行う。
// 上限に達した分は単純に捨てず、次に生成できたときの円形弾幕を強化する形で
// 還元する(「流速が高いほど難しい」という基本コンセプトを維持したまま
// ゲームが完全に破綻しないようにする、企画書§15後半の指示)。
import type { EmojiOccurrence } from "../noteEmoji.js";
import type { Bullet } from "./entities.js";
import { createBulletId } from "./entities.js";
import { aimedBullet, circularBurst, straightBullet, type Velocity } from "./patterns.js";
import { getOrLoadEmojiImage } from "../render.js";

const MAX_BULLETS_ON_SCREEN = 220;
const MAX_SPAWN_EVENTS_PER_SEC = 20;
const BULLET_SPRITE_SIZE = 28;
// 見た目(28px)よりはっきり小さい当たり判定。東方含む弾幕STGの定石
// (企画書§20「見た目では当たっているように見えるが実は避けている」)。
const BULLET_HIT_RADIUS = 8;
const MAX_OVERFLOW_BONUS = 24;

export interface SpawnContext {
  now: number;
  // 弾はコア(自機が撃破する対象)の位置から放たれる(東方のボスと同じ構図)。
  originX: number;
  originY: number;
  playerX: number;
  playerY: number;
}

export class BulletSpawner {
  private spawnTimestamps: number[] = [];
  private overflowBonus = 0;
  // 直近でストリーム流量が生成上限を超えた時刻。演出(§23の警告表示)向け。
  private lastOverflowAt = 0;

  // 「今、流速が生成上限を超えている(≒表示上の警告を出すべき)か」の目安。
  isOverflowing(now: number): boolean {
    return now - this.lastOverflowAt < 2000;
  }

  trySpawnFromOccurrence(occurrence: EmojiOccurrence, ctx: SpawnContext, bullets: Bullet[]): void {
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
    const origin = { x: ctx.originX, y: ctx.originY };
    const roll = Math.random();

    let velocities: Velocity[];
    if (bonus > 0 || roll < 0.15) {
      // 円/螺旋系。時間経過で基準角をずらし続けることで螺旋に見せる。
      const spiralOffset = (ctx.now / 300) % (Math.PI * 2);
      velocities = circularBurst(6 + bonus, spiralOffset);
    } else if (roll < 0.55) {
      velocities = [aimedBullet(origin.x, origin.y, ctx.playerX, ctx.playerY)];
    } else {
      velocities = [straightBullet()];
    }

    for (const v of velocities) {
      bullets.push({
        id: createBulletId(),
        img,
        shortcode: occurrence.shortcode,
        x: origin.x,
        y: origin.y,
        vx: v.vx,
        vy: v.vy,
        size: BULLET_SPRITE_SIZE,
        hitRadius: BULLET_HIT_RADIUS,
        spawnedAt: ctx.now,
      });
    }
  }

  private pruneOldTimestamps(now: number): void {
    const cutoff = now - 1000;
    while (this.spawnTimestamps.length > 0 && this.spawnTimestamps[0] < cutoff) {
      this.spawnTimestamps.shift();
    }
  }
}
