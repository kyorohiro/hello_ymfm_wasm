# Native追加YM2610

2026-10-23。[追加音源計画](todo_createSoundChip01.md)の次の対象として、
`createSoundChip('ym2610')`をNativeへ接続する。

```js
const opnb = await createSoundChip('ym2610', {id: 'opnb'});
opnb.setPreset(0, FM_PRESETS['one-op-basic']);
opnb.noteOn(0, 'C4');
opnb.ssg.tone(0, {period: 284, volume: 8});
await mixer.set(opnb.id, {volume: 0.5});
```

## 公開範囲

既存Browser追加音源の`createOpnClient('ym2610')`と、実際に使う`playground_opn_worklet.js`を基準にする。
Neo Geo主音源の独自APIや、6CHのYM2610Bの追加生成を暗黙に公開しない。

- FMは4CH。公開APIのlogical 0／1／2／3をphysical 1／2／4／5へ対応させる。
  register writeとsnapshotのkeyMasksは物理6枠、画面・FM preset・TFI／VGIはlogical 4枠を使う。
  CH3特殊モード／CSMはphysical 2、画面のFM 2（logical 1）に対応する。
- FM operator／preset・pan／LFO・frequency、CH3特殊／CSM、timer、raw write、clock・reset。
- SSG 3CHのtone・共有noise／envelope。保持した音量0と、一時的なkeyOffの音量0を区別する。
- ADPCM-AはROM 6voice、256-byte単位の範囲、全体level・voice level／pan・keyOn／keyOff。
  decoded rateはclock / 432、pitch／repeatは持たない。範囲は1 MiB未満にする。
- ADPCM-BはROM 1voice、256-byte単位の範囲、Delta-N／再生速度・linear level・pan・repeat。
  `adpcm`は`adpcmB`と同じオブジェクト。
- A／Bの`loadMemory()`は符号化済みbytesを転送する。Browser追加音源には`loadSample()`やtimeline APIがないため、
  今回も追加しない。主音源の音声decode／encodeの機能とは区別する。
- `useSoundChip('ym2610')`は該当Modeなら主音源を借用し、それ以外ではRun内で共有する追加音源を使う。
  Neo Geo B modeの既存借用規則と、主音源の寿命は維持する。

## ROMと音声callback

A／Bそれぞれ16 MiBのアドレス空間を持ち、未転送のアドレスは0を返す。
追加音源では**64 KiB単位のpageを必要な箇所だけ確保する**。
高いアドレスへ小さいsampleを置いても、その前の空間をすべて確保しない。
既存Neo Geo主音源のdense ROM・ABI・出力は変更しない。

- 共有の追加ラックは5種類合計16台・64 MiB。固定queue＋管理余裕の予約と、
  実際に確保したROM pages、準備中command、古いpageの退役待ちも数える。
- ROM pageはimmutable。部分更新も制御側で以前のpageからコピーしてpatchする。
  callbackでは用意したpageへのpointerを切り替え、16 MiBのmemcpy・allocation・最終freeを行わない。
- pageを跨ぐ転送も、全bank・アドレス・長さ・予算を検証してから受け付ける。
  1 bankの転送は最大16 MiB、1 Native batchの転送合計は32 MiBまで。
- 同じtransaction内の部分更新はwire順に重ねる。
  新しいpageを共有ledgerへ公開するのは、すべての音源・命令のadmissionが通った後にする。
  失敗したtransactionのpageは公開せず、所有参照がなくなった後に制御側で予約と一緒に回収する。
- 古いpageはcallback・未来の命令・準備dataが参照している間も保持・課金する。
  ROM置換中は旧版と新版が同時に存在するため、現在のROM量だけでは受付可否を判断しない。
- メモリー予算を超えた場合は理由を返す。異種・主音源との混在batchでも、
  拒否された命令のためにNativeエンジン全体を停止させない。

Browserのmemory転送はperformanceのprepare段階で即時適用され、未来のnote schedulingには入らない。
Nativeも転送を即時FIFOのresource操作として扱い、page適用を確認してからPromiseを解決する。
受付前の停止・取消しは転送を中止する。受付済みのROM bytesは後のloop停止では巻き戻さず、
古いloopが残したbytesを次の部分転送で復活させるようなCOWの依存関係を作らない。
Run／session・instanceの失効では、古い転送が同じIDの新音源へ届かないようにする。

64 MiBは追加Nativeラックが所有する確保・予約の予算であり、プロセス全体の総使用量ではない。
IPC受信時のJSON／DTO、JS側のbytes、主音源・共通FX・sessionの固定管理分は別枠。
A／Bを16 MiBずつ埋めた音源を2台作れるとは限らない。小さいROMを使う複数台も同じ予算で扱う。

## 演奏・画面・寿命

Mainでは安定したprivate owner group、Workerでは既存のperformance／ownerを使う。
FM通常発音・CSM、SSG、ADPCM-A各voice、ADPCM-Bの所有者と手動Keyboardを区別する。
ADPCM-Aの複数voice maskと、ADPCM-Bのexecute=0／record／resetによる停止も追跡する。
一方のloopの終了・stale keyOffで、後から別ownerが鳴らした音を止めない。

追加FM画面にYM2610を表示し、FM 4CH＋SSG＋ADPCM-A／Bを編集・試奏する。
Aは6voiceから対象を選び、それぞれのsample範囲・level・panと全体levelを編集する。
Bはsample範囲・Delta-N・level・panを編集する。
Keyboard対象はFM 4＋SSG 3＋A 6＋B 1の14個。Aは固定速度、Bは設定済み範囲・速度で鳴らす。

初回表示・Refreshではsnapshotを観測し、preset・発音・ROMを変更しない。
表示更新は選択・通知・編集完了・Refreshで行い、常時ポーリングは追加しない。
古い画面の編集・snapshot応答・Workerが、別選択先や同じIDで再生成した音源へ届かないことを確認する。
生成・破棄だけでは`mixer/current.json`を変更しない。

## 検証

物理音声デバイスを開く試聴と、オフライン／mock検証は区別する。

- 実際の追加音源用Worklet・配布WASMとのPCM・status／IRQ・read port比較を44.1／48／96 kHzで行う。
  FM4・全algorithm、SSG全envelope、ADPCM-A／B、clock・reset、疎なROMと部分転送を含める。
- 既存Neo GeoのYM2610／YM2610B主音源の回帰比較を行う。
- Nativeの実経路で、同種2台＋異種、共有上限、予算・置換・退役、失敗時の原子性、
  Main／Worker owner・手動発音・CSM・状態待ち・Stop／disposeを確認する。
- Chromium／WebKitの実Main／logic Workerで、Native IPCをmockして編集・Keyboard・Mixer・4CHのTFI／VGI・寿命を確認する。
  `scripts/check_playground_native_backend_browser.cjs --extra-ym2610-only`を使う。
- 配布ZIP・Tauri取込み・module参照・同梱ソースと原典snapshotを照合する。

## 検証結果

- `scripts/check_native_extra_ym2610.mjs`：実際の追加音源用Worklet／配布WASMと204ケース・1,253,376 stereo framesを比較し、
  PCM・status・IRQ・read portsの差分0。44.1／48／96 kHz、FM4・全algorithm、SSG・ADPCM-A／B・clock・resetを含む。
- `scripts/check_native_ym2610b.mjs`：既存Neo GeoのYM2610／YM2610B主音源72ケース・442,368 framesも差分0。
- C++ fixtureで、16 MiBを制御側で準備してcallbackでは256 page pointersだけを公開すること、
  部分更新・旧版保持・未転送pageの0、bank／instanceの分離、観測snapshotを確認した。
  FM1音の取消し中も他のFM・SSG・ADPCM-A／Bが途切れない比較を、8 MHz→100 kHz→8 MHzで行った。
  callback内allocation／freeは0。
- ソース段階と最終distのChromium／WebKitで、実Main／logic Worker、同種2台＋YM2608＋YM2203＋YM2612＋PSG、
  高アドレスの疎なA／B ROM・page跨ぎ・独立clock・Mixer・編集・PC Keyboard・4CHのTFI／VGI ZIP、
  同ID置換・非FM Mode・Stop／再Runを確認した。Native IPCはmockし、AudioContext／AudioWorkletは生成していない。
- Node全体は4,277成功・1 skip。関連JS 108件と画面26件も成功。
- Rust全体は399成功・4 ignored。追加YM2610の20件を含む。
  同種2台・5種類共通16台上限・22 Mode、2 bank各16 MiBと置換、予算拒否・混在transactionの巻戻し、
  pageの旧版保持と回収、accepted resourceとnote ownerの分離、Main／Worker・手動発音・CSM・
  ADPCM-A mask／B raw停止、状態待機中のStopを確認した。
- 最終distでは既存の追加YM2608／YM2203／YM2612／PSGも両ブラウザーで回帰確認した。
- Nativeビルドの検証環境はmacOS ARM64。MSVC／GCC・他CPUは既存CIで確認する。
  物理デバイスを開くignoredテスト、実機試聴・長時間のdropout確認は実行していない。

### オフラインDSP測定

Apple M2・Clang 17 `-O2`、48 kHzで2秒分を3回測った中央値。
各YM2610はFM4・SSG3・ADPCM-A6・ADPCM-Bを動かし、A／Bにそれぞれ64 KiBのROM pageを使う。

| YM2610台数 | 音声時間に対するCPU時間 | C++コア＋ROMの確保量 |
| --- | --- | --- |
| 1 | 1.06% | 142,208 B |
| 2 | 2.28% | 284,416 B |
| 4 | 4.36% | 568,832 B |
| 8 | 8.61% | 1,137,664 B |
| 16 | 17.10% | 2,275,328 B |

1台の内訳はコア11,136 B＋ROM pages 131,072 B。
4 YM2610＋4 YM2608＋4 YM2612＋2 YM2203＋2 PSGは17.31%、9,049,888 B。
描画中のallocation／freeは全ケース0。
Rustラック・固定queue・page管理と旧版の退役・allocator overhead・IPC・FX・UIは含まない。
実機のcallback締切・ドロップアウトを保証する値ではない。
`scripts/benchmark_native_extra_chips.mjs`で再実行できる。

ARM64のRust layoutでは追加Instance 14,720 B（YM2610 Shared 9,344 Bを含む）、
Renderer 5,248 B、session Shared 137,088 B。退役queueは1,048,576 B／台。
固定予約1,114,112 Bに加え、ROM pageは65,536 B＋管理余裕64 B、
所有payloadは実capacity＋管理余裕256 Bを予約する。

16 MiBのpage準備を別途3回測った中央値は3.240 ms。
256 pointersの公開はhot cacheで100,000回測った平均0.487 μs。
この値にもRPC・lock・decode・UI・音声デバイスは含まず、実機の締切を保証しない。

## 配布・同梱

- `web`から`docs/js`へ同期し、cache revisionを`native-extra-ym2610-1`へ更新した。
- `release/hello_ymfm_wasm_native-extra-ym2610_itch_playground.zip`を作成した。
  SHA256: `0ed08fe0f22ba784b49aa067eebd5e170f6fee174d56343075604395c46ae8bc`。
- Tauriへ858ファイルを取り込み、release lockとの一致を確認した。
  879件のlocal module／asset参照と、Mode starter・WASM・ライセンスの存在を確認した。
- Native source ZIPは1,331ファイル。SHA256:
  `be8ce8bc0028751e6e9ba03bca6896a94d56bcdd085160d106ce74cd4ae19b70`。
  21種類の原典snapshotと、現在のソース／同梱ZIPの一致を確認した。
- npm・itch.ioへの公開は行っていない。
