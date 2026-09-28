# Playground Game Boy raw API

`await createSoundChip('gameboy')` が `writeRegister(offset, value)`、`reset()`、
`dispose()` を持つ独立したDMG音源を返す。offsetは0xFF10からの相対値（0〜0x2F）。
高水準Synth APIの追加は別作業。

Workerとメイン側の実行環境に同じクライアントを公開。専用MessagePortで
AudioWorkletへレジスタを送り、共有master入力で他の音源とミックスする。
既存のStop・再Run・破棄の管理対象に追加。ゲームROMは不要。

例は`examples/chip-raw/`に配置し、basicの次に見えるようにする。
既存の`fm/raw-write-beep.js`は`chip-raw/ym2612-raw-write-beep.js`へ移動。
Game Boyは`chip-raw/gameboy-raw-write-sample.js`を追加した。

実WASM / Workletと例のコードを使い、矩形波2CH・波形RAM・ノイズ2モードの
発音、左右出力、解放を自動検証。関連45テスト成功。
ブラウザーでの実操作と聴感は未確認。投稿文は`devlog_chip_raw.md`に下書きとして用意し、未投稿。

## サンプルの変数名衝突修正

サンプルの`const write`がPlaygroundの注入引数`write`と衝突して
AsyncFunction構築時にSyntaxErrorになっていた。`gbWrite`へ改名し、examplesを再生成。
実際のPlayground全引数によるコンパイルテストと、`write`引数を含む実コア再生テストを追加した。
