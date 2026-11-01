# PS1 SPU ADPCMループ互換性 — 2026-11-01

Web SPU Synth / Playground / Native Pluginへ、同じADPCMループ修正を反映した。
実装前TODOは [todo_ps1_loop_compat_20261101.md](todo_ps1_loop_compat_20261101.md)。
実装commitはWeb `948808a3`、SDK `95cf71a`、Plugin `78e0b83`。
測定・成果物のhashは [JSON記録](ps1_loop_compat_20261101.json) に保存する。

## 問題と修正

旧coreは、ループ開始packetにもRepeat bit（flag2）があることを要求していた。
STARTのみのflag4や、markerなしでrepeat registerが指すflag0のpacketでは、
END側がRepeat有効でも一周後に停止した。Nativeでtail peakは0、
同じデータにflag2を加えた場合は0.0170888007だった。
修正後は元bytesの0 / 2 / 4 / 6すべてが同じtail peakになる。
旧WASMでも元bytesのNode / Synth / Playground回帰が長いtailの無音を検出して失敗した。

[PSX-SPXのflag仕様](https://psx-spx.consoledev.net/soundprocessingunitspu/#flag-bits-in-2nd-byte-of-adpcm-header)
に従い、START bit2によるrepeat address更新と、END時のRepeat bit1を独立に扱う。
SDKのcache生成・更新とrepeat先のfallbackを修正し、ENDのみのone-shotは停止を維持する。
Pluginはこの制限だけを解除し、構造不正入力の拒否は維持した。
VAB / raw ADPCM / Web音色 / embedded stateの元sample bytesを書き換えて解決しない。

## Webへの反映

正規SDK export / importで476filesを固定し、SPU WASMを再buildした。
SDKは未releaseの0.1.7 source commitを使用するため `unpublished: true` と記録した。
以前のSCSP local candidateの内容はこのSDKに収録済みで、SCSP core全filesのbytesは移行前と同じ。
他chipのWASMは変更していない。共通manifestを含む配布source bundleは同じSDK pinへ更新した。
PS1の同梱sourceだけからの独立rebuildで、JS / WASM双方が配布版と完全一致した。

既存の通常flag6ループは、220 / 440 / 880Hz・各8192 stereo framesのFloat32 PCM hashが修正前後で一致した。
NativeとWeb WASMの音量基準比較も12経路で差0。
新規の実ブラウザ校正は48経路＋YM2612基準8経路、設定適用後の再測定も同数成功した。
[新測定](ps1_loop_fm_chip_levels_01.json) /
[適用後の再測定](ps1_loop_fm_chip_levels_verify_01.json) を追加し、過去のJSONは変更していない。
生成されたMixer gain値は従来と同じで、測定参照だけを更新した。

## 自動検証

- Native: full RAM、24 voices、prefix / repeat先、fractional / max pitch、predictor履歴、render分割、cache invalidation、END one-shot、Noise / PMON / Reverb / Morph / 長いSoftware PCM2banks、callbackのC++ new/delete0。ReleaseとASan / UBSan成功。
- Web Node: SPU関連189件、SDK importer / inventory117件、校正policy397件成功。
- Raw WASM: Chromium / WebKit × Window / Workerで6条件ずつ、NodeとのFloat32 PCM差0、元RAM bytes保持、key-off / reset / dispose成功。
- Synth: complete VAB / VH+VBからflag4-only sampleを読み、Save / Load後も元ADPCM・loop / rootを保持し、ENDを越えた持続、離鍵・停止を検査。
- Playground: Chromium / WebKit × Main / Workerで同様に持続再生、元RAM bytesのsnapshot抽出と再投入、loop / tuning、離鍵・停止を検査。実行中の全register状態を丸ごと復元する検査とは別。
- Plugin: offline / macOSの各24件、ASan / UBSan24件、実AU48kHz、実VST3の44.1 / 48 / 96kHz、公式validator47成功 / 0失敗、Python18件成功。
- npm配布物: build後のtarballを隔離projectへinstallし、exports / types / 全28 WASM / Synth音声 / source同梱の検証成功。publishは行っていない。

すべて決定的なオリジナルfixtureで検証した。ブラウザ検査の物理出力はmuteし、
独立pilotとclockでcapture連続性を確認した。実聴・PS1実機との波形一致・長時間のRT性能の保証とは区別する。
Pluginの詳細は `w/tetorica-spu-plugin/docs/loop_repeat_20261101.md`。

## 配布物と残る確認

検証用に以下をbuildした。公開version / tagの変更、npm publish、itch / Tauri / Plugin releaseは行っていない。

- `release/tetorica_spu_synth_loopfix_20261101_itch.zip`
- `release/hello_ymfm_wasm_loopfix_20261101_itch_playground.zip`（完全sourceのdownload用）
- `release/hello_ymfm_wasm_loopfix_20261101_itch_playground_for_run.zip`（browser Run用）

実ZIPを新しい一時directoryへ展開し、Synthの両browserとPlaygroundの両browser × Main / Workerでfull回帰が成功した。
新ループに加え、Synthの20MiB audio / Morph / Noise / PMON / preset / 故障復帰なども通過し、clock anomalyは0。
既存MorphテストにはデフォOnへ追従して準備段階を明示Offにする1行を加えた。production / ZIPの変更は不要だった。

ローカルWebは更新したWASMを読み直すと反映される。itch.ioの公開済みZIP / Tauri配布binary / npm / Plugin配布版へは、検証済み成果物から別途反映する。
GitHub Pagesは既存workflowによりmainのpushから自動deployされる。
2026-11-01 06:05 UTCに公開PS1 WASMをGETし、修正版と同じ52,082bytes / SHA256で配信されていることを確認した。
公開画面のGUI操作・実聴を行った記録とは区別する。
installed AUは前回Software audio版のままで、今回buildしたAUの実host検査と区別する。
実聴、AU独自UI、長時間の実DAW演奏は人による確認を残す。


## Web側の再検証入口

```sh
python3 scripts/import_soundchip_sdk.py --check
node --test web/ps1*.test.mjs docs/synth-spu/*.test.mjs web/playground_ps1*.test.mjs
node scripts/check_ps1_spu_browser.cjs
node scripts/check_spu_synth_browser.cjs --loop-only
node scripts/check_playground_ps1_browser.cjs --loop-only
node scripts/generate_soundchip_mixer_presets.mjs --check
node scripts/check_fm2612_package.mjs
```

配布ZIPを作り直す場合は、既存公開物と区別できる新しいlabelを付けてbuildする。
実ZIP full回帰にはSynth checkerの `--root` とPlayground checkerの `--zip` を使い、
repositoryへのfallbackではなく実配布物を開く。


## 共通配布CIで見つけた別のテスト参照不整合

実装 `948808a3` の共通itch CIで、POKEYの初期gain比較がREADYより前にthrowした。
checkerだけが旧 `pokey_chip_levels_deferred_release_01.json` の0.413029を期待し、
配布runtime /generator /CI校正は現行 `pokey_scsp_fm_chip_levels_01.json` の
primary0.413052 /dual0.413051を使っていた。ローカルでも同じZIPで再現した。
`b8dae7d1` でcheckerの参照2箇所だけを現行測定へ合わせた。
音声code /gain /過去report /ZIPは変更せず、両browser × single /dual × Main /Workerの8経路が成功した。
実PCMのgain、dualの左右分離、System preset復元、Stop /Rerunを通過した。
初回CI失敗とローカル再現、修正後の結果はJSONへ別々に保存する。


## Sample Editorの予約音声と観測時点

`b8dae7d1` のCIは、POKEYを通過後にWebKit /Workerの24voice probeでgate21 /24を観測して失敗した。
他3経路と同じZIPのローカル4経路は成功していた。
Sample instrumentのnoteOn awaitはcontrol投入までで、getState /snapshotは未来の予約controlを待つfenceではない。
固定sleep1秒でaudio適用済みと仮定せず、`c7760213` で公開getStateを50ms間隔で読み、
厳密な全24gate /ENV>0を確認してからRAM snapshotを1回取るようにした。
未到達の再試行は8秒budgetとし、未到達channel・nativeFrames・first /last stateを記録する。
単一RPCには既存15秒timeoutがあり、全処理の8秒hard capを保証する検査ではない。
イベントの再送・条件緩和・production変更は行っていない。

最終Worker probeだけを公開Menuでlookahead2000msへ設定し、両browserのMain /Worker全4経路が成功。
Workerは39回の観測・約2.03 /2.05秒でgate0 /24から24 /24、全ENV>0へ到達した。
固定sleep1秒の旧方式を残した別checkerでは、この意図的2秒予約条件でgate0 /24の失敗を確認した。
これは固定待ち仮定が不十分という制御条件であり、CIのdefault500ms /21音現象を直接再現したという意味ではない。
実PCM /clock連続性と元ZIP hashも一致している。


## CIの最終結果

Native SDK `95cf71a` は12検証job、Plugin `78e0b83` は2job成功。
SPU Synth専用workflowは実装 `948808a3` の実ZIPで成功した。
POKEY参照とSample Editorの待ち方を直した最終 `c7760213` は、全5workflow /全8job成功、failure step0。
後続変更は検証script /TODOのみでSPU Synthのpath条件に該当せず、専用workflowを再実行していない。

| 対象 | 最終成功run |
| --- | --- |
| Native SDK | [41275704074](https://github.com/kyorohiro/tetorica-soundchip-native/actions/runs/41275704074) |
| Native Plugin | [41276718988](https://github.com/kyorohiro/tetorica-spu-plugin/actions/runs/41276718988) |
| SPU Synth実ZIP | [41277438940](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/41277438940) |
| SBI export tests | [41281987521](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/41281987521) |
| VGM parser and player tests | [41281987518](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/41281987518) |
| WASM SDK build and parity | [41281987520](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/41281987520) |
| itch web release ZIPs | [41281987538](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/41281987538) |
| pages build and deployment | [41281987025](https://github.com/kyorohiro/hello_ymfm_wasm/actions/runs/41281987025) |

最終itch CIでは、修正したPOKEY /Sample Editorと、全PS1 capture report audit /Neo Geo /artifact保存まで成功した。
初回のPOKEY失敗と2回目のSample Editor失敗は履歴としてJSONに残し、成功に置換していない。
