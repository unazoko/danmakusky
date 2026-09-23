// Misskeyの投稿流を弾幕として放つ「コア」(東方のボス役)の管理。
// コアには3段階の強さ(弱/中/強)があり、出現頻度は弱>中>強、同時出現数の
// 上限もそれぞれ異なる。攻撃間隔・移動速度は、直近の連合TLの流速
// (BulletSpawner.getStreamIntensity)でスケールし、「流速が高いほど難しい」
// という基本コンセプトをコアの攻撃にも反映させる。
import type { Bullet, Core, CoreTier, Laser } from "./entities.js";
import { createBulletId, createCoreId, createLaserId } from "./entities.js";
import {
  aimedBullet,
  aimedFanVelocities,
  circularBurst,
  concentricRingsVelocities,
  crossBurstVelocities,
  spiralArmVelocities,
  flowerBurstVelocities,
} from "./patterns.js";
import { getOrLoadEmojiImage } from "../render.js";
import { isCutInFlavorMode } from "../cutInSettings.js";

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
// 中: 地点間をなめらかに移動して静止を繰り返す・最大2体・弱よりHP高め・
//     螺旋/同心円弾幕
// 強: 中ボスと同じ移動だが画面中央寄りかつゆったり・最大1体・HPが一番高い・
//     攻撃も一番激しい
const TIER_CONFIG: Record<CoreTier, TierConfig> = {
  weak: { maxHp: 40, maxSimultaneous: 3, spriteSize: 44, hitRadius: 20, moves: true, spawnWeight: 60, attackIntervalMs: 1000, lifeUpDropChance: 0.5 },
  mid: { maxHp: 110, maxSimultaneous: 2, spriteSize: 60, hitRadius: 27, moves: true, spawnWeight: 35, attackIntervalMs: 800, lifeUpDropChance: 0.75 },
  strong: { maxHp: 200, maxSimultaneous: 1, spriteSize: 76, hitRadius: 34, moves: true, spawnWeight: 8, attackIntervalMs: 600, lifeUpDropChance: 1 },
};

// このショートコードはボスにせず通常弾のみとする(指定による除外)。
const BOSS_EXCLUDED_SHORTCODES = new Set(["ba_ibuki_facea"]);

// 強ボス専用「レーザー」の設定。予告→発射の2段階、発射中だけ当たり判定がある。
// 強ボスの通常攻撃間隔(500ms/流速)よりずっと長い一連の演出になるため、
// 乱発して見えないようクールダウンを別に設ける。
const LASER_TELEGRAPH_MS = 650;
const LASER_FIRE_MS = 550;
const LASER_WIDTH_PX = 28;
const LASER_LENGTH_PX = 2000;
const LASER_COOLDOWN_MS = 3500;

// 弱・中・強ボス共通の移動(東方のボスを参考に、地点間をなめらかに移動→
// 静止を繰り返す。単純な往復運動にはしない)。移動(グライド)自体は短く、
// 静止して攻撃する時間の方を長くする。階級ごとに緩急・移動範囲を変える
// (弱=近場をこまめに動く、中=画面全体を使って動く、強=中央寄りにゆったり)。
interface GlideTiming {
  glideMinMs: number;
  glideRandomMs: number;
  holdMinMs: number;
  holdRandomMs: number;
}
const WEAK_GLIDE: GlideTiming = { glideMinMs: 500, glideRandomMs: 300, holdMinMs: 400, holdRandomMs: 600 };
const MID_GLIDE: GlideTiming = { glideMinMs: 700, glideRandomMs: 400, holdMinMs: 1800, holdRandomMs: 1500 };
const STRONG_GLIDE: GlideTiming = { glideMinMs: 1000, glideRandomMs: 600, holdMinMs: 2500, holdRandomMs: 2000 };
const GLIDE_TIMING: Record<CoreTier, GlideTiming> = { weak: WEAK_GLIDE, mid: MID_GLIDE, strong: STRONG_GLIDE };

const BASE_SPAWN_INTERVAL_MS = 4000;
const MAX_RECENT_EMOJI_URLS = 20;
// 弱ボスが画面下へ流れていく速度(通常弾のstraightBullet等と同程度)。
const WEAK_DRIFT_SPEED_PX_PER_SEC = 28;
// 弱ボスの近場ウェーブ(現在地からどれだけ離れた場所へ移動先を選ぶか)。
const WEAK_WANDER_RANGE_PX = 160;
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
  noteUrl: string;
  cutInText: string | null;
}

export class CoreManager {
  cores: Core[] = [];
  lasers: Laser[] = [];
  private recentEmojis: RecentEmoji[] = [];
  private nextSpawnAt = 0;
  // 強ボスは常に最大1体なので、コアごとではなくCoreManager全体で1本管理する。
  private nextLaserAt = 0;

  // コアの攻撃弾の死因表示にショートコードをそのまま使えるよう、URLだけでなく
  // ショートコードも合わせて記録しておく。
  registerEmoji(shortcode: string, url: string, noteUrl: string, cutInText: string | null): void {
    if (BOSS_EXCLUDED_SHORTCODES.has(shortcode)) return;
    this.recentEmojis.push({ shortcode, url, noteUrl, cutInText });
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
    this.updateLasers(now);

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
      noteUrl: core.noteUrl,
    });
  }

  private trySpawn(now: number, canvasWidth: number, listeners: CoreManagerListeners): void {
    if (now < this.nextSpawnAt) return;
    if (this.recentEmojis.length === 0) return;

    // カットインを「投稿本文由来のみ」にするモード(設定のチェックボックスOFF、
    // isCutInFlavorMode()===false)では、直近に使える本文(cutInText)を持つ
    // 投稿が1件も無ければ、中ボス・強ボスにはなれない(弱ボスはカットイン
    // 自体が無いので対象外、main.ts: enqueueCutIn参照)。フレーバーテキスト
    // モード(===true)ではカットインは常にflavor.tsのランダム文言になる
    // ため、この制限自体が不要(従来通り無制限)。
    const flavorMode = isCutInFlavorMode();
    const hasCutInTextCandidate = this.recentEmojis.some((e) => e.cutInText);

    // 強ボスは、中ボスが既にいる間は新たに出現させない(強ボスの激しい弾幕と
    // 中ボスの弾幕が重なると理不尽になりやすいため)。逆(強ボスがいる状態で
    // 中ボスが新たに出現すること)は許容する。
    const eligibleTiers = (Object.keys(TIER_CONFIG) as CoreTier[]).filter((tier) => {
      if (this.countByTier(tier) >= TIER_CONFIG[tier].maxSimultaneous) return false;
      if (tier === "strong" && this.countByTier("mid") > 0) return false;
      if (!flavorMode && tier !== "weak" && !hasCutInTextCandidate) return false;
      return true;
    });
    if (eligibleTiers.length === 0) {
      this.nextSpawnAt = now + 1000; // 全枠埋まっている間は少し待って再チェック
      return;
    }

    const tier = pickWeighted(eligibleTiers, (t) => TIER_CONFIG[t].spawnWeight);
    const cfg = TIER_CONFIG[tier];
    // カットインの絵文字と引用文は、必ず同じ投稿由来のものにする(見た目と
    // 引用文の出所がズレるとコンセプト的におかしいため)。中ボス・強ボスで
    // 投稿本文由来モードの場合は、直近の中から使える本文を持つ最新の
    // エントリをさかのぼって探す(eligibleTiersの絞り込みで存在は保証済み)。
    // それ以外(弱ボス、またはフレーバーテキストモード)は従来通り単純に
    // 最新のエントリを使う。
    const picked =
      !flavorMode && tier !== "weak"
        ? this.findRecentEmojiWithCutInText()!
        : this.recentEmojis[this.recentEmojis.length - 1];
    const { shortcode, url, noteUrl, cutInText } = picked;

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
      spawnedAt: now,
      nextAttackAt: now + cfg.attackIntervalMs,
      attackAngle: 0,
      frozenForPattern: false,
      // 地点間をなめらかに移動する挙動用の状態。出現直後はその場で少し
      // 静止させてから最初の移動を始める。
      moveTargetX: x,
      moveGlideFromX: x,
      moveGlideStartedAt: now,
      moveGlideDurationMs: 0,
      nextRetargetAt: now + GLIDE_TIMING[tier].holdMinMs + Math.random() * GLIDE_TIMING[tier].holdRandomMs,
      noteUrl,
      cutInText,
    };
    this.cores.push(core);
    listeners.onCoreSpawned?.(core);

    this.nextSpawnAt = now + BASE_SPAWN_INTERVAL_MS + Math.random() * BASE_SPAWN_INTERVAL_MS;
  }

  private countByTier(tier: CoreTier): number {
    return this.cores.filter((c) => c.tier === tier).length;
  }

  // recentEmojisを新しい方からさかのぼり、最初に見つかったcutInText付きの
  // エントリを返す(trySpawn参照)。呼び出し側でhasCutInTextCandidateにより
  // 存在が保証されている場合にのみ呼ぶ。
  private findRecentEmojiWithCutInText(): RecentEmoji | undefined {
    for (let i = this.recentEmojis.length - 1; i >= 0; i--) {
      if (this.recentEmojis[i].cutInText) return this.recentEmojis[i];
    }
    return undefined;
  }

  // 弱・中・強のいずれも「ある地点までなめらかに移動→そこで静止して攻撃→
  // また別の地点へ移動」を繰り返す(東方のボスを参考にした挙動、単純な
  // 往復運動にはしない)。螺旋(spiral)のように複数ティックにまたがって
  // 発生点の一貫性が必要なパターンを撃っている間は、frozenForPatternで
  // 移動自体を止める(動きながら撃つと渦の形が歪んで汚くなるため)。単発の
  // 同心円・扇・十字・自機狙いは動きながらでも模様が崩れないので気にしない。
  private updateMovement(core: Core, dtSec: number, now: number, canvasWidth: number): void {
    const cfg = TIER_CONFIG[core.tier];
    if (!cfg.moves) return;

    if (!core.frozenForPattern) {
      this.updateGlide(core, now, GLIDE_TIMING[core.tier], () => this.pickMoveTargetX(core, canvasWidth));
    }

    if (core.tier === "weak") {
      // 縦方向だけは他の階級と違い、通常弾と同じく画面下へ流れ続ける。
      core.y += WEAK_DRIFT_SPEED_PX_PER_SEC * dtSec;
    }
  }

  // 移動先のx座標の選び方は階級ごとに変える(弱=現在地から近場、
  // 中=画面全体、強=画面中央寄り)。
  private pickMoveTargetX(core: Core, canvasWidth: number): number {
    if (core.tier === "weak") {
      const raw = core.x + (Math.random() - 0.5) * WEAK_WANDER_RANGE_PX;
      return Math.min(Math.max(raw, 40), canvasWidth - 40);
    }
    if (core.tier === "strong") {
      return canvasWidth * (0.35 + Math.random() * 0.3);
    }
    return canvasWidth * (0.2 + Math.random() * 0.6);
  }

  private updateGlide(core: Core, now: number, timing: GlideTiming, pickTargetX: () => number): void {
    if (now >= core.nextRetargetAt) {
      core.moveGlideFromX = core.x;
      core.moveTargetX = pickTargetX();
      core.moveGlideStartedAt = now;
      core.moveGlideDurationMs = timing.glideMinMs + Math.random() * timing.glideRandomMs;
      core.nextRetargetAt =
        now + core.moveGlideDurationMs + timing.holdMinMs + Math.random() * timing.holdRandomMs;
    }
    const t = Math.min(1, (now - core.moveGlideStartedAt) / core.moveGlideDurationMs);
    core.x = core.moveGlideFromX + (core.moveTargetX - core.moveGlideFromX) * easeOutCubic(t);
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
      // 東方を参考に、螺旋・同心円・自機狙いの扇・十字(風車)・花びら(バラ曲線)・
      // 輪の切れ目(壁の隙間を抜けさせる)をランダムに織り交ぜる。強ボスよりも
      // 1回あたりの弾数を絞って密度を抑える。
      core.attackAngle += (10 * Math.PI) / 180;
      const pattern = pickWeighted(
        ["spiral", "rings", "fan", "cross", "flower", "ringGap"] as const,
        (p) => ({ spiral: 20, rings: 15, fan: 20, cross: 15, flower: 15, ringGap: 15 })[p],
      );
      // 渦を巻く螺旋の間だけ移動を止め、それ以外に切り替わったら再び動かす
      // (updateMovement参照)。
      core.frozenForPattern = pattern === "spiral";
      if (pattern === "spiral") {
        velocities = spiralArmVelocities(3, core.attackAngle);
      } else if (pattern === "rings") {
        velocities = concentricRingsVelocities(2, 6);
      } else if (pattern === "fan") {
        velocities = aimedFanVelocities(3, Math.PI / 4, core.x, core.y, playerX, playerY);
      } else if (pattern === "cross") {
        velocities = crossBurstVelocities(core.attackAngle);
      } else if (pattern === "flower") {
        velocities = flowerBurstVelocities(24, 5, 90, 50, core.attackAngle);
      } else {
        // 自機方向を中心に、ほぼ一周(隙間だけ残す)広がる壁。隙間を通り抜けさせる。
        velocities = aimedFanVelocities(14, Math.PI * 1.6, core.x, core.y, playerX, playerY);
      }
    } else {
      // 強ボス: 中ボスと同じ引き出し(螺旋・同心円+放射・自機狙いの広い扇・
      // 二重十字・花びら・輪の切れ目)に加え、逆回転の二重螺旋・強ボス専用の
      // 「レーザー」をクールダウン付きで織り交ぜる、最も激しい攻撃。
      core.attackAngle += (16 * Math.PI) / 180;
      type StrongPattern =
        | "spiral"
        | "ringsBurst"
        | "fan"
        | "doubleCross"
        | "flower"
        | "dualSpiral"
        | "ringGap"
        | "laser";
      const weights: Record<StrongPattern, number> = {
        spiral: 20,
        ringsBurst: 14,
        fan: 14,
        doubleCross: 10,
        flower: 12,
        dualSpiral: 8,
        ringGap: 6,
        laser: 16,
      };
      const candidates: StrongPattern[] = [
        "spiral",
        "ringsBurst",
        "fan",
        "doubleCross",
        "flower",
        "dualSpiral",
        "ringGap",
      ];
      if (now >= this.nextLaserAt) candidates.push("laser");
      const pattern = pickWeighted(candidates, (p) => weights[p]);
      // 螺旋・二重螺旋・レーザーの間だけ移動を止める(いずれも複数ティックに
      // またがって発生点の一貫性が必要、またはレーザーのように狙いを定めてから
      // 撃つ性質上、本体が動いていると不自然なため)。
      core.frozenForPattern = pattern === "spiral" || pattern === "dualSpiral" || pattern === "laser";

      if (pattern === "laser") {
        this.spawnLaser(core, now, playerX, playerY);
        return;
      }

      if (pattern === "spiral") {
        velocities = spiralArmVelocities(5, core.attackAngle);
      } else if (pattern === "dualSpiral") {
        // 同じ角度を逆向きにも使うことで、互い違いに回る二重螺旋(二重らせん)にする。
        velocities = [
          ...spiralArmVelocities(3, core.attackAngle),
          ...spiralArmVelocities(3, -core.attackAngle),
        ];
      } else if (pattern === "ringsBurst") {
        velocities = [...concentricRingsVelocities(2, 12), ...circularBurst(8, core.attackAngle)];
      } else if (pattern === "fan") {
        velocities = aimedFanVelocities(5, Math.PI / 2.5, core.x, core.y, playerX, playerY);
      } else if (pattern === "flower") {
        velocities = flowerBurstVelocities(32, 6, 100, 60, core.attackAngle);
      } else if (pattern === "ringGap") {
        velocities = aimedFanVelocities(20, Math.PI * 1.75, core.x, core.y, playerX, playerY);
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
        noteUrl: core.noteUrl,
      });
    }
  }

  // 予告開始の瞬間の自機位置へ狙いを固定する(以後は自機が動いても追尾しない、
  // 「狙いを見て避ける」東方のレーザー攻撃と同じ緊張感を出すため)。
  private spawnLaser(core: Core, now: number, playerX: number, playerY: number): void {
    const angle = Math.atan2(playerY - core.y, playerX - core.x);
    this.lasers.push({
      id: createLaserId(),
      originX: core.x,
      originY: core.y,
      angle,
      length: LASER_LENGTH_PX,
      width: LASER_WIDTH_PX,
      state: "telegraph",
      stateEndsAt: now + LASER_TELEGRAPH_MS,
      shortcode: core.shortcode,
      img: core.img,
      noteUrl: core.noteUrl,
    });
    this.nextLaserAt = now + LASER_COOLDOWN_MS;
  }

  private updateLasers(now: number): void {
    for (const laser of this.lasers) {
      if (laser.state === "telegraph" && now >= laser.stateEndsAt) {
        laser.state = "firing";
        laser.stateEndsAt = now + LASER_FIRE_MS;
      }
    }
    this.lasers = this.lasers.filter((l) => l.state !== "firing" || now < l.stateEndsAt);
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

// 中ボスの移動を「勢いよく飛び出して、目的地手前でなめらかに減速して止まる」
// ような自然な動きにするための緩急(東方のボスの滑るような移動を意識)。
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
