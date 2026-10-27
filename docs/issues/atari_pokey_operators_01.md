# POKEY Operators panel

Date: 2026-10-27

## Scope

POKEYの残作業から、Playgroundの音色情報・編集・その場での試奏を追加した。
Atari 8-bitとAtari Arcade (Dual POKEY)にPOKEYタブを表示する。
`createSoundChip('pokey')`で追加した音源も、既存の音源一覧から同じタブへ接続できる。

POKEYはFMのoperatorを持たないため、4つの物理CHと共通レジスターを表示する。
2台構成ではタブ内の音源選択で切り替え、CH1–CH4を選ぶ。

## Behavior

- 適用済みAUDF/AUDC、timer period/frequency、音量、distortion、volume-only、clock、AUDCTL/SKCTLを表示する。
- 既存Synth APIを使い、音量・distortion・volume-only・周波数/音名・base clock・poly9・join・high clockを編集する。
- Hold、1秒preview、Guitar/PC Keyboardで選択CHを試奏する。共通Keyboardを右下にも表示する。
- joined pairは下側をtimer helper、上側を発音するCHとして区別し、helper単独の周波数編集・試奏を無効にする。
- noise、filter、DAC、serial/two-tone等は状態として表示する。timer周波数を実際の音程と断定しない。
- コピーするコードはprimaryの`pokey`/`pokey2`を区別する。追加instanceは、選択したIDへ`chip`を明示的に結び付けるためのコメントを出し、別の音源を自動生成しない。
- タブを開く・CH/音源を選ぶ・状態を更新する操作では音源設定を書き戻さない。既存の可視タブ用更新処理を使い、独立したpollingを増やさない。
- Hold/previewはCH・音源・接続・タブの変更やblurで解除する。下段Keyboardへ明示的に割り当てた音源は、下段Keyboardから続けて演奏できる。ルート変更・Stop・再Run・disposeでは該当する試奏を解除し、古いkeyupや遅延ACKは新しい試奏へ作用しない。
- timeline準備中・再生中は編集/試奏を無効にする。状態表示・コード確認は継続できる。
- 右下の共有Keyboardにもhelper/busy制約を反映し、無効な試奏RPCを送らない。
- Main/Workerの再Runは、音声準備完了後、新しいコードの実行前に前の試奏を解除する。未知の実行方式・未対応Worker・未知のソース・音声準備失敗では解除しない。
- Browserの追加POKEYは、接続メタデータだけでタブの表示/非表示を更新する。ほかの音源のメタデータは従来どおり。

## Validation

全Web/Playground **4,567件**、mode型検査、Mixer生成値の整合性検査が成功。
実WASMを使うWorklet試験では、状態取得がrender・レジスター・予約済み演奏を変更しないことも確認した。

npm配布候補は305 modules / 28 WASM pairs / 352 declarations / 880 files。
隔離install、実WASM読み込み、NodeNext/Bundler/DOM-only型検査が成功。公開versionは変更していない。
再Runで既存Nativeの解除経路も通るため、未完だったX68000/MSX/Master System/OPL試験用snapshotを実際のRust protocolに揃えた。検査条件は維持した。

最終flat配布物をChromium 153.0.8010.12 / WebKit 26.6で検証した。
各Browserの単体・dual・Genesisへの追加POKEY、計6routeが成功。
142回、計720,896 frames/channelのPCM観測で発音と解除を検査し、停止・解除後の厳密なゼロ、monoの左右一致、非有限値なし、capture quantum欠落なしを確認した。
単体モードではMain/Workerの旧loopによるkeyOffから手動試奏を保護し、別CHの演奏を維持することも検査した。
非表示中のInspector RPCなし、実際の共有Keyboardでhelper/busy時の試奏RPCなし、2台の選択、追加instanceの破棄と生存側の状態保持も成功。
Chromium/WebKitのdual画面を画像で確認した。実聴・実機比較は行っていない。物理出力はcaptureの後で無音化した。

Browserが読んだ277 assetのSHA256と、配布ZIPのmemberが一致した。
ZIP全959 fileもstageとbyte一致。Tauriは既存規則で`.DS_Store`を除いた958 payloadを取り込み、dist/release lockも一致した。
TauriのPython24件・Node31件・offline source pins22件が成功。対応source ZIPの1,919 fileも検証済み。Rust/DSP変更がないためCargoは再実行していない。

ZIP: `release/hello_ymfm_wasm_pokey-voice-dev_itch_playground.zip`

SHA256: `d367568cc0dfd300f0fdff05f5b50fc719c4e7028535706bd189f3a6a2499675`

Tauri source ZIP SHA256: `f0afc0a1696c9b33f145215136a99b05e6f3c771ac923fd1ee2922784a9eb2d6`

配布物とTauriの結果・hashは[同名JSON](atari_pokey_operators_01.json)へ記録する。

再検証:

```sh
node --test --test-concurrency=4 web/*.test.mjs docs/playground/*.test.mjs
node scripts/check_playground_mode_types.mjs
node scripts/check_fm2612_package.mjs
sh scripts/package_itch_playground.sh pokey-voice-dev
node scripts/check_playground_pokey_voice_browser.cjs --root=release/itch_playground_pokey-voice-dev
```

## Boundaries

SDK、音源コア、生成WASM、Mixer値、Rust/DSPは変更していない。
npm公開済みの`tetorica-fm2612` 0.2.31と`tetorica-vgm` 0.2.16はこの作業では再公開しない。
外部POKEY I/O、実機との音量/挙動比較、sample exportは今回の対象外。
