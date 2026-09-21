// ゲーム本体の状態(自機・弾・コア・残機・スコア)と、1フレーム分の更新処理。
// 当たり判定は自機/コア中心の小さな円と弾中心の小さな円の距離判定のみ(企画書§20)。
//
// 企画書には無い追加要素: Misskeyの投稿由来の弾幕は「コア」という敵から
// 放たれることにし(東方のボスに相当)、自機の弾でコアを撃破しない限り
// 弾幕は止まらない。コアを倒すと少し休憩してから次のコアが出現し、
// また弾幕が始まる(スコアはこれまで通り生存時間ベースのまま変更しない)。
import type { EmojiOccurrence } from "../noteEmoji.js";
import type { InputController } from "../input.js";
import type { Bullet, Core, Player, PlayerBullet } from "./entities.js";
import { createBulletId } from "./entities.js";
import { BulletSpawner } from "./spawner.js";
import { spiralArmVelocities } from "./patterns.js";
import { getOrLoadEmojiImage } from "../render.js";

const INITIAL_LIFE = 3;
const SCORE_PER_SECOND = 100;
// 被弾直後、この時間は無敵にする(同時多発的な多重被弾で瞬時に残機を失うのを防ぐ、
// 東方含む弾幕STGの定石)。
const INVINCIBLE_MS = 1500;
// 画面外に十分出た弾は削除する(このマージンより内側に戻ってくることはない前提)。
const CULL_MARGIN_PX = 60;

const CORE_MAX_HP = 40;
const CORE_SPRITE_SIZE = 64;
const CORE_HIT_RADIUS = 30;
// コア撃破後、次のコアが出現するまでの休憩時間(この間は弾幕が止まる)。
const CORE_BREATHER_MS = 2500;
const MAX_RECENT_EMOJI_URLS = 20;

const PLAYER_BULLET_SPEED = 420;
const PLAYER_BULLET_RADIUS = 4;
const PLAYER_BULLET_DAMAGE = 1;
// 自機弾の連射間隔(企画書には無いが東方のZキー連射相当)。
const PLAYER_FIRE_INTERVAL_MS = 120;

// コアの常時螺旋弾幕(企画書§12「3.円/螺旋系」の本格版)。ノート由来の弾とは
// 独立して、コアが生きている間はずっと少しずつ回転しながら発射し続ける。
const SPIRAL_TICK_MS = 130;
const SPIRAL_ARM_COUNT = 3;
const SPIRAL_ANGLE_STEP = (10 * Math.PI) / 180;
const SPIRAL_BULLET_SPRITE_SIZE = 22;
const SPIRAL_BULLET_HIT_RADIUS = 7;

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
  onCoreDefeated?: () => void;
}

export class GameState {
  readonly player: Player;
  bullets: Bullet[] = [];
  playerBullets: PlayerBullet[] = [];
  core: Core | null = null;
  life = INITIAL_LIFE;
  score = 0;
  gameOver = false;
  private causeShortcode: string | null = null;
  private causeImg: HTMLImageElement | null = null;
  private readonly startedAt: number;
  private readonly spawner = new BulletSpawner();

  // 次のコア出現に使う画像の候補(直近で見た絵文字のURL、古いものから捨てる)。
  private recentEmojiUrls: string[] = [];
  private nextCoreSpawnAt = 0;
  private nextPlayerShotAt = 0;
  private spiralAngle = 0;
  private nextSpiralAt = 0;

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

  handleEmojiOccurrences(occurrences: EmojiOccurrence[], now: number): void {
    if (this.gameOver || occurrences.length === 0) return;

    for (const occurrence of occurrences) {
      this.recentEmojiUrls.push(occurrence.url);
      if (this.recentEmojiUrls.length > MAX_RECENT_EMOJI_URLS) this.recentEmojiUrls.shift();
    }

    if (!this.core) {
      // まだコアが居ない(ゲーム開始直後、または休憩時間中に絵文字が届いた場合)。
      // 休憩時間中でなければ即座にコアを立てる。
      if (now >= this.nextCoreSpawnAt) this.spawnCore(occurrences[0].url, now);
      return;
    }

    const ctx = {
      now,
      originX: this.core.x,
      originY: this.core.y,
      playerX: this.player.x,
      playerY: this.player.y,
    };
    for (const occurrence of occurrences) {
      this.spawner.trySpawnFromOccurrence(occurrence, ctx, this.bullets);
    }
  }

  update(dtSec: number, now: number, input: InputController): void {
    if (this.gameOver) return;

    input.update(this.player, dtSec);
    this.updatePlayerShooting(now, dtSec, input);
    this.updateEnemyBullets(dtSec);
    this.updateCore(now);

    if (now >= this.player.invincibleUntil) {
      const hit = this.bullets.find((b) => this.collidesWithPlayer(b));
      if (hit) this.handlePlayerHit(hit, now);
    }

    this.score = Math.floor(((now - this.startedAt) / 1000) * SCORE_PER_SECOND);
    this.listeners.onScoreChange?.(this.score);
  }

  survivedMs(now: number): number {
    return now - this.startedAt;
  }

  // ストリームの流速が弾生成の上限を超えている(演出§23の警告表示向け)かどうか。
  isStreamOverflowing(now: number): boolean {
    return this.spawner.isOverflowing(now);
  }

  private spawnCore(imgUrl: string, now: number): void {
    this.core = {
      x: this.canvas.width / 2,
      y: this.canvas.height * 0.18,
      hp: CORE_MAX_HP,
      maxHp: CORE_MAX_HP,
      spriteSize: CORE_SPRITE_SIZE,
      hitRadius: CORE_HIT_RADIUS,
      img: getOrLoadEmojiImage(imgUrl),
    };
    this.spiralAngle = 0;
    this.nextSpiralAt = now;
  }

  private updatePlayerShooting(now: number, dtSec: number, input: InputController): void {
    if (input.isFiring() && now >= this.nextPlayerShotAt) {
      this.nextPlayerShotAt = now + PLAYER_FIRE_INTERVAL_MS;
      this.playerBullets.push({
        id: createBulletId(),
        x: this.player.x,
        y: this.player.y - this.player.spriteSize / 2,
        vy: -PLAYER_BULLET_SPEED,
      });
    }

    for (const b of this.playerBullets) b.y += b.vy * dtSec;
    this.playerBullets = this.playerBullets.filter((b) => b.y > -CULL_MARGIN_PX);
  }

  private updateEnemyBullets(dtSec: number): void {
    for (const b of this.bullets) {
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
    }
    this.bullets = this.bullets.filter((b) => this.isWithinCullBounds(b));
  }

  private updateCore(now: number): void {
    if (!this.core) {
      if (now >= this.nextCoreSpawnAt && this.recentEmojiUrls.length > 0) {
        this.spawnCore(this.recentEmojiUrls[this.recentEmojiUrls.length - 1], now);
      }
      return;
    }

    // 自機弾との当たり判定。命中した自機弾はここで取り除く。
    const core = this.core;
    this.playerBullets = this.playerBullets.filter((pb) => {
      const dx = pb.x - core.x;
      const dy = pb.y - core.y;
      const rSum = PLAYER_BULLET_RADIUS + core.hitRadius;
      const hit = dx * dx + dy * dy <= rSum * rSum;
      if (hit) core.hp -= PLAYER_BULLET_DAMAGE;
      return !hit;
    });

    if (core.hp <= 0) {
      this.bullets = []; // 東方のボス撃破と同じく、画面上の弾を一掃する
      this.nextCoreSpawnAt = now + CORE_BREATHER_MS;
      this.listeners.onCoreDefeated?.();
      this.core = null;
      return;
    }

    // 常時螺旋弾幕(ノート由来の弾幕とは独立)。
    if (now >= this.nextSpiralAt) {
      this.nextSpiralAt = now + SPIRAL_TICK_MS;
      this.spiralAngle += SPIRAL_ANGLE_STEP;
      for (const v of spiralArmVelocities(SPIRAL_ARM_COUNT, this.spiralAngle)) {
        this.bullets.push({
          id: createBulletId(),
          img: core.img,
          shortcode: "",
          x: core.x,
          y: core.y,
          vx: v.vx,
          vy: v.vy,
          size: SPIRAL_BULLET_SPRITE_SIZE,
          hitRadius: SPIRAL_BULLET_HIT_RADIUS,
          spawnedAt: now,
        });
      }
    }
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
    this.life -= 1;
    this.causeShortcode = bullet.shortcode || "不明";
    this.causeImg = bullet.img;
    this.player.invincibleUntil = now + INVINCIBLE_MS;
    this.bullets = this.bullets.filter((b) => b.id !== bullet.id);
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
