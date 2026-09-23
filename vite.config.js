import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [],

  server: {
    port: 5173,
    strictPort: true,
    // public/sounds配下の音声ファイルはビルド成果物として配信されるだけで
    // ホットリロード対象にする必要が無い。Windows環境で他プロセス(同期・
    // スキャン等)が音声ファイルを一時的にロックしていると、chokidarの
    // watchがEBUSYで例外を投げ開発サーバーごと落ちることがあったため、
    // そもそも監視対象から外す。
    watch: {
      ignored: ["**/public/sounds/**"],
    },
  },
});
