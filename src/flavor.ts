// 無駄に本気のSF系システムメッセージと、ゲームの勝敗・難易度には一切影響しない
// ハッタリ数値・演出文言をまとめる飾りづけ専用モジュール(ロジックへの影響ゼロ)。
import type { CoreTier } from "./game/entities.js";

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// --- ハッタリ数値(sin波+ノイズで常に揺らいでいるだけで、何の実測値でもない) ---

export function fakeDensityPercent(now: number): number {
  const wave = Math.sin(now / 900) * 260 + Math.sin(now / 233) * 140;
  return Math.max(0, Math.round(420 + wave));
}

export function fakeSyncRate(now: number): number {
  return Math.round(50 + Math.sin(now / 611) * 49);
}

const THREAT_LEVELS = ["UNDEFINED", "CLASSIFIED", "N/A", "???", "OVER 9000", "計測不能", "HIGH(自称)"] as const;
export function fakeThreatLevel(now: number): string {
  return THREAT_LEVELS[Math.floor(now / 4000) % THREAT_LEVELS.length];
}

// --- 起動シーケンス用の飾り文言 ---

const BOOT_FLAVOR_LINES = [
  "CALIBRATING BULLET-HELL MATRIX...",
  "DECRYPTING FEDERATED TIMELINE...",
  "LOADING CUSTOM EMOJI WARHEAD DATABASE...",
  "RETICULATING SPLINES...",
  "ESTABLISHING QUANTUM HANDSHAKE...",
  "THREAT ASSESSMENT: INCONCLUSIVE",
  "INITIALIZING EMOJI CONTAINMENT PROTOCOL...",
  "CONTACTING FEDERATED DEFENSE NETWORK...",
  "RECONSTRUCTING BATTLEFIELD FROM PUBLIC POSTS...",
  "ANALYZING HOSTILE MEMES...",
  "ALLOCATING EMERGENCY EMOJI COUNTERMEASURES...",
  "CALIBRATING SOMETHING IMPORTANT...",
  "PRETENDING TO KNOW WHAT WE ARE DOING...",
  "CHECKING WHETHER THIS WAS A GOOD IDEA...",
  "ASKING THE TIMELINE TO CALM DOWN...",
];
export function randomBootFlavorLine(): string {
  return pick(BOOT_FLAVOR_LINES);
}

// --- ゲーム中にランダムで挟む、意味のない一言(演出のみ・当たり判定等には無関係) ---

const GLITCH_LINES = [
  "> 検閲済み <",
  "SYSTEM: 特に意味はありません",
  "ERROR 404: {ここにステータス}",
  "再起動しません",
  "いつもより多めに回しております",
  "気にしないでください",
  "この演出に深い意味はない",
  "STATUS: たぶん大丈夫",
  "処理中(何も処理していない)",
  "ANOMALY DETECTED (仕様です)",
  "SYSTEM: 異常なし(異常はある)",
  "戦況を確認中……確認を終了しました",
  "現在、非常に重要な何かが起きています",
  "絵文字密度が高まっています。たぶん。",
  "未確認の何かを確認しました",
  "これは想定されていた想定外です",
  "WARNING: WARNING",
  "SYSTEM: 落ち着いてください",
  "落ち着ける状況ではありません",
  "連合TLとの同期を試みています",
  "敵性反応を確認……パターンE 絵文字です",
  "不要な処理を実行しています",
  "重要ではない処理を優先しています",
  "現在の状況: 非常に状況",
  "戦術的に何もしていません",
  "防衛システムは正常に正常です",
  "この情報はあなたに必要ありません",
  "機密情報: 特にありません",
  "作戦名を忘れました",
  "作戦名を思い出しました。忘れました",
];
export function randomGlitchLine(): string {
  return pick(GLITCH_LINES);
}

// --- 撃墜(ゲームオーバー)時の煽り文言 ---

const DEATH_INTROS = [
  "正体不明の絵文字弾が\n防衛ラインを突破しました",
  "敵対的な絵文字との\n致命的な接触を確認",
  "防衛網機能不全\n絵文字が機体を侵徹",
  "SOUSA-MISS",
  "回避に失敗しました",
  "起床が遅延しました",
  "防衛ライン崩壊\n原因：絵文字",
  "回避行動に失敗\n大変遺憾です",
  "致命的損傷を確認",
  "相手は絵文字だぞ!?",
  "もっとこう……なんかあるだろ",
  "防御システム全滅\n絵文字に負けました",
  "防衛作戦終了\nお疲れさまでした",
];
export function randomDeathIntro(): string {
  return pick(DEATH_INTROS);
}

const SYSTEM_STATUS_LINES = [
  "embarrassing",
  "catastrophic",
  "so uncool",
  "気まずい",
  "台無し",
  "N/A(見なかったことにしてください)",
  "ルヴァ○パーティー"
];
export function randomSystemStatus(): string {
  return pick(SYSTEM_STATUS_LINES);
}

// --- コア撃破・残機回復時の一言 ---

const CORE_DEFEAT_LINES = ["HOSTILE CORE NEUTRALIZED", "コア消滅を確認", "TARGET ELIMINATED", "撃墜完了"];
export function randomCoreDefeatLine(): string {
  return pick(CORE_DEFEAT_LINES);
}

const LIFE_UP_LINES = [
  "VITALITY RESTORED",
  "残機が回復しました",
  "LIFE UP! ラッキー",
  "SYSTEM: 生き返った",
  "うれしいね",
  "EMERGENCY REVIVAL SUCCESSFUL",
  "死んでなかったことにします",
  "まだやれます",
  "奇跡です",
  "なぜか生きています",
  "残機が増えました。なぜ？",
  "SYSTEM: もう一回だけ",
  "生命活動を再開しました",
  "復活しました",
  "死ぬにはまだ早い",
];
export function randomLifeUpLine(): string {
  return pick(LIFE_UP_LINES);
}

// --- コア出現時のカットイン演出(東方Project的なボス登場演出) ---
// 雑魚(weak)はひっきりなしに出現するので対象外にし、中ボス・強ボスの
// 登場時だけ出す(演出過多でプレイの邪魔にならないようにするため)。

const CUT_IN_TIER_LABEL: Record<CoreTier, string> = {
  weak: "WEAK CORE",
  mid: "MID CORE APPROACHING",
  strong: "★ STRONG CORE APPROACHING ★",
};
export function cutInTierLabel(tier: CoreTier): string {
  return CUT_IN_TIER_LABEL[tier];
}

const CUT_IN_QUOTES: Record<CoreTier, readonly string[]> = {
  weak: [
    "特に強くはない",
    "たぶん大丈夫",
    "これは前座です",
    "問題ありません",
  ],
  mid: [
    "そこそこやるようだ",
    "少しは本気を出すか",
    "Misskeyって自由ですか？",
    "ざぁこ♥",
    "さらに前へ…もっと前へ",
    "文明の鉄槌を叩き込んでやれ！"
  ],
  strong: [
    "覚悟した方がいい",
    "俺はかーなーり強い",
    "見せてもらおうか、連合TLの流量とやらを",
    "逃げたら一つ、進めば瓜二つ",
    "この戦いに意味はない",
    "意味はないが、負けるわけにはいかない",
  ],
};
export function randomCutInQuote(tier: CoreTier): string {
  return pick(CUT_IN_QUOTES[tier]);
}
