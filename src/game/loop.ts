// ゲーム本体の状態(自機・弾・コア・残機・スコア)と、1フレーム分の更新処理。
// 当たり判定は自機/コア中心の小さな円と弾中心の小さな円の距離判定のみ。
//
// - Misskeyの投稿由来の「通常弾」は画面上端から常時降ってくる(コアの有無に
//   関わらず、連合TLの流速がそのまま難易度になるようにする)。
// - 「コア」という敵(東方のボスに相当)が出現し、独自の弾幕を放つ。
//   弱/中/強の3段階があり、弱=複数体・移動・単調、中=固定・螺旋/同心円、
//   強=移動・最も激しい、という差をつけている(coreManager.ts参照)。
// - 一部の通常弾は「残機回復弾」(捕まえると残機+1、上限あり)。
import type { EmojiOccurrence } from "../noteEmoji.js";
import type { InputController } from "../input.js";
import type { Bullet, Core, Laser, Player, PlayerBullet } from "./entities.js";
import { createBulletId } from "./entities.js";
import { BulletSpawner } from "./spawner.js";
import { CoreManager } from "./coreManager.js";
import { updateBullet } from "./bulletMotion.js";

export const INITIAL_LIFE = 6;
const SCORE_PER_SECOND = 100;
// 被弾直後、この時間は無敵にする(同時多発的な多重被弾で瞬時に残機を失うのを防ぐ、
// 東方含む弾幕STGの定石)。
const INVINCIBLE_MS = 1500;
// 画面外に十分出た弾は削除する(このマージンより内側に戻ってくることはない前提)。
const CULL_MARGIN_PX = 60;

const PLAYER_BULLET_SPEED = 420;
const PLAYER_BULLET_RADIUS = 4;
const PLAYER_BULLET_DAMAGE = 1;
// 自機弾の連射間隔(東方のZキー連射相当)。
const PLAYER_FIRE_INTERVAL_MS = 120

// 4連ガトリング
const PLAYER_SHOT_OFFSETS_PX = [-21, -7, 7, 21];
// 3連ガトリング
// const PLAYER_SHOT_OFFSETS_PX = [-14, 0, 14];
// 2連ガトリング
// const PLAYER_SHOT_OFFSETS_PX = [-8, 8];

// GRAZE(ニアミス)判定。実際の当たり判定(hitRadius同士の合計)より一回り
// 広い距離まで弾が近づいた瞬間を「かすった」とみなす。実際に当たった弾は
// updateEnemyBullets→当たり判定の順で既にbulletsから除去済みのため、
// 二重に加点されることはない。
const GRAZE_MARGIN_PX = 13;
const GRAZE_SCORE_BONUS = 10;
// 残機が満タンの状態で残機回復弾を拾った場合、回復の代わりに加点する
// (満タン時はただ無駄になるだけなので)。
const LIFE_UP_OVERFLOW_SCORE_BONUS = 50;
// コア(ボス)撃破時の加点。階級が高いほど大きく加点する。
const CORE_DEFEAT_SCORE_BONUS: Record<Core["tier"], number> = {
  weak: 200,
  mid: 500,
  strong: 1500,
};

export interface GameOverInfo {
  score: number;
  survivedMs: number;
  causeShortcode: string | null;
  causeImg: HTMLImageElement | null;
  // 撃墜した弾/レーザーの出所ノートへの永続リンク(結果画面の
  // 「あなたを撃墜したノートを見る」ボタン用、main.ts参照)。取れない場合はnull。
  causeNoteUrl: string | null;
  grazeCount: number;
}

export interface GameEventListeners {
  onLifeChange?: (life: number) => void;
  onScoreChange?: (score: number) => void;
  onGameOver?: (info: GameOverInfo) => void;
  onCoreDefeated?: (core: Core) => void;
  onCoreSpawned?: (core: Core) => void;
  onLifeUp?: () => void;
  onGrazeChange?: (count: number) => void;
  onPlayerShoot?: () => void;
  // ボス撃破・満タン時の残機回復弾など、まとまった加点が入った瞬間に通知する
  // (GRAZEの細かい加点はここには含めない、main.ts側の演出用)。
  onScoreBonus?: (amount: number) => void;
}

export class GameState {
  readonly player: Player;
  bullets: Bullet[] = [];
  playerBullets: PlayerBullet[] = [];
  life = INITIAL_LIFE;
  score = 0;
  gameOver = false;
  grazeCount = 0;
  // GRAZE・満タン時の残機回復弾・コア撃破など、経過時間以外での加点をまとめて積む。
  private bonusScore = 0;
  private causeShortcode: string | null = null;
  private causeImg: HTMLImageElement | null = null;
  private causeNoteUrl: string | null = null;
  private readonly startedAt: number;
  private readonly spawner = new BulletSpawner();
  private readonly coreManager = new CoreManager();
  private nextPlayerShotAt = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly listeners: GameEventListeners,
    now: number,
    playerEmojiImg: HTMLImageElement | null,
  ) {
    this.startedAt = now;
    this.player = {
      x: canvas.width / 2,
      y: canvas.height * 0.75,
      spriteSize: 36,
      hitRadius: 5,
      emojiImg: playerEmojiImg,
      invincibleUntil: 0,
      focused: false,
    };
  }

  get cores(): readonly Core[] {
    return this.coreManager.cores;
  }

  get lasers(): readonly Laser[] {
    return this.coreManager.lasers;
  }

  handleEmojiOccurrences(occurrences: EmojiOccurrence[], now: number): void {
    if (this.gameOver || occurrences.length === 0) return;

    const ctx = {
      now,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      playerX: this.player.x,
      playerY: this.player.y,
    };
    for (const occurrence of occurrences) {
      this.coreManager.registerEmoji(
        occurrence.shortcode,
        occurrence.url,
        occurrence.noteUrl,
        occurrence.cutInText,
        occurrence.cutInEmojis,
      );
      this.spawner.trySpawnFromOccurrence(occurrence, ctx, this.bullets);
    }
  }

  update(dtSec: number, now: number, input: InputController): void {
    if (this.gameOver) return;

    input.update(this.player, dtSec);
    this.updatePlayerShooting(now, dtSec, input);
    this.updateEnemyBullets(dtSec, now);

    const intensity = this.spawner.getStreamIntensity(now);
    this.coreManager.update(
      dtSec,
      now,
      this.canvas.width,
      this.canvas.height,
      intensity,
      this.player.x,
      this.player.y,
      this.bullets,
      {
        onCoreDefeated: (core) => {
          const bonus = CORE_DEFEAT_SCORE_BONUS[core.tier];
          this.bonusScore += bonus;
          this.listeners.onScoreBonus?.(bonus);
          this.listeners.onCoreDefeated?.(core);
        },
        onCoreSpawned: (core) => this.listeners.onCoreSpawned?.(core),
      },
    );
    this.handlePlayerBulletsVsCores();

    // 残機回復弾は無敵時間中でも拾える(無敵は被弾を防ぐためのものであって、
    // 回復のチャンスまで奪う必要はない)。ダメージ弾のみ無敵中は判定しない。
    const lifeUpIndex = this.bullets.findIndex((b) => b.isLifeUp && this.collidesWithPlayer(b));
    if (lifeUpIndex !== -1) this.handlePlayerHit(this.bullets[lifeUpIndex], now);

    if (now >= this.player.invincibleUntil) {
      const hitIndex = this.bullets.findIndex((b) => !b.isLifeUp && this.collidesWithPlayer(b));
      if (hitIndex !== -1) this.handlePlayerHit(this.bullets[hitIndex], now);
    }

    // レーザーは発射中(firing)のみ当たり判定がある。上のhandlePlayerHitが
    // 無敵時間をセットしていれば、この時点でinvincibleUntilは既に未来の
    // 時刻になっているため、同じフレームで弾とレーザーの二重被弾にはならない。
    if (now >= this.player.invincibleUntil) {
      const hitLaser = this.coreManager.lasers.find(
        (l) => l.state === "firing" && this.collidesWithLaser(l),
      );
      if (hitLaser) this.handleLaserHit(hitLaser, now);
    }

    // 実際に当たった弾は上のhandlePlayerHitで既にbulletsから除去済みなので、
    // ここに残っている弾だけを対象にGRAZE判定を行える。
    this.updateGraze();

    this.score = Math.floor(((now - this.startedAt) / 1000) * SCORE_PER_SECOND) + this.bonusScore;
    this.listeners.onScoreChange?.(this.score);
  }

  survivedMs(now: number): number {
    return now - this.startedAt;
  }

  // ストリームの流速が弾生成の上限を超えている(警告表示向け)かどうか。
  isStreamOverflowing(now: number): boolean {
    return this.spawner.isOverflowing(now);
  }

  private updatePlayerShooting(now: number, dtSec: number, input: InputController): void {
    if (input.isFiring() && now >= this.nextPlayerShotAt) {
      this.nextPlayerShotAt = now + PLAYER_FIRE_INTERVAL_MS;
      for (const offsetX of PLAYER_SHOT_OFFSETS_PX) {
        this.playerBullets.push({
          id: createBulletId(),
          x: this.player.x + offsetX,
          y: this.player.y - this.player.spriteSize / 2,
          vy: -PLAYER_BULLET_SPEED,
        });
      }
      this.listeners.onPlayerShoot?.();
    }

    for (const b of this.playerBullets) b.y += b.vy * dtSec;
    this.playerBullets = this.playerBullets.filter((b) => b.y > -CULL_MARGIN_PX);
  }

  private updateEnemyBullets(dtSec: number, now: number): void {
    const spawned: Bullet[] = [];
    for (const b of this.bullets) {
      updateBullet(b, dtSec, now, this.player.x, this.player.y, spawned);
    }
    if (spawned.length > 0) this.bullets.push(...spawned);
    this.bullets = this.bullets.filter((b) => !b.dead && this.isWithinCullBounds(b));
  }

  private handlePlayerBulletsVsCores(): void {
    if (this.coreManager.cores.length === 0) return;
    this.playerBullets = this.playerBullets.filter((pb) => {
      for (const core of this.coreManager.cores) {
        const dx = pb.x - core.x;
        const dy = pb.y - core.y;
        const rSum = PLAYER_BULLET_RADIUS + core.hitRadius;
        if (dx * dx + dy * dy <= rSum * rSum) {
          core.hp -= PLAYER_BULLET_DAMAGE;
          return false; // この自機弾は消費された
        }
      }
      return true;
    });
  }

  private isWithinCullBounds(b: Bullet): boolean {
    return (
      b.x > -CULL_MARGIN_PX &&
      b.x < this.canvas.width + CULL_MARGIN_PX &&
      b.y > -CULL_MARGIN_PX &&
      b.y < this.canvas.height + CULL_MARGIN_PX
    );
  }

  private collidesWithPlayer(b: Bullet): boolean {
    const dx = b.x - this.player.x;
    const dy = b.y - this.player.y;
    const rSum = b.hitRadius + this.player.hitRadius;
    return dx * dx + dy * dy <= rSum * rSum;
  }

  // 自機からビームの直線(originから角度方向、長さlength)への最短距離の
  // 2乗を返す(原点より手前・終点より先には広がらないよう、射影をその
  // 範囲にclampする)。当たり判定・GRAZE判定の両方から使う共通計算。
  private laserDistanceSquared(laser: Laser): number {
    const dirX = Math.cos(laser.angle);
    const dirY = Math.sin(laser.angle);
    const relX = this.player.x - laser.originX;
    const relY = this.player.y - laser.originY;
    const t = Math.max(0, Math.min(laser.length, relX * dirX + relY * dirY));
    const closestX = laser.originX + dirX * t;
    const closestY = laser.originY + dirY * t;
    const dx = this.player.x - closestX;
    const dy = this.player.y - closestY;
    return dx * dx + dy * dy;
  }

  private collidesWithLaser(laser: Laser): boolean {
    const rSum = laser.width / 2 + this.player.hitRadius;
    return this.laserDistanceSquared(laser) <= rSum * rSum;
  }

  private updateGraze(): void {
    for (const b of this.bullets) {
      if (b.isLifeUp || b.grazed) continue;
      const dx = b.x - this.player.x;
      const dy = b.y - this.player.y;
      const rSum = b.hitRadius + this.player.hitRadius + GRAZE_MARGIN_PX;
      if (dx * dx + dy * dy > rSum * rSum) continue;
      b.grazed = true;
      this.countGraze();
    }

    // レーザーも東方と同じくGRAZE対象。発射中(firing)の実体だけを対象にし
    // (予告中は当たり判定自体が無いのでGRAZEもしない)、同じ発射中は
    // 1回だけカウントする。
    for (const l of this.coreManager.lasers) {
      if (l.state !== "firing" || l.grazed) continue;
      const rSum = l.width / 2 + this.player.hitRadius + GRAZE_MARGIN_PX;
      if (this.laserDistanceSquared(l) > rSum * rSum) continue;
      l.grazed = true;
      this.countGraze();
    }
  }

  private countGraze(): void {
    this.grazeCount += 1;
    this.bonusScore += GRAZE_SCORE_BONUS;
    this.listeners.onGrazeChange?.(this.grazeCount);
  }

  private handlePlayerHit(bullet: Bullet, now: number): void {
    this.bullets = this.bullets.filter((b) => b.id !== bullet.id);

    if (bullet.isLifeUp) {
      if (this.life < INITIAL_LIFE) {
        this.life += 1;
        this.listeners.onLifeChange?.(this.life);
      } else {
        // 残機が満タンなら回復しても無駄になるだけなので、代わりに加点する。
        this.bonusScore += LIFE_UP_OVERFLOW_SCORE_BONUS;
        this.listeners.onScoreBonus?.(LIFE_UP_OVERFLOW_SCORE_BONUS);
      }
      this.listeners.onLifeUp?.();
      return;
    }

    this.applyDamage(bullet.shortcode, bullet.img, bullet.noteUrl, now);
  }

  // レーザーは弾のように配列から取り除く対象が無い(発射が終わるまで
  // 存在し続ける)以外はダメージ弾と同じ扱いにする。
  private handleLaserHit(laser: Laser, now: number): void {
    this.applyDamage(laser.shortcode, laser.img, laser.noteUrl, now);
  }

  private applyDamage(
    shortcode: string,
    img: HTMLImageElement,
    noteUrl: string | null,
    now: number,
  ): void {
    this.life -= 1;
    this.causeShortcode = shortcode || "不明";
    this.causeImg = img;
    this.causeNoteUrl = noteUrl;
    this.player.invincibleUntil = now + INVINCIBLE_MS;
    this.listeners.onLifeChange?.(this.life);

    if (this.life <= 0) {
      this.gameOver = true;
      this.listeners.onGameOver?.({
        score: this.score,
        survivedMs: this.survivedMs(now),
        causeShortcode: this.causeShortcode,
        causeImg: this.causeImg,
        causeNoteUrl: this.causeNoteUrl,
        grazeCount: this.grazeCount,
      });
    }
  }
}
