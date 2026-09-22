import type { Player, Bullet, Core, PlayerBullet, Laser } from "./game/entities.js";

// カスタム絵文字画像のプリロード・キャッシュ。
// 同じURLの画像を何度もロードし直さないようにする。ショートコード名ではなく
// URLをキーにする(連合先が異なると同じショートコードでも別画像になりうるため)。
const imageCache = new Map<string, HTMLImageElement>();

// まだロード中の画像は、ロード完了まで描画をスキップしたいのでMapの値には常に
// HTMLImageElementそのものを入れ、呼び出し側はcomplete/naturalWidthを見て判定する。
export function getOrLoadEmojiImage(url: string): HTMLImageElement {
  const cached = imageCache.get(url);
  if (cached) return cached;

  // crossOriginは付けない: 当たり判定は座標同士の比較のみで行い、canvasから
  // ピクセルを読み取る(getImageData等)ことはしないため、CORS許可は不要。
  // 絵文字配信元がAccess-Control-Allow-Originを返さないケースは珍しくなく、
  // crossOrigin="anonymous"を付けるとその場合に画像読み込み自体が失敗してしまう。
  const img = new Image();
  img.src = url;
  imageCache.set(url, img);
  return img;
}

export function isImageReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

// カスタム絵文字は正方形とは限らない(横長・縦長のものも珍しくない)ため、
// 弾・コア・自機のいずれも無理やり正方形に引き伸ばさない。縦幅(高さ)は
// boxSizeに揃えて統一し、横幅は元の縦横比なりに(boxSizeを超えても)
// そのまま伸ばす(横長のものほど見た目の広さにも差が出た方が弾幕らしく、
// ゲーム性が上がるため)。中心は(x,y)に合わせる。
// なお当たり判定(hitRadius)は見た目の幅とは完全に独立した固定値なので、
// 見た目が横に伸びても判定サイズ自体は変わらない。
function scaledWidthForHeight(img: HTMLImageElement, height: number): number {
  return (img.naturalWidth / img.naturalHeight) * height;
}

function drawImageMatchHeight(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  boxSize: number,
): void {
  const w = scaledWidthForHeight(img, boxSize);
  ctx.drawImage(img, x - w / 2, y - boxSize / 2, w, boxSize);
}

// 自機絵文字がまだ決まっていない(投稿が来ずタイムアウトした等)ときの
// フォールバック用に、既に読み込み済みの絵文字からランダムに1つ返す。
// 1件もなければnull(その場合は追加の投稿を待つしかない)。
export function randomCachedEmojiImage(): HTMLImageElement | null {
  const ready = [...imageCache.values()].filter(isImageReady);
  if (ready.length === 0) return null;
  return ready[Math.floor(Math.random() * ready.length)];
}

// 残機回復弾だけ緑色のグローを添えて、「これは避けるのではなく取りに行く弾」だと
// 一目で分かるようにする。
export function drawBullets(ctx: CanvasRenderingContext2D, bullets: readonly Bullet[], now: number): void {
  for (const b of bullets) {
    if (!isImageReady(b.img)) continue;

    if (b.isLifeUp) {
      const pulse = 0.6 + 0.4 * Math.sin(now / 120);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size * 0.75, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110, 255, 160, ${0.35 * pulse})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(110, 255, 160, ${0.9 * pulse})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      // 黒っぽい絵文字が背景(黒)に溶け込んで見えなくなるのを防ぐため、
      // 弾の背後に薄い白いハローを敷く(明るい絵文字にはほぼ影響しない)。
      // 横長の絵文字は横幅もそれに合わせて楕円にする。
      const haloWidth = scaledWidthForHeight(b.img, b.size);
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, haloWidth * 0.5, b.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fill();
    }

    drawImageMatchHeight(ctx, b.img, b.x, b.y, b.size);
  }
}

// 自機は絵文字画像を中心に描画する。被弾直後の無敵中は点滅させて分かりやすくし、
// 低速(フォーカス)中は東方同様に当たり判定の目安となる小さな点を重ねて表示する。
export function drawPlayer(ctx: CanvasRenderingContext2D, player: Player, now: number): void {
  const isInvincible = now < player.invincibleUntil;
  const blinkVisible = !isInvincible || Math.floor(now / 100) % 2 === 0;

  if (blinkVisible && player.emojiImg && isImageReady(player.emojiImg)) {
    // 弾・コアと同様、黒っぽい絵文字が背景に溶け込まないよう薄い白いハローを
    // 敷く(横長の絵文字は横幅もそれに合わせて楕円にする)。
    const haloWidth = scaledWidthForHeight(player.emojiImg, player.spriteSize);
    ctx.beginPath();
    ctx.ellipse(player.x, player.y, haloWidth * 0.45, player.spriteSize * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fill();
    drawImageMatchHeight(ctx, player.emojiImg, player.x, player.y, player.spriteSize);
  }

  if (player.focused) {
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.hitRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 110, 199, 0.9)";
    ctx.fill();
  }
}

// 自機の弾(単純な光弾。大量の絵文字弾と見分けやすくするため絵文字は使わない)。
export function drawPlayerBullets(ctx: CanvasRenderingContext2D, bullets: readonly PlayerBullet[]): void {
  ctx.fillStyle = "#7cf7ff";
  ctx.shadowColor = "#7cf7ff";
  ctx.shadowBlur = 6;
  for (const b of bullets) {
    ctx.fillRect(b.x - 2, b.y - 8, 4, 16);
  }
  ctx.shadowBlur = 0;
}

const TIER_RING_COLOR: Record<Core["tier"], string> = {
  weak: "rgba(160, 170, 180, 0.7)",
  mid: "rgba(124, 247, 255, 0.8)",
  strong: "rgba(255, 110, 110, 0.85)",
};

// コア(Misskeyの投稿流を弾幕として放つボス役)と、その上のHPバーを描画する。
// 階級(弱/中/強)ごとに縁取りの色を変え、見た目でも区別できるようにする。
export function drawCore(ctx: CanvasRenderingContext2D, core: Core): void {
  ctx.beginPath();
  ctx.arc(core.x, core.y, core.spriteSize / 2 + 4, 0, Math.PI * 2);
  ctx.strokeStyle = TIER_RING_COLOR[core.tier];
  ctx.lineWidth = 3;
  ctx.stroke();

  if (isImageReady(core.img)) {
    // 弾・自機と同様、黒っぽい絵文字が縁取りの内側で見えなくならないよう
    // 薄い白いハローを敷く。横長の絵文字は横幅もそれに合わせて楕円にする。
    const haloWidth = scaledWidthForHeight(core.img, core.spriteSize);
    ctx.beginPath();
    ctx.ellipse(core.x, core.y, haloWidth * 0.45, core.spriteSize * 0.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
    ctx.fill();
    drawImageMatchHeight(ctx, core.img, core.x, core.y, core.spriteSize);
  }

  const barWidth = core.spriteSize * 1.4;
  const barHeight = 6;
  const barX = core.x - barWidth / 2;
  const barY = core.y - core.spriteSize / 2 - barHeight - 8;
  const ratio = Math.max(core.hp / core.maxHp, 0);

  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = ratio > 0.3 ? "#7cf7ff" : "#ff6e6e";
  ctx.fillRect(barX, barY, barWidth * ratio, barHeight);
}

// 強ボス専用のレーザー。予告(telegraph)中は狙いだけを示す点滅する破線、
// 発射(firing)中は当たり判定のある太い発光ビームにする。
export function drawLasers(ctx: CanvasRenderingContext2D, lasers: readonly Laser[], now: number): void {
  for (const laser of lasers) {
    ctx.save();
    ctx.translate(laser.originX, laser.originY);
    ctx.rotate(laser.angle);

    if (laser.state === "telegraph") {
      const pulse = 0.4 + 0.35 * Math.sin(now / 60);
      ctx.strokeStyle = `rgba(255, 90, 90, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(laser.length, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const gradient = ctx.createLinearGradient(0, -laser.width / 2, 0, laser.width / 2);
      gradient.addColorStop(0, "rgba(255, 110, 110, 0)");
      gradient.addColorStop(0.5, "rgba(255, 255, 255, 0.95)");
      gradient.addColorStop(1, "rgba(255, 110, 110, 0)");
      ctx.fillStyle = gradient;
      ctx.shadowColor = "rgba(255, 80, 80, 0.9)";
      ctx.shadowBlur = 18;
      ctx.fillRect(0, -laser.width / 2, laser.length, laser.width);
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }
}
