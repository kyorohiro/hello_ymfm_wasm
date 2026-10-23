# Native追加YMF262（OPL3）

2026-10-23。[追加音源計画](todo_createSoundChip01.md)のYMF262追加生成。
主音源のDOS PC（YMF262）用コアは維持し、独立したOPL3だけを追加ラックへ接続する。

```js
const lead = await createSoundChip('ymf262', {id: 'opl3-lead'});
lead.setFourOp(9, true);
lead.setPreset(9, OPL_PRESETS['four-op-bell']);
lead.setPan(9, true, false);
lead.noteOn(9, 'C4');
await beat(1);
lead.keyOff(9);
```

## 対象と完了条件

- 18CH、2bank／512 register、既定14,318,180 Hz、8 waveform、左右出力。
- 6組の4operator pair、algorithmとoperator配置、NEW切替、rhythmの共有CH。
- Main／Workerの公開API、operator編集、Keyboardのinstance／CH選択、独立Mixer。
- 追加音源12種類合計16台・64 MiB。準備中・退役待ちも予算へ含める。
- 手動保持・script・owner取消しを分離し、pair・drumsの別名から他の演奏を止めない。
- 適用済みlayoutの通知を利用し、UI更新のための常時ポーリングを増やさない。
- callback内のallocation・最終free・待機lockを増やさない。

## OPL3互換モードの扱い

`NEW=0`では上位bankへの書込みが下位bankへ折り返す。
既に設定した4operator pairは保持されるため、書込み履歴の`0x104`だけで
実際のpairを判断しない。適用済みpair maskとNEW状態を別に取得する。

公開raw register APIの動作はBrowser版に合わせる。
手動編集・試奏では、別のCHを誤って変更しないよう、NEW=0中の上位bankの対象を制限する。
これは音声コアの上位9CHを止める操作ではない。

## 検証方針

実際のBrowser公開client／Worklet／配布WASMと44.1／48／96 kHzで照合する。
全CH・全pair・4operator algorithm・bank・pan・NEW・rhythm・timer・clock・resetを対象にする。
既存追加OPL1／OPL2／Y8950と、主音源DOS PC／MSX Audioの回帰も確認する。

Rustでlease・alias・取消し・layout適用順・生成破棄と共有予算を確認する。
Chromium／WebKitでは実Main／logic Workerを動かし、Native IPCだけをmockして
Operators・Keyboard・Mixer・主音源借用・Stop／Run・同ID再利用を確認する。
この検証では物理音声デバイスを開かない。

## 音声比較と所有権

4 profilesを44.1／48／96 kHzで比較し、552ケース・3,391,488 stereo framesでPCM・status／IRQの差分0。
全6pair・4operator algorithms・4busのclampと合成・NEW／bankの折返しを含む。
既存主音源もDOS PC 198ケース・1,216,512 frames、MSX Audio 138ケース・847,872 framesで差分0。
音声callback内のallocation／freeは0。

公開`allNotesOff()`と、runtimeのowner取消しを区別する。
互換モードでは公開APIのbank折返しによって上位の物理voiceが残ることがあるため、
後の取消しで回収できるようそのleaseを維持する。
4operatorの解除後にsecondaryの尾音だけが残らないよう、変更後のmapでも対象sourceを終了する。
他ownerのsecondary gate、低clock時の保持PCM、共有drumの別bitは保護する。

Inspector用には適用済みauthoring register imageを別に保持する。
NEWによる折返しを反映し、試奏中の内部mute用TLは音色値に混ぜない。
Native statusの`registers`と公開clientのauthoring cacheは既存のraw契約を維持する。
追加YMF262のInspectorでは`registers`／`effectiveRegisters`を編集用の適用済みimage、
`authoredRegisters`をraw imageとして返す。

Workerのclock応答やInspector編集で、Worker自身の未適用の4operator設定が
Main側のsnapshotに置き換わる不具合も修正した。
clockはclockだけを更新し、Inspectorの変更は操作内容をWorker自身のauthoring cacheへ適用する。
音声への命令を再送したり、無関係な将来の設定をsnapshotで上書きしたりしない。

## オフライン負荷測定

Apple M2・Clang 17 `-O2`、48 kHz、2秒分をfresh processで3回測った中央値。
YMF262は6組の4operator・3組の2operator・5drums、8waveforms・全4bus・AM／PMを動かす。

| YMF262台数 | CPU時間／音声時間 |
| --- | --- |
| 1 | 1.82% |
| 2 | 3.66% |
| 4 | 7.37% |
| 8 | 14.63% |
| 16 | 33.12% |

C++ heapはYMF262 27,040 B／台、16台で432,640 B。
OPL4種類各2台＋既存8種類各1台、計16台は15.27%、C++ heap 2,411,744 B。
既存3種類のheapはYM3526 9,424 B、YM3812 15,568 B、Y8950 9,520 B／台。

RustのARM64 layoutはInstance 14,720 B、Shared 5,760 B、Renderer 1,656 B。
1台の固定予約1,114,112 Bは1 MiBの退役queueと管理余裕64 KiBを含む。
Instance＋最大の新コアは41,760 Bで管理余裕に収まる。
測定にRustラック・allocator overhead・IPC・FX・UI・実機の音声デバイスは含まない。
実際のcallback締切・dropoutを保証する値ではない。

最終の全体検証と配布物の照合結果は追記する。
