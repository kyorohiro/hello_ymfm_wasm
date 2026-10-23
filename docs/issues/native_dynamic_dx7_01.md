# Native追加DX7

2026-10-24。[追加音源計画](todo_createSoundChip01.md)のDX7追加生成。
Mode内蔵と同じMSFAコアを独立した追加音源としてラックへ接続する。

```js
const keys = await createSoundChip('dx7', {id: 'keys'});
await keys.setPreset({name: 'MODE KEYS', algorithm: 31, feedback: 0,
  operators: {1: {coarse: 1, outputLevel: 85}}});
keys.noteOn(60, 100);
await beat(1);
keys.noteOff(60);
```

## 対象と完了条件

- 6operator・32algorithm・16voice割当。音色・SysEx bank・選択slot・LFO・filter・resamplerを個別保持する。
- Browser公開APIと同じ生成optionは`{id}`のみ。INIT音色から使い始め、`initialize()`は不要。
  DX7にclock APIは追加しない。内部44,100 Hzで計算し、出力sample rateへ変換する。
- `createSoundChip()`は全Native Modeで独立生成する。
  DX7 Modeの`useSoundChip('dx7')`は内蔵を借り、他Modeでは共有追加音源を取得する。
- 対応18種類で合計16台・64 MiB。不要な同居音源を作らず、準備中・退役待ち・bank／patch payloadも予算へ数える。
- Main／Worker、個別Mixer、既存6operator編集とKeyboardのinstance選択へ接続する。
- 演奏のowner、同じMIDI音のnote lease、手動試奏を分け、古いnoteOff・owner取消しで新しい音を止めない。
  手動保持中のscript音色上書きと、voice枠の奪取を保護する。
- 予約済みの論理音色と適用済み音色を区別する。
  音色準備の非同期完了と未来の音声frameの適用を混同せず、既存Browserの契約を保つ。
- session／generation／instance、生成待ち中Stop、同ID再生成、遅延応答・disposeを回収する。
- 観測のための常時polling、callback内allocation・最終free・待機lockを増やさない。

## 検証方針

実配布WASMとC++を44.1／48／96 kHz・可変callbackで比較し、primary経路も回帰確認する。
独立2台、16voice・release tail、preset／SysEx bank・operator live edit・panic・再発音を対象にする。
Rustでは台数／予算・適用済みsnapshot・予約取消し・manual voice保護・受付失敗時のtransactionを確認する。
Chromium／WebKitでは実Main／logic Workerと既存UIを使い、Native IPCのみmockする。
物理音声デバイスを開かず、実機試聴・dropout評価とは区別する。

## C++／PCM

実配布DX7 WASMとの63ケース・718,848 stereo framesを、44.1／48／96 kHz・可変callbackで比較し差分0。
既存primaryも114ケース・792,576 framesで差分0だった。
既存コアを使い、手動保持slotを除いたvoice割当、個別slotの強制停止、core size照会をNativeへ追加する。
MSFAの共通LUTは制御側で一度だけ44,100 Hzとして初期化し、LFO・filter・resampler・16音の状態は各コアが持つ。
個別停止にも64内部frameの先読みbufferとfilterの遅延があり、他の音を巻き込む全体bufferの消去は行わない。

C++コアの確保量は35,320 B。SynthUnitと生成時に確保する16個のDx7Noteを含む。
17箇所の確保失敗を注入し、途中生成の回収も確認した。
独立性・保護されたslot割当・個別停止を実コアで検証し、callback allocation／freeは0。
Browser DSPと配布WASM binaryは変更しない。

## オフライン負荷測定

Apple M2・Clang 17・C++17 `-O2` scalar、48 kHz。
各DX7を16音で発音し、6operator、feedback 5、LFOを使用。
algorithmはインスタンス番号によって0〜31を使い分ける。
4,096 frameのwarmup後に1秒分のDSP・加算のみを計測し、fresh process 3試行の中央値を記録した。

| DX7台数 | CPU時間／音声時間 | C++ heap |
| --- | --- | --- |
| 1 | 1.28% | 35,320 B |
| 2 | 1.68% | 70,640 B |
| 4 | 2.97% | 141,280 B |
| 8 | 6.02% | 282,560 B |
| 16 | 12.35% | 565,120 B |

全18種類からSega PSG・AYを除いた各1台・合計16台では23.20%、C++ heap 2,599,512 B。
生成・warmup・Rustラック・IPC・UI・FX・音声デバイスは測定外で、実機のcallback締切やdropoutを保証しない。

## 状態・所有者・メモリー

公開APIの音色setterと`getState()`／`getPreset()`は、Browserと同じく受理済みの将来編集を含む論理音色を返す。
予約frameまで待つことでWorkerの命令FIFOやStopを止めない。
Inspectorは適用済みsnapshotを読み、試奏・明示編集の適用確認はFIFOの外で待つ。
部分的なoperator／feedback編集は対象VCED byteだけを変更し、無関係な将来の音色情報を上書きしない。
Inspectorの部分的なpreset変更も対象byteだけを反映するが、Browserと同じく新しい音色世代を割り当てる。
algorithm等を変更した後のlive operator編集が、変更前の音色で保持中の音へ届かないことを保つ。
feedbackのみの変更は同じ音色世代のlive editとして扱う。
読み取りは状態通知を再発行せず、明示編集・取消し・接続変更を画面の更新契機にする。
JS側の未処理準備は各インスタンス256件までに制限する。

16voiceのmanual保持、scriptのperformance／owner、Mainのprivate group、MIDI音ごとのnote leaseを区別する。
16音を手動保持中はscriptがその枠を奪わず、古いnoteOffで新しい同音を止めない。
手動保持中のscript音色変更は非致命的に拒否する。
同じ音色世代の音量・周波数・feedbackの明示編集は保持音とrelease tailにも適用し、EG・algorithm等は次の発音に反映する。
通常のnoteOff／allNotesOffはreleaseを残す。
固定16要素でtailのownerも追跡し、loop取消し・scoped panicではそのownerの余韻を停止する。
slot再利用で古いtailの所有権を外し、取消しで新しい発音を巻き込まない。
UIのactive note表示は適用済みnote gateで、エンベロープの瞬間振幅ではない。

macOS ARM64のInstanceは22,656 B、DX7 Shared 12,928 B、Renderer 2,496 B、session Renderer 36,960 B。
Sharedのatomic bankとRendererのbankは制御側で各4,960 Bを確保し、大きなbank配列をcallbackのstackへ積まない。
DX7専用領域はC++コア35,320 B＋bank 9,920 B＝45,240 B。
固定queue＋共通管理余裕の1,114,112 Bへ専用領域も保守的に加算し、1台の予約を1,159,352 Bとする。
準備・予約・退役待ちのpayloadも別途64 MiB予算に含める。
既存の最大YMF262はInstance＋C++コア49,696 Bで、共通管理余裕65,536 B以内を維持する。

## 統合確認

- JavaScript全体4,454件成功・1件skip。追加DX7 clientは15件。
  全追加音源・Primary DX7・実Worklet・Inspector・runtimeなどの集中検証410件も成功。
- Rust全体605件成功・4件ignore。追加DX7は18件。
  部分的なpreset変更と音色世代・将来の編集のマージも、既存Native primaryとの実PCM比較で一致した。
- Mode別の型検査成功。
- 最終Tauri distでChromium／WebKitともMain／Workerが成功。
  独立2台、32音色SysEx・選択slot・6operator・手動保持中の編集・Keyboard・Mixer、
  全18種類を使う16枠内の混在、primary借用、Stop・同ID置換を確認した。
  Native IPCのみmockし、AudioContext／AudioWorklet生成とDX7 WASM取得は0件。
- packageの959箇所のmodule／asset参照、869ファイルのTauri取込みhashを検証した。
- 21種類のoffline source snapshotと1,378ファイルの対応ソースZIPを検証した。
- `web`→`docs/js`、cache revision `native-extra-dx7-1`、ローカルPlayground ZIP、
  Tauri dist／release lock、対応ソースZIPを更新した。公開・commitは行っていない。

| 成果物 | SHA-256 |
| --- | --- |
| `release/hello_ymfm_wasm_native-extra-dx7_itch_playground.zip` | `1d86f42422ad2ad2df6627b915addbdbd92482c19f7dee87019979d257602299` |
| `w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip` | `1813d52c2780f1b53254eee83daca887bddd1bce0376439a1fa9d4826e1ea97e` |

検証環境はmacOS ARM64。物理音声デバイスでの試聴と、Windows／Linuxのbuild・実機確認は未実施。
オフラインPCM一致やmock IPCでのUI成功を、実機のdropout解消とはみなさない。

主な再実行入口：

```sh
node scripts/check_native_extra_dx7.mjs
node --test web/*.test.mjs docs/playground/*.test.mjs docs/vgm_analyzer/*.test.mjs test/*.test.mjs
node scripts/check_playground_mode_types.mjs
node scripts/check_playground_native_backend_browser.cjs --extra-dx7-only --root=w/tetorica-fm2612-playground-tauri/dist
node --experimental-vm-modules scripts/check_playground_package.mjs w/tetorica-fm2612-playground-tauri/dist
# 以下はTauri repository内
cargo test --locked --manifest-path src-tauri/Cargo.toml --quiet
python3 scripts/import_release.py --check
python3 scripts/check_native_sources.py --bundle
```
