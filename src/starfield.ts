// 「宇宙を飛んでいる」感じを出すための背景の星々。ゲームロジックには一切
// 関与しない見た目だけの演出で、他の描画より先に(一番奥に)描く。
interface Star {
  x: number;
  y: number;
  speed: number;
  size: number;
  brightness: number;
}

const STAR_COUNT = 90;
const MIN_SPEED = 40;
const MAX_SPEED = 200;

export class Starfield {
  private stars: Star[] = [];

  constructor(
    private width: number,
    private height: number,
  ) {
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push(this.randomStar(Math.random() * height));
    }
  }

  private randomStar(y: number): Star {
    return {
      x: Math.random() * this.width,
      y,
      // 速度をばらつかせることで、近い星は速く・遠い星は遅く見える
      // 疑似的な奥行き(視差)を出す。
      speed: MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED),
      size: 0.6 + Math.random() * 1.8,
      brightness: 0.3 + Math.random() * 0.7,
    };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  update(dtSec: number): void {
    for (const star of this.stars) {
      star.y += star.speed * dtSec;
      if (star.y > this.height) {
        Object.assign(star, this.randomStar(-4), { x: Math.random() * this.width });
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const star of this.stars) {
      ctx.globalAlpha = star.brightness;
      ctx.fillStyle = "#cfeeff";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
