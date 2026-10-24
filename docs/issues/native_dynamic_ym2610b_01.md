# 追加YM2610Bの6FM対応

2026-10-24。[追加音源計画](todo_createSoundChip01.md)の残件として、
`createSoundChip('ym2610b')`をBrowser／Nativeの両方へ追加した。
従来の`ym2610`は4FMを維持し、追加生成の公開名は合計22種類になった。

## 公開APIと取得規則

```js
const opnb = await createSoundChip('ym2610b', {id: 'six-fm'});
try {
  // 数字は追加音源のlogical channel。ModeのCH1などには依存しない。
  for (let channel = 0; channel < 6; channel++) {
    opnb.setAlgo(channel, 7, 0);
    opnb.setPan(channel, true, true);
    opnb.setOperator(channel, 3, {
      multi: 1, tl: 24, ar: 31, d1r: 0, d2r: 0, sl: 0, rr: 15,
    });
    opnb.setFrequency(channel, 220 * 2 ** (channel / 12));
    opnb.keyOn(channel);
    await sleep(0.2);
    opnb.keyOff(channel);
  }
} finally {
  opnb.dispose();
}
```

| 公開名 | FMのlogical→physical | SSG | ADPCM-A | ADPCM-B |
| --- | --- | --- | --- | --- |
| `ym2610` | 0..3→1／2／4／5 | 3CH | 6voice | 1voice |
| `ym2610b` | 0..5→0／1／2／3／4／5 | 3CH | 6voice | 1voice |

`ym2610b`のFM APIは6CHの`YM2610BSynth`。4CH facadeの`.fm`を経由せず、
`setPreset()`・operator・pan／LFO・周波数・CH3特殊／CSM・raw writeを呼べる。
`ssg`・`adpcmA`・`adpcmB`を持ち、`adpcm`は`adpcmB`と同じオブジェクト。
初期clockは8 MHzで、`await setClock(hz)`によってFM／SSG／ADPCM-Bの周波数計算も更新する。
Aはclock / 432の固定速度、BはDelta-Nとrepeatを持つ。
既存の追加YM2610と同様に、`loadMemory()`には符号化済みのA／B bytesを渡す。

`createSoundChip()`は選択Modeにかかわらず毎回独立生成する。
`useSoundChip()`は、主音源の公開名が一致する場合だけ借用する。

- Neo Geoの`useSoundChip('ym2610')`は4FM主音源を借用する。
- Neo Geo Bの`useSoundChip('ym2610b')`は6FM主音源を借用する。
- Neo Geo Bで`ym2610`を要求すると、独立した4FMをRun内で共有・cacheする。
  Neo Geoで`ym2610b`を要求した場合も、独立した6FMを共有生成する。
- 別のvariantを同じ主音源の別名として扱わない。Browser／Native・Main／Workerで型と動作を揃える。

共有生成の同時要求は集約し、個別`dispose()`後には同じ公開名・Mixer IDで再生成できる。
借用した主音源は追加音源の破棄対象にしない。

## variant・ROM・音声callback

NativeではYM2610とYM2610Bの共通追加コアを使い、生成時にvariantを固定する。
生成／status／disposeと命令の種類も区別し、別variantのinstanceへの命令・状態応答を拒否する。
raw register、reset、clock変更でvariantを切り替えることはできない。
同じMixer IDを再利用しても、古いinstance・session・ownerの命令を新音源へ届けない。

各インスタンスはA／Bそれぞれ独立した16 MiBのROMアドレス空間を持つ。
Nativeでは必要な64 KiB pageだけを確保し、未転送部分を0として読む。
pageの部分更新は制御側で準備し、callbackではpointerを公開する。
旧page・準備中転送・退役待ちも既存のメモリー予算へ含める。
resetはROMの内容を保持する。

ラック上限は**22種類合計16台・64 MiB**。64 MiBは1台ごとの上限ではない。
固定queue・管理余裕とROMの新旧保持も数えるため、A／Bを各16 MiB埋めた音源を2台作れるとは限らない。
IPCのJSON／DTO・JSのbytes・decode・主音源・FXは別枠で、プロセス総使用量の上限とは区別する。
ROMの受付・予算拒否・取消し・回収は[既存YM2610の規則](native_dynamic_ym2610_01.md)を維持する。

Mainはprivate owner group、Workerは既存performance／ownerへ接続する。
FM6・SSG・ADPCM-A各voice・ADPCM-Bを個別に追跡し、古いloopの取消しやkeyOffで別ownerの発音を止めない。
Browser追加OPNの所有者追跡にもSSGとA／Bを追加した。
port 1のADPCM-A end register `0x28`を、port 0のFM key registerと誤認しない。
clockは適用確認後に反映し、ROM転送完了と未来の発音時刻を分ける。

## Mixer・Keyboard・Inspector

Mixerへ種類`ym2610b`と個別IDで接続し、volume／pan／mute／soloを分離する。
System初期値は既存の単一carrier校正に合わせる。追加Bのunity基準振幅は`0.1246337890625`、
種類別gainは`1.03357`。他の種類・主音源の既存gainは変更しない。
保存済みPreset／default／currentの上書き規則を維持し、生成・破棄だけでは`mixer/current.json`を書き換えない。
[共通の試聴Example](playground_chip_comparison_01.md)もYM2610Bを含む22種類へ拡張する。

KeyboardはFM6＋SSG3＋A6＋B1の16対象から選択する。
Nativeの追加OPN Inspector／operator編集も、選択したinstanceのFM6・SSG・A／Bへ接続する。
TFI／VGIの読み書きと分割exportは、YM2610の4CHとYM2610Bの6CHを区別する。
ADPCM-Aは設定済み範囲を固定速度で、Bは設定済み範囲・速度で試奏する。

表示は選択・状態通知・編集完了・Refreshを契機に更新する。
表示を開くだけで音色・ROM・発音を変更せず、常時pollingを増やさない。
Native音声はcallbackで生成し、AudioContext／AudioWorkletや連続PCM転送を追加しない。

## 確認済みの検証

- `scripts/check_native_extra_ym2610.mjs`：追加YM2610／YM2610Bを、実際の追加音源用Worklet・配布WASMと比較した。
  44.1／48／96 kHz、両variantの全FM・algorithm、SSG、ADPCM-A／B、clock・resetを含む
  **504ケース・3,096,576 stereo framesでPCM・status・IRQ・read portsの差分0**。
- `scripts/check_native_ym2610b.mjs`：既存YM2610／YM2610B主音源の72ケース・442,368 stereo framesも差分0。
- C++ fixture：variantの固定、Bだけに存在するphysical FM0／FM3の発音・手動試奏、
  reset・疎なA／B ROM・部分更新・未転送page・旧page保持・clock変更を確認した。
  fixtureで測定したcallback内allocation／freeは0。
- Rustの対象26件が成功。Bの全6FM、variantを違えた命令／status／disposeの拒否と原子性、
  手動lease・clock競合と回復、Workerの所有者取消し、16台共通上限・疎なROM・Stop・制御側回収を含む。
- Browser関連Node 398件が成功。実WASMの全6FM・address／data write・A／B再生・reset時ROM保持、
  44.1／48／96 kHzの分割render、pending clock／ROM requestの破棄、Main／Workerの正しい借用・cache・再生成を確認した。
- Native JS関連308件が成功。実logic Workerの6CH状態・author edit・clock／ROM完了・同ID再生成、
  coalesced lookup後のowner分離、遅延生成の回収を含む。

- 全体Node試験は4,914成功・1 skip。Rust全体は699成功・4 ignoredで失敗0。
  Tauriの`npm test`も成功（Node 31件とPython）。Mode別の型チェックも成功した。
- Chromium／WebKitで、実Main／logic Workerから4FMと6FMを生成し、
  独立ROM・clock・Mixer・SSG／A／B編集・Keyboard・4／6CH TFI／VGI ZIP、
  同ID再生成・Stop／再Run・非FM Modeの画面切替を確認した。Native IPCはmock。
- 全22種類の生成途中取消し・遅延応答・Workerへの遅い配送・
  共有待機者の分離・同ID再生成を両ブラウザーで検証した。
  待機要求・追加音源・Worker・port／listenerの残存は0。
- ADPCM-Bのraw制御も追跡する。execute解除・record・resetを停止として扱い、
  古いownerの停止を別ownerへ送らない。port 1の`0x28`はFM発音と数えない。
  この修正後の全体Node試験と最終パッケージの画面操作を再確認した。

- 全22種類の比較ExampleをChromium／WebKit、Native／Web Audio、Main／Workerの全8通りで完走した。
  各通りで11番目の途中Stopから再Runし、合計264回生成した。同時接続とNative mockラックは最大1台。
  Webの実Worklet／WASMで88窓を測定し、非有限値・±1超過は0。
  期待振幅との差はChromium最大約0.069%、WebKit最大約0.010%。
  current／defaultの元のbytesと明示Mixer設定を維持し、終了後の待機要求・追加音源・Worker／未帰属portは0。
- 最終パッケージのWebKitでYM2610Bを220／440／880 Hzで再測定した。
  既存49経路の倍率と共通targetが変わっていないことも照合した。
- BrowserのADPCM-B raw停止追跡を含む最終パッケージでも、両ブラウザーの4／6CH画面・試奏・TFI／VGIを再確認した。
  比較Exampleは通常のkey-on／key-offを使う。rawのexecute解除・record・resetは別の所有者回帰試験で確認した。

### 配布物

- Playground ZIP：`release/hello_ymfm_wasm_extra-ym2610b-final_itch_playground.zip`
- SHA256：`fdc4367baed46a57fdf1128f3b21a6de8de82263c583fde2814f2d42e350af07`
- Tauriの`dist`へ876ファイルを取り込み、977ローカル参照・全starter・API・WASM・ライセンスを照合した。
- Nativeソースは既存21組のsnapshotを再利用。対応ソースZIPの1,400ファイルも一致した。
- NativeソースZIP SHA256：`9eb212db2f51e81b95441be8dc227b409e013cb9decfd162aa0c8bff89505504`
- 画面結果：`/private/tmp/ym2610b-final-v2-ui/`
- 比較Example結果：`/private/tmp/ym2610b-final-comparison/`
- 生成取消し結果：`/private/tmp/ym2610b-final-lifecycle/`
- 音量測定：`/private/tmp/ym2610b-levels-webkit-final.json`
- ソース照合：`/private/tmp/ym2610b-native-sources-final.json`

ここでのPCM比較・IPC mock・fixture検証では物理音声デバイスを開かない。
実機での聴感・長時間dropoutと、Windows／Linuxの既存CIは別途確認する。

## 主な実装

- [Main実行・追加生成](../../web/playground_runtime.js)、[logic Worker](../../web/playground_logic_worker.js)
- [Browser OPN client](../../web/playground_opn.js)、[追加音源用Worklet](../../web/playground_opn_worklet.js)
- [Native YM2610／YM2610B adapter](../../web/native_genesis_extra_ym2610.js)
- [追加OPN画面](../playground/playground_extra_fm_editor.js)、[Playground型](../playground/tetorica-playground-globals.d.ts)
- Native実装：Tauriの`src-tauri/src/native_genesis_extra_ym2610.rs`と`native_genesis_ym2610b.cpp`
