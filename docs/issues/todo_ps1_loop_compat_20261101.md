# PS1 SPU: ADPCMループ互換性 — 2026-11-01

ユーザー指示「進めて これってSPU synthも?」で開始。Web SPU Synth / PlaygroundとNative Pluginを対象にする。
開始: 親repo `4c65bef7`、SDK `997256e`、Plugin `6ddd13b`。各worktree clean。
実装前にこのTODOを保存する。中断後は各repoのstatusと本TODO、Plugin側TODOを確認する。

## 今回の範囲

- [x] Native /現在Web WASMで、flag4のみのLOOP STARTとrepeat register先flag0/4でループが止まる条件を元ADPCMのまま再現する。END/REPEATとSTART/repeat addressの役割を一次仕様でも確認する。
- [x] SDKのloop/cache経路を最小修正する。END側のREPEAT条件は維持し、開始packetにflag2を要求しない。元ADPCMを書き換えず、pristine upstream sourceは保持する。
- [x] flag4/6、markerless repeat register、loopまでのprefix、decoder履歴を使うloop、Gaussian seam、one-shot END、fullRAM、fractional/max pitch・render分割・RAM/cache invalidationを検証する。通常の既存PCM出力を維持する。
- [x] Noise /PMON /Reverb /112cycle Morph /長Software PCM2banksとRT C++ new/delete0を回帰確認する。Native Release/sanitizerとCIを通しcommit /pushする。
- [x] Pluginのこの制限だけを解除し、VAB /raw ADPCM /Web v1 /state9 /旧state /workerで元sample bytesを保つ。unsupported期待を成功＋PCM/loop検証に置換する。実AU/VST3 /CIも検証する。
- [x] Webの固定SDK snapshotは正規export/importで更新する。既存SCSP local candidate変更を保持し、無関係chipのcoreを黙って変更しない。新source commit /candidate provenance /manifestを保存する。
- [x] Web SPU WASMを再buildし、Synth・PlaygroundのMain /Worker・Chromium /WebKitでflag4 loopを元bytesのまま持続再生できることを検証する。file読み込み、preset保存/復元、loop position、離鍵・停止も検査する。
- [x] docs/generated /docs/sources /SDK receipts・SPU校正freshness /JS package buildを必要範囲で更新し、原本と同じsourceから再buildできることを確認する。npm publish・version/tag変更・itch/Tauri/Plugin releaseは今回行わない。
- [x] 修正前後の再現、byte保持、回帰結果とCIを記録し、残る実聴・配布物更新のTODOを分けてcommit /pushする。

Pluginの実装TODO: `w/tetorica-spu-plugin/docs/issues/TODO.md`。
Web版は固定SDKからのWASM buildなので、NativeのGit更新だけでは既存Webページへ反映されない。
Tauri配布済みbinaryや公開済みnpm /itchの更新は、この作業の検証済み成果物から別途行う。

## 実装チェックポイント

SDK `95cf71a` とPlugin `78e0b83` を公開commitへ保存し、両repo CI成功。
Webは同じSDKを正規snapshotとして固定し、SPU WASMを再buildした。
既存SCSP変更は新SDKに収録済みで、SCSP coreのbytesは移行前と一致する。
SDK 0.1.7は未releaseのためpinに `unpublished: true` を保存し、公開releaseとは扱わない。
新しい校正48経路＋YM2612基準8経路と、適用後の同数の再検証に成功。過去の測定JSONは変更していない。
NodeのSPU関連189件、校正policy397件、SDK importer/inventory117件が成功。
配布ZIPのfull browser回帰と親repo CIの最終確認も完了。詳細は下記の最終記録を参照。


## 今回の修正後に残す確認

- [ ] 人の耳で、使用しているVAB音色の持続・ループ境界・離鍵と、通常Sineを短く試す。ブラウザの新WASM読み直し後に行う。
- [ ] 新Pluginを実DAWでも試す場合はhostを保存・終了し、`docs/software_audio_20261101.json` のknown hash照合・退避付きでAUを更新する。現在のinstalled AUは前のSoftware audio版を維持している。
- [ ] itch / Tauri / npm / Pluginの配布更新は、検証済み成果物と公開先を確認して別途行う。今回はversion /tagを変更していない。GitHub Pagesは既存のmain自動deployの対象。

実DAWの独自UI操作・automation録音・長時間使用はPlugin側の人による確認TODOを引き続き参照する。
外部入力Reverb / Morph LFOは今回も追加しない。


## 共通CIの追加切り分け（完了）

実装 `948808a3` のSPU Synth /WASM33core parity /VGM /SBI /Pagesは成功。
共通itch run `41277439005` のpackaged POKEY System gains /dual /Worker /Stopで失敗を検出した。
PS1 /WonderSwan /POKEYの校正、packaged Analyzer /FM Synth /Playgroundはここまで成功している。
失敗logを取得し、同じ実ZIPで再現・原因を切り分けてから必要な修正を行う。
POKEY参照をb8dae7d1で修正し、最終c7760213のCIでもこの検証は成功した。


追加原因: packaged POKEY checkerだけが旧 `pokey_chip_levels_deferred_release_01.json`
（gain 0.413029）を参照していた。配布runtime /generator /CI校正は既に
`pokey_scsp_fm_chip_levels_01.json`（primary 0.413052、dual 0.413051）。
最初のREADYより前のexact gain比較でthrowし、40秒待ちとして表面化していた。
同じ実ZIPでローカル再現済み。runtimeや音量値は変えずcheckerの参照を現行測定へ合わせ、
両browser × single /dual × Main /Workerの8経路で実PCM・System復元を再検証する。


## Sample Editor共通CIの追加切り分け（完了）

`b8dae7d1` の再実行でPOKEYは通過。SPU mode /ADPCM変換 /live voice・PCM・Reverb編集も通過した。
続くitch run `41279067313` のPS1 Sample Editor /saved Keyboard instrumentsで失敗を検出した。
失敗logを確認し、同じZIPを追試したがローカル4経路は成功した。
2秒予約の制御条件で固定待ちの不十分さを確認し、実際の到達を待つテストへ修正した。
c7760213で観測時点を修正し、最終CI全5workflow /8job成功。


Sample Editorの具体failureはCIのWebKit /Workerだけ、24note後のgate数が21。
他3経路と同じZIPのローカル4経路は成功。noteOnのawaitはcontrol投入までで、
getState /snapshotは予約NoteOnを追い越す即時RPC。固定sleep(1)はaudio適用のbarrierではない。
テストは厳密24条件を維持し、公開getStateで期限付きの到達待ちを行い、最後にRAM snapshotを1回検査する。
Native envelope /nativeFrames /missing channelを診断に残し、未到達は引き続き失敗させる。
公開Worker lookahead設定を2秒へ上げたprobeで固定1秒待ちの不十分さを意図的に再現し、
条件待ちで24音の実audio適用に到達することを検証する。productionのイベント再送・count緩和は行わない。


## 最終保存

[検証記録](ps1_loop_compat_20261101.md) / [機械記録](ps1_loop_compat_20261101.json)。
実装はWeb `948808a3`、SDK `95cf71a`、Plugin `78e0b83`。
共通CIのテスト参照修正 `b8dae7d1` と予約音声の観測修正 `c7760213` も保存済み。
最終親CIは全5workflow /8job成功、SPU Synth専用CI・Native SDK /Plugin CIも成功。
GitHub Pagesの公開WASMは修正版hashと一致。人の実聴・installed AU・手動配布更新は上の未完了項目として残す。
