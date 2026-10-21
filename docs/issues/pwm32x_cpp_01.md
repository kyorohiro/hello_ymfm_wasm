# 32X PWM を C++ / WASM / Native で共用する

2026-10-22。既存の MAME 由来 JavaScript PWM の音を保ちながら、Browser / npm は WASM、Tauri は C++ を直接使う。

## 実装

- `wasm/pwm32x_core.h` が共通コア。3段FIFO、overflow、routing、cycle 0 / 1、underrun保持、割り込みカウント、フレーム内の時間平均を従来JSに合わせる。浮動小数演算の結合を無効にしてNative ARM64でも同じ計算順序を使う。
- `wasm/pwm32x_wasm.cpp` と `scripts/build_pwm32x_wasm.sh` でWASMをビルドする。`PWM32X.create()` / `createSoundChip('pwm')` は既定でWASM。同期の `new PWM32X()` と明示的な `implementation:'js'` は互換・比較用として維持する。WASMの読込み失敗はエラーにする。
- PWM専用／共通AudioWorklet、MegaSynth、オフラインNode、非同期Genesis / VGM経路を接続する。Workletは静的にWASMラッパーとfactoryを読込み、バイナリーをMainから渡す。レンダー用メモリーは起動時に確保する。
- Tauriの32Xは既存のFM / PSG / RF5C164とPWMをNative側で混合する。UIの保存済みmode ID `genesis-full` は維持し、Native内部の `32x` へ対応づける。32X NukedはWeb Audio。
- `pwm` / `useSoundChip('pwm')`、Main / Worker、register read / write、frame指定の予約書込み、clock、PWMミキサー、チップ情報表示に対応する。共通FX / liveFx / monitor / 最終出力録音へ入る。
- Stopは予約・FIFO・保持出力を消し、clock / routing / cycleを保持する。resetはレジスターも初期化する。古い演奏・loop ownerからの予約が次の演奏を再開しないようにする。
- Nativeの大量予約はcontrol側で検証・ソートし、音声callbackには予約バッチのcursorを渡す。callbackで全件の登録・ソートや最終メモリー解放を行わない。
- npm / CLI / Playground / Synth / Analyzerの配布物にWASMペア・必要モジュール・ソースとBSD通知を含める。Web Audioを既定に保つ。

## 検証と範囲

- Native C ABIと従来JS：57ケース、466,944ステレオフレーム、PCM差分0。44.1 / 48 / 96 kHz、FIFO / timer / routing / reset / stopを含む。ラッパーのrender中malloc / freeは0。
- WASMとJS：32 / 44.1 / 48 / 96 kHz、DAC / dutyのPCM・FIFO・phase・割り込みカウント・snapshotを照合。実WASMを使う両Workletのレンダー中のWASM追加確保は0。
- 隔離したCLI配布物：8,192ステレオフレームをJSと照合し差分0。VGM fixtureの再生とWAV出力を確認。
- 全体回帰：JS 3,220件成功（並列数4）、Native 169件成功・4件ignore。Native PWMの17件は、大量予約・owner取消・未来時刻Resetとの順序・RF5C164併用を含む。`cargo build --offline --locked` 成功。
- Chromium / WebKit：Native接続をmockしたMain / Worker・画面全体の回帰を、ソースと最終Playground配布物で確認。Browser PWMは実WASM / AudioWorkletで確認。Synth / Analyzerの配布物も読込み成功。
- Playgroundの757参照、Synthの220参照、Analyzerの744参照、ZIPとソース／ライセンスの同梱を確認。Playground ZIPをTauriへ取り込み、importのハッシュ検証に成功。
- 隔離したnpm配布物：既定WASMの生成・PCM・snapshot・動的アセット・ソース／ライセンスとNodeNext / Bundler / Browserの型検査を確認。
- Nativeの実デバイスを開くテストは実行しない。PCM一致は従来のホスト側計算を維持する確認であり、実機のPWMフィルター等との一致や聴感の判定ではない。

結果の集計は `pwm32x_cpp_validation_20261022.json` に記録済み。npm公開・バージョン更新は今回行わない。

由来・ホスト出力の差異は `third_party/mame-32x-pwm/README.md`、既存接続の履歴は `pwm32x_01.md` を参照。
