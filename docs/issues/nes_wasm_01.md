# NES＋FDSのWASM・Web package対応

2026-10-22。Native対応に続き、Browser Playgroundと`tetorica-fm2612`の通常のNES再生をWASMへ移す。

## 実装方針

- Nativeから移したC++コアを`third_party/tetorica-nes/`の共通原典とし、WASMとNativeで同じDSPを使う。
- Nativeの独立リポジトリーにもコアを同期し、ハッシュで差分を検出する。旧JSの原典スナップショットは比較基準として保持する。
- `await createSoundChip('nes')`と`await NesApu.create()`はWASMを使う。従来の同期コンストラクター`new NesApu(...)`はJSの互換経路として残す。
- PlaygroundはMainでWASMを読み込み、AudioWorkletへ渡して初期化する。初期化前は無音、初期化失敗はエラーとし、暗黙にJS音源へ切り替えない。
- 既存のNesApuSynth、レジスター命令、DMC RAM、FDS波形・変調、Keyboard、Operators、Main／Workerの制御を維持する。
- ブロック単位でC++を呼び、Workletは再利用するPCM viewを使う。コピーを返す公開`generateStereo()`の配列寿命は維持する。
- Nativeコア内のDC除去と、Browser側のclock変更を二重適用しない。
- `nesapu_wasm.js`／`.wasm`、ソース、再ビルド手順、Apache-2.0／MITライセンスと著作者情報をWeb・npmの配布物に含める。
- packageは0.2.24としてローカル配布物を作る。npm公開は今回の作業に含めない。

Analyzerおよび`tetorica-vgm`の既存JSエンジンは維持する。Analyzerのopaque stateによるseekは今回の移行対象に含めない。

## 確認

```sh
sh scripts/build_nesapu_wasm.sh
node scripts/check_native_nes.mjs --wasm --out /private/tmp/nes-wasm-parity.json
npm run build:fm2612
npm run test:fm2612
npm run test:fm2612:types
```

Native C++／WASM／旧JSのPCM比較に加え、実WASMを使うDirect／Worklet、Main／Worker、Keyboard／Operators、RAM・波形・Stop・clockを確認する。
Browserの確認は音声デバイスへの接続と聴き比べを分けて扱い、どこまで確認したかを結果に記録する。

## 検証結果

- Native C++／WASM／従来JS: 44,100／48,000／96,000 Hz、72ケース・710,784ステレオフレーム。すべて最大差0。
- JS全体: 3,172件成功、失敗0。従来JSのAnalyzer・CLI、Native制御の回帰確認を含む。
- npm 0.2.24: 702ファイルのtgzを作成。隔離環境へのインストール、実PCM生成、公開exports、NodeNext／Bundler／Browser型チェック成功。
- flat配置のnpm packageでChromium／WebKit確認成功。Direct、汎用Worklet、Playground Main／Workerの実WASM再生・音程・既定asset URLを確認した。
- Web PlaygroundでChromium／WebKit確認成功。Main／WorkerのPulse・FDSの440 Hz、DMC、6CHのPC Keyboard、Operatorsの編集・試聴・領域外でのrelease、Stop後の波形・RAM保持を確認した。
- Browser確認では実Worklet内の`chip.backend`が`wasm`であることを確認し、NES modeでYM2612／PSG音源を生成しないことも確認した。Native IPCのmockによる検証ではない。
- Native用の原典15ファイル・C++ mirror 2ファイルのハッシュ確認に成功。Tauriのoffline・lockedビルド成功。
- 最終Tauri同梱データ812ファイルでもChromium／WebKitの実WASM確認に成功。既存NativeバックエンドのIPC mock全体確認も両Browserで成功。Native NESのRustテスト13件成功。

ローカルnpm配布物は`tetorica-fm2612-0.2.24.tgz`。PlaygroundのZIPは`release/hello_ymfm_wasm_dev_nes_wasm_20261022_itch_playground.zip`。
Tauriへの取り込みとハッシュ確認まで完了し、npm／itch.ioへの公開は行っていない。

Workletは動的`import()`を実行できないため、専用・汎用の両WorkletからWASM adapterを静的にimportする。
CHのenableは従来どおり公開`writeRegister($4015)`を一度通し、Operatorsの観測とDMCの完了状態を維持する。
停止の検証は`playback === 'stopped'`だけではなく`stopWithFade()`の完了を待つ。
Pulseの試聴にはD3以上の範囲を使い、従来JSでも起きる既定sweep設定による低音のmuteをWASM差と誤認しない。

最終出力のPCMをheadless Browserで測定した。実機での聴き比べ・長時間負荷確認は未実施。
詳細は[検証データ](nes_wasm_validation_20261022.json)に保存する。
