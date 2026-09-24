import type { Player, Bullet, Core, PlayerBullet, Laser, Swarmer, SquadronUnit } from "./game/entities.js";

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

// ボス(コア)から発射される弾専用の縦横比上限。極端に横長の絵文字
// (縦横比1:4超)がそのまま弾になると画面を埋め尽くしかねないため、
// 縦横比を維持したまま「1:7のときの横幅」を上限に縮小して描画する
// (縦横比が1:7以下の絵文字や、通常弾・コア本体・自機には影響しない)。
const BOSS_BULLET_MAX_ASPECT = 7;

// 指定した縦横比の上限(maxAspect)を超えない範囲で、縦横比を維持した
// 描画サイズを返す。上限を超える場合は横幅をmaxAspect*boxSizeまで
// 縮小し、縦幅もそれに合わせて縦横比なりに縮む(=全体が小さくなる)。
function boxSizeFor(
  img: HTMLImageElement,
  boxSize: number,
  maxAspect: number,
): { width: number; height: number } {
  const ratio = img.naturalWidth / img.naturalHeight;
  if (ratio <= maxAspect) return { width: ratio * boxSize, height: boxSize };
  const width = maxAspect * boxSize;
  return { width, height: width / ratio };
}

function drawImageMatchHeight(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  boxSize: number,
  maxAspect: number = Infinity,
): void {
  const { width, height } = boxSizeFor(img, boxSize, maxAspect);
  ctx.drawImage(img, x - width / 2, y - height / 2, width, height);
}

// 画像がまだ読み込めていない(ロード中・失敗いずれも)場合の仮図形の色。
// 自機は六角形、敵(コアの本体・弾)は三角形にする。何も描かないと
// 「見えない弾/敵」になってしまうための保険。
const PLAYER_FALLBACK_COLOR = "rgba(124, 247, 255, 0.9)";
const ENEMY_FALLBACK_COLOR = "rgba(255, 110, 110, 0.9)";

function drawFallbackPolygon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  sides: number,
  color: string,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * i) / sides;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawPlayerFallback(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  drawFallbackPolygon(ctx, x, y, radius, 6, PLAYER_FALLBACK_COLOR);
}

function drawEnemyFallback(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  drawFallbackPolygon(ctx, x, y, radius, 3, ENEMY_FALLBACK_COLOR);
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
    if (!isImageReady(b.img)) {
      // 画像が取得できない敵弾を透明にしない(見えない弾になってしまうため)。
      drawEnemyFallback(ctx, b.x, b.y, b.size * 0.55);
      continue;
    }

    const maxAspect = b.isBossBullet ? BOSS_BULLET_MAX_ASPECT : Infinity;

    // 自転する弾(patterns.ts: spinningBullet)は、見た目だけ経過時間に応じて
    // 回転させる(軌道・当たり判定には影響しない)。
    const spinning = !!b.spinRadPerSec;
    if (spinning) {
      const spinAngle = b.spinRadPerSec! * ((now - b.spawnedAt) / 1000);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(spinAngle);
      ctx.translate(-b.x, -b.y);
    }

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
      // 横長の絵文字は横幅もそれに合わせて楕円にする(ボス弾は縦横比上限後の
      // サイズに合わせる)。
      const { width: haloWidth, height: haloHeight } = boxSizeFor(b.img, b.size, maxAspect);
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, haloWidth * 0.5, haloHeight * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fill();
    }

    drawImageMatchHeight(ctx, b.img, b.x, b.y, b.size, maxAspect);

    if (spinning) ctx.restore();
  }
}

// 自機は絵文字画像を中心に描画する。被弾直後の無敵中は点滅させて分かりやすくし、
// 低速(フォーカス)中は東方同様に当たり判定の目安となる小さな点を重ねて表示する。
export function drawPlayer(ctx: CanvasRenderingContext2D, player: Player, now: number): void {
  const isInvincible = now < player.invincibleUntil;
  const blinkVisible = !isInvincible || Math.floor(now / 100) % 2 === 0;

  if (blinkVisible) {
    if (player.emojiImg && isImageReady(player.emojiImg)) {
      // 弾・コアと同様、黒っぽい絵文字が背景に溶け込まないよう薄い白いハローを
      // 敷く(横長の絵文字は横幅もそれに合わせて楕円にする)。
      const haloWidth = scaledWidthForHeight(player.emojiImg, player.spriteSize);
      ctx.beginPath();
      ctx.ellipse(player.x, player.y, haloWidth * 0.45, player.spriteSize * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fill();
      drawImageMatchHeight(ctx, player.emojiImg, player.x, player.y, player.spriteSize);
    } else {
      // 自機絵文字が未取得の場合、自機自体が見えなくなってしまわないよう
      // 仮図形(六角形)を表示する。
      drawPlayerFallback(ctx, player.x, player.y, player.spriteSize * 0.5);
    }
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

// 中ボスの自動消滅直前(fadeOutStartsAt〜expiresAt)だけフワッとフェード
// アウトするアルファ値。対象外(fadeOutStartsAt/expiresAt未設定)は常に1。
function coreAlpha(core: Core, now: number): number {
  if (core.fadeOutStartsAt === undefined || core.expiresAt === undefined) return 1;
  if (now <= core.fadeOutStartsAt) return 1;
  const span = Math.max(core.expiresAt - core.fadeOutStartsAt, 1);
  return Math.max(0, Math.min(1, (core.expiresAt - now) / span));
}

// コア(Misskeyの投稿流を弾幕として放つボス役)と、その上のHPバーを描画する。
// 階級(弱/中/強)ごとに縁取りの色を変え、見た目でも区別できるようにする。
export function drawCore(ctx: CanvasRenderingContext2D, core: Core, now: number): void {
  const alpha = coreAlpha(core, now);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;

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
  } else {
    // コア絵文字が未取得の場合、ボス自体が見えなくなってしまわないよう
    // 仮図形(三角形)を表示する。
    drawEnemyFallback(ctx, core.x, core.y, core.spriteSize * 0.5);
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

  ctx.restore();
}

const SWARMER_RING_COLOR = "rgba(255, 200, 90, 0.85)";

// 出現・消滅の瞬間だけフワッとフェードするアルファ値を計算する
// (寿命の最初と最後、fadeInEndsAt/fadeOutStartsAtで挟まれた区間は1)。
function swarmerAlpha(s: Swarmer, now: number): number {
  if (now < s.fadeInEndsAt) {
    const span = Math.max(s.fadeInEndsAt - s.spawnedAt, 1);
    return Math.max(0, Math.min(1, (now - s.spawnedAt) / span));
  }
  if (now > s.fadeOutStartsAt) {
    const span = Math.max(s.expiresAt - s.fadeOutStartsAt, 1);
    return Math.max(0, Math.min(1, (s.expiresAt - now) / span));
  }
  return 1;
}

// 「群れ」敵(coreManager.tsとは別枠の短命な雑魚敵、swarmManager.ts参照)。
// コアと同様の見た目だが、縁取りの色を専用にして見分けられるようにし、
// 出現・消滅の瞬間はフワッとフェードさせる。
export function drawSwarmers(ctx: CanvasRenderingContext2D, swarmers: readonly Swarmer[], now: number): void {
  for (const s of swarmers) {
    const alpha = swarmerAlpha(s, now);
    if (alpha <= 0) continue;
    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.beginPath();
    ctx.arc(s.x, s.y, s.spriteSize / 2 + 4, 0, Math.PI * 2);
    ctx.strokeStyle = SWARMER_RING_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();

    if (isImageReady(s.img)) {
      const haloWidth = scaledWidthForHeight(s.img, s.spriteSize);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, haloWidth * 0.45, s.spriteSize * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fill();
      drawImageMatchHeight(ctx, s.img, s.x, s.y, s.spriteSize);
    } else {
      drawEnemyFallback(ctx, s.x, s.y, s.spriteSize * 0.5);
    }

    const barWidth = s.spriteSize * 1.2;
    const barHeight = 5;
    const barX = s.x - barWidth / 2;
    const barY = s.y - s.spriteSize / 2 - barHeight - 6;
    const ratio = Math.max(s.hp / s.maxHp, 0);
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = ratio > 0.3 ? "#ffd25a" : "#ff6e6e";
    ctx.fillRect(barX, barY, barWidth * ratio, barHeight);

    ctx.restore();
  }
}

const SQUADRON_RING_COLOR = "rgba(140, 200, 255, 0.85)";

// 2列×8体の編隊で出現する敵(coreManager.tsとは別枠、squadronManager.ts参照)。
// 1体ごとのHPが低いことが伝わるよう、他の敵よりHPバーを薄く小さめにする。
export function drawSquadronUnits(ctx: CanvasRenderingContext2D, units: readonly SquadronUnit[]): void {
  for (const u of units) {
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.spriteSize / 2 + 3, 0, Math.PI * 2);
    ctx.strokeStyle = SQUADRON_RING_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (isImageReady(u.img)) {
      const haloWidth = scaledWidthForHeight(u.img, u.spriteSize);
      ctx.beginPath();
      ctx.ellipse(u.x, u.y, haloWidth * 0.45, u.spriteSize * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
      ctx.fill();
      drawImageMatchHeight(ctx, u.img, u.x, u.y, u.spriteSize);
    } else {
      drawEnemyFallback(ctx, u.x, u.y, u.spriteSize * 0.5);
    }

    const barWidth = u.spriteSize;
    const barHeight = 4;
    const barX = u.x - barWidth / 2;
    const barY = u.y - u.spriteSize / 2 - barHeight - 5;
    const ratio = Math.max(u.hp / u.maxHp, 0);
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = ratio > 0.3 ? "#8cc8ff" : "#ff6e6e";
    ctx.fillRect(barX, barY, barWidth * ratio, barHeight);
  }
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
