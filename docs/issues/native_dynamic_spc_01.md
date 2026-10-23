# Native追加SPCファイルプレーヤー

2026-10-24。[追加音源計画](todo_createSoundChip01.md)の`createSoundChip('spc')`対応。
SPC700とS-DSPを動かすファイル再生。CPUを実行しないBRR楽器／timeline用の`snes`とは別の入口にする。

```js
const player = await createSoundChip('spc', {id:'spc-song'});
await player.loadSPC(await file('/samples/song.spc', {type:'arrayBuffer'}));
await mixer.set(player.id, {volume:0.5});
await player.play();
// await player.pause();
// await player.seek(30);
// await player.stop(); // Loaded file retained; return to its initial state.
```

## 対象と完了条件

- 公開optionはBrowserと同じ`{id}`。SPC700・S-DSP・64 KiB RAM・読込み元・mute・補間位相を独立させる。
- `loadSPC`／`play`／`pause`／`stop`／`seek`／`getState`／`snapshot`／`setMuteMask`／`onEvent`／`dispose`を接続する。
- SPCの実行は32 kHz。BPMやWorkerの先読みに関係なく、出力sample rateへ補間して再生する。
  128 native framesの先行生成と、出力上の再生位置を区別する。pauseは位相を保ち、stopは初期状態へ戻す。
- 読込み・stop用の初期core・seekの重いCPU実行は制御側で準備し、callbackは準備済みcoreへ切り替える。
  古いload／seekや取り消したloopが、新しい再生・同IDの別instanceを上書きしない。
- snapshotは同じ時点のRAM・DSP・native framesを明示要求時だけコピーする。
  これは解析用の状態であり、完全なemulator save stateとして公開しない。
- `onEvent`は既存decoderでDSP書込みからnote／pitch／volume等を解釈する。
  購読中だけ観測し、固定容量queue・epoch・sequence・overflowと再同期で遅延／取消しを扱う。
  callbackは登録元のMain／Workerとloop contextで呼び、音声callbackからJSを直接実行しない。
- Main／Worker、個別Mixer、loop所有者、Stop／再Run、個別破棄、生成中の取消しへ接続する。
  SPCには独立した音符用Keyboardを追加しない。
- 全21種類で16台・64 MiBの共通上限。core・元file・準備中core・seek・イベント・snapshot・退役待ちも数える。
- callback内allocation・最終free・待機lockを増やさない。観測用の常時view pollingを増やさない。
- ID666の再生時間・fadeに基づく自動停止は、現行Browser APIと同じく追加しない。
- 既存のsnes-spcと同じ版・設定をNativeで使用し、共通DSP・WASMの音を変更しない。
  対応ソース・ライセンス・再ビルド材料と、Tauriの取込みを更新する。

## 検証方針

オリジナルの合成SPCを使い、実配布Worklet／WASMとNativeを44.1／48／96 kHz・可変callbackで比較する。
CPUがRAMやDSPを更新し続けること、pause／stop／seek／mute／echo、独立2台、状態読取りの無作用を確認する。
イベントはraw時刻とdecoder出力、途中購読・取消し・overflow・再同期を確認する。
Main／Workerと最終配布画面はNative IPCだけをmockし、実機試聴とは区別する。

## C++／PCM

既存の`native-snes`と同じsnes-spcへ、SPC700 CPU・state loaderと専用C ABIを追加した。
元fileはRust側で保持し、C++ coreはRAM・DSP・補間buffer・固定observer storageを持つ。
coreのheapは204,624 B、状態ABIは56 B。CPUを動かすためのIPL ROMやゲーム音源はfixtureに含めていない。

実配布`spc-worklet.js`／WASM／`SpcResampler`を参照し、252条件・2,064,384 stereo framesでPCM最大差分0。
44.1／48／96 kHz、callback 1／128／不規則分割、8声・BRR filter・noise・echo・pitch modulation、
pause／resume・stop・別fileへの置換・mute・seekを含む。
seekは0／1／17／1023／1024／15999／16000／16001／32000／48001 native framesと停止中のseekを照合した。
RAM／DSP snapshot、CPUによるRAM変更、raw DSP書込みの順序・64-bit clock、途中の観測開始・overflowも比較した。
検証したrender内の`new`／`free`は0。

```sh
node scripts/check_native_extra_spc.mjs --out /private/tmp/native-extra-spc-pcm.json
```

## オフライン負荷

Apple M2／Clang 17、`-O2`、48 kHz。1秒分を別processで3回生成したCPU時間の中央値。
8 BRR声・noise／echo／pitch modulationと、DSPを書き続ける合成SPC700 driverを使用した。
observerも有効にし、固定storageから毎output frameで回収した。

| SPC台数 | 音声時間に対するCPU時間 | C++ core heap |
| --- | --- | --- |
| 1 | 0.95% | 204,624 B |
| 2 | 1.23% | 409,248 B |
| 4 | 2.36% | 818,496 B |
| 8 | 4.54% | 1,636,992 B |
| 16 | 9.10% | 3,273,984 B |

SPCを含む16種類混在は21.56%、C++ heap 2,835,408 B。
この測定はRustのラック・元file・IPC・UI・FX・物理デバイスを含めず、実機のcallback締切を保証しない。

```sh
node scripts/benchmark_native_extra_chips.mjs --spc-only --seconds=1 --repeats=3 --out=/private/tmp/native-extra-spc-benchmark.json
```

## 予算・停止・観測

固定queueと管理用の予約は2,686,976 B／SPC instance。実測した固定queue／table heapは2,375,680 B、
Sharedは1,792 B、Rendererは88 B。共通ラックのInstance 22,656 B・Session Renderer 36,960 Bは変えていない。
core・元file・準備中／退役待ちのcore・要求payload・snapshotは別途、同じ64 MiB予算へ計上する。
元fileは最大16 MiB。RAM／DSPの未回収snapshotはSPCラック全体で16件、workspaceは各66,048 Bに制限する。

Main／Workerとも専用portで既存`createSpcClient`を使う。
ファイル再生の制御命令はframe 0で送り、BPM／Workerの先読み時刻を付けない。
完了待ちとseekのCPU実行は通常の命令FIFOから外し、Stop・個別dispose・他音源の操作を待たせない。
読み込みとStopが重なった場合は、先に受け付けたfileの読み込み順序を保ち、古い待ち応答だけを取り消す。

イベントは固定8,192書込みのqueueと最大4 packetのACK枠を使い、1 packetは2,048書込みまで。
購読中だけ取得する。intervalだけの変更では同じepochのpacketを捨てず、
load／seek／Stopの世代変更とoverflowではDSP状態から再同期する。
loop取消しはそのloopの購読と待機要求を外し、最後の購読がなくなれば取得timerを停止する。
常時のRAM取得やview用pollingは追加していない。

## 統合検証

Main／実logic Worker・Mixer・既存SPC Song importで確認した。
画面の検証はNative IPCのみをmockし、SPC700／DSPの音の比較は上記の実C++／WASMで分けて行う。

- SPCのJS回帰24件を含む関連81件が成功。実Node Workerでも、seek実行待ち中の他音源操作・取消し・破棄を確認した。
- 公開APIの独立2台・pauseの位置保持・stopのrewind・seekの再開意図・mute・RAM／DSP snapshotを確認した。
  snapshotのRAM／DSPと位置・muteは同じcaptureから返し、遅れた応答で新しい状態表示を巻き戻さない。
- ファイル読込み／seekの重複、読み込み直後のStop、無効headerからの再試行、遅延応答と同IDの再生成を確認した。
- `onEvent`のsemantic decoder・voice／type filter・ACK・overflow、interval変更中のpacket、
  failed load後の再同期、paused loop取消し後の購読解除を確認した。
- SPC単独の失敗はそのplayerだけを破棄し、Nativeエンジンと別の音源を維持する。
  購読や明示的な状態取得がない場合は、エラー監視のための常時pollingを追加しない。
- Chromium／WebKitの最終Tauri distで、Main／Worker、21種類を16台以内で混在、個別Mixer、
  共有cache／dispose／Stop／同ID再生成、既存Song importを確認した。AudioContext／AudioWorkletの生成は0。
- Modeの型チェックと、配布物のmodule／asset・Native API・WASM・ライセンスの照合も成功。

- Node全体：4,528成功・1 skip。
- Rust全体：690成功・4 ignored。追加SPCは36件、追加音源全体は385件。
  64 KiBのcallback stack、取消し・失敗時の原子的な受付、明示snapshotの上限と予算回収も確認した。
- 最終Tauri取込みは873 files、module／asset参照は975件。既存snes-spc componentの原典snapshotは34 files。
  Native全体の21 componentと、1,395 filesの対応ソースZIPを照合した。

配布ZIP：`release/hello_ymfm_wasm_native-extra-spc_itch_playground.zip`。
SHA-256：`1800709756b1efd8d4fdeff53fc3846754f69a3aba21affdc8a264b03cd9fab7`。
対応ソースZIP：`w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`。
SHA-256：`cd2131d55547b836e89d42d2f8587f90b1873ab4ea492b4a8b2908ccd294b063`。

主な再実行コマンド（root checkoutで実行）：

```sh
node --test web/*.test.mjs docs/playground/*.test.mjs docs/vgm_analyzer/*.test.mjs test/*.test.mjs
node scripts/check_playground_mode_types.mjs
node --experimental-vm-modules scripts/check_playground_package.mjs w/tetorica-fm2612-playground-tauri/dist
node scripts/check_playground_native_backend_browser.cjs --extra-spc-only --root=w/tetorica-fm2612-playground-tauri/dist
cargo test --locked --manifest-path w/tetorica-fm2612-playground-tauri/src-tauri/Cargo.toml --quiet
```

対応ソースの照合はTauri checkoutで`python3 scripts/check_native_sources.py --bundle`を実行する。
実機の試聴・dropout評価と、Windows／Linux／ARM64のCI実行は今回の検証に含めていない。
