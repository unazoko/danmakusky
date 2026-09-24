// Misskeyの投稿流を弾幕として放つ「コア」(東方のボス役)の管理。
// コアには3段階の強さ(弱/中/強)があり、出現頻度は弱>中>強、同時出現数の
// 上限もそれぞれ異なる。攻撃間隔・出現間隔は、直近の連合TLの流速
// (BulletSpawner.getStreamIntensity)に加えてプレイ時間経過による倍率
// (loop.ts: getTimeDifficultyMultiplier、5分以降で段階的に上昇)も掛けた
// intensityでスケールし、「流速・プレイ時間が高いほど難しい」という
// 基本コンセプトをコアの攻撃にも反映させる。攻撃弾の弾速も、プレイ時間
// 経過のみに基づく倍率(bulletSpeedMultiplier、intensityと違い流速は
// 含まない)でスケールする。
import type { Bullet, BulletBehavior, Core, CoreTier, Laser } from "./entities.js";
import { createBulletId, createCoreId, createLaserId } from "./entities.js";
import {
  aimedBullet,
  aimedFanVelocities,
  arcVelocities,
  circularBurst,
  concentricRingsVelocities,
  convergingRingVelocities,
  crossBurstVelocities,
  spiralArmVelocities,
  flowerBurstVelocities,
  randomSpeed,
  type Velocity,
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
  mid: { maxHp: 140, maxSimultaneous: 2, spriteSize: 60, hitRadius: 27, moves: true, spawnWeight: 35, attackIntervalMs: 800, lifeUpDropChance: 0.75 },
  strong: { maxHp: 260, maxSimultaneous: 1, spriteSize: 76, hitRadius: 34, moves: true, spawnWeight: 15, attackIntervalMs: 580, lifeUpDropChance: 1 },
};

// このショートコードはボスにせず通常弾のみとする(指定による除外)。
const BOSS_EXCLUDED_SHORTCODES = new Set(["ba_ibuki_facea"]);

// 強ボス専用「レーザー」の設定。予告→発射の2段階、発射中だけ当たり判定がある。
// 強ボスの通常攻撃間隔(500ms/流速)よりずっと長い一連の演出になるため、
// 乱発して見えないようクールダウンを別に設ける。
const LASER_TELEGRAPH_MS = 650;
const LASER_FIRE_MS = 1000;
const LASER_WIDTH_PX = 28;
const LASER_LENGTH_PX = 2000;
const LASER_COOLDOWN_MS = 3500;
// 強ボスのレーザーは、撃つたびに1本か2本かをランダムに決める。2本のときは
// 自機方向を中心に左右へ少しずつ角度をずらし、完全に重なって見えないようにする。
const DOUBLE_LASER_CHANCE = 0.5;
const DOUBLE_LASER_ANGLE_OFFSET_RAD = (12 * Math.PI) / 180;
// プレイ時間が一定時間を超えたら、発射中(firing)のレーザーが回転して振れる
// ようにする。2本同時のときは、常に外側へ逃げるのではなく各本独立に
// 回転方向をランダムに決める(そうしないと必ず開いていくだけで避けやすい
// ため)。その代わり、互いに近づく組み合わせを引いた場合でも2本が成す角度が
// MIN_LASER_ANGLE_GAP_RADより狭くなったり交差したりしないよう、
// そこに達する時刻で両方とも回転を止める(angleFreezeAt、下記参照)。
const LASER_SWEEP_UNLOCK_MS = 1.5 * 60 * 1000;
const LASER_SWEEP_SPEED_RAD_PER_SEC = (15 * Math.PI) / 180;
const MIN_LASER_ANGLE_GAP_RAD = (14 * Math.PI) / 180;

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

// 中・強ボス撃破時の残機回復弾: 出現から一定時間はそのまま(ゆっくり)
// 落下し、その後は自機を素早く追いかけるようにする(弱ボスはそもそも
// 出さない、TIER_CONFIG.weak.lifeUpDropChance参照)。
const LIFEUP_HOMING_DELAY_MS = 1000;
const LIFEUP_HOMING_SPEED = 260;
const LIFEUP_HOMING_TURN_RATE_RAD_PER_SEC = Math.PI * 4;

// 中ボスは倒し切れなくても一定時間で自動消滅する(撃破扱いにはしない、報酬もなし)。
// 消える直前はフワッとフェードアウトさせる(render.ts参照)。
const MID_LIFESPAN_MS = 22000;
const MID_FADE_MS = 300;

// 開始直後20秒間は強ボスを出現させない。また、開始1分経過時点で
// まだ一度も強ボスが出現していなければ、その時点(または既存の「強ボスが
// 出現できない状況」が解除された直後)に強制的に出現させる(trySpawn参照)。
const STRONG_MIN_SPAWN_MS = 20000;
const STRONG_GUARANTEE_MS = 60000;

const BASE_SPAWN_INTERVAL_MS = 4000;
// intensityが大きくなっても攻撃間隔が0に近づいて理不尽にならないよう設ける下限。
const MIN_ATTACK_INTERVAL_MS = 150;
const MAX_RECENT_EMOJI_URLS = 20;
// 弱ボスが画面下へ流れていく速度(通常弾のstraightBullet等と同程度)。
const WEAK_DRIFT_SPEED_PX_PER_SEC = 45;
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
  cutInEmojis: Record<string, string> | undefined;
}

export class CoreManager {
  cores: Core[] = [];
  lasers: Laser[] = [];
  private recentEmojis: RecentEmoji[] = [];
  private nextSpawnAt = 0;
  // 強ボスは常に最大1体なので、コアごとではなくCoreManager全体で1本管理する。
  private nextLaserAt = 0;
  // このラウンドで強ボスが一度でも出現したか(STRONG_GUARANTEE_MSの保証用)。
  private hasStrongSpawned = false;

  // コアの攻撃弾の死因表示にショートコードをそのまま使えるよう、URLだけでなく
  // ショートコードも合わせて記録しておく。
  registerEmoji(
    shortcode: string,
    url: string,
    noteUrl: string,
    cutInText: string | null,
    cutInEmojis: Record<string, string> | undefined,
  ): void {
    if (BOSS_EXCLUDED_SHORTCODES.has(shortcode)) return;
    this.recentEmojis.push({ shortcode, url, noteUrl, cutInText, cutInEmojis });
    if (this.recentEmojis.length > MAX_RECENT_EMOJI_URLS) this.recentEmojis.shift();
  }

  update(
    dtSec: number,
    now: number,
    canvasWidth: number,
    canvasHeight: number,
    intensity: number,
    bulletSpeedMultiplier: number,
    survivedMs: number,
    playerX: number,
    playerY: number,
    bullets: Bullet[],
    suppressSpawn: boolean,
    listeners: CoreManagerListeners,
  ): void {
    this.trySpawn(now, canvasWidth, intensity, survivedMs, suppressSpawn, listeners);
    this.updateLasers(dtSec, now);

    for (const core of this.cores) {
      this.updateMovement(core, dtSec, now, canvasWidth);
      this.updateAttack(core, now, intensity, bulletSpeedMultiplier, survivedMs, playerX, playerY, bullets);
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

    // 中ボスは一定時間で自動消滅する(倒し切れなくても、撃破扱い・報酬なしで
    // 静かに消える。フェードアウトの見た目はrender.ts側で処理する)。
    this.cores = this.cores.filter((c) => c.expiresAt === undefined || now < c.expiresAt);
  }

  // ボスを倒すと、階級に応じた確率でその場に残機回復弾を1つ落とす
  // (弱=0%、中=50%、強=100%)。
  private dropLifeUpItem(core: Core, now: number, bullets: Bullet[]): void {
    if (Math.random() >= TIER_CONFIG[core.tier].lifeUpDropChance) return;
    // 強ボスの回復弾のみ、一定時間そのまま落下させた後、自機が静止している
    // 間だけ素早く追尾する(弱・中ボスの回復弾はどちらも追尾しない、単純な
    // 落下のまま)。自機が動いている間は追尾せず、直前の向きのまま通常弾と
    // 同じ速度(normalSpeed)で直進する(bulletMotion.ts参照)。
    const behavior: BulletBehavior =
      core.tier === "strong"
        ? {
            kind: "delayedHoming",
            triggerAt: now + LIFEUP_HOMING_DELAY_MS,
            speed: LIFEUP_HOMING_SPEED,
            turnRateRadPerSec: LIFEUP_HOMING_TURN_RATE_RAD_PER_SEC,
            triggered: false,
            normalSpeed: randomSpeed(),
          }
        : { kind: "linear" };
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
      behavior,
      isLifeUp: true,
      noteUrl: core.noteUrl,
      isBossBullet: true,
    });
  }

  private trySpawn(
    now: number,
    canvasWidth: number,
    intensity: number,
    survivedMs: number,
    suppressSpawn: boolean,
    listeners: CoreManagerListeners,
  ): void {
    // 「群れ」敵(swarmManager.ts)が出現中は、弱・中・強ボスの新規出現を
    // 止める(逆に、ボスが既にいる状態で群れ敵が出現するのは問題ない)。
    if (suppressSpawn) {
      this.nextSpawnAt = now + 1000;
      return;
    }
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

    // 開始STRONG_GUARANTEE_MS経過時点でまだ一度も強ボスが出現していなければ、
    // 強ボスが出現できるようになるまで他のボスの新規出現も止める(=強制的に
    // 強ボスを出現させるまでの「待ち」にする)。強ボス出現後は通常通り。
    const mustForceStrong = !this.hasStrongSpawned && survivedMs >= STRONG_GUARANTEE_MS;

    // 強ボスは、中ボスが既にいる間は新たに出現させない(強ボスの激しい弾幕と
    // 中ボスの弾幕が重なると理不尽になりやすいため)。逆(強ボスがいる状態で
    // 中ボスが新たに出現すること)は許容する。また、開始20秒間は強ボス自体を
    // 出現不可にする。
    const eligibleTiers = (Object.keys(TIER_CONFIG) as CoreTier[]).filter((tier) => {
      if (tier === "strong" && survivedMs < STRONG_MIN_SPAWN_MS) return false;
      if (this.countByTier(tier) >= TIER_CONFIG[tier].maxSimultaneous) return false;
      if (tier === "strong" && this.countByTier("mid") > 0) return false;
      if (!flavorMode && tier !== "weak" && !hasCutInTextCandidate) return false;
      // 強ボス保証待ちの間は、強ボス以外の新規出現を止める(その状況が
      // 解除されてeligibleTiersに"strong"が入ってくるまでは何も出現しない、
      // 次回以降のtrySpawnで再度この判定を試みる)。
      if (mustForceStrong && tier !== "strong") return false;
      return true;
    });
    if (eligibleTiers.length === 0) {
      this.nextSpawnAt = now + 1000; // 全枠埋まっている間は少し待って再チェック
      return;
    }

    const tier =
      mustForceStrong && eligibleTiers.includes("strong")
        ? "strong"
        : pickWeighted(eligibleTiers, (t) => TIER_CONFIG[t].spawnWeight);
    if (tier === "strong") this.hasStrongSpawned = true;
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
    const { shortcode, url, noteUrl, cutInText, cutInEmojis } = picked;

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
      cutInEmojis,
      expiresAt: tier === "mid" ? now + MID_LIFESPAN_MS : undefined,
      fadeOutStartsAt: tier === "mid" ? now + MID_LIFESPAN_MS - MID_FADE_MS : undefined,
    };
    this.cores.push(core);
    listeners.onCoreSpawned?.(core);

    // 流速・時間経過によるintensityが高いほど、ボスの出現間隔自体も短くする
    // (攻撃間隔の短縮と同じintensityをそのまま使い回す)。
    this.nextSpawnAt = now + (BASE_SPAWN_INTERVAL_MS + Math.random() * BASE_SPAWN_INTERVAL_MS) / intensity;
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
    bulletSpeedMultiplier: number,
    survivedMs: number,
    playerX: number,
    playerY: number,
    bullets: Bullet[],
  ): void {
    if (now < core.nextAttackAt) return;
    const cfg = TIER_CONFIG[core.tier];
    // 流速・時間経過が激しいほど攻撃間隔を短くする(=激しくなる)。ただし
    // intensityが非常に大きくなっても理不尽にならないよう下限を設ける。
    core.nextAttackAt = now + Math.max(MIN_ATTACK_INTERVAL_MS, cfg.attackIntervalMs / intensity);

    const img = core.img;
    let velocities: Velocity[];

    if (core.tier === "weak") {
      // 単調な攻撃: 自機狙いを1発だけ。
      velocities = [aimedBullet(core.x, core.y, playerX, playerY)];
    } else if (core.tier === "mid") {
      // 東方を参考に、螺旋・同心円(マンダラ状)・自機狙いの扇・十字(風車)・
      // 花びら(バラ曲線)・回転する隙間の壁・収束リングをランダムに織り交ぜる。
      // 強ボスよりも1回あたりの弾数を絞って密度を抑える。
      core.attackAngle += (10 * Math.PI) / 180;
      const pattern = pickWeighted(
        ["spiral", "rings", "fan", "cross", "flower", "ringGap", "converge"] as const,
        (p) =>
          ({ spiral: 20, rings: 15, fan: 20, cross: 15, flower: 15, ringGap: 15, converge: 15 })[p],
      );
      // 渦を巻く螺旋・収束リングの間だけ移動を止め、それ以外に切り替わったら
      // 再び動かす(updateMovement参照)。
      core.frozenForPattern = pattern === "spiral" || pattern === "converge";
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
      } else if (pattern === "ringGap") {
        // 自機位置ではなくattackAngleを中心にすることで、プレイヤーの動きに
        // 依存せず隙間そのものが回転し続ける「風車の壁」の見た目になる。
        velocities = arcVelocities(14, Math.PI * 1.6, core.attackAngle);
      } else {
        // 収束リング: コアを囲む輪が中心へ縮んでいく。
        velocities = convergingRingVelocities(10, core.attackAngle);
      }
    } else {
      // 強ボス: 中ボスと同じ引き出し(螺旋・同心円+放射・自機狙いの広い扇・
      // 二重十字・花びら・回転する隙間の壁・収束リング)に加え、逆回転の
      // 二重螺旋・強ボス専用の「レーザー」をクールダウン付きで織り交ぜる、
      // 最も激しい攻撃。
      core.attackAngle += (16 * Math.PI) / 180;
      type StrongPattern =
        | "spiral"
        | "ringsBurst"
        | "fan"
        | "doubleCross"
        | "flower"
        | "dualSpiral"
        | "ringGap"
        | "converge"
        | "laser";
      const weights: Record<StrongPattern, number> = {
        spiral: 20,
        ringsBurst: 14,
        fan: 14,
        doubleCross: 10,
        flower: 12,
        dualSpiral: 8,
        ringGap: 6,
        converge: 10,
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
        "converge",
      ];
      if (now >= this.nextLaserAt) candidates.push("laser");
      const pattern = pickWeighted(candidates, (p) => weights[p]);
      // 螺旋・二重螺旋・収束リング・レーザーの間だけ移動を止める(いずれも
      // 複数ティックにまたがって発生点の一貫性が必要、またはレーザーのように
      // 狙いを定めてから撃つ性質上、本体が動いていると不自然なため)。
      core.frozenForPattern =
        pattern === "spiral" || pattern === "dualSpiral" || pattern === "converge" || pattern === "laser";

      if (pattern === "laser") {
        // 1本か2本かをここでランダムに決める。
        const fireDouble = Math.random() < DOUBLE_LASER_CHANCE;
        // 3分経過後は発射中に回転して振れるようにする。
        const sweepEnabled = survivedMs >= LASER_SWEEP_UNLOCK_MS;
        if (fireDouble) {
          // 各本の回転方向は独立にランダムへ決める(常に外側へ開くだけだと
          // 避けやすすぎるため)。ただし互いに近づく組み合わせを引いた場合、
          // 2本が成す角度がMIN_LASER_ANGLE_GAP_RADへ達する時刻を計算し、
          // その時刻で両方とも回転を止める(交差・極端な接近を防ぐ)。
          const dirA = Math.random() < 0.5 ? -1 : 1;
          const dirB = Math.random() < 0.5 ? -1 : 1;
          let freezeAt: number | undefined;
          if (sweepEnabled) {
            const closureRadPerSec = (dirA - dirB) * LASER_SWEEP_SPEED_RAD_PER_SEC;
            if (closureRadPerSec > 0) {
              // dirA・dirBが互いに近づく向きの組み合わせ。
              const initialGapRad = DOUBLE_LASER_ANGLE_OFFSET_RAD * 2;
              const closableRad = Math.max(0, initialGapRad - MIN_LASER_ANGLE_GAP_RAD);
              freezeAt = now + (closableRad / closureRadPerSec) * 1000;
            }
          }
          this.spawnLaser(
            core,
            now,
            playerX,
            playerY,
            -DOUBLE_LASER_ANGLE_OFFSET_RAD,
            sweepEnabled ? dirA * LASER_SWEEP_SPEED_RAD_PER_SEC : 0,
            freezeAt,
          );
          this.spawnLaser(
            core,
            now,
            playerX,
            playerY,
            DOUBLE_LASER_ANGLE_OFFSET_RAD,
            sweepEnabled ? dirB * LASER_SWEEP_SPEED_RAD_PER_SEC : 0,
            freezeAt,
          );
        } else {
          const sweepDir = Math.random() < 0.5 ? -1 : 1;
          this.spawnLaser(
            core,
            now,
            playerX,
            playerY,
            0,
            sweepEnabled ? sweepDir * LASER_SWEEP_SPEED_RAD_PER_SEC : 0,
          );
        }
        this.nextLaserAt = now + LASER_COOLDOWN_MS;
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
        // 中ボスと同様、attackAngleを中心にして隙間そのものを回転させる。
        velocities = arcVelocities(20, Math.PI * 1.75, core.attackAngle);
      } else if (pattern === "converge") {
        // 中ボスより広い輪・多い弾数で、強ボスらしい迫力のある収束にする。
        velocities = convergingRingVelocities(16, core.attackAngle);
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
        x: core.x + (v.offsetX ?? 0),
        y: core.y + (v.offsetY ?? 0),
        // 時間経過による難易度上昇(loop.ts: getTimeDifficultyMultiplier)を
        // ボスの弾速にも反映する(5分まではbulletSpeedMultiplier=1倍で無変化)。
        vx: v.vx * bulletSpeedMultiplier,
        vy: v.vy * bulletSpeedMultiplier,
        size: 22,
        hitRadius: 7,
        spawnedAt: now,
        behavior: { kind: "linear" },
        noteUrl: core.noteUrl,
        isBossBullet: true,
      });
    }
  }

  // 予告開始の瞬間の自機位置へ狙いを固定する(以後は自機が動いても追尾しない、
  // 「狙いを見て避ける」東方のレーザー攻撃と同じ緊張感を出すため)。
  // angleOffsetRadは2本同時撃ちのときに左右へずらすためのもの(通常は0)。
  // angularVelocityRadPerSecは発射中(firing)の回転速度(3分未満は常に0)。
  // angleFreezeAtは、その時刻以降回転を止める上限(2本が近づきすぎるのを防ぐ)。
  private spawnLaser(
    core: Core,
    now: number,
    playerX: number,
    playerY: number,
    angleOffsetRad = 0,
    angularVelocityRadPerSec = 0,
    angleFreezeAt?: number,
  ): void {
    const angle = Math.atan2(playerY - core.y, playerX - core.x) + angleOffsetRad;
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
      angularVelocityRadPerSec,
      angleFreezeAt,
    });
  }

  private updateLasers(dtSec: number, now: number): void {
    for (const laser of this.lasers) {
      if (laser.state === "telegraph" && now >= laser.stateEndsAt) {
        laser.state = "firing";
        laser.stateEndsAt = now + LASER_FIRE_MS;
      } else if (
        laser.state === "firing" &&
        laser.angularVelocityRadPerSec &&
        (laser.angleFreezeAt === undefined || now < laser.angleFreezeAt)
      ) {
        laser.angle += laser.angularVelocityRadPerSec * dtSec;
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
