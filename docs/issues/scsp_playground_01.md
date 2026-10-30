# SCSP Playground初期接続 — 2026-10-30

Saturn (SCSP) Modeを追加し、Web AudioのMain／logic Workerから同じ実SCSP
AudioWorkletを操作できるようにした。専用Synth UI／Tauri Native音声経路／SSFは後続。
[API・操作手順](../scsp.md)／[残TODO](todo_scsp_01.md)／[source・ZIP hashと検証要約](scsp_playground_01.json)。

## 今回の範囲

- `useSoundChip('scsp')`はprimaryを借用。`createSoundChip('scsp',{id})`は独立32 slots／512 KiBを作成する。
- 内蔵の自作PCMを全32 slotsへ割り当て、SCSPタブのPrepare audioだけでHold／Keyboard試奏できる。
  モードを開くだけではAudioContextやコアを生成しない。
- 32-slotの設定／RAM表示、音名による発音、PCM16 stereo upload例、Main／Workerの初期コードを追加。
  PCM／EG編集は現在JavaScript。表示gateは発音要求であり、実EGのactivity meterではない。
- PCM upload／resetは即時準備barrier、Workerのnoteはlookaheadを維持する。
  bank identity付きdescriptorで別instance・消去済みhandleを拒否する。
- manual audition lease、同じslotへの次の鍵盤の引き継ぎ、古い離鍵の無視、owner取消、Stopを接続。
  Stopは無限releaseと予約noteを止め、primaryのbank／音色を保持する。
- PS1の既存44.1 kHz streaming resamplerを共有部品へ抽出。算術を変更せず、PS1／SCSPの
  44.1／48／96 kHzと不規則な分割renderを検証した。
- 固定生成SCSP loaderはWorkletで`wasmBinary`を消費しないため、raw `Scsp.create`で
  明示的にcompileし`instantiateWasm`へ渡す。渡したbytesが不正ならfallbackせず失敗する。
  SDK pin／C++／生成WASMは今回変更していない。
- サイト用cache revision、Monaco型、共通factory／registry、配布dependency closureを更新。
  既存npm payloadの新しい相対importも解決し、SCSP pair／型／出典を含める。
- `copy_scsp_sources.mjs`でSDK manifestに照合した19 inputs／24 filesを同梱。
  元の相対layout・recipe・upstream・BSD noticeを保持。配布ZIPからの再ビルド手順は`SCSP.md`。

## 検証

- 関連Node tests **253件成功**。raw／Synth／実WASM Worklet、PS1回帰、owner／lease、
  RAM／instance境界、異常入力、factory lifecycle、Keyboard、source bundleを含む。
- Mixer生成／現行source freshness **37件成功**。ZIP bundle／準備 **10件成功**。合計300件。
- 共通APIのstrict TypeScriptと全Playground modeのpositive／negative型確認成功。
- 実際のRun ZIPを展開した内容でChromium／WebKit × Main／Workerの**4経路成功**。
  Prepare、Hold、PC Keyboardのslot 32、初期コード、PCM16 upload例、独立instance、Stopを確認。
  Worker経路は実logic Worker生成も確認。40回のaudible／silent観測を保存。
  [ブラウザ記録](scsp_playground_browser_01.json)。全物理出力をミュートし、人による試聴はしていない。
  WebKitの既知の`ResizeObserver loop completed with undelivered notifications.`は別項目に記録。
  Worklet processor error／その他のpage例外はない。
- `check_fm2612_package.mjs`成功。ビルド、tarball、installed exports／browser imports／型／既存PCMを検証。
  公開・version変更はしていない。

再実行：

```sh
node --test web/scsp.test.mjs web/scspsynth.test.mjs web/playground_scsp_worklet.test.mjs web/ps1_resampler.test.mjs
node scripts/check_playground_mode_types.mjs
node scripts/check_playground_scsp_browser.cjs --out /private/tmp/scsp-browser.json
node --test scripts/generate_playground_mixer_defaults.test.mjs scripts/generate_soundchip_mixer_presets.test.mjs scripts/vab_mixer_calibration.test.mjs
node scripts/check_fm2612_package.mjs
sh scripts/package_itch_playground.sh scsp-dev-20261030
```

## 既存Mixerの再測定

共通routing／served sourceが変わったため、古いreportのhashは書き換えず新規測定を行った。
153件の共通historical baseline／target／過去reportは保持する。

- [PS1](ps1_scsp_chip_levels_01.json)：48 PS1 captures＋8 YM2612 anchors。
  primary／extra gainは双方0.129331で従来と一致。
- [WonderSwan](wonderswan_scsp_chip_levels_01.json)：48＋8 captures。
  primary／extra gainは双方1.172528で従来と一致。
- [POKEY](pokey_scsp_chip_levels_01.json)：96＋8 YM2612＋8 PSG＋8 dual-combination captures。
  AC RMS測定の小差によりgainは約0.413033–0.413034から約0.413050–0.413051へ更新。
  target／listening policy／ユーザーの保存値は変更しない。

全reportでPCM continuity成功。generator／npm builder／freshness testsはこの新規reportを参照する。
SCSP自身のlistening calibrationはまだなく、Mixerは明示的にneutral gain 1で初期化する。

## 配布物と次の作業

今回専用の`release/itch_playground_scsp-dev-20261030*`に完全source版／Run版を生成。
Run ZIPは**964 entries、directory entries 0**でitch.ioの1,000件制限内。
新しいSCSP module／WASM／宣言／例／license／sourceの存在と相対参照を検証した。
既存releaseディレクトリー全体は削除していない。アップロード／公開／commitは未実施。

次はPCM／EG編集とCopy voice JavaScript。その後focus／復旧／Mixer・FXの操作網羅とSCSPの音量校正。
Tauri Native、DSP／slot FM／LFO、専用Synth、SSF実行は別段階に残す。
