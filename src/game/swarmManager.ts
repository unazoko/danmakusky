// 「群れ」敵(Swarmer)。弱・中・強のコア(ボス)とは別枠の、短時間だけ出現する
// 雑魚敵。5体が600ms間隔で連続出現し、出現後は位置を固定したまま弾幕を
// 3回放って3500msで自動消滅する。撃墜も可能(HPは弱ボスより低い)。
// この敵が1体でも画面に残っている間は、弱・中・強ボスの新規出現を止める
// (逆に、ボスが既にいる状態でこの敵が出現するのは問題ない、coreManager.ts参照)。
import type { Bullet, Swarmer } from "./entities.js";
import { createBulletId, createSwarmerId } from "./entities.js";
import { concentricRingsVelocities } from "./patterns.js";
import { getOrLoadEmojiImage } from "../render.js";

// 弱ボスと同じサイズ(TIER_CONFIG.weak参照)、弱ボス(maxHp40)より低いHP。
const SPRITE_SIZE = 44;
const HIT_RADIUS = 20;
const MAX_HP = 10;

const LIFESPAN_MS = 3500;
// フワッと出現・消滅させる演出時間(寿命の最初と最後にこれだけかけて
// アルファを0→1、1→0にする、render.ts参照)。
const FADE_MS = 300;
const ATTACK_COUNT = 3;

const WAVE_COUNT = 5;
const WAVE_SPAWN_INTERVAL_MS = 600;
// 次のウェーブが発生するまでの間隔。出現中はボスの新規出現を止めてしまう
// ため、頻発しすぎないよう長めに取る。
const WAVE_COOLDOWN_MIN_MS = 15000;
const WAVE_COOLDOWN_RANDOM_MS = 15000;

// 出現範囲: 画面上部2/5、左右は端ギリギリを避ける。
const SPAWN_Y_RATIO = 0.4;
const SPAWN_X_MARGIN_RATIO = 0.1;

const MAX_RECENT_EMOJI_URLS = 20;

interface RecentEmoji {
  shortcode: string;
  url: string;
  noteUrl: string;
}

export interface SwarmManagerListeners {
  onSwarmerDefeated?: (swarmer: Swarmer) => void;
}

export class SwarmManager {
  swarmers: Swarmer[] = [];
  private recentEmojis: RecentEmoji[] = [];
  private nextWaveAt = 0;
  // 現在のウェーブで、あと何体出現させる必要があるか(0=ウェーブ未発生/完了)。
  private waveRemaining = 0;
  private nextWaveSpawnAt = 0;

  registerEmoji(shortcode: string, url: string, noteUrl: string): void {
    this.recentEmojis.push({ shortcode, url, noteUrl });
    if (this.recentEmojis.length > MAX_RECENT_EMOJI_URLS) this.recentEmojis.shift();
  }

  // ウェーブ出現中、またはこの敵がまだ1体でも画面に残っている間はtrue
  // (coreManager.ts側で弱・中・強ボスの新規出現を止めるのに使う)。
  isActive(): boolean {
    return this.waveRemaining > 0 || this.swarmers.length > 0;
  }

  update(
    now: number,
    canvasWidth: number,
    canvasHeight: number,
    bullets: Bullet[],
    listeners: SwarmManagerListeners,
  ): void {
    this.trySpawnWave(now, canvasWidth, canvasHeight);

    for (const s of this.swarmers) {
      this.updateAttack(s, now, bullets);
    }

    const defeated = this.swarmers.filter((s) => s.hp <= 0);
    if (defeated.length > 0) {
      this.swarmers = this.swarmers.filter((s) => s.hp > 0);
      for (const s of defeated) listeners.onSwarmerDefeated?.(s);
    }

    this.swarmers = this.swarmers.filter((s) => now < s.expiresAt);
  }

  private trySpawnWave(now: number, canvasWidth: number, canvasHeight: number): void {
    if (this.waveRemaining > 0) {
      if (now >= this.nextWaveSpawnAt) {
        this.spawnOne(now, canvasWidth, canvasHeight);
        this.waveRemaining -= 1;
        this.nextWaveSpawnAt = now + WAVE_SPAWN_INTERVAL_MS;
      }
      return;
    }
    if (now < this.nextWaveAt) return;
    if (this.recentEmojis.length === 0) return;

    this.waveRemaining = WAVE_COUNT - 1;
    this.spawnOne(now, canvasWidth, canvasHeight);
    this.nextWaveSpawnAt = now + WAVE_SPAWN_INTERVAL_MS;
    this.nextWaveAt = now + WAVE_COOLDOWN_MIN_MS + Math.random() * WAVE_COOLDOWN_RANDOM_MS;
  }

  private spawnOne(now: number, canvasWidth: number, canvasHeight: number): void {
    const { shortcode, url, noteUrl } = this.recentEmojis[this.recentEmojis.length - 1];
    const x = canvasWidth * (SPAWN_X_MARGIN_RATIO + Math.random() * (1 - SPAWN_X_MARGIN_RATIO * 2));
    const y = Math.random() * canvasHeight * SPAWN_Y_RATIO;
    const attackIntervalMs = LIFESPAN_MS / (ATTACK_COUNT + 1);
    this.swarmers.push({
      id: createSwarmerId(),
      shortcode,
      x,
      y,
      hp: MAX_HP,
      maxHp: MAX_HP,
      spriteSize: SPRITE_SIZE,
      hitRadius: HIT_RADIUS,
      img: getOrLoadEmojiImage(url),
      spawnedAt: now,
      expiresAt: now + LIFESPAN_MS,
      fadeInEndsAt: now + FADE_MS,
      fadeOutStartsAt: now + LIFESPAN_MS - FADE_MS,
      attacksFired: 0,
      nextAttackAt: now + attackIntervalMs,
      attackAngle: Math.random() * Math.PI * 2,
      noteUrl,
    });
  }

  // 同心円型の弾幕を3回放つ。位置固定の敵なので、動きではなく弾幕そのもので
  // 存在感を出す。角度を毎回少しずらすことで、リングが少しずつ回転しながら
  // 連続発生する見た目にする。
  private updateAttack(s: Swarmer, now: number, bullets: Bullet[]): void {
    if (s.attacksFired >= ATTACK_COUNT) return;
    if (now < s.nextAttackAt) return;
    s.attacksFired += 1;
    s.nextAttackAt = now + LIFESPAN_MS / (ATTACK_COUNT + 1);
    s.attackAngle += (25 * Math.PI) / 180;

    const velocities = concentricRingsVelocities(1, 8, s.attackAngle);
    for (const v of velocities) {
      bullets.push({
        id: createBulletId(),
        img: s.img,
        shortcode: s.shortcode,
        x: s.x,
        y: s.y,
        vx: v.vx,
        vy: v.vy,
        size: 22,
        hitRadius: 7,
        spawnedAt: now,
        behavior: { kind: "linear" },
        noteUrl: s.noteUrl,
        isBossBullet: true,
      });
    }
  }
}
