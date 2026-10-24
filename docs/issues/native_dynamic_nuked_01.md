# 追加YM2612のNuked選択

2026-10-24。[追加音源計画](todo_createSoundChip01.md)の残件として、
`createSoundChip('ym2612', {engine: 'nuked'})`をBrowser／Nativeへ追加した。
公開名は`ym2612`のままとし、既存の追加生成22種類を増やさず、生成時にコアを選ぶ。
`engine`を省略した場合は従来どおり`ymfm`を使う。

## 公開APIと作業範囲

```js
for (const engine of ['ymfm', 'nuked']) {
  const chip = await createSoundChip('ym2612', {engine});
  try {
    log(chip.engine); // 生成後は変更できない。
    await chip.setPreset(0, FM_PRESETS['one-op-basic']);
    await chip.noteOn(0, 'A4');
    await sleep(1);
    await chip.noteOff(0);
    await sleep(0.1);
  } finally {
    await chip.dispose();
  }
}
```

- `createSoundChip('ym2612', {id?, engine?: 'ymfm' | 'nuked'})`で毎回独立生成する。
  明示的な`engine: 'ymfm'`と省略は同じ選択になる。
- `engine`はYM2612追加生成専用。他の種類へ渡した場合や、文字列の大小違い・`null`などは、
  Mixer IDの予約・Native IPC・Worker RPC・コア確保より前に拒否する。
- Browser／Native、Main／logic Workerで取得方法・readonlyの`client.engine`を揃える。
  呼出し後に元のoptionsを書き換えても、生成待ちの音源の選択は変わらない。
- FM 6CH、operator／preset、pan／LFO、CH3特殊／CSM、clock・timer、2portのraw writeを接続する。
  DACは既存の`setDacEnabled()`／`writeDac()`などのregister操作の範囲を維持する。
  追加音源用に存在しないDAC sample／bank APIを、Mode主音源のDACへ転送しない。
- 独立したYM2612コアだけを生成し、Genesis合成音源やSega PSGを同時に確保しない。
  Nativeはcallbackで音声を生成し、新しいAudioContext／AudioWorkletや連続PCM転送を追加しない。

`useSoundChip()`の取得規則は変更しない。engine optionsは受け付けない。
公開名が一致するMode主音源を借用し、主音源がなければ従来のymfm追加音源をRun内で共有する。
したがってNuked Modeの`useSoundChip('ym2612')`はそのNuked主音源を借りるが、
別ModeからNukedを追加したい場合は、明示的に`createSoundChip()`を使う。
追加音源の選択によってModeや主音源のengineを切り替えない。

## コアとインスタンスの識別

engineは生成時に固定する。reset・clock・raw registerやInspector編集によって切り替えない。
Browserは選択したWASMコアを追加OPN用Workletへ接続する。
Nativeは既存の`extra-ym2612` family・生成／status／dispose IPCを維持し、
生成引数に`engine`を明示する。Nuked専用の別公開名・別familyは作らない。

Nativeの追加YM2612 snapshotは`engine`を返す。
要求したNukedについては、初期化中に適用済みstatusを取得してengineの一致を確認する。
古いNative hostが未知の引数を無視してymfmを生成した場合や、engineの記載がない場合は、
Nukedとして公開せず生成を取り消す。確保したコア・port・ID予約を回収する。
従来のymfmだけは、旧host／既存fixtureのengine省略を許容する。
どちらのclientも、明示された別engineの状態は採用しない。

Mixer IDと物理instance・session・generationを分離し、同じIDで別engineを作り直せるようにする。
古い音源の遅延生成応答・snapshot・未来のdispose・owner取消しを、新しい音源へ適用しない。
Workerの未来時刻でのdisposeは既存の演奏時計に従い、同IDの再生成は旧endpointの退役を待つ。

追加ラックは引き続き**22種類合計16台・64 MiB**。
ymfmとNukedのYM2612を併用しても同じ台数・所有メモリー予算へ数える。
準備中・退役待ちも含める。主音源・FX・IPCのJSON／JS一時dataなどを含む
プロセス総使用量の上限とは区別する。生成・最終解放は音声callback外で行う。

## Mixer・Keyboard・Inspector

Mixerでは種類`ym2612`を維持し、接続中のstripへengineを実行時metadataとして持たせる。
Nukedには表示名を付け、種類別共通設定を別名へ分裂させない。
KeyboardとOPN音色画面は選択したinstance・CHへ接続する。
表示のための常時pollingや、画面を開いた際のpreset書込みは追加しない。

初期音量は[既存の単一carrier校正](playground_chip_levels_01.md)に従う。
追加音源のunity時振幅がengine間で異なるため、Systemのfactory fallbackをengine別に持つ。

| 追加YM2612のengine | unity基準振幅 | Systemのgain |
| --- | --- | --- |
| `ymfm` | `0.166015625` | `0.775938` |
| `nuked` | `0.260833740234375` | `0.493869` |

Nukedの測定は実Worklet／配布WASMの220／440／880 Hzによる。
共通target振幅`0.12881777435541153`、他種類・Mode主音源の既存gainは維持する。
これは固定の出力単位補正で、音色の聴感・多声時の音量を自動的に揃える処理ではない。

factoryの適用は1回だけ。ユーザーが保存した種類別設定・個別IDのMixer値は、
従来どおり絶対値でfactory fallbackを上書きする。
例えば保存値が`volume: 0.5`なら、Nukedでも`0.5`のままで、`0.5 × 0.493869`にはしない。
同IDでengineを変えた場合も、明示的な保存値を維持する。
保存値がなければ新しいengineのfactory値を使う。

engine metadata・factory gainをユーザーのPreset／default／currentへ自動保存しない。
生成・破棄だけでは`mixer/current.json`を変更せず、
Preset選択時にcurrentを上書きしない[既存保存規則](playground_mixer_state_01.md)を維持する。
汎用npmパッケージの音量やVGM Analyzerの出力値は、このPlayground向け校正で変更しない。

## 実装・検証

- [x] Browserの追加OPN生成・Worklet・clientにengineを接続する。
- [x] Main／Workerの引数検証・生成応答・readonly metadataと型を揃える。
- [x] Nativeの独立追加コア、生成時engine指定、snapshotと共通ラックへ接続する。
- [x] 旧hostの不一致、生成待ち取消し、遅延応答、同ID再生成時のengine識別を検証する。
- [x] Mixerのengine別factory fallbackと絶対上書き、Keyboard／Inspectorのinstance選択へ接続する。
- [x] 実コア比較・全体回帰試験・最終パッケージでの画面試験の結果を確定する。
- [x] `web`→`docs/js`・cache・Playground ZIP・Tauri取込み・対応ソース照合を完了し記録する。

## 確認済みの検証

- Native JSの対象17件が成功。Mainと実logic Workerの両engine混在・readonly識別・optionsの固定、
  手動試奏とclock競合、operator編集、loop取消し、Stop／同IDで別engineへ再生成を確認した。
- 旧hostのymfm／engine省略／未知engineをNukedとして受け取らないことと、その後の回復を確認した。
  無効なengineはIPC・instance番号の採番より前に拒否する。
- Native生成の遅延応答、破棄後に返るsnapshot、未来のWorker disposeが、
  同じMixer IDを持つ別engineの新しい音源へ影響しないことを確認した。
- Native JS関連の全体試験は**1,007件成功・失敗0**。
  結果：`/private/tmp/nuked-extra-native-js-tests.log`。
- 校正JSONと生成済みSystem profileに、上記のNuked測定3周波数とengine別gainを反映した。

### 最終検証・配布

2026-10-24に以下を確認した。

- JavaScript全体は**4,950件成功・1件skip・失敗0**。Tauri側のPython試験とNode 31件も成功。
  型検査、Mixer profileの生成結果照合、両repositoryの`git diff --check`も成功。
- Rust全体は**701件成功・4件ignored・失敗0**。
- Native追加Nukedと配布用Worklet／WASMを、44.1／48／96 kHzの**198ケース・1,216,512 stereo frames**で比較。
  PCM・status・IRQ・全4 read portの差は0。ASan／UBSanでも同じ比較が成功。
  callback内のC／C++確保・解放0と、独立instance・DAC・timer・reset・Stopも確認した。
  既存の追加ymfmとMode主音源Nukedの回帰比較も成功。
- 配布版のChromium／WebKitでBrowser／Native・Main／Workerを確認。
  両engine混在、Mixerの初期値、Operator編集、Keyboard試奏、同IDでの作り直しを確認した。
- [比較Example](../playground/examples/genesis/ym2612-engine-comparison.js)を追加。
  同じ音色・6音をymfm→Nukedの順で鳴らし、各音源を`finally`で破棄する。
  上記2ブラウザー×2 backend×2実行方式で、中断→再Run→完走を確認した。
  BrowserではPCMを採取し、有限・非clip・無音でないことと終了後の無音を確認。
  ID・port・Worker・Native追加ラックが残らず、保存済みMixerファイルが変わらないことも確認した。
- WebKitで両engineの220／440／880 Hzを再測定し、System gainの適用を確認した。
  既存50ルートの初期gain・共通targetは変更せず、追加Nukedの3測定を加えた153測定を正本にした。
- `web`→`docs/js`を同期し、runtime cache revisionを`extra-ym2612-nuked-1`に更新。
  最終ZIPをTauriへ取り込み、878ファイル・984のmodule／asset参照と各Modeの起動コードを照合した。
  対応ソースも再生成し、21 offline snapshot・1,404 source filesと新しいNuked wrapper／fixtureの同梱を確認した。

最終配布物（公開・commitは未実施）：

- Playground ZIP：`release/hello_ymfm_wasm_extra-ym2612-nuked-final_itch_playground.zip`
  - SHA256：`c3ba4bc95473198b8cf90958776d98751b699076170430fe72ed63ec220e43b7`
- Tauri対応ソース：`w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`
  - SHA256：`d751a3aab444a74162bbc4e4a4fe10d20890da56f126842cbdb4ff7cfbb57989`

最終ZIPと画面・PCM試験に使ったZIPとの差は`llms.txt`と型宣言の説明コメントだけで、
実行用JS・WASM・比較Exampleは同一。

試験結果：

- `/private/tmp/nuked-extra-all-node-final.log`
- `/private/tmp/nuked-extra-tauri-js.log`
- `/private/tmp/native-extra-ym2612-nuked.json`
- `/private/tmp/native-extra-ym2612-nuked-sanitize.json`
- `/private/tmp/nuked-extra-final-ui/`
- `/private/tmp/nuked-extra-final-engine-comparison/`
- `/private/tmp/nuked-extra-final-webkit-levels.json`
- `/private/tmp/nuked-extra-native-sources-final.json`

IPC mockによる画面試験とオフライン実コアPCM比較は別々に行い、物理音声デバイスは開いていない。
実機での聴感・長時間dropoutとWindows／Linuxの既存CIは別途確認する。

## 主な実装

- [引数検証](../../web/playground_soundchip_options.js)、[Main実行](../../web/playground_runtime.js)、[logic Worker](../../web/playground_logic_worker.js)
- [Browser OPN client](../../web/playground_opn.js)、[Browser生成](../../web/playground_opn_audio.js)、[追加Worklet](../../web/playground_opn_worklet.js)
- [Native追加YM2612 adapter](../../web/native_genesis_extra_ym2612.js)、[Native Inspector](../../web/native_genesis_synth.js)
- [Mixer](../../web/soundchip_mixer.js)、[生成済みSystem profile](../playground/playground_mixer_defaults.js)、[Playground型](../playground/tetorica-playground-globals.d.ts)
- [Native JS回帰試験](../../web/native_genesis_extra_ym2612.test.mjs)、[実コア比較](../../scripts/check_native_extra_ym2612_nuked.mjs)、[画面試験](../../scripts/native_backend_extra_ym2612.cjs)
- Native実装：Tauriの`src-tauri/src/native_genesis_ym2612.rs`、`native_genesis_ym2612.cpp`、`native_genesis_nuked_ym2612.inc`
