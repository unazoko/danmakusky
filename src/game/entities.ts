// 自機・弾・コアのエンティティ定義。
// 自機・弾ともに見た目はカスタム絵文字画像そのものだが、当たり判定は見た目より
// 大幅に小さい円にする。見た目では当たっているように見えても実際は避けられる
// 状態を作れる、東方Project由来の弾幕ゲームの定石。

export interface Player {
  x: number;
  y: number;
  spriteSize: number;
  hitRadius: number;
  emojiImg: HTMLImageElement | null;
  // この時刻(performance.now())まで無敵。被弾直後に同じフレームで何度も
  // 判定されて残機が溶けるのを防ぐ(東方含む弾幕ゲームの定石)。
  invincibleUntil: number;
  // 東方の「低速移動(Shift)」に相当。trueの間は移動速度が落ち、当たり判定の
  // 目安となる小さな点を表示する。
  focused: boolean;
}

// 弾の飛び方。vx/vyは常に「今フレームの速度」として使い、位置更新
// (x+=vx*dt)は共通処理で行う。behaviorの種類ごとに、毎フレームvx/vy
// (・orbitのみ位置も直接)を更新する(game/bulletMotion.ts参照)。
export type BulletBehavior =
  // 直進のみ(発生時に決めた速度のまま)。直線弾・自機狙い弾はこれ。
  | { kind: "linear" }
  // ゆっくり追尾。毎フレーム、向きをプレイヤー方向へ少しずつ曲げる。
  | { kind: "homing"; turnRateRadPerSec: number }
  // 円運動。中心点の周りを一定角速度で回り続ける。
  | { kind: "orbit"; centerX: number; centerY: number; radius: number; angle: number; angularSpeedRadPerSec: number }
  // ジグザグ。基準方向に対して左右に周期的に振れる。
  | { kind: "zigzag"; baseAngle: number; speed: number; amplitudeRad: number; angularFreq: number; startedAt: number }
  // 急に方向転換。指定時刻まで直進し、その瞬間だけ新しい向きに切り替える。
  | { kind: "redirect"; triggerAt: number; newAngle: number; speed: number; triggered: boolean }
  // 一定時間停止してから急加速。指定時刻まで停止(速度ゼロ)し、その後は直進。
  | { kind: "delayedAccel"; triggerAt: number; angle: number; speed: number; triggered: boolean }
  // 複数方向への分裂。指定時刻に、その場で複数方向へ分裂した新しい弾を撒く
  // (元の弾は消える)。
  | { kind: "splitter"; triggerAt: number; splitCount: number; speed: number; triggered: boolean }
  // 一定の角速度で弧を描き続ける(プレイヤーを追尾はしない、曲がる向き・
  // 速さは発生時に固定)。ゆっくり追尾(homing)と違い曲線の形が予測できる分、
  // 見た目の面白さ重視のパターン。
  | { kind: "curve"; angle: number; speed: number; curveRadPerSec: number }
  // 速さが正弦波状に変化し続ける(アコーディオンのように間隔が伸び縮みして
  // 見える)。方向は発生時のまま固定。
  | { kind: "pulse"; baseAngle: number; baseSpeed: number; amplitude: number; angularFreq: number; startedAt: number }
  // 発生時はゆっくりだが、飛んでいる間ずっと加速し続ける(上限あり)。
  // 見た目の速度から予測して避けると急加速に間に合わなくなる、油断させる弾。
  | { kind: "accel"; angle: number; speed: number; accelPxPerSec2: number; maxSpeed: number }
  // 指定時刻までは現在の速度のまま飛び、それ以降は自機を追い続ける
  // (中・強ボス撃破時の残機回復弾用。redirectと違い、トリガー後も
  // プレイヤーの動きに追従し続ける)。ただし自機が移動中は追尾せず、
  // 直前の向きを保ったままnormalSpeed(通常弾と同じ速度)で直進する
  // (bulletMotion.ts参照)。
  | {
      kind: "delayedHoming";
      triggerAt: number;
      speed: number;
      turnRateRadPerSec: number;
      triggered: boolean;
      normalSpeed: number;
    };

export interface Bullet {
  id: number;
  img: HTMLImageElement;
  shortcode: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  hitRadius: number;
  spawnedAt: number;
  behavior: BulletBehavior;
  // trueなら「残機回復弾」。当たると残機が1増える(見た目も専用の演出で区別する)。
  isLifeUp?: boolean;
  // splitter等、寿命が尽きて次のフレームで消えるべき弾に立てるフラグ。
  dead?: boolean;
  // GRAZE(ニアミス)判定済みかどうか。同じ弾で何度も加点されないようにする。
  grazed?: boolean;
  // この弾の元になった投稿の永続リンク。結果画面の「あなたを撃墜したノートを見る」ボタン用
  // (main.ts参照)。コア(ボス)の攻撃弾は、そのコアが出現するきっかけと
  // なった投稿のリンクを引き継ぐ(coreManager.ts参照)。
  noteUrl: string | null;
  // trueならコア(ボス)から発射された弾。極端に横長の絵文字だと画面を
  // 埋め尽くしかねないため、描画時のみ縦横比の上限を設けて縮小する
  // (render.ts参照、通常弾には適用しない)。
  isBossBullet?: boolean;
  // 見た目だけの自転速度(ラジアン/秒)。設定されている場合、render.ts側で
  // spawnedAtからの経過時間を使って毎フレーム回転角を計算する(軌道・
  // 当たり判定には一切影響しない、patterns.ts: spinningBullet参照)。
  spinRadPerSec?: number;
}

// コアの強さの階級。
// 弱: 複数体同時出現・移動する・HP低め・攻撃単調・弾少な目
// 中: 位置固定・最大2体同時・弱よりHP高め・螺旋/同心円弾幕
// 強: 移動する(単純な往復/円運動)・最大1体・HPが一番高い
// 出現頻度は 弱 > 中 > 強。
export type CoreTier = "weak" | "mid" | "strong";

// Misskeyの投稿流を弾幕として放つ「コア」。東方のボスに相当する。
export interface Core {
  id: number;
  tier: CoreTier;
  shortcode: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spriteSize: number;
  hitRadius: number;
  img: HTMLImageElement;
  spawnedAt: number;
  nextAttackAt: number;
  // 螺旋・連続回転攻撃用に積み上げていく角度(移動角とは別管理)。
  attackAngle: number;
  // 螺旋のように複数ティックにまたがって発生点の一貫性が必要なパターンを
  // 撃っている間、移動を止めるためのフラグ(coreManager.ts参照)。
  frozenForPattern: boolean;
  // 「ある地点へなめらかに移動→そこで静止して攻撃→また別の地点へ移動」を
  // 繰り返す(東方のボスの動き方を再現するための状態、coreManager.ts参照)。
  moveTargetX: number;
  moveGlideFromX: number;
  moveGlideStartedAt: number;
  moveGlideDurationMs: number;
  nextRetargetAt: number;
  // このコアの出現きっかけとなった投稿の永続リンク(結果画面の
  // 「あなたを撃墜したノートを見る」ボタン用。Bullet.noteUrl参照)。
  noteUrl: string | null;
  // 出現カットイン演出の引用文(装飾記号を取り除いた1行プレーンテキスト、
  // main.ts: playCutIn参照)。使える本文が無かった場合はnull(その場合は
  // flavor.tsのランダム文言にフォールバックする)。
  cutInText: string | null;
  // cutInText中の:shortcode:を実際の画像に差し替えるためのマップ。
  cutInEmojis: Record<string, string> | undefined;
  // 中ボスのみ設定される自動消滅時刻(撃破扱いにはしない、coreManager.ts参照)。
  // 未設定(undefined)なら自動消滅しない。
  expiresAt?: number;
  // 自動消滅の直前、フワッとフェードアウトを始める時刻(render.ts参照)。
  fadeOutStartsAt?: number;
}

// 「群れ」敵(coreManager.ts/swarmManager.ts参照)。弱・中・強のコアとは別枠の
// 短命な雑魚敵で、5体が連続出現し、出現後は位置を固定したまま弾幕を数回
// 放って自動的に消える。撃墜も可能(HPは弱ボスより低い)。
export interface Swarmer {
  id: number;
  shortcode: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spriteSize: number;
  hitRadius: number;
  img: HTMLImageElement;
  spawnedAt: number;
  // この時刻で自動消滅する(倒されなくても)。
  expiresAt: number;
  // フワッと出現・消滅する演出用(render.ts参照)。
  fadeInEndsAt: number;
  fadeOutStartsAt: number;
  attacksFired: number;
  nextAttackAt: number;
  // 同心円弾幕を撃つたびに少しずつ増やす角度(見た目が回転して見えるようにする)。
  attackAngle: number;
  noteUrl: string | null;
}

// 2列×8体の編隊で出現する敵(squadronManager.ts参照)。編隊全体が左右に
// 旋回するように揺れながら、前(row=0)から順に1体ずつ自機狙いの弾を撃つ。
// 1体ごとのHPは低く、容易に撃墜できる。
export interface SquadronUnit {
  id: number;
  shortcode: string;
  img: HTMLImageElement;
  noteUrl: string | null;
  col: number;
  row: number;
  // 前から順に発射する順番を決めるための通し番号(row優先、col次点)。
  order: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  spriteSize: number;
  hitRadius: number;
}

// 自機が撃つ弾。見た目は絵文字ではなく単純な光弾にする
// (画面上の大量の絵文字弾と見分けやすくするため)。
export interface PlayerBullet {
  id: number;
  x: number;
  y: number;
  vy: number;
}

// 強ボス専用の特殊攻撃。まず予告(telegraph、当たり判定なし)で狙いを示し、
// 少し遅れて実際に当たる太いビーム(firing)に切り替わる。origin/angleは
// 予告を出した瞬間の自機位置で固定し(コア本体の位置に関わらず)独立して
// 存在し続ける(発生済みの通常弾がコア本体から独立するのと同じ考え方)。
export type LaserState = "telegraph" | "firing";

export interface Laser {
  id: number;
  originX: number;
  originY: number;
  angle: number;
  length: number;
  width: number;
  state: LaserState;
  // 現在の状態(telegraph/firing)が終わる時刻。
  stateEndsAt: number;
  shortcode: string;
  img: HTMLImageElement;
  // GRAZE(ニアミス)判定済みかどうか。発射中に何度もかすっても1回だけ
  // 加点するためのフラグ(Bullet.grazedと同じ考え方)。
  grazed?: boolean;
  // Bullet.noteUrlと同じ(このレーザーを撃ったコアの出所ノートへのリンク)。
  noteUrl: string | null;
  // プレイ時間3分経過後に有効になる、発射中(firing)だけ働く回転速度。
  // 0/undefinedなら回転しない(coreManager.ts参照)。
  angularVelocityRadPerSec?: number;
  // この時刻以降は回転を止める(2本同時撃ちで互いに近づく向きのとき、
  // 角度が狭くなりすぎる/交差するのを防ぐための上限、coreManager.ts参照)。
  angleFreezeAt?: number;
}

let nextBulletId = 1;
export function createBulletId(): number {
  return nextBulletId++;
}

let nextCoreId = 1;
export function createCoreId(): number {
  return nextCoreId++;
}

let nextLaserId = 1;
export function createLaserId(): number {
  return nextLaserId++;
}

let nextSwarmerId = 1;
export function createSwarmerId(): number {
  return nextSwarmerId++;
}

let nextSquadronUnitId = 1;
export function createSquadronUnitId(): number {
  return nextSquadronUnitId++;
}
