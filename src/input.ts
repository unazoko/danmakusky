// 自機の操作。PCはWASD/矢印キーでの8方向移動(Shiftで低速・精密移動する
// 「低速(フォーカス)」を追加)、スマートフォンはタッチ&ドラッグで自機を
// 追従させる。
// 発射(自機の弾)はPCならZキー/スペースキー、スマホなら画面上の発射ボタン
// (main.ts側でsetFireButtonHeldを呼ぶ)で行う。東方のZキー連射と同じ、
// 押している間だけ発射する方式(自動連射ではない)。
import type { Player } from "./game/entities.js";

const NORMAL_SPEED_PX_PER_SEC = 260;
// Shift(低速)中は東方同様に大きく減速し、弾の隙間を精密に通り抜けやすくする。
const FOCUS_SPEED_PX_PER_SEC = 110;

const MOVE_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
]);
const FOCUS_KEYS = new Set(["ShiftLeft", "ShiftRight"]);
const FIRE_KEYS = new Set(["KeyZ", "Space"]);

// タッチ操作は指の真下に自機が来ると指で隠れて見えなくなるため、検出位置
// より上に自機を表示させる(=自機位置を指の位置そのものにしない)。
const TOUCH_LIFT_PX = 60;

export class InputController {
  private pressedKeys = new Set<string>();
  private focusHeld = false;
  private fireKeyHeld = false;
  private fireButtonHeld = false;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  // スマホの発射ボタン要素。自機がこの真下に潜り込んで隠れたり、ドラッグ中に
  // ボタン上へ着地した指がボタンへの新規タップと誤認されて操作を奪われたり
  // しないよう、自機がこのボタンの領域に重ならないようにする。
  private fireButtonEl: HTMLElement | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
  }

  // 自機の位置を1フレーム分更新する。画面外に出ないようclampする。
  update(player: Player, dtSec: number): void {
    if (this.dragging) {
      player.x = this.dragX;
      player.y = this.dragY;
      // タッチ操作は指で隠れて見えにくい分、常に精密移動扱いにして当たり判定の
      // 目安ドットを表示する。
      player.focused = true;
    } else {
      const dir = this.keyboardDirection();
      player.focused = this.focusHeld;
      if (dir.x !== 0 || dir.y !== 0) {
        const speed = this.focusHeld ? FOCUS_SPEED_PX_PER_SEC : NORMAL_SPEED_PX_PER_SEC;
        player.x += dir.x * speed * dtSec;
        player.y += dir.y * speed * dtSec;
      }
    }

    player.x = clamp(player.x, player.hitRadius, this.canvas.width - player.hitRadius);
    player.y = clamp(player.y, player.hitRadius, this.canvas.height - player.hitRadius);

    if (this.dragging && this.fireButtonEl) {
      this.keepOutOfFireButton(player);
    }
  }

  // スマホの発射ボタン(main.ts側のDOM要素)を登録する。ボタンは画面上に
  // 固定表示されている別要素で、canvasとは独立に自身のpointerdownを奪う
  // ため、自機がその真下に来ないようにここで押し出す。
  setFireButtonElement(el: HTMLElement): void {
    this.fireButtonEl = el;
  }

  private keepOutOfFireButton(player: Player): void {
    const canvasRect = this.canvas.getBoundingClientRect();
    const btnRect = this.fireButtonEl!.getBoundingClientRect();
    const margin = player.spriteSize / 2;
    const left = btnRect.left - canvasRect.left - margin;
    const right = btnRect.right - canvasRect.left + margin;
    const top = btnRect.top - canvasRect.top - margin;
    const bottom = btnRect.bottom - canvasRect.top + margin;
    if (player.x < left || player.x > right || player.y < top || player.y > bottom) return;

    // 自機の中心がボタン領域(+余白)に入り込んでいる場合、一番近い辺まで
    // 押し出す(finger位置自体は変えず、見た目の自機位置だけをずらす)。
    const distLeft = player.x - left;
    const distRight = right - player.x;
    const distTop = player.y - top;
    const distBottom = bottom - player.y;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
    if (minDist === distLeft) player.x = left;
    else if (minDist === distRight) player.x = right;
    else if (minDist === distTop) player.y = top;
    else player.y = bottom;
  }

  private keyboardDirection(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.pressedKeys.has("ArrowLeft") || this.pressedKeys.has("KeyA")) x -= 1;
    if (this.pressedKeys.has("ArrowRight") || this.pressedKeys.has("KeyD")) x += 1;
    if (this.pressedKeys.has("ArrowUp") || this.pressedKeys.has("KeyW")) y -= 1;
    if (this.pressedKeys.has("ArrowDown") || this.pressedKeys.has("KeyS")) y += 1;

    if (x !== 0 && y !== 0) {
      // 斜め移動が直進より速くならないよう正規化する。
      const inv = Math.SQRT1_2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  // タッチの発射ボタン(main.ts側のDOMボタン)から呼ばれる。
  setFireButtonHeld(held: boolean): void {
    this.fireButtonHeld = held;
  }

  isFiring(): boolean {
    return this.fireKeyHeld || this.fireButtonHeld;
  }

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    if (MOVE_KEYS.has(ev.code)) {
      this.pressedKeys.add(ev.code);
      ev.preventDefault();
    } else if (FOCUS_KEYS.has(ev.code)) {
      this.focusHeld = true;
    } else if (FIRE_KEYS.has(ev.code)) {
      this.fireKeyHeld = true;
      ev.preventDefault(); // スペースキーによるページスクロールを防ぐ
    }
  };

  private readonly onKeyUp = (ev: KeyboardEvent): void => {
    if (MOVE_KEYS.has(ev.code)) {
      this.pressedKeys.delete(ev.code);
    } else if (FOCUS_KEYS.has(ev.code)) {
      this.focusHeld = false;
    } else if (FIRE_KEYS.has(ev.code)) {
      this.fireKeyHeld = false;
    }
  };

  private readonly onPointerDown = (ev: PointerEvent): void => {
    this.dragging = true;
    this.canvas.setPointerCapture(ev.pointerId);
    this.updateDragPosition(ev);
  };

  private readonly onPointerMove = (ev: PointerEvent): void => {
    if (!this.dragging) return;
    this.updateDragPosition(ev);
  };

  private readonly onPointerUp = (): void => {
    this.dragging = false;
  };

  private updateDragPosition(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dragX = ev.clientX - rect.left;
    this.dragY = ev.clientY - rect.top - TOUCH_LIFT_PX;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
