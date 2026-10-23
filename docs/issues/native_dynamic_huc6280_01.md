# Native追加HuC6280

2026-10-24。[追加音源計画](todo_createSoundChip01.md)のPC Engine PSG追加生成。
Mode内蔵と同じMAME由来の単独HuC6280コアを追加ラックへ接続する。

```js
const psg = await createSoundChip('huc6280', {id: 'pce-lead'});
psg.initialize();
psg.setWaveform(0, Array.from({length: 32}, (_, i) => i));
psg.setVolume(0, 24);
psg.noteOn(0, 'C4');
await beat(1);
psg.keyOff(0);
```

## 対象と完了条件

- 6CH、各32×5bitの波形RAM、CH5／6のnoise、全CHのDDA、master balance、共有LFO。
  波形・register・clock・LFO・noise状態をインスタンスごとに保持する。
- Browser公開APIと同じく生成optionは`{id}`のみ。既定clockは3,579,545 Hz。
  高級APIを使う前に`initialize()`を呼ぶ。raw writeからは`adoptRegisterState()`も使える。
- `createSoundChip()`は全Native Modeで独立生成する。
  PC Engine Modeの`useSoundChip('huc6280')`は内蔵`pce`を借り、他Modeでは共有追加音源を取得する。
- 対応17種類で合計16台・64 MiB。不要な同居音源を作らず、準備中・退役待ちも予算に含める。
- Main／Worker、個別Mixer、既存の音色編集とKeyboardのinstance／CH選択へ接続する。
- LFO・master balanceは1チップ内で共有する。別CHのowner取消しで共有設定や他CHを壊さない。
  手動試奏の保持・DDAのDC出力・波形書込みのpointerを扱い分ける。
- session／generation／instance、生成待ち中Stop、同ID再生成、遅延応答・disposeを回収する。
- 観測目的の常時polling、callback内allocation・最終free・待機lockを増やさない。

## 検証方針

実配布Worklet／WASMとC++を44.1／48／96 kHz、可変callbackで比較する。
全CH、wave／DDA／noise、LFO、clock、reset／Stop、独立2台を対象にする。
Rustでは台数／予算・適用済みsnapshot・owner取消し・手動試奏・受付失敗時のtransactionを確認する。
Chromium／WebKitでは実Main／logic Workerと既存UIを使い、Native IPCのみmockする。
物理音声デバイスを開かず、実機試聴・dropout評価とは区別する。

## C++／PCM

実配布HuC6280 Worklet／WASMとの153ケース・1,316,736 stereo framesの比較で差分0。
44.1／48／96 kHz、1 frame／128 frame／不規則callback分割、波形・DDA・noise・LFO・clockを含む。
既存Native coreを再利用し、source mute maskとcore size照会だけを追加した。
state ABIは352 Bで変更せず、1台のC++ heapは704 B。
独立性・読取りの無作用・CH別Stop・clock／波形／latch保持、mute中のLFO／noise位相継続を確認し、
callback allocation／freeは0。Browser DSPと配布WASM binaryは変更しない。
既存primaryの39ケース・239,616 framesも差分0だった。

## オフライン負荷測定

Apple M2・Clang 17 `-O2`、48 kHz・1秒分の音声をfresh processで3回測った中央値。
各HuC6280で6CHを使い、wave・DDA・noise・LFOを動かす。

| HuC6280台数 | CPU時間／音声時間 | C++ heap |
| --- | --- | --- |
| 1 | 6.03% | 704 B |
| 2 | 12.07% | 1,408 B |
| 4 | 24.11% | 2,816 B |
| 8 | 48.38% | 5,632 B |
| 16 | 97.05% | 11,264 B |

全17種類のうちSega PSGを除いた各1台・合計16台では22.55%、C++ heap 2,564,696 B。
Rustラック・IPC・UI・FX・実音声デバイスは測定外。
16台のHuC6280を全CH動かす構成では音声時間に近いCPU時間を要するため、
16枠の容量上限に加えて、実際の組合せによる負荷も考慮する。

## 編集・所有者の扱い

Native側の適用済みsnapshotと、JS側の将来の演奏用設定を区別する。
画面を開いたり状態を読んだりしても、clock・波形pointer・予約済みの音色情報を変更しない。
画面で変更したvolume／片側balance／LFOの対象bitだけをJS側にも反映する。

手動試奏中の編集は同じvoice識別子を付け、発音を維持したままvolume・波形を編集する。
DDAへ切り替える場合は設定を反映してから手動保持を解放する。DDAのDAC値は保持し、key gateを切って無音にする。
script由来のreset・clock・他ownerの書込みが手動保持中の音を上書きしないよう保護する。
手動保持中のclock変更は非致命的に拒否し、Native engine自体は利用可能なままとする。

LFO使用中のCH2はCH1の変調用波形を兼ねるため、他ownerのCH1を変える操作を保護する。
CH2自身のbalance・volume変更と安全なkeyOffは受け付け、LFO用波形・frequency・pointerを保持する。
owner取消し／Stopも共有LFO設定を消さず、該当する発音だけを停止する。
clockの適用完了待ちは命令FIFOの外で行い、待機中もStop・disposeを受け付ける。

作成待ちの取消しはNative createの完了を待たずにJS側の登録を解放し、遅延して生成された実体も回収する。
同ID置換で旧端末の送信完了が遅れる競合を、遅延flushで再現した。
共有voice contextの完了判定は世代・session・invalidateを先に照合し、
破棄済み端末の応答を通常の音声障害としてWorkerへ通知しない。
現役端末の音声未準備エラーは引き続き通常エラーとして扱う。

## メモリー

macOS ARM64の`Instance`は22,656 B、HuC Shared 13,184 B、Renderer 568 B、session Renderer 36,960 B。
Sharedと個別RendererはInstanceに含まれ、Instance＋C++コアは23,360 B。
共通の管理余裕65,536 Bに収まり、固定queueを含む1台の予約は1,114,112 Bで維持する。
命令payload・準備中・退役待ちは共通64 MiB予算へ別途加算する。
既存の最大YMF262もInstance＋コア49,696 Bで管理余裕内、
NESはInstance＋コア＋coverage 120,624 Bで管理余裕＋RAMの131,072 B以内。

## 統合確認

- JavaScript全体4,439件成功・1件skip。追加HuC6280 clientは12件。
  全追加音源・bridge・consoleなど関連280件も成功。
- Rust全体587件成功・4件ignore。追加HuC6280は17件。
- Mode別の型検査成功。
- 最終Tauri distでChromium／WebKitともMain／Workerが成功。
  独立2台・wave／DDA／noise／LFO・clock・全6CHのKeyboard・手動保持中の編集・Mixer・
  全17種類を使う16枠内の混在・primary借用・Stop／同ID置換を確認した。
  既存NES・RF5C164追加音源の画面検証も両browserで成功。
  Native IPCのみmockし、AudioContext／AudioWorkletは作成していない。
- packageの953箇所のmodule／asset参照、868ファイルのTauri取込みhashを検証した。
- 21種類のoffline source snapshotと1,375ファイルの対応ソースZIPを検証した。
- `web`→`docs/js`、cache revision `native-extra-huc6280-1`、ローカルPlayground ZIP、
  Tauri dist／release lock、対応ソースZIPを更新した。公開・commitは行っていない。

Playground ZIP：`release/hello_ymfm_wasm_native-extra-huc6280_itch_playground.zip`。
SHA-256：`12084ad639058597ea49c91d8d6f8e11e8da2d907519fbea91a3f3b17f579e45`。

対応ソースZIP：`w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`。
SHA-256：`e1123bd505a6b92f3dbaf4cc449476ea7b1a569e466ec8f9faa43b84d1f75796`。

検証環境はmacOS ARM64。物理音声デバイスでの試聴と、Windows／Linuxのbuild・実機確認は未実施。
オフラインPCM一致やmock IPCでのUI成功を、実機のdropout解消とはみなさない。

主な再実行入口：

```sh
node scripts/check_native_extra_huc6280.mjs
node --test web/*.test.mjs docs/playground/*.test.mjs docs/vgm_analyzer/*.test.mjs test/*.test.mjs
node scripts/check_playground_mode_types.mjs
node scripts/check_playground_native_backend_browser.cjs --extra-huc6280-only --root=w/tetorica-fm2612-playground-tauri/dist
node --experimental-vm-modules scripts/check_playground_package.mjs w/tetorica-fm2612-playground-tauri/dist
# 以下はTauri repository内
cargo test --locked --manifest-path src-tauri/Cargo.toml --quiet
python3 scripts/import_release.py --check
python3 scripts/check_native_sources.py --bundle
```
