// Misskeyの投稿流を弾幕として放つ「コア」(東方のボス役)の管理。
// コアには3段階の強さ(弱/中/強)があり、出現頻度は弱>中>強、同時出現数の
// 上限もそれぞれ異なる。攻撃間隔・移動速度は、直近の連合TLの流速
// (BulletSpawner.getStreamIntensity)でスケールし、「流速が高いほど難しい」
// という基本コンセプトをコアの攻撃にも反映させる。
import type { Bullet, Core, CoreTier } from "./entities.js";
import { createBulletId, createCoreId } from "./entities.js";
import {
  aimedBullet,
  aimedFanVelocities,
  circularBurst,
  concentricRingsVelocities,
  crossBurstVelocities,
  spiralArmVelocities,
} from "./patterns.js";
import { getOrLoadEmojiImage } from "../render.js";

interface TierConfig {
  maxHp: number;
  maxSimultaneous: number;
  spriteSize: number;
  hitRadius: number;
  moves: boolean;
  spawnWeight: number;
  attackIntervalMs: number;
  lifeUpDropChance: number;
}

// 弱: 複数体同時出現・移動する・HP低め・攻撃単調・弾少な目
// 中: 水平往復移動・最大2体・弱よりHP高め・螺旋/同心円弾幕
// 強: 横方向の中心に固定・最大1体・HPが一番高い・攻撃も一番激しい
const TIER_CONFIG: Record<CoreTier, TierConfig> = {
  weak: { maxHp: 40, maxSimultaneous: 3, spriteSize: 44, hitRadius: 20, moves: true, spawnWeight: 60, attackIntervalMs: 1000, lifeUpDropChance: 0.1 },
  mid: { maxHp: 110, maxSimultaneous: 2, spriteSize: 60, hitRadius: 27, moves: true, spawnWeight: 35, attackIntervalMs: 800, lifeUpDropChance: 0.5 },
  strong: { maxHp: 200, maxSimultaneous: 1, spriteSize: 76, hitRadius: 34, moves: false, spawnWeight: 8, attackIntervalMs: 500, lifeUpDropChance: 1 },
};

// このショートコードはボスにせず通常弾のみとする(指定による除外)。
const BOSS_EXCLUDED_SHORTCODES = new Set(["ba_ibuki_facea"]);

const BASE_SPAWN_INTERVAL_MS = 4000;
const MAX_RECENT_EMOJI_URLS = 20;
// 弱ボスが画面下へ流れていく速度(通常弾のstraightBullet等と同程度)。
const WEAK_DRIFT_SPEED_PX_PER_SEC = 28;
// 画面外に十分出た弱ボスは通常弾と同じように消す(このマージンより
// 内側に戻ってくることはない前提、loop.ts: CULL_MARGIN_PXと同じ考え方)。
const WEAK_CULL_MARGIN_PX = 60;

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
    if (BOSS_EXCLUDED_SHORTCODES.has(shortcode)) return;
    this.recentEmojis.push({ shortcode, url });
    if (this.recentEmojis.length > MAX_RECENT_EMOJI_URLS) this.recentEmojis.shift();
  }

  update(
    dtSec: number,
    now: number,
    canvasWidth: number,
    canvasHeight: number,
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
      for (const core of defeated) {
        this.dropLifeUpItem(core, now, bullets);
        listeners.onCoreDefeated?.(core);
      }
    }

    // 弱ボスは通常弾と同じく画面下へ流れ続けるので、十分下まで出たら
    // (倒したことにはせず、報酬も出さずに)静かに消す。
    this.cores = this.cores.filter(
      (c) => c.tier !== "weak" || c.y < canvasHeight + WEAK_CULL_MARGIN_PX,
    );
  }

  // ボスを倒すと、階級に応じた確率でその場に残機回復弾を1つ落とす
  // (弱=0%、中=50%、強=100%)。
  private dropLifeUpItem(core: Core, now: number, bullets: Bullet[]): void {
    if (Math.random() >= TIER_CONFIG[core.tier].lifeUpDropChance) return;
    bullets.push({
      id: createBulletId(),
      img: core.img,
      shortcode: core.shortcode,
      x: core.x,
      y: core.y,
      vx: (Math.random() - 0.5) * 30,
      vy: 70 + Math.random() * 30,
      size: 26,
      hitRadius: 10,
      spawnedAt: now,
      behavior: { kind: "linear" },
      isLifeUp: true,
    });
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

    // 強ボスは横方向の中心に固定して出現させる(それ以外は左右にばらけさせる)。
    const x = tier === "strong" ? canvasWidth / 2 : canvasWidth * (0.25 + Math.random() * 0.5);
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
      spawnedAt: now,
      nextAttackAt: now + cfg.attackIntervalMs,
      attackAngle: 0,
    };
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
      // 左右には正弦波でふらふらと(ランダムウォークだと角度がたまたま
      // 垂直寄りに偏ったまま止まって見えることがあるため、絶対に止まらない
      // 正弦波にする)、縦方向は通常弾と同じく画面下へ流れ続ける。
      const elapsedSec = (now - core.spawnedAt) / 1000;
      const amplitude = Math.min(canvasWidth * 0.2, 80);
      core.x = core.moveOriginX + Math.sin(elapsedSec * 0.9 + core.moveAngle) * amplitude;
      core.x = Math.min(Math.max(core.x, 40), canvasWidth - 40);
      core.y += WEAK_DRIFT_SPEED_PX_PER_SEC * dtSec;
    } else if (core.tier === "mid") {
      // 中ボスは単純な水平往復運動。
      const elapsedSec = (now - core.spawnedAt) / 1000;
      const amplitude = Math.min(canvasWidth * 0.25, 100);
      core.x = core.moveOriginX + Math.sin(elapsedSec * 0.7) * amplitude;
    }
    // 強ボスは横方向の中心に固定(moves: falseなのでここに来ない)。
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
      // 東方を参考に、螺旋・同心円・自機狙いの扇・十字(風車)をランダムに
      // 織り交ぜる。強ボスよりも1回あたりの弾数を絞って密度を抑える。
      core.attackAngle += (10 * Math.PI) / 180;
      const pattern = pickWeighted(
        ["spiral", "rings", "fan", "cross"] as const,
        (p) => ({ spiral: 25, rings: 20, fan: 30, cross: 25 })[p],
      );
      if (pattern === "spiral") {
        velocities = spiralArmVelocities(3, core.attackAngle);
      } else if (pattern === "rings") {
        velocities = concentricRingsVelocities(2, 6);
      } else if (pattern === "fan") {
        velocities = aimedFanVelocities(3, Math.PI / 4, core.x, core.y, playerX, playerY);
      } else {
        velocities = crossBurstVelocities(core.attackAngle);
      }
    } else {
      // 強ボス: 中ボスと同じ引き出し(螺旋・同心円+放射・自機狙いの広い扇・
      // 二重十字)をランダムに選ぶ、最も激しい攻撃。
      core.attackAngle += (16 * Math.PI) / 180;
      const pattern = pickWeighted(
        ["spiral", "ringsBurst", "fan", "doubleCross"] as const,
        (p) => ({ spiral: 35, ringsBurst: 20, fan: 25, doubleCross: 20 })[p],
      );
      if (pattern === "spiral") {
        velocities = spiralArmVelocities(5, core.attackAngle);
      } else if (pattern === "ringsBurst") {
        velocities = [...concentricRingsVelocities(2, 12), ...circularBurst(8, core.attackAngle)];
      } else if (pattern === "fan") {
        velocities = aimedFanVelocities(5, Math.PI / 2.5, core.x, core.y, playerX, playerY);
      } else {
        velocities = [
          ...crossBurstVelocities(core.attackAngle),
          ...crossBurstVelocities(core.attackAngle + Math.PI / 4),
        ];
      }
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
