# PS1 SPU: ADPCMループ互換性 — 2026-11-01

ユーザー指示「進めて これってSPU synthも?」で開始。Web SPU Synth / PlaygroundとNative Pluginを対象にする。
開始: 親repo `4c65bef7`、SDK `997256e`、Plugin `6ddd13b`。各worktree clean。
実装前にこのTODOを保存する。中断後は各repoのstatusと本TODO、Plugin側TODOを確認する。

## 今回の範囲

- [ ] Native /現在Web WASMで、flag4のみのLOOP STARTとrepeat register先flag0/4でループが止まる条件を元ADPCMのまま再現する。END/REPEATとSTART/repeat addressの役割を一次仕様でも確認する。
- [ ] SDKのloop/cache経路を最小修正する。END側のREPEAT条件は維持し、開始packetにflag2を要求しない。元ADPCMを書き換えず、pristine upstream sourceは保持する。
- [ ] flag4/6、markerless repeat register、loopまでのprefix、decoder履歴を使うloop、Gaussian seam、one-shot END、fullRAM、fractional/max pitch・render分割・RAM/cache invalidationを検証する。通常の既存PCM出力を維持する。
- [ ] Noise /PMON /Reverb /112cycle Morph /長Software PCM2banksとRT C++ new/delete0を回帰確認する。Native Release/sanitizerとCIを通しcommit /pushする。
- [ ] Pluginのこの制限だけを解除し、VAB /raw ADPCM /Web v1 /state9 /旧state /workerで元sample bytesを保つ。unsupported期待を成功＋PCM/loop検証に置換する。実AU/VST3 /CIも検証する。
- [ ] Webの固定SDK snapshotは正規export/importで更新する。既存SCSP local candidate変更を保持し、無関係chipのcoreを黙って変更しない。新source commit /candidate provenance /manifestを保存する。
- [ ] Web SPU WASMを再buildし、Synth・PlaygroundのMain /Worker・Chromium /WebKitでflag4 loopを元bytesのまま持続再生できることを検証する。file読み込み、preset保存/復元、loop position、離鍵・停止も検査する。
- [ ] docs/generated /docs/sources /SDK receipts・SPU校正freshness /JS package buildを必要範囲で更新し、原本と同じsourceから再buildできることを確認する。npm publish・version/tag変更・itch/Tauri/Plugin releaseは今回行わない。
- [ ] 修正前後の再現、byte保持、回帰結果とCIを記録し、残る実聴・配布物更新のTODOを分けてcommit /pushする。

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
配布ZIPのfull browser回帰と親repo CIの最終確認・検証記録は続けて保存する。
