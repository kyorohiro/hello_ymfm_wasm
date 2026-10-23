# Native追加OKIM6258

2026-10-24。[追加音源計画](todo_createSoundChip01.md)のOKIM6258追加生成。
X68000内蔵用の構成から、単独のADPCMストリームを追加ラックへ接続する。

```js
const adpcm = await createSoundChip('okim6258', {id: 'voice'});
await adpcm.loadSample(await file('/voice.wav', {type: 'arrayBuffer'}));
adpcm.setDivider(768);
adpcm.play({repeat: true});
await beat(2);
adpcm.stop();
```

## 対象と完了条件

- 独立した1ストリーム、既定8 MHz、divider 1024／768／512、左右出力、repeat、raw FIFO。
- 公開APIの同期操作と非同期sample／clock操作の契約を維持する。
  resetではsampleとclockを保持し、再生・divider・panを初期化する。
- `useSoundChip()`はX68000内蔵を借用し、他のNative modeでは共有追加音源を取得する。
  `createSoundChip()`はModeにかかわらず独立したインスタンスを作る。
- 同居YM2151や固定32 MiB sample領域を生成せず、サンプル分だけ制御側で確保する。
  最大16 MiB／sample、追加14種類合計16台・64 MiBの予算へ準備中・置換・退役待ちも含める。
- Main／Worker、個別Mixer、既存サンプル波形・音声ファイル読込み・divider／pan／repeat編集、Keyboard。
  Keyboardは現在の速度で再トリガーする。MIDI音程への自動変換は行わない。
- session／generation／instanceと所有者を確認し、古いsample転送・release・dispose・状態応答を分離する。
- callback内にallocation・最終free・待機lockを追加しない。観測のための常時pollingを増やさない。

## 検証方針

配布Worklet／WASMと実C++を44.1／48／96 kHzで比較する。
ADPCM nibble順・clock／divider・raw FIFO・pan・repeat・sample置換・Stop／reset・callback分割を扱う。
Rustでは共有予算・転送・適用確認・取消し・所有者・同ID再生成と他チップの非干渉を確認する。
Chromium／WebKitで実Main／logic Workerと既存画面を動かし、Native IPCのみmockする。
物理音声デバイスを開かず、実機試聴・dropout評価とは区別する。

## 検証結果

配布中の実OKIM6258 Worklet／WASM（flags 12）と135ケース・792,576 stereo framesを比較した。
44.1／48／96 kHz、1frame／128frame／不規則なcallback分割でPCMの最大差分0。
raw FIFOのnibble順・underflow／overflow、clock／divider、左右pan、repeat、sample置換、
Stop・resetのsample保持と終端無音を確認した。

実C++の9組のrate／clock・独立性検証も成功した。state ABIは28 B。
音声生成中のallocation／freeは0。既存X68000の42ケース・258,048 stereo frame pairsも差分0。
追加音源は既存の固定ソースを共有し、ADPCMデコーダーを変更しない。

Nativeの出力rateは8 kHzから選べるため、追加OKIのclockは
`clock / 512 / outputRate <= 14`も満たす値に制限する。
dividerを1024にしてからclockを極端に上げ、resetで512へ戻した場合もFIFO上限を超えない。
この制限は通常の44.1／48／96 kHzでは100 MHzの公開上限より広く、通常設定には影響しない。

Apple M2・Clang 17 `-O2`、48 kHzで2秒分をfresh processで3回測った中央値。
各OKIは64 KiB ADPCM sampleを8 MHz・divider 512でrepeatする。

| OKI台数 | CPU時間／音声時間 |
| --- | --- |
| 1 | 0.09% |
| 2 | 0.14% |
| 4 | 0.20% |
| 8 | 0.32% |
| 16 | 0.55% |

1台のC++ heapは136 B＋外部保持sample 65,536 B。
OKI3台＋既存13種類各1台、計16台の混在は11.45%、C++ heapはsample込み2,613,528 B。
callback内のallocation／freeは0。Rustラック・queue・IPC・FX・UI・音声デバイスは測定外。
実機のcallback締切やdropoutを保証する測定ではない。

## 転送・適用確認・回収

`load-memory`はsample全体とbounded metadataを制御側で検証してから、immutable payloadとして保持する。
callbackではC++へそのpointerを渡す。現在のsample・準備中・置換前のsample・退役待ちの
参照が残る間は、合計64 MiBの予約も保持する。sampleを読み戻す常時転送は設けない。

sample／clockのPromiseは命令の適用を確認して完了する。
`status(after:id)`待機を制御FIFOから分離し、未来の適用待ち中にもStop・取消し・disposeを進める。
取消された転送は、呼出し側が適用確認を取りに来ない場合も制御側で回収する。
完了結果は固定512件の小さな履歴へ残し、失効したIDの再確認は成功扱いせず明示的に拒否する。

手動試奏中の公開APIによるsample置換・clock変更は拒否し、発音・sample情報・エンジンを保つ。
画面のclock編集は明示的な試奏権限で適用し、保持を維持したまま変更できる。
古いownerからのraw停止値0も他の発音を止めず、有限sampleの自然終端では試奏の保持を解放する。
Workerのauthor状態通知は変更fieldだけを反映し、未来に予約した別fieldの編集を古い全体状態で戻さない。

ARM64のInstanceは22,400 B、OKI Sharedは12,800 B（完了履歴8,192 B込み）、Rendererは128 B。
session Rendererは36,960 Bで、既存音源から増えていない。
固定予約1,114,112 B／台のうち64 KiBの管理余裕内に収まり、sample・metadata・Preparedは別に数える。

## 最終統合

- JS全体：4,403成功・1 skip。新規OKI17件を含む。Playgroundのmode型検証も成功。
- Rust全体：530成功・4 ignored。追加OKIの重点20件を含む。
- Chromium／WebKit：最終Tauri取込み物で実Main／logic Worker、独立OKI2台と既存13種類、
  合計16台、個別sample／clock／divider／pan／Mixer、WAV読込み・波形表示、
  Keyboardタブ・OKIタブ上のPCキー、手動保持中のclock編集、同ID再生成、Stop／Runを確認した。
- X68000の内蔵OKI借用と追加生成を両実行方式で確認した。
  既存追加RF5C164・OPL4種類の音色編集／Keyboard／Mixer回帰も両ブラウザーで成功。
  Native IPCだけをmockし、AudioContext／AudioWorkletは0。

| 成果物 | 照合結果 |
| --- | --- |
| `release/hello_ymfm_wasm_native-extra-okim6258_itch_playground.zip` | SHA-256 `3e41e0cb081a61c42f04414845870db6e5a1dd27b998a1896c3d505b52787c30` |
| Tauri取込み | 865 files、release lock照合成功 |
| 配布module／asset参照 | 930参照、Mode starter・Native API・WASM・license検証成功 |
| Native対応ソースbundle | 1,366 files、SHA-256 `22b2ed6a0f24eb8a7c1f9db49d32cbdeaaaaee009084de5ef69ebdd18cc50b43` |
| 固定ソースsnapshot | 21件、現在のソース・同梱ZIPとの照合成功 |

cache revisionは`native-extra-okim6258-1`。
Nativeビルド・オフライン検証はmacOS ARM64で実施した。
物理音声デバイス・credential storeを使うテストは有効化していない。
実機試聴・長時間のdropout・他OS／CPUの確認は未実施。
commit・npm公開・itch.io公開は行っていない。
