# VAB共通API・npm・Playground（2026-11-12）

- [x] Sony VAB v6/v7のreadVab／prepareVabTone／exportVabをtetorica_src/runtimeへ移し、既存Playground／Synthの互換入口は同じ実装を参照する。元Bank保持・単独Tone書き出し・検証・無音動作を維持する。
- [x] npmの個別モジュールと共通入口から関数を公開し、Bank／Program／Tone／Sample／準備結果／export optionの型・説明を提供する。
- [x] PlaygroundのMain／Worker Codeで同じ純粋関数を使えるようにし、型・補完・実装参照を揃える。演奏割り当て・Preset形式などの新しい抽象APIは追加しない。
- [x] 「VAB読込 → Program／Tone選択 → loadADPCM／setPreset → 発音」の最小サンプルと利用説明を追加する。Tetorica JSONに依存せず、外部のゲームデータを同梱・取得しない。
- [x] 古いSPU TODOのうち、現在の実装・検証記録で完了が確認できる項目を整理する。実ゲームの実聴・長時間確認は未完のまま残す。
- [x] canonical→docs/jsの同期、Node／実WASM、npmインストール後の実行と型（NodeNext／Bundler／browser）、無音headlessのMain／Worker・補完・既存Synth取込と配布を確認する。
- [x] 検証記録・配布物を残す。commit／push／npm公開・Tauri更新は今回行わない。

通常browser／native app／OS音量は操作しない。実PCMはメモリー／ファイルで検証し、headlessはアプリ起動前からdestinationをgain 0へ遮断、Chromiumはmuteを併用する。既存の固定WASM／Native SDKは再ビルドしない。

検証記録: [ps1_vab_public_api_verification_01.json](ps1_vab_public_api_verification_01.json)。npmはローカル配布候補（0.2.39表記）の検証までで、registryへの公開は未実施。Playground／SPU SynthのZIPもローカル作成・検証済み。
