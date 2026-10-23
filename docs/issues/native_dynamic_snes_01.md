# Native追加SNES S-DSP

2026-10-24。[追加音源計画](todo_createSoundChip01.md)の`createSoundChip('snes')`対応。
CPUを動かさない8声のS-DSP楽器と、取得済みDSP／RAM timelineを対象にする。
SPC700を含む`createSoundChip('spc')`は[別のファイル再生経路として対応](native_dynamic_spc_01.md)。

```js
const voice = await createSoundChip('snes', {id:'brr-instrument'});
const sample = await voice.loadBRR(await file('/samples/tone.brr', {type:'arrayBuffer'}), {
  rootNote:'C4', loopStartSamples:0,
});
voice.setPreset(0, {sample, gain:100, volumeLeft:80, volumeRight:90});
voice.noteOn(0, 'C4');
```

## 対象と完了条件

- 1台ごとにS-DSP・64 KiB RAM・sample directory・8 physical voices・補間位相・timelineを持つ。
- 公開optionはBrowserと同じ`{id}`。32 kHzのS-DSPを出力sample rateへ補間する。`setClock()`は追加しない。
- `loadBRR`、preset／pitch／note／raw DSP、`readDsp`／`getState`／`getPreset`／`snapshot`、
  `prepareTimeline`／`playTimeline`／`stopTimeline`／`getTimelineState`、reset／Stop／disposeを接続する。
- `reset()`はsample ID・BRRを保って楽器モードへ戻す。timelineのRAMをそのまま楽器のBRRとして扱わない。
- BRR＋directoryの転送と、reset＋DSP初期値＋BRR復元を原子的に適用する。
  失敗・取消しでJSのsample metadataやNative RAMを途中まで変更しない。
- Main／Worker、個別Mixer、Keyboard・CH選択、音色情報へ接続する。
  SNESの専用タブを追加し、8声のsample／pitch／ADSR／GAIN／左右音量と試奏を扱う。
- timelineと楽器編集を排他にする。手動試奏中のRAM／timeline置換を拒否し、他loop・他instanceの発音を守る。
- 全20種類で16台・64 MiBの共通上限。固定core・RAM・管理queue、転送・timeline・準備／退役待ちを数える。
- callback内allocation・最終free・待機lockを増やさない。RAM snapshotは明示要求時だけ取得し、通常の状態通知では転送しない。
- session／generation／instance、生成待ち中Stop、同ID再生成、遅延応答、disposeを確認する。
- Web Audioを既定のまま保ち、共通DSP・WASMの音を変えない。

## C++／PCM

既存の独立S-DSP wrapperを再利用し、追加C ABIは`native_snes_core_size()`だけ。
状態ABIは152 B、core heapは67,280 B（64 KiB RAM込み）。
共通DSPアルゴリズム・WASM binaryは変更しない。Native snapshot 31 filesを同期・照合した。

実配布Worklet／WASMと225ケース・2,285,568 stereo framesを比較し、差分0。
44.1／48／96 kHz、1／128／不規則callback分割で、8声、BRR filter・高range・ENDX、
ADSR／GAIN、noise／pitch modulation、echo／RAM wrap、読取りの無作用、Stop／reset、
clock単位のtimeline・pause／replay／置換を対象にした。
既存primaryの42ケース・442,368 framesも差分0。
独立2台のRAM・timeline、KON／KOFF保護、callback内new／free 0も確認した。

## オフライン負荷測定

Apple M2・Clang 17 `-O2`、48 kHz・1秒分をfresh processで3回測った中央値。
8声のBRR・noise・pitch modulation・ADSR・echo／FIRを有効にした。

| SNES台数 | CPU時間／音声時間 | C++ heap |
| --- | --- | --- |
| 1 | 0.71% | 67,280 B |
| 2 | 0.97% | 134,560 B |
| 4 | 1.68% | 269,120 B |
| 8 | 3.42% | 538,240 B |
| 16 | 7.31% | 1,076,480 B |

16種類混在では21.88%、C++ heap 2,641,968 B。
Rustラック・IPC・UI・FX・音声デバイスは測定外。
この値は実機のcallback締切やdropoutを保証するものではない。

## RAM・予約・寿命

通常の状態通知は128出力framesごとと命令適用時にDSP register・gate・timelineだけを公開する。
RAMを継続して走査・ミラー・転送しない。
明示的な`snapshot()`では制御側でcapture bufferを確保し、callbackでRAM・DSP・frameを一度だけ記録する。
Release／Acquireで完了を公開し、要求IDに対応する同じ時点のRAMとDSPを返す。

未配信captureはラック全体で16件・1 MiBまで。取消し後の適用済みcaptureも回収し、
未取得のまま残った低レベル要求には30秒の期限を設ける。
1回のRAM uploadは64 KiB、待機中uploadはラック全体で1 MiBまで。
timelineは最大1,000,000 events、SNESの待機payloadは32 MiB以内とし、共通64 MiB予算にも数える。
全音源の取消し準備が成功してから所有データの回収をcommitし、他音源の受付失敗でsnapshotを失わない。

固定予約は1台2,293,760 B（2.1875 MiB）、16台35 MiB。
実測した型サイズと固定容量による使用上限見積りは2,195,280 Bで、予約内に収まる。
Instance 22,656 B・Session Renderer 36,960 Bは従来と同じ。
大きな構築は専用の制御側factoryで行い、64 KiBの音声スレッドstackでも動作確認した。

適用待ちとtimelineの完了待ちは命令FIFO・Worker bridgeの外で待つ。
timelineを明示的に再生した間だけ、残り時間に応じた状態確認を行う。view用の常時pollingは増やさない。
遅れたsnapshotで新しい状態を上書きせず、発音処理中の古い状態表示で新しいmanual leaseを消さない。

## 統合検証

- Node全体：4,504成功・1 skip。Modeの型チェックも成功。
- Rust全体：654成功・4 ignored。新規追加SNES 27件、追加音源全体349件も成功。
  既存primaryとの実Native PCM比較は演奏・timelineとも3 sample ratesで一致した。
- Chromium／WebKit：最終Tauri distの実Main／logic Workerで、独立2台、20種類を16台以内で混在、
  BRR／RAM・timeline完了／reset・全8声Keyboard・保持中の部分編集・Mixer・主音源との併用と編集・
  Stop／同ID再生成を確認した。Native IPCだけをmockし、AudioContext／AudioWorkletは生成していない。
  音色タブと右下のKeyboard表示を目視確認した。
- 非表示のFMエディターが他タブの試奏先を消す問題を修正し、SNES→Keyboard→Consoleの往復も確認した。
  発音処理中に古い観測結果が返っても、新しい手動leaseを削除しない回帰テストを追加した。
- 配布物：972件のmodule／asset参照、Mode starter、Native API、WASM、ライセンスを検証。
  Tauriへ取り込んだ872 filesの一致も確認した。
- 対応ソース：21種類のoffline snapshotと、1,386 filesの再ビルド用ソースZIPを照合した。

配布ZIP：`release/hello_ymfm_wasm_native-extra-snes_itch_playground.zip`。
SHA-256：`7eaf35862d801c60194f54fdf0569514688bbe47ce8c675922749ddaada52c86`。
実機での試聴・dropout評価と、Windows／Linux／ARM64のCI実行はこの検証には含めない。

主な再実行コマンド（root checkoutで実行）：

```sh
node scripts/check_native_extra_snes.mjs --out /private/tmp/native-extra-snes-pcm.json
node --test web/*.test.mjs docs/playground/*.test.mjs docs/vgm_analyzer/*.test.mjs test/*.test.mjs
node scripts/check_playground_mode_types.mjs
node --experimental-vm-modules scripts/check_playground_package.mjs w/tetorica-fm2612-playground-tauri/dist
node scripts/check_playground_native_backend_browser.cjs --extra-snes-only --root=w/tetorica-fm2612-playground-tauri/dist
cargo test --locked --manifest-path w/tetorica-fm2612-playground-tauri/src-tauri/Cargo.toml --quiet
```

対応ソースの照合はTauri checkoutで`python3 scripts/check_native_sources.py --bundle`を実行する。
