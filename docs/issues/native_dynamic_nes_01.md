# Native追加NES＋FDS

2026-10-24。[追加音源計画](todo_createSoundChip01.md)のNES追加生成。
Mode内蔵と同じ単独Nativeコアを使い、独立したAPUと任意FDSを追加ラックへ接続する。

```js
const apu = await createSoundChip('nes', {id: 'famicom', fds: true});
apu.pulse.setVoice(0, {duty: 0.5, volume: 10});
apu.pulse.noteOn(0, 'C4');
await beat(1);
apu.pulse.keyOff(0);
```

## 対象と完了条件

- pulse 2CH・triangle・noise・DMC、任意FDS。追加生成の既定は`fds:false`。
  Browserと同じ自動初期設定・公開API・`{fds,clock}`のvalidationを維持する。
- 64 KiB DMCメモリー、FDS波形・modulation・gain、基準clockと再生clockをインスタンスごとに保持する。
- `createSoundChip()`は全Native Modeで独立した音源を作る。
  `useSoundChip()`はNES Modeの内蔵を借用し、他のModeでは共有追加音源を取得する。
- 追加16種類合計16台・64 MiB。不要な同居音源を作らず、memory・準備中・退役待ちも予算に含める。
- Main／Worker、個別Mixer、既存NES音色情報の編集とKeyboardのinstance／CH選択。
- DMCメモリー転送の適用・取消しと手動保持、FDS有無、共有enable・IO・wave write設定を区別し、
  他のCH／owner／インスタンスの発音・波形・sampleを誤って変更しない。
- session／generation／instance、生成待ち中Stop、同ID再生成、遅延応答・個別disposeを回収する。
- 観測のための常時pollingと、callback内のallocation・最終free・待機lockを増やさない。

## 検証方針

実配布Worklet／WASMとC++を44.1／48／96 kHz、可変callbackで比較する。
全CH、DMC、FDS波形・modulation・有無、基準clock・clock変更、reset／Stop、独立2台を対象にする。
Rustでは台数／予算・転送の適用／取消し・所有者・手動試奏・受付失敗時のtransactionを確認する。
Chromium／WebKitで実Main／logic Workerと既存画面を動かし、Native IPCのみmockする。
物理音声デバイスを開かず、実機試聴・dropout評価とは区別する。

## 検証結果

実配布NES Worklet／WASMと243ケース・2,353,536 stereo framesを比較した。
44.1／48／96 kHz、1frame／128frame／不規則なcallback分割、FDS有無、
PAL `1662607.125`・NTSC `1773448.875`などの小数基準clockを含め、PCM差分0。
既存primaryも72ケース・710,784 framesでJS／WASM／Nativeの差分0。

既存の単独コアを再利用し、Native用のCH別Stop・active mask・core size照会と、
DMCの末尾byteを保持したCH別enable・保護付きenable register書込みを追加する。
FDSのIOが無効でもCH別Stopでoscillatorを止め、wave・gain・IO設定を保持する。
DMCのenable解除後も残り得るDAC出力はCH別Stopで無音にし、設定用DAC levelは保持する。
既存のBrowser DSPとWASM binaryは変更しない。Native state ABIは400 Bで変更していない。
独立性、RAM・clock保持、完全reset、読取りの無作用、有限DMCの終了を実C++で確認した。
音声生成中のallocation／freeは0。

## 転送量とオフライン測定

DMC memoryは準備済みの差分を既存64 KiB RAMへ適用する。
未来のreset・重なる転送・取消しの順序を保つため、制御側で先読みした全体画像の置換は使わない。
1 batch最大64 KiB、追加NES全体の待機uploadは最大1 MiBに制限する。
公開clientのuploadは即時適用で、Promiseは実際の適用を確認して完了する。

Apple M2・Clang 17 `-O2`、48 kHzで1秒分をfresh processで3回測った中央値。
各NESはAPU全5CHとFDSを動かす。

| NES台数 | CPU時間／音声時間 |
| --- | --- |
| 1 | 1.80% |
| 2 | 3.59% |
| 4 | 7.16% |
| 8 | 14.46% |
| 16 | 28.56% |

1台のC++ heapは81,584 B（DMC RAM 65,536 B込み）。
全16種類各1台の混在は16.42%、C++ heapは2,564,096 B。
Rustラック・転送queue・IPC・FX・UI・音声デバイスは測定外。

同じC ABIのmemory copyを、確保済みRAM・warm cache・10,000回で測った値。

| 適用量 | 中央値 | p99 | 最大 |
| --- | --- | --- | --- |
| 64 KiB | 1.000 µs | 1.375 µs | 3.167 µs |
| 16台 × 64 KiB | 16.542 µs | 25.542 µs | 101.333 µs |

このcopy測定はcoverage更新・Rustラック・scheduler・IPCを含まず、実機のcallback締切やdropoutを保証しない。

Rustのdebug buildでも、準備済み64 KiB uploadの適用・coverage更新・状態publishを含めて測った。
各30試行、無発音・1 frame callbackの中央値／p97／最大は、1台で38.875／54.084／67.750 µs、
16台で463.666／510.167／550.416 µs。release buildや実音声デバイスの性能値とは区別する。

## 所有者・寿命・予算

- memory／clockの完了待ちは制御命令FIFOの外で行い、待機中もStop／disposeを受け付ける。
  完了結果は512件まで保持し、期限切れIDを明示的に拒否する。
- loop取消しは全音源の受付確認後に確定する。受付失敗で一部の音源だけを取り消さない。
- 手動Keyboardで保持中のDMC memory置換と、手動発音中のclock変更は非致命的な拒否にする。
  共有enable・FDS IO・wave書込み設定を保護し、別CHの操作でDMCの最終byteを切らない。
- raw DMCを別ownerへ引き継ぐ場合は新しいsampleで開始し、古いownerの停止では新しい発音を止めない。
- coverage領域2個は制御側で確保し、callbackのstackへ大きな配列を積まない。
  `Instance` 22,528 B、NES Shared 13,056 B、Renderer 448 B、session Renderer 36,960 B。
  NESはInstance＋C++コア＋coverage heapが120,496 Bで、管理余裕＋RAMの131,072 B以内。
  共通の固定queue予約を加えた1台の予算は1,179,648 B。待機payloadは別途加算する。
  既存15種類も最大のYMF262でInstance＋コア49,568 Bとなり、管理余裕65,536 B以内。

Main／Workerの追加clientは同じInspectorを使い、編集中の対象ビットだけを反映する。
追加NESは自動初期設定なのでGame Boyの`initialize()`に相当する呼出しは不要。
NES Modeでの`useSoundChip('nes')`はFDS付き内蔵音源を借り、
他のModeでは既定のFDSなし追加音源を共有する。`useSoundChip()`へ生成optionは渡さない。

## 統合と配布物の確認

- JavaScript全体：4,427件成功・1件skip。追加NES clientは13件。
- Rust全体：570件成功・4件ignore。追加NESは22件。
- Mode別の型検査成功。
- 最終Tauri distでChromium／WebKitともMain／Workerを確認。
  独立2台、FDS有無、小数PAL clock、DMC memory、全16種類の混在、
  Keyboard全CH、FDS／pulse編集、Mixer、primary借用、Stop・同ID置換が成功。
  Game Boy・RF5C164の既存追加音源テストも両browserで成功。
  Native IPCをmockし、AudioContext／AudioWorkletは作成していない。
- package内の946箇所のmodule／asset参照、867ファイルのTauri取込みhash、
  21種類のoffline source snapshotと1,372ファイルの対応ソースZIPを検証した。
- `web`→`docs/js`、cache revision `native-extra-nes-1`、ローカルPlayground ZIP、
  Tauri dist／release lock、対応ソースZIPを更新した。公開・commitは行っていない。

ローカル成果物：

| 成果物 | SHA-256 |
| --- | --- |
| `release/hello_ymfm_wasm_native-extra-nes_itch_playground.zip` | `c0645b283fd643a3d4085878fc47acebee81c2d9d570c79e09241d7b6b03278f` |
| `w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip` | `a7c8ce2a3b4f10d1b8aa1ea8b8757477bf8cacceda5399178c729e4d78da0d09` |

検証環境はmacOS ARM64。物理音声デバイスでの試聴と、Windows／Linuxのbuild・実機確認は未実施。
オフラインPCM一致・mock IPCでのUI成功を、実機のdropout解消とはみなさない。

主な再実行入口：

```sh
node scripts/check_native_extra_nes.mjs
node --test web/*.test.mjs docs/playground/*.test.mjs docs/vgm_analyzer/*.test.mjs test/*.test.mjs
node scripts/check_playground_mode_types.mjs
node scripts/check_playground_native_backend_browser.cjs --extra-nes-only --root=w/tetorica-fm2612-playground-tauri/dist
node --experimental-vm-modules scripts/check_playground_package.mjs w/tetorica-fm2612-playground-tauri/dist
# 以下はTauri repository内
cargo test --locked --manifest-path src-tauri/Cargo.toml --quiet
python3 scripts/import_release.py --check
python3 scripts/check_native_sources.py --bundle
```
