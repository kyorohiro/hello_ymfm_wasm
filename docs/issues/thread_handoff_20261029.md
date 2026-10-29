# 次スレッドへの引き継ぎ — 2026-10-29

このファイルがスレッド終了時点の入口。まず本書を読み、詳細が必要な箇所だけ
[savePoint.md](savePoint.md) と個別の作業記録を参照する。
savePointの下位の「未commit／未公開／次は…」は当時の履歴であり、現在の残作業とは限らない。

## 後続更新：2026-10-29 SPU Synth PMON

FXタブへPitch Modulationを追加し、12組のsource／carrier割当と保存・復元を実装した。
結果・試用ZIP・検証は [spu_synth_pmon_01.md](spu_synth_pmon_01.md) を参照。未commit・未公開。

## 後続更新：2026-10-29 ガウシアン補間

ユーザーの実装指示により、PS1 SPUの既定4点ガウシアン補間を実装し、SDK正規import・WASM・Tauriへ反映した。
現在の結果と検証・配布物は [ps1_gaussian_01.md](ps1_gaussian_01.md) を参照。
以下の「未実装」「実装指示は未受領」は、この後続作業前の履歴。公開済みSynth ZIPは上書きしていない。

## 現在の終了地点

- **Tetorica SPU Synthはユーザーがリリース済みと報告した。** Xでのboostも1,000円分実施済み。
  公開待ちへ戻さず、追加の公開・広告操作を自動で始めない。
- 本体HEADは `9750b5b7`（`spu synth 0.0.1`）。最新の4タブ版までcommit済み。
  この引き継ぎを書き始める直前の本体working treeはcleanだった。
- このスレッドの直近の必須実装に、把握している未完了作業はない。
  その後、ユーザー指摘で**ガウシアン補間の未対応**を確認した。次の具体的な候補として下記に追記。
  新しい実装は次スレッドのユーザー指示に従う。
- 今回追加した本書・リリースinventory・savePoint追記は未commit。こちらからcommit／pushはしない。

## SPU Synthの現在の仕様と入口

- 製品名：**Tetorica SPU Synth**。説明：**PlayStation 1 SPU synthesizer / emulator**。
- アプリ：[`docs/synth-spu/index.html`](../synth-spu/index.html)。
  トップページ [`docs/index.html`](../index.html) にアイコン付きカードあり。
- アプリ内アイコンは `docs/synth-spu/icon.png`。ユーザー提供1254px PNGを無変換で使用。
  トップページのカードはユーザー指定の `docs/tetorica_spu_synth.webp`。
  シルバー／濃い表示部／赤・黄・青の意匠に合わせた。
- 上段：**Envelope／Waveform／Spectrum＋縦Pitch**。
  Envelopeは実出力RMSの履歴表示。編集するADSR図を上段へ戻さない。
- 下段：**PCM／ADSR／FX／Audio** の4タブ。初期表示はPCM。
  PCMは112-sample周期波形、ADSRは数値とドラッグ図、FXはSPU reverb、Audioはファイル取込・root note・loop。
  音色名とpreset load/save/resetは共通操作。
- **全24声で1つの音色を共有し、Keyboardはround robin。** 空き声を巡回、満杯時だけ最古を置換。
  Voice studio・physical voice selector・Selected ADPCM voiceはユーザー指定で削除済み。
- Guitar／Bass／Ukulele、PCキー／pointer、和音、Sustain、±2半音Pitch、preset保存復元が動く。
  古い離鍵が置換後の音を止めない。Pitchは保持音とrelease tailsへ適用し、再発音しない。
- タブ切り替えは音を止めたり音色を再設定したりしない。左右キー／Home／Endでも操作できる。
- Audioはブラウザーでdecode→mono→準備WorkerでADPCM変換。短周期PCMと録音ファイルの双方を扱う。
  standaloneにマイク録音・長い音声のcrop editor・MIDI・Native出力を追加する依頼は未受領。
  共通Sample Editor等の既存Playground機能と混同しない。

主な実装：

- `docs/synth-spu/synth.js`：UI／Keyboard／ファイル操作。
- `spu_synth_panel.js`：既存Playground panelを共通音色・4タブへ接続するadapter。
- `spu_synth_audio.js`／`spu_synth_worklet.js`：既存SPU WASMとAudioWorklet、RPC。
- `spu_synth_voices.js`：audio owner側の24声割当。
- `spu_synth_visualizer.js`：Master後のpassive analyser、最大30fps、無音・非表示時停止、tail復帰。
- `spu_synth_instrument.js`／`spu_synth_prepare_worker.js`：preset検証と音声準備。

最新の詳しい記録は [spu_synth_tabs_01.md](spu_synth_tabs_01.md)。

## 最後に追加された未対応事項：SPUガウシアン補間

- ユーザーが「ガウシアン補間が入っていないのでは」と指摘。**現状は2点線形補間で、ガウシアン補間は未実装**と確認した。
- 対象はSDK原本 `vendor/mame-ps1-spu/spu.cpp` の各voiceの補間。
  Synth／Playground／Nativeは同じコアを使うため共通の課題。UIの未使用スイッチや係数表は存在しない。
- ホスト向け44.1kHz→デバイスrate変換は別のresamplerであり、各voiceの補間と区別する。
- 今回は確認とTODO記載のみ。実装開始・既定変更・再公開の指示はまだ受けていない。
  次の作業候補として [todo_ps1_gaussian_01.md](todo_ps1_gaussian_01.md) を読む。
  原本SDK→正規import→WASM／Tauriへの展開と、補間仕様・境界・回帰・音量測定の確認を記録している。

## 配布物と検証の扱い

配布スクリプトは **`scripts/package_itch_spu_synth.sh`**。
`script/patch_...` は作っていない。既存の `scripts/package_itch_*.sh` と同じ命名を使う。

```sh
sh scripts/package_itch_spu_synth.sh dev
# versionを指定する場合はdevの代わりに指定する
```

- root `index.html` で起動する45ファイルのZIPを生成。3entryをbundle＋minifyし、icon／WASM／source／licenseを同梱。
  npm別名は `npm run pack:spu-synth -- VERSION`。READMEの`v0.1.0`はコマンド例で、公開版番号の根拠ではない。
- ユーザーのローカル配布物は次の2つ。終了時点で**両方とも同じbyte列**だった。
  - `release/tetorica_spu_synth_dev_itch_v0.0.1.zip`
  - `release/tetorica_spu_synth_dev_itch_for_run_v0.0.1.zip`
- 各 **45files／5,459,208bytes**、SHA256
  `42695498009fe2179d36161a89ba9d8434598826093c17290d1ede54fd79f7f7`。
  ZIPのCRCは正常、root indexあり。内部の包装versionは`dev`、ファイル名とcommit subjectは`v0.0.1`。
  公開URLと、どちらのファイルを実際にuploadしたかは会話に記録されていない。
- 最終自動試験：Node **37成功**、実ZIPのChromium／WebKit両方成功。
  タブ切り替えでRPCゼロ・音色／所有権／PCM維持、ADSR drag、全既存演奏・保存・復元・Stop・recoverを確認。
  各37captures／385,024frames、pilot／clock連続、診断0。1440／390pxの表示も確認。
  物理出力はmute、AIによる実聴や実機精度の証明ではない。
- 上記の現存ZIPについて、過去の最終Browser reportに記録された**配信runtime 8ファイルが全byte一致**することを
  引き継ぎ時に照合した。新しいブラウザー試験や公開サイトの確認をした、という意味ではない。
  [今回のinventory](thread_handoff_20261029_release_inventory.json)。
- 古い`v0.1.0`／`editor-tabs-dev`等のファイル名や`/private/tmp`の展開先は履歴。
  現在存在するとは限らない。過去のJSON／hashを書き換えて現行版の試験結果に見せない。

必要な改修をした時の確認コマンド：

```sh
npm run test:spu-synth
node scripts/check_spu_synth_browser.cjs
```

実配布の確認はZIPを新規展開し、checkerの `--root DIR --entry /index.html` を使う。
サーバー8877や`/private/tmp`の過去の試験環境が稼働・残存していると仮定しない。
新しいraw reportは別名で保存する。

## 他のリポジトリと、以前からの持ち越し

| Repository | 終了時点のローカル状態 |
| --- | --- |
| 本体（このrepo） | `9750b5b7`、引き継ぎ記載前はclean |
| `w/tetorica-soundchip-native` | `544364743702671fac40eed4fe7ef44f4769c07f`、clean |
| `w/tetorica-fm2612-playground-tauri` | `6ac2f78d204c5055de0dc1f6576d05979e0397b2`、150 modified＋1 untracked |

Tauriの未commitは、このSPU Synth standaloneを作る前からのPS1・frontend・SDK取り込み等。
`dist/playground_ps1_envelope.js`もuntracked。不要ファイルと判断して消したり、まとめてrestoreしたりしない。
再開時は各repoの`git status --short`を再確認する。

### 実際に持ち越しているもの

1. **SDK 0.1.7候補の正式化と配布先の整理。** SDKのCHANGELOGは`unreleased`、ローカルtagは0.1.6まで。
   本体とTauriは同じ0.1.7 `localCandidate` をpin済みで、最新のPS1 live／保留ADSR修正は取り込み済み。
   455files、archive SHA256
   `0c09e92c3147a83fe3e694c2a48af169415b4e7e3c0b0cb3000ffb91c250f7b4`、9 changedPaths。
   正式SDK tag／配布、consumerのcommit／remote CI、新しいnpm版の公開反映は、別途ユーザーと進める作業。
   今回の「SPU Synthをreleaseした」は、SDK／npmも公開済みになった、という意味ではない。
   [ps1_deferred_release_01.md](ps1_deferred_release_01.md) とSDK pinを参照。
   ネットワークによる現在の公開状態の再確認は、この引き継ぎではしていない。
2. **Tauri GUI・物理音声での確認。** offline／Native自動試験は過去に完了。
   16台・64 MiBの重い混在構成や実機でのdropout・聴音評価は未確認。
3. **必要時の性能再監査。** OS再起動で消えたSafari／WebViewノイズの根本原因は断定していない。
   [aaa_daily01_report.md](aaa_daily01_report.md) のP1（HuC indexed copy／LiveFX finite validation）は実装済み。
   非OPNの内部PCM再利用などP2/P3は候補段階。再現・profilingを見てから選び、音の式を推測だけで変えない。
4. **汎用の低レベルJS Native adapter／パッケージ分離。** 将来の別作業。
   既存Playgroundの`createSoundChip()`が未完成という意味ではない。

### 未完了として再実装しないもの

- 初期22種類のNative追加生成、既存27 WASM targetのSDK移行は完了。
  [todo_createSoundChip01.md](todo_createSoundChip01.md) の古い未チェックだけで未実装と判断しない。
- CD-ROM²のHuC6280／MSM5205／CD-DA対応は完了。
  古いTODOの未公開記述は後続のSDK／npm公開記録で更新されている。
- SDK 0.1.6／npm `tetorica-fm2612` 0.2.33は過去の公開完了記録がある。0.1.7候補と区別する。
- SPCのWebKit初期化中close問題は後続で修正済み：
  [spc_webkit_close_01.md](spc_webkit_close_01.md)。
- CUE/BIN・物理CD・BIOS／CPUエミュレーション等は、今回の実装漏れではなく対象外だった。

## 作業方針を引き継ぐ

- standalone SynthとPlaygroundの共有panelを分ける。standalone用UI都合で共有音源の挙動を変えない。
- viewと音声生成の更新を分離し、表示のための常時RPC pollingや音声callback内のencode／UI処理を増やさない。
- SDK原本から正規export/importする。固定SDK snapshotを直接編集しない。
- 今回は引き継ぎ文書だけを追加。実装、配布ZIP、SDK、Tauri、広告の変更はしていない。
