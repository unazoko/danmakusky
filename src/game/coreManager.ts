// Misskeyの投稿流を弾幕として放つ「コア」(東方のボス役)の管理。
// コアには3段階の強さ(弱/中/強)があり、出現頻度は弱>中>強、同時出現数の
// 上限もそれぞれ異なる。攻撃間隔・移動速度は、直近の連合TLの流速
// (BulletSpawner.getStreamIntensity)でスケールし、「流速が高いほど難しい」
// という基本コンセプトをコアの攻撃にも反映させる。
import type { Bullet, Core, CoreTier } from "./entities.js";
import { createBulletId, createCoreId } from "./entities.js";
import { aimedBullet, circularBurst, concentricRingsVelocities, spiralArmVelocities } from "./patterns.js";
import { getOrLoadEmojiImage } from "../render.js";

interface TierConfig {
  maxHp: number;
  maxSimultaneous: number;
  spriteSize: number;
  hitRadius: number;
  moves: boolean;
  spawnWeight: number;
  attackIntervalMs: number;
}

// 弱: 複数体同時出現・移動する・HP低め・攻撃単調・弾少な目
// 中: 位置固定・最大2体・弱よりHP高め・螺旋/同心円弾幕
// 強: 移動する(単純な往復)・最大1体・HPが一番高い・攻撃も一番激しい
const TIER_CONFIG: Record<CoreTier, TierConfig> = {
  weak: { maxHp: 15, maxSimultaneous: 3, spriteSize: 44, hitRadius: 20, moves: true, spawnWeight: 60, attackIntervalMs: 1100 },
  mid: { maxHp: 35, maxSimultaneous: 2, spriteSize: 60, hitRadius: 27, moves: false, spawnWeight: 30, attackIntervalMs: 750 },
  strong: { maxHp: 70, maxSimultaneous: 1, spriteSize: 76, hitRadius: 34, moves: true, spawnWeight: 10, attackIntervalMs: 500 },
};

const BASE_SPAWN_INTERVAL_MS = 4000;
const MAX_RECENT_EMOJI_URLS = 20;

export interface CoreManagerListeners {
  onCoreDefeated?: (core: Core) => void;
  // カットイン演出(東方風のボス登場演出)のトリガー用。
  onCoreSpawned?: (core: Core) => void;
}

interface RecentEmoji {
  shortcode: string;
  url: string;
}

export class CoreManager {
  cores: Core[] = [];
  private recentEmojis: RecentEmoji[] = [];
  private nextSpawnAt = 0;

  // コアの攻撃弾の死因表示にショートコードをそのまま使えるよう、URLだけでなく
  // ショートコードも合わせて記録しておく。
  registerEmoji(shortcode: string, url: string): void {
    this.recentEmojis.push({ shortcode, url });
    if (this.recentEmojis.length > MAX_RECENT_EMOJI_URLS) this.recentEmojis.shift();
  }

  update(
    dtSec: number,
    now: number,
    canvasWidth: number,
    intensity: number,
    playerX: number,
    playerY: number,
    bullets: Bullet[],
    listeners: CoreManagerListeners,
  ): void {
    this.trySpawn(now, canvasWidth, listeners);

    for (const core of this.cores) {
      this.updateMovement(core, dtSec, now, canvasWidth);
      this.updateAttack(core, now, intensity, playerX, playerY, bullets);
    }

    const defeated = this.cores.filter((c) => c.hp <= 0);
    if (defeated.length > 0) {
      this.cores = this.cores.filter((c) => c.hp > 0);
      for (const core of defeated) listeners.onCoreDefeated?.(core);
    }
  }

  private trySpawn(now: number, canvasWidth: number, listeners: CoreManagerListeners): void {
    if (now < this.nextSpawnAt) return;
    if (this.recentEmojis.length === 0) return;

    const eligibleTiers = (Object.keys(TIER_CONFIG) as CoreTier[]).filter(
      (tier) => this.countByTier(tier) < TIER_CONFIG[tier].maxSimultaneous,
    );
    if (eligibleTiers.length === 0) {
      this.nextSpawnAt = now + 1000; // 全枠埋まっている間は少し待って再チェック
      return;
    }

    const tier = pickWeighted(eligibleTiers, (t) => TIER_CONFIG[t].spawnWeight);
    const cfg = TIER_CONFIG[tier];
    const { shortcode, url } = this.recentEmojis[this.recentEmojis.length - 1];

    const x = canvasWidth * (0.25 + Math.random() * 0.5);
    const core: Core = {
      id: createCoreId(),
      tier,
      shortcode,
      x,
      y: 70 + Math.random() * 40,
      hp: cfg.maxHp,
      maxHp: cfg.maxHp,
      spriteSize: cfg.spriteSize,
      hitRadius: cfg.hitRadius,
      img: getOrLoadEmojiImage(url),
      moveAngle: Math.random() * Math.PI * 2,
      moveOriginX: x,
      moveOriginY: 0,
      spawnedAt: now,
      nextAttackAt: now + cfg.attackIntervalMs,
      attackAngle: 0,
    };
    core.moveOriginY = core.y;
    this.cores.push(core);
    listeners.onCoreSpawned?.(core);

    this.nextSpawnAt = now + BASE_SPAWN_INTERVAL_MS + Math.random() * BASE_SPAWN_INTERVAL_MS;
  }

  private countByTier(tier: CoreTier): number {
    return this.cores.filter((c) => c.tier === tier).length;
  }

  private updateMovement(core: Core, dtSec: number, now: number, canvasWidth: number): void {
    const cfg = TIER_CONFIG[core.tier];
    if (!cfg.moves) return;

    if (core.tier === "weak") {
      // ふらふらとした弱ボスの移動: 角度をゆっくりランダムに変えながら漂う。
      core.moveAngle += (Math.random() - 0.5) * dtSec * 1.5;
      const speed = 30;
      core.x += Math.cos(core.moveAngle) * speed * dtSec;
      core.y += Math.sin(core.moveAngle) * speed * dtSec * 0.4; // 縦方向の動きは控えめに
      core.x = Math.min(Math.max(core.x, 40), canvasWidth - 40);
      core.y = Math.min(Math.max(core.y, 50), 160);
    } else if (core.tier === "strong") {
      // 強ボスは単純な水平往復運動。
      const elapsedSec = (now - core.spawnedAt) / 1000;
      const amplitude = Math.min(canvasWidth * 0.3, 120);
      core.x = core.moveOriginX + Math.sin(elapsedSec * 0.8) * amplitude;
    }
  }

  private updateAttack(
    core: Core,
    now: number,
    intensity: number,
    playerX: number,
    playerY: number,
    bullets: Bullet[],
  ): void {
    if (now < core.nextAttackAt) return;
    const cfg = TIER_CONFIG[core.tier];
    // 流速が高いほど攻撃間隔を短くする(=激しくなる)。
    core.nextAttackAt = now + cfg.attackIntervalMs / intensity;

    const img = core.img;
    let velocities: { vx: number; vy: number }[];

    if (core.tier === "weak") {
      // 単調な攻撃: 自機狙いを1発だけ。
      velocities = [aimedBullet(core.x, core.y, playerX, playerY)];
    } else if (core.tier === "mid") {
      // 螺旋か同心円かを交互に。
      core.attackAngle += (12 * Math.PI) / 180;
      velocities =
        Math.random() < 0.5
          ? spiralArmVelocities(4, core.attackAngle)
          : concentricRingsVelocities(2, 10);
    } else {
      // 強ボス: 螺旋+時々同心円を織り交ぜた激しい攻撃。
      core.attackAngle += (16 * Math.PI) / 180;
      velocities =
        Math.random() < 0.7
          ? spiralArmVelocities(5, core.attackAngle)
          : [...concentricRingsVelocities(2, 12), ...circularBurst(8, core.attackAngle)];
    }

    for (const v of velocities) {
      bullets.push({
        id: createBulletId(),
        img,
        shortcode: core.shortcode,
        x: core.x,
        y: core.y,
        vx: v.vx,
        vy: v.vy,
        size: 22,
        hitRadius: 7,
        spawnedAt: now,
        behavior: { kind: "linear" },
      });
    }
  }
}

function pickWeighted<T>(items: T[], weightOf: (item: T) => number): T {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= weightOf(item);
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}
