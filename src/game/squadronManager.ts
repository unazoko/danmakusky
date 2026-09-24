// 2列×8体の編隊で出現する敵(SquadronUnit)。coreManager.ts/swarmManager.ts
// とは別枠。画面右端・左端のどちらかから侵入し、蛇のように大きく上下へ
// うねりながら横切って反対サイドへ抜けていく。前(row=0)から順に1体ずつ、
// 500ms間隔で自機のいる方向へ直進弾(追尾なし、同時に複数発は撃たない)を
// 撃つ。最後尾まで撃ち終えたら1拍分間を空けて先頭から撃ち直す。
// 1体ごとのHPは低く、容易に撃墜できる(倒された分は発射順から除外される)。
import type { Bullet, SquadronUnit } from "./entities.js";
import { createBulletId, createSquadronUnitId } from "./entities.js";
import { aimedBullet } from "./patterns.js";
import { getOrLoadEmojiImage } from "../render.js";

const COLUMNS = 2;
const ROWS = 8;

const UNIT_HP = 5;
const SPRITE_SIZE = 32;
const HIT_RADIUS = 13;

// 列内で前後に並ぶ間隔(進行方向に沿って)。絵文字の幅を基準に、
// 前後が重ならない程度(=1個分)にする。
const ROW_GAP_PX = SPRITE_SIZE;
// 2列の左右(進行方向に垂直)の間隔。絵文字1個分。
const COLUMN_GAP_PX = SPRITE_SIZE;

// 画面を横切る速度と、その途中で上下に大きくうねる(蛇のように旋回する)
// 正弦波の振れ幅・周期(周期が長いほど、進行速度に対して波長が長くなる)。
const CROSS_SPEED_PX_PER_SEC = 90;
const SWAY_AMPLITUDE_PX = 100;
const SWAY_PERIOD_MS = 5000;
// 侵入・退出時に画面外のどこまで進んだら完全に見えなくなったとみなすか
// (編隊の全長+αぶんの余裕を持たせる)。
const ENTRY_MARGIN_PX = ROW_GAP_PX * ROWS + SPRITE_SIZE * 2;

const FIRE_INTERVAL_MS = 250;
// 攻撃弾の弾速倍率(固定、時間経過等では変化しない)。
const BULLET_SPEED_MULTIPLIER = 2;

// 編隊が全滅/画面を抜け切ってから次の編隊が出現するまでの間隔。
const SPAWN_COOLDOWN_MIN_MS = 15000;
const SPAWN_COOLDOWN_RANDOM_MS = 15000;

// 出現時のうねりの基準位置(画面上部1/3の範囲内でランダム)。
const SPAWN_Y_MIN_RATIO = 0.05;
const SPAWN_Y_MAX_RATIO = 1 / 3;

const MAX_RECENT_EMOJI_URLS = 20;

interface RecentEmoji {
  shortcode: string;
  url: string;
  noteUrl: string;
}

export interface SquadronManagerListeners {
  onUnitDefeated?: (unit: SquadronUnit) => void;
}

export class SquadronManager {
  units: SquadronUnit[] = [];
  private recentEmojis: RecentEmoji[] = [];
  private nextSpawnAt = 0;
  // 横切る向き(+1=左から右、-1=右から左)と、その始点。
  private direction = 1;
  private startX = 0;
  private swayBaseY = 0;
  private formationSpawnedAt = 0;
  private nextFireAt = 0;
  // 直近に発射した個体のorder。次はこれより大きいorderの中で最小のものを狙う
  // (撃墜されて欠けても、順番そのものは崩れず自然に飛ばされる)。
  private lastFiredOrder = -1;

  registerEmoji(shortcode: string, url: string, noteUrl: string): void {
    this.recentEmojis.push({ shortcode, url, noteUrl });
    if (this.recentEmojis.length > MAX_RECENT_EMOJI_URLS) this.recentEmojis.shift();
  }

  update(
    now: number,
    canvasWidth: number,
    canvasHeight: number,
    playerX: number,
    playerY: number,
    bullets: Bullet[],
    listeners: SquadronManagerListeners,
  ): void {
    this.trySpawn(now, canvasWidth, canvasHeight);
    this.updatePositions(now);
    this.updateFiring(now, playerX, playerY, bullets);

    const defeated = this.units.filter((u) => u.hp <= 0);
    if (defeated.length > 0) {
      this.units = this.units.filter((u) => u.hp > 0);
      for (const u of defeated) listeners.onUnitDefeated?.(u);
    }

    // 反対サイドまで完全に抜け切ったら、倒されていなくても編隊を消す。
    const fullyCrossed = this.units.length > 0 && this.hasFullyCrossed(now, canvasWidth);
    if (fullyCrossed) this.units = [];

    // 全滅・退出いずれかで編隊が消えたら、次の編隊までのクールダウンを積む。
    if (this.units.length === 0 && (defeated.length > 0 || fullyCrossed)) {
      this.nextSpawnAt = now + SPAWN_COOLDOWN_MIN_MS + Math.random() * SPAWN_COOLDOWN_RANDOM_MS;
    }
  }

  private trySpawn(now: number, canvasWidth: number, canvasHeight: number): void {
    if (this.units.length > 0) return; // 編隊が残っている間は新規発生しない
    if (now < this.nextSpawnAt) return;
    if (this.recentEmojis.length === 0) return;
    this.spawnFormation(now, canvasWidth, canvasHeight);
  }

  // 最後尾(row=ROWS-1)が反対サイドを抜け切るまでは編隊が残っているとみなす
  // (先頭だけで判定すると、まだ画面内にいる最後尾が消えてしまう)。
  private hasFullyCrossed(now: number, canvasWidth: number): boolean {
    const tailX = this.headX(now) - this.direction * (ROWS - 1) * ROW_GAP_PX;
    return this.direction > 0 ? tailX > canvasWidth + ENTRY_MARGIN_PX : tailX < -ENTRY_MARGIN_PX;
  }

  // 先頭(row=0)が現在いるべきx座標。
  private headX(now: number): number {
    const elapsedSec = (now - this.formationSpawnedAt) / 1000;
    return this.startX + this.direction * CROSS_SPEED_PX_PER_SEC * elapsedSec;
  }

  private spawnFormation(now: number, canvasWidth: number, canvasHeight: number): void {
    const { shortcode, url, noteUrl } = this.recentEmojis[this.recentEmojis.length - 1];
    const img = getOrLoadEmojiImage(url);

    // 画面右端・左端のどちらかから侵入し、反対サイドへ抜けていく。
    const enterFromLeft = Math.random() < 0.5;
    this.direction = enterFromLeft ? 1 : -1;
    this.startX = enterFromLeft ? -ENTRY_MARGIN_PX : canvasWidth + ENTRY_MARGIN_PX;
    this.swayBaseY = canvasHeight * (SPAWN_Y_MIN_RATIO + Math.random() * (SPAWN_Y_MAX_RATIO - SPAWN_Y_MIN_RATIO));
    this.formationSpawnedAt = now;
    this.lastFiredOrder = -1;
    this.nextFireAt = now + FIRE_INTERVAL_MS;

    this.units = [];
    let order = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLUMNS; col++) {
        this.units.push({
          id: createSquadronUnitId(),
          shortcode,
          img,
          noteUrl,
          col,
          row,
          order: order++,
          x: 0,
          y: 0,
          hp: UNIT_HP,
          maxHp: UNIT_HP,
          spriteSize: SPRITE_SIZE,
          hitRadius: HIT_RADIUS,
        });
      }
    }
    this.updatePositions(now);
  }

  // 列そのものを蛇のようにうねらせる: 列を1つの剛体として動かすのではなく、
  // 各個体が「先頭(row=0)が過去に通った軌跡」を、自分の後方距離ぶんの
  // 時間差(delaySec)だけ遅れて追いかけるようにする。先頭のsin波をそのまま
  // 後続がなぞる形になるため、列全体が実際に体をくねらせて進む蛇のような
  // 形になる(列を丸ごと平行移動させるだけの揺れとは別物)。
  private updatePositions(now: number): void {
    if (this.units.length === 0) return;
    const headX = this.headX(now);
    for (const u of this.units) {
      const behindPx = u.row * ROW_GAP_PX;
      const delaySec = behindPx / CROSS_SPEED_PX_PER_SEC;
      const wavePhaseMs = now - this.formationSpawnedAt - delaySec * 1000;
      const wave = SWAY_AMPLITUDE_PX * Math.sin((2 * Math.PI * wavePhaseMs) / SWAY_PERIOD_MS);
      u.x = headX - this.direction * behindPx;
      u.y = this.swayBaseY + (u.col - 0.5) * COLUMN_GAP_PX + wave;
    }
  }

  private updateFiring(now: number, playerX: number, playerY: number, bullets: Bullet[]): void {
    if (this.units.length === 0) return;
    if (now < this.nextFireAt) return;

    // lastFiredOrderより大きいorderの中で最小のものを探し、無ければ先頭
    // (最小order)に戻る。これで「前から順番に」を撃墜による欠けにも
    // 崩れず自然に維持できる。
    let next: SquadronUnit | undefined;
    for (const u of this.units) {
      if (u.order > this.lastFiredOrder && (!next || u.order < next.order)) next = u;
    }
    if (!next) {
      for (const u of this.units) {
        if (!next || u.order < next.order) next = u;
      }
    }
    if (!next) return;
    this.lastFiredOrder = next.order;

    // 残っている中でこれが最後尾(=最大order)だった場合、次の1発(先頭への
    // 巻き戻し)までは通常の倍の間隔を空ける(「1拍間を開けて」)。
    const isLast = !this.units.some((u) => u.order > next!.order);
    this.nextFireAt = now + FIRE_INTERVAL_MS * (isLast ? 2 : 1);

    // 1体につき1発のみ。同心円等の複数方向弾は撃たない。弾速は固定で2倍にする。
    const v = aimedBullet(next.x, next.y, playerX, playerY);
    bullets.push({
      id: createBulletId(),
      img: next.img,
      shortcode: next.shortcode,
      x: next.x,
      y: next.y,
      vx: v.vx * BULLET_SPEED_MULTIPLIER,
      vy: v.vy * BULLET_SPEED_MULTIPLIER,
      size: 20,
      hitRadius: 6,
      spawnedAt: now,
      behavior: { kind: "linear" },
      noteUrl: next.noteUrl,
      isBossBullet: true,
    });
  }
}
