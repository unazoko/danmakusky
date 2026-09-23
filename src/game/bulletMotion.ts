// 弾のbehavior(game/entities.ts: BulletBehavior)に応じた毎フレームの
// 位置・速度更新。「linear」以外の各パターン(ゆっくり追尾・円運動・
// ジグザグ・急な方向転換・停止後急加速・分裂)をここでまとめて処理する。
import type { Bullet } from "./entities.js";
import { createBulletId } from "./entities.js";

function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

// 円運動は軌道が画面内に収まっていると画面外カリングの対象にならず、
// 被弾しない限り永遠に残ってしまう。一定時間で軌道を離し、その瞬間の
// 接線方向へ直進させることで、以降は通常のカリングで消えるようにする。
const ORBIT_RELEASE_MS = 4000;

// spawnedはsplitter発動時に増える弾を積む先(呼び出し側でbullets配列へ追加する)。
export function updateBullet(
  b: Bullet,
  dtSec: number,
  now: number,
  playerX: number,
  playerY: number,
  spawned: Bullet[],
): void {
  const behavior = b.behavior;

  switch (behavior.kind) {
    case "linear": {
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      break;
    }

    case "homing": {
      const targetAngle = Math.atan2(playerY - b.y, playerX - b.x);
      const curAngle = Math.atan2(b.vy, b.vx);
      const speed = Math.hypot(b.vx, b.vy);
      const diff = normalizeAngle(targetAngle - curAngle);
      const maxTurn = behavior.turnRateRadPerSec * dtSec;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
      const newAngle = curAngle + turn;
      b.vx = Math.cos(newAngle) * speed;
      b.vy = Math.sin(newAngle) * speed;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      break;
    }

    case "orbit": {
      if (now - b.spawnedAt > ORBIT_RELEASE_MS) {
        // 直前のフレームまでの接線方向の速度(b.vx/b.vy)をそのまま引き継いで直進に切り替える。
        b.behavior = { kind: "linear" };
        b.x += b.vx * dtSec;
        b.y += b.vy * dtSec;
        break;
      }
      behavior.angle += behavior.angularSpeedRadPerSec * dtSec;
      const speed = Math.abs(behavior.angularSpeedRadPerSec) * behavior.radius;
      const dir = behavior.angularSpeedRadPerSec >= 0 ? 1 : -1;
      b.vx = -Math.sin(behavior.angle) * speed * dir;
      b.vy = Math.cos(behavior.angle) * speed * dir;
      b.x = behavior.centerX + Math.cos(behavior.angle) * behavior.radius;
      b.y = behavior.centerY + Math.sin(behavior.angle) * behavior.radius;
      break;
    }

    case "zigzag": {
      const elapsedSec = (now - behavior.startedAt) / 1000;
      const wobble = Math.sin(elapsedSec * behavior.angularFreq) * behavior.amplitudeRad;
      const angle = behavior.baseAngle + wobble;
      b.vx = Math.cos(angle) * behavior.speed;
      b.vy = Math.sin(angle) * behavior.speed;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      break;
    }

    case "redirect": {
      if (!behavior.triggered && now >= behavior.triggerAt) {
        behavior.triggered = true;
        const angle = Math.atan2(playerY - b.y, playerX - b.x);
        b.vx = Math.cos(angle) * behavior.speed;
        b.vy = Math.sin(angle) * behavior.speed;
      }
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      break;
    }

    case "delayedAccel": {
      if (!behavior.triggered && now >= behavior.triggerAt) {
        behavior.triggered = true;
        b.vx = Math.cos(behavior.angle) * behavior.speed;
        b.vy = Math.sin(behavior.angle) * behavior.speed;
      }
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      break;
    }

    case "curve": {
      behavior.angle += behavior.curveRadPerSec * dtSec;
      b.vx = Math.cos(behavior.angle) * behavior.speed;
      b.vy = Math.sin(behavior.angle) * behavior.speed;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      break;
    }

    case "pulse": {
      const elapsedSec = (now - behavior.startedAt) / 1000;
      const speed = behavior.baseSpeed + Math.sin(elapsedSec * behavior.angularFreq) * behavior.amplitude;
      b.vx = Math.cos(behavior.baseAngle) * speed;
      b.vy = Math.sin(behavior.baseAngle) * speed;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      break;
    }

    case "accel": {
      behavior.speed = Math.min(behavior.speed + behavior.accelPxPerSec2 * dtSec, behavior.maxSpeed);
      b.vx = Math.cos(behavior.angle) * behavior.speed;
      b.vy = Math.sin(behavior.angle) * behavior.speed;
      b.x += b.vx * dtSec;
      b.y += b.vy * dtSec;
      break;
    }

    case "splitter": {
      if (!behavior.triggered && now >= behavior.triggerAt) {
        behavior.triggered = true;
        b.dead = true;
        for (let i = 0; i < behavior.splitCount; i++) {
          const angle = (Math.PI * 2 * i) / behavior.splitCount;
          spawned.push({
            id: createBulletId(),
            img: b.img,
            shortcode: b.shortcode,
            x: b.x,
            y: b.y,
            vx: Math.cos(angle) * behavior.speed,
            vy: Math.sin(angle) * behavior.speed,
            size: b.size,
            hitRadius: b.hitRadius,
            spawnedAt: now,
            behavior: { kind: "linear" },
            noteUrl: b.noteUrl,
          });
        }
      } else {
        b.x += b.vx * dtSec;
        b.y += b.vy * dtSec;
      }
      break;
    }
  }
}
