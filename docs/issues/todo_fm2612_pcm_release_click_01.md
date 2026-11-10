# FM2612 Synth：PCM離鍵時のクリック低減（2026-11-10）

指摘：PCMで鍵盤を離すとクリック音が残る。現在のRF5C164 keyOffは波形がゼロ以外でも即時停止するため、ソフトウェアで短い離鍵処理を加える。共有SDK／実チップの挙動は変更しない。

- [x] 実WASMを配列へ生成して、離鍵前後の段差を再現・数値化する。
- [x] アプリ専用のsample-clock処理で各CHのVolumeを約4msで下げてから停止する。保持中の他CHを減衰させず、通常の持続音は元の出力を保つ。音量レジスタ変更によるソフトウェア機能と明記する。
- [x] 再発音／同CH再利用では古い離鍵処理を取り消す。Stop・サンプル交換・出力切替は確実に停止し、遅延処理が音を復活させない。JSタイマーによる音量制御は使わない。
- [x] 通常PCM／Pause試奏・Event Rec・Looperで同じ離鍵処理を使う。Looperの短いtailを保持し、周期や元サンプル／プリセット／VGM再生は変えない。
- [x] 実WASMの段差低減・多音分離・再利用・タイミングと、完全muteしたheadless Chromium／WebKitで入力／録音／重ね録り／停止を検証する。通常browser・native app・OS音量を操作せず、実聴はしない。
- [x] help・cache key・配布ZIP・再開記録を更新する。commit／push／公開は行わない。

まずは離鍵の不連続を対象とする。波形自体・Loop Start／End移動や音色切替に伴う段差とは分けて検証する。

## 実装

- `synth_pcm_release.js`のアプリ専用wrapperが、真の`releaseNote`だけを4msの音量低下へ変える。内部更新はsample clockで進み、同じ長さのPCMなら128／71／1frameに分割しても一致する。保持中の他CH・通常の持続音は元のnative出力と一致する。
- 論理channel maskと実際の発音maskを分離した。`keyOn`／`keyOff`／`releaseNote`は専用コマンドでWorkletへ送り、次の別CH発音で古いRelease音が復活しない。再発音時はそのCHの古い減衰を取り消し、元のVolumeを戻す。生mask／reset／強制Stopは即時停止のまま。
- `synth_pcm_worklet.js`は`tetorica-synth-pcm`として登録する。共有SDKの`tetorica-rf5c164`とは別にし、通常PCMとPause試奏に使用する。Event Rec専用WorkletとLooper offline生成も同じwrapperを使う。
- Looperの周期はそのまま、生成PCMの末尾だけ4ms release＋1ms flushへ延ばした。録音終了時刻ちょうどのnoteOffも適用してからtailを生成する。末尾が未離鍵の取込データも終了位置でReleaseし、既存Event Recの10ms周期padding内に収める。JSON／PCM preset形式・WAV元データは変更していない。
- End RAM転送待ち中に`getPlayableSynth()`がnullを返して離鍵を落とす経路も修正した。接続済みPCMへは常に離鍵を届け、新しいNote Onは引き続きRAM準備を待つ。
- ソフトウェア機能であることをPCM help・README英語／日本語へ明記し、cache keyを`pcm-release-1`へ更新した。共有SDK／DSP／WASM／校正値と曲のVGM再生処理は変更していない。

## 検証記録

- 元のnative Sine（48kHz、256frames後）では離鍵時に`0.0814819336 → 0`へ切れ、通常の隣接差`0.0082397461`の約9.9倍の段差を再現した。
- 専用実WASMテスト7件成功。新しい離鍵の最大段差は旧hard keyOffの20%未満。左右別の2CHで、一方のRelease中も他方の保持音はsample単位で元と一致。再発音・別CHへの移動・強制停止・内部register選択の復元も確認した。
- 最終`node --test --test-concurrency=1 docs/synth/*.test.mjs`：401件成功。ログ：`/private/tmp/fm2612-pcm-release-final-node-20261110.log`。
- `check_synth_pcm_browser.cjs`：最終配布stageのChromium／WebKitで成功。テスト専用Workletで実際のrender blockを取得し、6回の離鍵で最大の隣接段差が0.02未満であること、保持中の他CHの振幅が減衰しないこと、再利用・blur強制停止を確認。Loop End短縮／拡大・Start変更時にreleaseを送らないことも確認した。
- `check_synth_pcm_recording_browser.cjs`：同stageのChromium／WebKitで成功。Event Recの録音／再生、Use current sound、終端・音色交換、JSON、System補正×Master、取消・元音色保持を確認した。
- `check_synth_pcm_looper_browser.cjs`：同stageのChromium／WebKitで成功。尾音を保持した重ね録り・Undo／再開、音色／End変更、音量補正、取消・16層上限を確認。EndのRAM転送待ち中でも離鍵が届いて音が止まり、遅延したRAM反映後も音が復活しないことを実出力で確認した。
- `check_synth_pcm_live_browser.cjs`：同stageのChromium／WebKitで成功。VGMの生RAM／レジスタLive、Pause中の選択CH試奏とsoftware release、Copy、Seek、編集音色保持の回帰を確認した。
- 全speaker接続はページ実行前からgain 0へ迂回し、テスト専用capture Workletの枝もgain 0。Chromiumは`--mute-audio`も使用。実聴・通常browser・native app・OS音量の操作は行っていない。

## 配布候補

- `sh scripts/package_itch_synth.sh pcm-release-final-20261110`：382件のローカル参照チェック成功。
- ZIP：`release/hello_ymfm_wasm_pcm-release-final-20261110_itch_synth.zip`、939,749 bytes／255 files。全fileはstageとbyte一致。
- SHA-256：`fb4d65034383b3c2bfb7311d2414ed85693ee4aecfc3468e2666a2aa89d50414`。
- stage：`release/itch_synth_pcm-release-final-20261110`。新しいhelper／Workletも読みやすいソースで収録し、共有runtime参照のパスを配布先に合わせている。
- 記録：`/private/tmp/fm2612-pcm-release-final-{browser,recording-browser,looper-browser,live-browser}-20261110.json`、`/private/tmp/fm2612-pcm-release-final-package-proof-20261110.json`。
- 全4 browser検証の取得assetsはZIP内bytes／hashと一致した（通常編集129件、Event Rec130件、Looper131件、Live129件）。page error・欠落asset・外部通信なし。幅1240／390 pxの配置と横overflowなしを確認。
- 通常の`sh scripts/package_itch_synth.sh`も実行済み。`release/hello_ymfm_wasm_dev_itch_synth.zip`を更新し、内部の255 filesが最終検証ZIPとすべてbyte一致。通常ZIPも939,749 bytes、SHA-256は`3c544f39dfaa30f5b6bd397f67c557dc31fa7c3ee8af3a45b005317b7890f3ce`。

```sh
node --test --test-concurrency=1 docs/synth/*.test.mjs
sh scripts/package_itch_synth.sh pcm-release-check
node scripts/check_synth_pcm_browser.cjs --root=release/itch_synth_pcm-release-check --entry=/index.html
node scripts/check_synth_pcm_recording_browser.cjs --root=release/itch_synth_pcm-release-check --entry=/index.html
node scripts/check_synth_pcm_looper_browser.cjs --root=release/itch_synth_pcm-release-check --entry=/index.html
node scripts/check_synth_pcm_live_browser.cjs --root=release/itch_synth_pcm-release-check --entry=/index.html
```

## 残り

- [ ] 人による実聴：Sine／WAVと和音で離鍵時のクリック、4msの減衰、再発音、録音・Looper境界、Pause試奏を確認する。今回の検証ではスピーカーへ出力していない。

commit／push／公開は未実施。
