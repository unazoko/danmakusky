// Misskeyの公開ストリーム(globalTimelineチャンネル)へブラウザから直接接続する。
// サーバー側で投稿を中継・保存する処理は一切持たない。
//
// 接続仕様はmisskey-dev/misskey・misskey-dev/misskey.jsの実装を直接確認して
// 実装している(推測では書いていない)。
// - 接続先: wss://{host}/streaming (匿名アクセスなら追加のクエリ不要)
// - チャンネル参加: {"type":"connect","body":{"channel":"globalTimeline","id":<任意文字列>}}
// - 受信: {"type":"channel","body":{"id":<同じ文字列>,"type":"note","body":<Noteオブジェクト>}}
// globalTimelineチャンネル自体はrequireCredential=false(匿名OK)だが、インスタンス側の
// ロールポリシー(gtlAvailable)次第で匿名ユーザーには何も配信されないインスタンスがある。
// これは接続エラーにはならず「ずっと何も届かない」状態になるため、別途タイムアウト監視が必要。
//
// connectのparamsは指定していないため、withRenotesはサーバー側のデフォルト値(true)になる
// (global-timeline.ts: `this.withRenotes = !!(params.withRenotes ?? true);`)。つまり
// 単純リノート(コメント無し)も配信される。ただし単純リノートはtext/cwがnullで、
// 元投稿の中身はnote.renoteに入っている(MisskeyNote.renote参照、noteEmoji.ts側で読む)。
//
// 個別ノートへのリアクション購読も、misskey-dev/misskey本体(Connection.ts・
// ReactionService.ts)を直接確認して実装している。
// - 購読: {"type":"subNote","body":{"id":<ノートID>}} (channelの仕組みとは別の、
//   トップレベルのメッセージタイプ)
// - 解除: {"type":"unsubNote","body":{"id":<ノートID>}}
// - 受信: {"type":"noteUpdated","body":{"id":<ノートID>,"type":"reacted","body":
//   {"reaction":"...", "emoji": {"name":"shortcode@host"|"shortcode@.", "url":"..."} | null,
//   "userId":"..."}}}
//   emojiがnullの場合はUnicode標準絵文字でのリアクションなので対象外にする。

export interface MisskeyNote {
  id: string;
  text: string | null;
  cw: string | null;
  // ローカル/リモート双方の絵文字ショートコード→絶対URL(サーバー側で解決済み)。
  emojis?: Record<string, string>;
  // 受信した時点で既に付いているカスタム絵文字リアクションのスナップショット
  // (NoteEntityService.ts参照)。キー形式はemoji.nameと同じ"shortcode@host"。
  // 注意: リモート(他インスタンス)のカスタム絵文字リアクションのみが対象で、
  // ローカル(同一インスタンス)のカスタム絵文字リアクションはここに含まれない
  // (reactionEmojiNamesの絞り込み条件`!x.includes('@.')`によるMisskey側の仕様)。
  reactionEmojis?: Record<string, string>;
  // リノート/引用リノートの場合、リノート元の投稿がそのままpackされた形で入る
  // (global-timeline.ts等で確認済み)。単純リノートはtext/cwがnullで、
  // 本文の中身はここにしか無い。
  renote?: MisskeyNote | null;
}

export interface CustomEmojiReaction {
  shortcode: string;
  url: string;
}

export type StreamStatus =
  | "connecting"
  | "online" // 少なくとも1件のnoteを受信済み
  | "idle-timeout" // 接続はできたが一定時間noteが1件も来ない(インスタンス側でGTLが無効化されている等)
  | "reconnecting"
  | "closed";

interface MisskeyStreamCallbacks {
  onNote: (note: MisskeyNote) => void;
  onStatusChange: (status: StreamStatus) => void;
}

// チャンネル購読IDは「このWebSocket接続内で一意」であれば足り、暗号学的な
// 強度は不要。crypto.randomUUID()はセキュアコンテキスト(https、または
// localhost)でしか使えず、同じLAN内の他PCから素のHTTP(例: http://192.168.x.x)
// でアクセスした場合に例外を投げてストリーム接続全体が止まってしまうため、
// あえて使わない。
function generateChannelId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const CHANNEL = "globalTimeline";
// 再接続の間隔(切断が続くほど間隔を延ばす。最後の値で頭打ち)。
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
// 接続直後、一度もnoteを受信しないままこの時間が経ったら「配信されていない」と判断する。
// (「静かなら簡単・活発なら難しい」という設計上、note間隔が空くこと自体は
// 正常な低難易度状態なので、初回受信より後はこのタイムアウトを再武装しない)
const INITIAL_NOTE_TIMEOUT_MS = 10_000;

interface ChannelMessage {
  type: "channel";
  body: { id: string; type: string; body: unknown };
}

function isChannelMessage(value: unknown): value is ChannelMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "channel" && typeof v.body === "object" && v.body !== null;
}

interface NoteUpdatedMessage {
  type: "noteUpdated";
  body: { id: string; type: string; body: unknown };
}

function isNoteUpdatedMessage(value: unknown): value is NoteUpdatedMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "noteUpdated" && typeof v.body === "object" && v.body !== null;
}

interface ReactedEventBody {
  reaction: string;
  emoji: { name: string; url: string } | null;
  userId: string;
}

// emoji.nameは "shortcode@host"(リモート)または"shortcode@."(ローカル)の形式
// (ReactionService.ts参照)なので、"@"より前だけをショートコードとして扱う。
// note.reactionEmojisのキーも同じ形式(NoteEntityService.ts: reactionEmojiNamesの
// 組み立て方参照)なので、noteEmoji.ts側でも共通で使う。
export function parseReactionShortcode(name: string): string {
  return name.split("@")[0];
}

export class MisskeyStream {
  private readonly host: string;
  private readonly channelId: string;
  private readonly callbacks: MisskeyStreamCallbacks;
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: number | undefined;
  private initialNoteTimer: number | undefined;
  private hasReceivedAnyNote = false;
  private manuallyClosed = false;
  private readonly reactionSubscribers = new Map<string, (r: CustomEmojiReaction) => void>();

  constructor(host: string, callbacks: MisskeyStreamCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.channelId = generateChannelId();
  }

  connect(): void {
    this.manuallyClosed = false;
    this.callbacks.onStatusChange(this.hasReceivedAnyNote ? "reconnecting" : "connecting");

    const ws = new WebSocket(`wss://${this.host}/streaming`);
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      ws.send(
        JSON.stringify({
          type: "connect",
          body: { channel: CHANNEL, id: this.channelId },
        }),
      );
      if (!this.hasReceivedAnyNote) this.armInitialNoteTimer();
      // subNote購読は接続ごとのサーバー側状態なので、再接続時は当然全て失われている。
      // 呼び出し側に再購読を強制する複雑さを持ち込むほどの機能ではない
      // (リアクションの取りこぼしが多少あっても実害の無い演出的な機能のため)ので、
      // ここでは単に手元の記録だけ空にする。
      this.reactionSubscribers.clear();
    });

    ws.addEventListener("message", (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (isNoteUpdatedMessage(parsed)) {
        this.handleNoteUpdated(parsed.body);
        return;
      }

      if (!isChannelMessage(parsed)) return;
      if (parsed.body.id !== this.channelId || parsed.body.type !== "note") return;

      if (!this.hasReceivedAnyNote) {
        this.hasReceivedAnyNote = true;
        this.clearInitialNoteTimer();
        this.callbacks.onStatusChange("online");
      }
      this.callbacks.onNote(parsed.body.body as MisskeyNote);
    });

    ws.addEventListener("close", () => {
      if (this.manuallyClosed) {
        this.callbacks.onStatusChange("closed");
        return;
      }
      this.scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // closeイベントが後続で発火し再接続処理はそちらに任せるため、ここではws自体を閉じるのみ。
      ws.close();
    });
  }

  disconnect(): void {
    this.manuallyClosed = true;
    window.clearTimeout(this.reconnectTimer);
    this.clearInitialNoteTimer();
    this.ws?.close();
    this.ws = null;
  }

  // 指定ノートへの新規リアクションを購読する。同じノートを二重購読しない
  // (呼び出し側=ReactionTrackerが件数上限・自動解除を管理する)。
  subscribeToNoteReactions(noteId: string, onReaction: (r: CustomEmojiReaction) => void): void {
    if (this.reactionSubscribers.has(noteId)) return;
    this.reactionSubscribers.set(noteId, onReaction);
    this.ws?.send(JSON.stringify({ type: "subNote", body: { id: noteId } }));
  }

  unsubscribeFromNoteReactions(noteId: string): void {
    if (!this.reactionSubscribers.delete(noteId)) return;
    this.ws?.send(JSON.stringify({ type: "unsubNote", body: { id: noteId } }));
  }

  private handleNoteUpdated(body: { id: string; type: string; body: unknown }): void {
    if (body.type !== "reacted") return;
    const subscriber = this.reactionSubscribers.get(body.id);
    if (!subscriber) return;

    const reacted = body.body as ReactedEventBody;
    if (!reacted.emoji) return; // Unicode標準絵文字でのリアクションは対象外
    subscriber({
      shortcode: parseReactionShortcode(reacted.emoji.name),
      url: reacted.emoji.url,
    });
  }

  private scheduleReconnect(): void {
    const delay =
      RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt++;
    this.callbacks.onStatusChange("reconnecting");
    this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
  }

  private armInitialNoteTimer(): void {
    this.clearInitialNoteTimer();
    this.initialNoteTimer = window.setTimeout(() => {
      if (!this.hasReceivedAnyNote) this.callbacks.onStatusChange("idle-timeout");
    }, INITIAL_NOTE_TIMEOUT_MS);
  }

  private clearInitialNoteTimer(): void {
    if (this.initialNoteTimer !== undefined) {
      window.clearTimeout(this.initialNoteTimer);
      this.initialNoteTimer = undefined;
    }
  }
}
