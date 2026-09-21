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
import type { Bullet, Core, Player, PlayerBullet } from "./entities.js";
import { createBulletId } from "./entities.js";
import { BulletSpawner } from "./spawner.js";
import { CoreManager } from "./coreManager.js";
import { updateBullet } from "./bulletMotion.js";

export const INITIAL_LIFE = 8;
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
const PLAYER_FIRE_INTERVAL_MS = 120;
// 横三連ガトリング。単発の狙い撃ちより面で当てやすくし、コアを早く倒せるように
// する(コアを早く倒せれば、その分弾幕が激しい時間も短くなる)。
const PLAYER_SHOT_OFFSETS_PX = [-14, 0, 14];

export interface GameOverInfo {
  score: number;
  survivedMs: number;
  causeShortcode: string | null;
  causeImg: HTMLImageElement | null;
}

export interface GameEventListeners {
  onLifeChange?: (life: number) => void;
  onScoreChange?: (score: number) => void;
  onGameOver?: (info: GameOverInfo) => void;
  onCoreDefeated?: (core: Core) => void;
  onCoreSpawned?: (core: Core) => void;
  onLifeUp?: () => void;
}

export class GameState {
  readonly player: Player;
  bullets: Bullet[] = [];
  playerBullets: PlayerBullet[] = [];
  life = INITIAL_LIFE;
  score = 0;
  gameOver = false;
  private causeShortcode: string | null = null;
  private causeImg: HTMLImageElement | null = null;
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
      this.coreManager.registerEmoji(occurrence.shortcode, occurrence.url);
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
      intensity,
      this.player.x,
      this.player.y,
      this.bullets,
      {
        onCoreDefeated: (core) => this.listeners.onCoreDefeated?.(core),
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

    this.score = Math.floor(((now - this.startedAt) / 1000) * SCORE_PER_SECOND);
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

  private handlePlayerHit(bullet: Bullet, now: number): void {
    this.bullets = this.bullets.filter((b) => b.id !== bullet.id);

    if (bullet.isLifeUp) {
      this.life = Math.min(this.life + 1, INITIAL_LIFE);
      this.listeners.onLifeChange?.(this.life);
      this.listeners.onLifeUp?.();
      return;
    }

    this.life -= 1;
    this.causeShortcode = bullet.shortcode || "不明";
    this.causeImg = bullet.img;
    this.player.invincibleUntil = now + INVINCIBLE_MS;
    this.listeners.onLifeChange?.(this.life);

    if (this.life <= 0) {
      this.gameOver = true;
      this.listeners.onGameOver?.({
        score: this.score,
        survivedMs: this.survivedMs(now),
        causeShortcode: this.causeShortcode,
        causeImg: this.causeImg,
      });
    }
  }
}
