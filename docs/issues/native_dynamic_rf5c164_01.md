# Native追加RF5C164

2026-10-24。[追加音源計画](todo_createSoundChip01.md)のRF5C164追加生成。
Mega CD／32X modeの内蔵PCMを維持し、独立した8CHと64 KiB RAMを追加ラックへ接続する。

```js
const pcm = await createSoundChip('rf5c164', {id: 'sampler'});
const sample = await pcm.loadSample(await file('/voice.wav', {type: 'arrayBuffer'}));
await pcm.setChannel(0, {...sample, volume: 200, pan: {left: 15, right: 15}});
await pcm.keyOn(0);
await beat(1);
await pcm.keyOff(0);
```

## 対象と完了条件

- 8CH・64 KiB RAM、既定12,500,000 Hz、loop／step／volume／左右pan。
- 現在のBrowser公開APIと同じ`loadMemory()`・`loadSample()`・high-level操作・raw write。
  `reset()`ではRAMを保持する。同期`read()`／`generateStereo()`をIPCへ擬装しない。
- `createSoundChip()`は全Native modeで独立した音源を作る。
  `useSoundChip()`は内蔵PCMがあれば借用し、それ以外では共有追加音源を取得する。
- 追加音源13種類合計16台・64 MiB。RAM、準備中転送、旧版、退役待ちも予算へ含める。
- Main／Worker、独立Mixer、音色情報・サンプル波形／範囲、Keyboardのinstance／CH選択。
- 手動試奏のstepと設定用stepを分け、再発音・古いrelease・別ownerの取消しを区別する。
- selected CH、bank、global enable、active-low maskを共有するraw操作を追跡し、
  他のCHの保持・予約・サンプルを古い命令や取消しで変更しない。
- 生成・RAM転送の準備・最終回収は制御側で行う。
  callback内のallocation・最終free・待機lockを増やさない。

## 検証方針

実際のBrowser公開client／配布WASM／Workletと44.1／48／96 kHzで比較する。
全CH、符号・端点marker、loop、step／clock、pan、mask／global enable、bank、
raw／high-level、resetとRAM保持、callback分割を確認する。

Rustでは所有権・共有registerのbit保持・手動試奏・RAM転送の適用／回収、
同ID再生成・Stop／再Run・生成待ち中取消しと共有予算を確認する。
Chromium／WebKitでは実Main／logic Workerと既存画面を使い、Native IPCのみmockする。
内蔵PCMの借用、独立2台、他種類との混在、サンプル読込み・編集・Keyboard・Mixerを確認する。
物理音声デバイスは開かず、実機試聴・dropoutは別に扱う。

## 音声比較とオフライン測定

実際の追加RF Worklet／配布WASMと44.1／48／96 kHzで比較した。
75ケース・448,512 stereo framesでPCM、register shadow、control／bank／mask、
positionとRAM参照の差分0。既存Mega CDも21ケース・98,304 framesで差分0。
MAME参照48,095 framesの照合も成功した。

9組のrate／clock条件で、8voice合成のclip、100 kHz clockでの保持PCM、
100 MHzでの平均化、別voiceを保った取消し、RAM保持と読取りを確認した。
音声生成中のallocation／freeは0。Native state ABIは100 B。

Apple M2・Clang 17 `-O2`、48 kHz、2秒分をfresh processで3回測った中央値。
各RFの全8CHを動かす。

| RF台数 | CPU時間／音声時間 |
| --- | --- |
| 1 | 0.14% |
| 2 | 0.21% |
| 4 | 0.33% |
| 8 | 0.64% |
| 16 | 1.40% |

C++ heapは1台66,320 B（64 KiB RAM＋784 B）。
RF4台＋既存12種類各1台の計16台は11.49%、C++ heap 2,615,472 B。
Rustラック・転送／退役queue・allocator overhead・IPC・FX・UI・音声デバイスは測定外。
実際のcallback締切・dropoutを保証する値ではない。

## 転送と手動演奏の保護

通常の公開RPCも命令IDを付け、実際の適用を待ってPromiseを完了する。
読取り専用の`status(after:id)`待機を制御FIFOから分離し、未来の命令を待つ間も
Stop・個別dispose・owner取消しを進める。後続IDの命令が先に完了しても、
未適用の古いIDの待機は解放しない。

RAM転送はinstanceごとのFIFOで管理する。呼出し時にbyte列とownerを捕捉し、
Inspectorの空き領域選択・転送・sample metadataの確定を同じ順序で行う。
手動演奏の保護で転送が拒否された時や、適用前に取消された時は、
読込み済みsampleとして登録しない。RAMを常時ダウンロードする処理は設けていない。

手動保持中のRAM保護は、start・loop・現在の再生位置から到達する範囲を扱う。
大きいstepで飛び越せない連続markerまでを含め、安全な終端が見つからない場合は
保守的に広い範囲を保護する。その範囲を上書きするには手動発音を解放する。
guardは経路変更後の次の転送時にだけ計算し、毎frame・各parameter書込みでは走査しない。

`scripts/benchmark_native_rf_guard.mjs`は現行Rustの検索関数を抽出し、`rustc -O`で再測定する。
全8voice×3経路、最大stepに必要な32連続markerを毎回全経路から検索する保守的な上限測定で、
M2・2,000回の中央値137.958 µs、p99 177.375 µs、最大235.458 µsだった。
実処理ではRAM全体を保護する結果が出ればそのvoiceの残り経路の検索も打ち切る。
この測定は転送copy・DSP・IPC・音声デバイスの時間を含まない。

ARM64 layoutはInstance 22,400 B、RF Shared 12,928 B、RF Renderer 9,224 B。
RFの固定予約は既存1,114,112 BにRAM 65,536 Bを足した1,179,648 B／台。
既存の16台・64 MiB共通予算で、保留中payloadとcallback後の退役待ちも数える。
全音源の受付に成功してから取消しを確定し、別音源の受付失敗でtransaction全体が
戻った時に、以前の予約だけが取消された状態を残さない。

## 最終統合

- JS全体：4,386成功・1 skip。新規RF22件を含む重点検証106件、UI33件も成功。
- Rust全体：510成功・4 ignored。追加RFの重点検証21件が成功。
- Chromium／WebKit：最終Tauri取込み物で実Main／logic Worker、独立RF2台と既存12種類、
  合計16台、個別RAM／clock／Mixer、sample waveform・WAV読込みと選択CHへの割当、
  KeyboardタブとRFタブ上のPCキー、同ID再生成、Stop／Runを確認した。
- Mega CD／32X／32X Nukedで内蔵PCMの借用と追加音源が分かれることを確認した。
  既存追加OPL4種類のMain／Worker・Operators／Keyboard回帰も両ブラウザーで成功。
  Native IPCだけをmockし、AudioContext／AudioWorkletは0。

| 成果物 | 照合結果 |
| --- | --- |
| `release/hello_ymfm_wasm_native-extra-rf5c164_itch_playground.zip` | SHA-256 `6479d3f039bc346a1f1d149dd7e2f976dcc4c770f12f6c80c7394afe67c4b3cf` |
| Tauri取込み | 864 files、release lock照合成功 |
| 配布module／asset参照 | 921参照、Mode starter・Native API・WASM・license検証成功 |
| Native対応ソースbundle | 1,360 files、SHA-256 `5b8d2d8c5f85eb2739677a9898e29f8e192148a91a80a3ef882d06522f9edd42` |
| 固定ソースsnapshot | 21件、現在のソース・同梱ZIPとの照合成功 |

Nativeビルド・オフライン検証はmacOS ARM64で実施した。
物理音声デバイス・credential storeを使うテストは有効化していない。
実機試聴・長時間のdropout・他OS／CPUの確認は未実施。
commit・npm公開・itch.io公開は行っていない。
