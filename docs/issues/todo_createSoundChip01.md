# Native版 createSoundChip() 対応計画

2026-10-23。追加音源の対象と必要な作業を整理する。
Sega PSG・YM2612・YM2203・YM2608・YM2610・YM2151・YM2413・AY-3-8910・YM3526・YM3812・Y8950・YMF262・RF5C164・OKIM6258・Game Boy・NES＋任意FDS・PC Engine・DX7・32X PWM・SNES S-DSP・SPC700ファイルプレーヤーの追加生成まで実装済み。公開21種類をNativeへ接続した。

## 目的と範囲

Browser版Playgroundで使える追加音源を、TauriのNativeエンジンでも独立して生成できるようにする。
選択中のModeの主音源と追加音源を一緒に鳴らし、それぞれをMixer・Keyboard・音色情報から操作する。

```js
// 実装済みの例。Mode内蔵のPSGとは別のインスタンス。
const lead = await createSoundChip('segapsg', {id: 'lead'});
const bass = await createSoundChip('segapsg', {id: 'bass'});
await mixer.set(lead.id, {volume: 0.5, pan: -0.4});
lead.tone(0, {note: 'C4', attenuation: 7});
```

- `createSoundChip()`は毎回、独立した音源を作る。追加音源には個別の`dispose()`を持たせる。
- `useSoundChip()`は、該当するModeの主音源があれば借用する。
  主音源がなければ追加音源を共有・キャッシュし、個別破棄後の再取得で作り直す。
- Modeの固定構成と主音源の寿命を保ち、追加生成だけを段階的に広げる。
- 対象は現在のPlayground公開API。チップごとの機能・戻り値・初期値をBrowser版と照合する。
- Web Audioを既定のままにする。Nativeで未対応の種類・操作は理由を示して拒否する。

## 現在の到達点

- [x] Native主音源の`useSoundChip()`をMain／Workerで一致させる。
- [x] 独立した`segapsg`を全Native Modeから生成する。
- [x] PSGのMain／Worker、Mixer、Inspector、Keyboard、個別破棄、Stop／再Runに対応する。
- [x] session・世代・インスタンス番号で、古い命令と同じMixer IDの新音源を分離する。
- [x] 生成とC++コアの最終回収を音声callback外で行う。
- [x] 追加ラックをYM2612へ拡張し、同種2台＋PSG＋Mode主音源を併用する。
- [x] 追加YM2612のMain／Worker、Mixer、Keyboard、OPN音色編集、個別破棄、Stop／再Runに対応する。
- [x] 追加YM2203のFM 3CH＋SSG 3CH、共有noise／envelope、mono・prescaler、予約書込み、音色編集・Keyboardに対応する。
- [x] 追加YM2608のFM 6CH＋SSG 3CH＋rhythm 6音色＋ADPCM-B、独立ROM／RAM、再利用可能timeline、編集・Keyboardに対応する。
- [x] 追加YM2610のFM 4CH＋SSG 3CH＋ADPCM-A 6voice／B、疎なROM、編集・Keyboardに対応する。
- [x] 追加YM2151の独立FM 8CH、LFO／noise・全CH CSM、音色編集・Keyboardに対応する。
- [x] 追加YM2413の単独9CH・User patch・rhythmと、AYの単独3CH・共有noise／envelope・音量0保持に対応する。
- [x] 追加YM3526／YM3812／Y8950の独立FM 9CH・rhythm 5voice、CSM・音色編集・Keyboardに対応する。
- [x] 追加YMF262の独立18CH・4operator 6pair・rhythm・ステレオ、適用済みlayout・音色編集・Keyboardに対応する。
- [x] 追加RF5C164の独立8CH・64 KiB RAM・サンプル転送・loop／step／pan、音色編集・Keyboardに対応する。
- [x] 追加OKIM6258の単独ADPCM・可変sample保持・divider／pan／repeat、波形表示・音色情報・Keyboardに対応する。
- [x] 追加Game Boyの独立pulse 2CH／wave／noise・Wave RAM・power／左右routing、音色編集・Keyboardに対応する。
- [x] 追加NESの独立APU 5CH＋任意FDS、64 KiB DMC RAM・波形・小数基準clock、音色編集・Keyboardに対応する。
- [x] 追加HuC6280の独立6CH・波形RAM・DDA・noise・共有LFO、音色編集・Keyboardに対応する。
- [x] 追加DX7の独立16voice・preset／SysEx bank・6operator、音色編集・Keyboardに対応する。
- [x] 追加32X PWMの独立左右FIFO・clock・予約再生・owner別取消し、情報表示・Mixerに対応する。
- [x] 追加SNESの独立8声・64 KiB RAM・BRR、原子的な転送／reset、timeline、音色編集・Keyboardに対応する。
- [x] 追加SPCの独立SPC700／S-DSP・ファイル保持、play／pause／stop／seek、RAM／DSP snapshot、onEventに対応する。
- [x] 全21種類でMain／Workerの生成待ち中のloop取消し、遅延応答の回収、Stop／再Run／同ID再生成、共有待機者の分離を確認する。
- [x] 代表7種類の混在ラックを実コアで継続生成し、予算・所有者取消し・Stop／再開・回収を検証する。共通の試聴Exampleを用意する。
- [x] 対応済み21種類のNative所有メモリーに合計64 MiBの予算を設け、準備中・破棄待ちも数える。

現在の上限は**PSG＋YM2612＋YM2203＋YM2608＋YM2610＋YM2151＋YM2413＋AY-3-8910＋YM3526＋YM3812＋Y8950＋YMF262＋RF5C164＋OKIM6258＋Game Boy＋NES＋HuC6280＋DX7＋PWM＋SNES＋SPCの合計16台・64 MiB**。
YM2608は1台ごとにRAM 2 MiB＋ROM 8 KiBを持つ。YM2610はA／B各16 MiB空間の使用箇所を64 KiB単位で確保する。
RF5C164・NES・SNESは1台ごとに64 KiB RAMを持つ。NESの待機uploadは1 batch 64 KiB・ラック全体1 MiB以内とする。OKIM6258は最大16 MiBのsampleを転送時に確保する。固定queue・管理余裕、転送・timeline、ROMの旧版・新版の重複保持も数える。
SPCは元file・SPC700／DSP core・seek準備・イベント・snapshot・退役待ちも数える。
IPCのJSON／DTO一時data・JS・decode・主音源・FXは別枠。実機の負荷上限の評価は継続する。

## 対象一覧

現在のBrowser版`createSoundChip()`が受け付ける21種類を基本対象とする。
Nativeの「既存コア」はMode内蔵用の実装があるという意味で、追加生成への接続完了を意味しない。

| 公開名 | Native追加生成 | 追加対応で必要な主な作業 |
| --- | --- | --- |
| `segapsg` | 対応済み | 今後の共通化でも、独立したtone／noise・stereo・clockと回収を維持 |
| `ym2612` | 対応済み | ymfmのFM 6CH＋DAC register、OPN API、CH3特殊／CSM、timer、clock、音色編集・試奏 |
| `ym2203` | 対応済み | FM 3CH＋SSG 3CH、noise／envelope、mono、prescaler、`scheduleRegisters()`、音色編集・試奏 |
| `ym2608` | 対応済み | FM 6CH＋SSG＋rhythm＋ADPCM-B、独立ROM／RAM、再利用timeline、編集・試奏、合計メモリー予算 |
| `ym2610` | 対応済み | FM 4CHのphysical対応、SSG、ADPCM-A／B、疎なROMと制御側COW準備、編集・試奏 |
| `ym2151` | 対応済み | OPM 8CHの単独生成、operator、LFO／noise、CSM、pan、clock、編集・試奏 |
| `ym2413` | 対応済み | OPLL単独9CH、共有User patch、rhythm 5voice、mono出力、編集・試奏 |
| `ay8910` | 対応済み | AY単独tone 3CH、共有noise／envelope、clock・音量0の保持、編集・試奏 |
| `ym3526` | 対応済み | OPL単独9CH／2op・rhythm 5voice、timer／CSM、編集・試奏 |
| `ym3812` | 対応済み | OPL2単独9CH／rhythm・waveform選択、clock、編集・試奏 |
| `y8950` | 対応済み | 単独FM 9CH／rhythm・raw ADPCM制御、保持DCの所有権。memory API拡張は別項目 |
| `ymf262` | 対応済み | OPL3単独18CH、6組の4operator・rhythm・2bank・ステレオ、NEW折返しと適用済みregister plane、編集・試奏 |
| `rf5c164` | 対応済み | 独立PCM 8CH・64 KiB RAM、bank／loop／step／pan、転送完了とguard、音色編集・Keyboard |
| `okim6258` | 対応済み | 単独1ストリーム、動的sample保持・原子的ADPCM転送・divider／pan／repeat、波形・音声ファイル・Keyboard |
| `gameboy` | 対応済み | 独立pulse 2CH／wave／noise、Wave RAM・power／clock・左右routing、有限音の試奏保持解除、音色編集・Keyboard |
| `nes` | 対応済み | 独立pulse／triangle／noise／DMC＋任意FDS。`{fds, clock}`、DMC memory・FDS波形・所有者を分離、編集・Keyboard |
| `snes` | 対応済み | 独立8声・BRR・64 KiB RAM・DSP・echo・timeline。原子的な転送／reset、明示RAM snapshot、編集・Keyboard、owner／手動leaseの排他 |
| `huc6280` | 対応済み | 独立6CHのwave／DDA／noise、共有LFO、波形RAM・clockを分離、音色編集・Keyboard |
| `dx7` | 対応済み | 独立16voice・6operator、preset／SysEx bank、voice割当・note lease・適用済み／論理音色、編集・Keyboard |
| `pwm` | 対応済み | 独立左右FIFO・register・clock・時刻付きschedule・tag付き保持出力、owner別取消し・情報表示・Mixer |
| `spc` | 対応済み | 独立SPC700／S-DSPファイル再生。load／play／pause／stop／seek／snapshot／mute／onEvent、Main／Worker・所有者別取消し・Mixer |

### 公開名と機能の注意点

- **`ym2610b`**：現在の汎用`createSoundChip()`にはない。
  Neo Geo B modeの`useSoundChip('ym2610b')`は、内蔵6CH音源を借りるための別名。
  追加生成にも6CH版を公開するなら、Browser／Nativeの名前・型・取得規則を別途決める。
- **`snes`と`spc`**：`snes`はCPUを動かさないS-DSP楽器・取得済みtimelineの再生。
  `spc`はSPC700も動かすファイルプレーヤー。[別の再生経路](native_dynamic_spc_01.md)としてNativeへ追加した。
- **Y8950 ADPCM**：低レベルコアの機能と現在のPlayground公開APIを区別する。
  ADPCM memory APIの新規公開を、追加生成対応の完了条件へ暗黙に加えない。
- **Nuked**：まず追加YM2612は通常のymfmを対象とする。
  Nukedを追加生成時にも選べるようにするか、公開オプションとともに別途検討する。

## 実装順の目安

1. **YM2612（完了）**：独立FM＋DAC registerを、PSGと同じ追加ラックへ接続した。
   異なるチップの併用・Main／Worker・Mixer・Keyboard・Inspector・回収を確認済み。
2. **YM2203（完了）**：OPNの再利用、FMとSSGの複合出力、mono、prescaler、scheduleを確認した。
   Mainの通常writeと予約writeをNativeの所有者groupで追跡し、Workerの長時間予約取消しもイベントで完了待ちを解放する。
3. **YM2608（完了）**：FM／SSG／rhythm／ADPCM-B、ROM／RAM、再利用timelineを接続した。
   4種類合計64 MiBの予算を用意し、準備・置換・取消し・退役の参照が残る間も予約を保持する。
4. **YM2610（完了）**：FM4／SSG／ADPCM-A／Bを接続した。ROMは必要な64 KiB pagesを制御側で作り、
   callbackはpointerのみ切り替える。旧版・新版・退役待ちも64 MiB予算へ含める。
5. **他の既存コア**：YM2151 OPM・YM2413 OPLL・AY・OPL1/2/Y8950・YMF262 OPL3・Game Boy・NES＋任意FDS・PC Engine・DX7・PWM・SNESの単独化は完了。
   YM2608で実装した合計メモリー予算へ、新しい種類の固定確保と所有payloadを追加する。
6. **サンプル・timelineを含む仕上げ**：RF5C164・OKIM6258・SNESの追加生成・転送・手動試奏は完了。
   SNESのtimeline・RAM snapshotも所有者と寿命を分離し、置換・停止・失敗・完了を確認した。
7. **SPCプレーヤー（完了）**：SPC700を含む独立ファイル再生を追加した。
   読込み・stop用coreの再作成・seekは制御側で準備し、callbackへ渡す。既存Browser APIの停止・状態・イベントを維持する。

手順5以降の細かな順番は暫定。共通部分の調査・実装は並行してよい。
音源ごとの公開API・PCM比較・寿命・画面の検証を通してから配布物へ統合し、失敗時の切り分けを保つ。

## 共通で必要な作業

以下は全対象への完了条件。PSG／YM2612／YM2203／YM2608／YM2610／YM2151／YM2413／AY／YM3526／YM3812／Y8950／YMF262／RF5C164／OKIM6258／Game Boy／NES／HuC6280／DX7／PWM／SNES／SPCでの検証結果は種類別の文書へ記録する。
以下の未チェック項目には、既存実装の横断整理・共通化と実機評価を含む。全種類の追加生成が未実装という意味ではない。

### ラック・生成・寿命管理

- [x] PSG用の生成／命令／状態取得／破棄を整理し、YM2612・YM2203・YM2608・YM2610・YM2151・YM2413・AY・OPL1/2/Y8950・OPL3・RF5C164・OKIM6258・Game Boy・NES・HuC6280・DX7・PWM・SNES・SPCも追加できる入口を作る。
  各チップの命令検証・DSP状態・voice管理は、そのチップの実装へ委譲する。
- [ ] 単独チップを生成するC ABIとRust wrapperを用意し、不要な同居音源の生成を避ける。
  例：YM2151だけの追加で、X68000複合のOKI用メモリーまで確保しない。
- [ ] 種類別／合計台数、ROM・RAM・サンプル、準備中転送、待機命令、破棄待ちの上限を決める。
  停止中やcallbackの進行が遅い場合も、上限を超えて確保しない。
- [ ] 生成・大きな転送準備・最終解放を制御側で行い、callbackでallocation・最終free・待機lockを増やさない。
- [ ] Mixer IDとNative識別子を分け、session／世代／instanceを確認する。
  古いwrite・予約・状態応答・disposeが、同じIDで再生成した音源へ届かないこと。
- [ ] 生成途中のStop、個別dispose、同じIDの再利用、再Run、Mode／backend変更、生成失敗を回収する。
  ID予約・port・listener・キュー・ROM／RAMの保持参照も残さない。

### 演奏命令と公開API

- [ ] Main／Workerで同じ機能・初期値・validation・非同期完了条件を提供する。
- [ ] 追加チップも既存の演奏時計・performance・ownerに参加させる。SPCのファイル再生はBPM／先読み時計から独立させる。
  `stopLoop()`が他のloop・音源・手動Keyboardの発音まで止めないこと。
- [ ] raw write、clock、reset、keyOff、schedule・memoryなど、チップ固有の公開操作を一覧にして照合する。
  アップロード完了と、未来に予約した命令の適用完了を区別する。
- [ ] JSの予約済み／編集済み状態とNativeの適用済み状態を区別する。
  clockは適用確認後に反映し、状態読取りで演奏時計を設定し直さない。
- [ ] `useSoundChip()`の借用／共有生成、同時要求の集約、失敗後の再取得、dispose後のcache破棄を確認する。
- [ ] 対応済み種類をcapabilitiesへ追加し、Main／Workerの受付・d.ts・説明を揃える。

WASM／Direct用の同期`read()`・`generateStereo()`の契約は維持する。
Native IPCで同じ同期呼出しを装ったり、戻り値を無条件にPromiseへ変えたりしない。
Nativeの描画はcallbackが担当し、UIの状態取得は非同期のsnapshot／適用確認で接続する。
低レベルnpm API全体へのNative adapter公開や、パッケージの分離は別の作業として扱う。

### Mixer・Keyboard・音色情報

- [ ] インスタンスごとにMixerへ接続し、volume／pan／mute／soloを独立させる。
  追加音源も共通FX・liveFx・monitor・録音へ流す。
- [ ] 固定IDでMixer設定を再利用できるようにし、既存のPreset／default／current保存規則に従う。
  音源の作成・破棄だけでは`mixer/current.json`を書き換えない。
- [ ] Keyboardで対象インスタンスとCHを選べるようにし、PCキー／Guitar／手動試奏へ接続する。
- [ ] 既存の音色情報・operator編集・試奏UIを追加インスタンスからも使えるようにする。
  チップに存在する操作だけを表示し、固定Modeの主音源と追加音源を識別できること。
  SPCはファイルプレーヤーのため、音符用Keyboard／Operator編集の対象にはしない。
- [ ] 状態通知を正しいinstanceへ送る。追加音源の通知で主音源や別インスタンスの表示を上書きしない。
- [ ] viewの描画と音声生成を分離し、観測のための常時ポーリングを増やさない。
  status待機中にもStop／disposeが進むようにする。

## YM2612の完了項目

- [x] ymfmのYM2612単独コアを用意する。FM 6CHとDACを持ち、PSGを同時生成しない。
- [x] 2port write、operator／preset、pan／LFO、CH3特殊モード／CSM、timer・clockを照合する。
- [x] DAC enable／dataを扱い、PCM用の公開操作は現在の追加YM2612 APIで実際に使える範囲を確認して接続する。
  主音源側のDAC bank・所有者・停止と混線させない。
- [x] 同じYM2612を2台追加した場合と、追加YM2612＋PSG＋Mode主音源の混在を確認する。
- [x] Main／Worker、Mixer、Keyboard、音色情報、個別dispose、Stop／再Runを接続する。
- [x] callback分割や状態読取りの有無でPCMが変わらず、Browser側の対応音源と一致することを確認する。
- [x] 台数を増やしたオフラインDSPの処理時間とコアのメモリー量を記録する。
  ラック・固定キュー・IPC・UIを含む全体負荷と、実機でのcallback締切は別途測定する。

## 各チップの完了条件と検証

1. 実C++／RustとBrowser／WASMをオフライン比較する。44.1／48／96 kHz、clock、
   全CH、音量・pan、raw操作、reset、Stop／再発音、可変callbackを対象にする。
   比較対象コア・丸めによる許容差はチップごとに根拠を残す。
2. 同種2台と異種混在を確認する。一方の編集・reset・clock・dispose・owner取消しで、
   他方の音色・波形・ROM／RAM・予約・発音が変わらないこと。
3. 無効な操作・上限超過・転送失敗・古いsession・生成中Stop・同ID再利用を確認する。
   受付失敗時に途中の設定や確保だけが残らないこと。
4. 実logic WorkerとNative IPCのmockで、API・予約・取消し・portの寿命を検証する。
   Chromium／WebKitではKeyboard・音色情報・Mixer・Run／Stopを確認する。
5. Native再生経路でAudioContext／AudioWorkletや連続PCM転送を追加しないこと。
   通常再生のテストでは物理音声デバイスを開かず、実機試聴・dropout確認とは結果を分ける。
6. 新規C++／RustをMSVC／GCC／Clang、x86_64／ARM64の既存CIでビルドする。
   ライセンス・原典照合・対応ソースと再ビルド材料の同梱も更新する。
7. `web`→`docs/js`同期、cache revision、Playground ZIP、Tauri取込み、同梱ソースZIPを更新する。
   最終distでも確認し、種類ごとの対応API・制限・検証結果を記録する。

## 未決定・別途扱う項目

- [x] 全21種類へ[生成待ち中のloop取消し・遅延応答後の回収](native_dynamic_lifetime_01.md)を展開した。
  Main／Worker、Native応答前の取消し、Workerへの遅い配送、同ID再生成、共有cacheの別待機者を検証した。
- [ ] 全21種類へ展開した16台・64 MiBの予算について、重い組合せの実機負荷を評価する。
  [代表7種類の混在自動試験と共通Example](native_dynamic_stability_01.md)は追加済み。物理デバイスの試聴・dropout評価は別途行う。
- [ ] 追加生成用`ym2610b`の公開名・型・Browser対応。
- [ ] 追加YM2612でのNuked選択と、選択方法。
- [ ] Y8950 ADPCMなど、現在のPlayground公開APIにない機能の追加。
- [x] [SPCプレーヤーのNative化と観測イベントの配送](native_dynamic_spc_01.md)。
- [ ] `tetorica-soundchip-native`／JS adapterのパッケージ分離、低レベルAPI全体への展開。

## 関連する実装・記録

- [公開名と追加生成の入口](../../web/playground_runtime.js)、[共有音源のcache](../../web/playground_soundchips.js)
- [Native主音源API](native_primary_api_01.md)、[実装済みの追加Sega PSG](native_dynamic_psg_01.md)
- [実装済みの追加YM2612と検証結果](native_dynamic_ym2612_01.md)
- [実装済みの追加YM2203と検証結果](native_dynamic_ym2203_01.md)
- [実装済みの追加YM2608・メモリー予算と検証結果](native_dynamic_ym2608_01.md)
- [実装済みの追加YM2610・疎なROMと検証結果](native_dynamic_ym2610_01.md)
- [実装済みの追加YM2151・単独OPMと検証結果](native_dynamic_ym2151_01.md)
- [実装済みの追加YM2413・AYと検証結果](native_dynamic_opll_ay01.md)
- [実装済みの追加OPL1/2・Y8950と検証結果](native_dynamic_opl01.md)
- [実装済みの追加OPL3・YMF262と検証結果](native_dynamic_opl3_01.md)
- [実装済みの追加RF5C164と検証結果](native_dynamic_rf5c164_01.md)
- [実装済みの追加OKIM6258と検証結果](native_dynamic_okim6258_01.md)
- [実装済みの追加Game Boyと検証結果](native_dynamic_gameboy_01.md)
- [実装済みの追加NES＋FDSと検証結果](native_dynamic_nes_01.md)
- [実装済みの追加HuC6280と検証結果](native_dynamic_huc6280_01.md)
- [実装済みの追加DX7と検証結果](native_dynamic_dx7_01.md)
- [実装済みの追加32X PWMと検証結果](native_dynamic_pwm_01.md)
- [Mixerの保存規則](playground_mixer_state_01.md)、[Native安定化・継続検証](native_stability_01.md)
- [Neo Geoの4CH／6CH](native_neogeo_01.md)、[Native SNESなどの対応範囲](native_consoles_01.md)、[MSX Audioの対応範囲](native_msx_audio_01.md)

- [実装済みの追加SNES S-DSPと検証結果](native_dynamic_snes_01.md)
- [実装済みの追加SPC700ファイルプレーヤーと検証結果](native_dynamic_spc_01.md)
- [全21種類の生成取消し・寿命管理](native_dynamic_lifetime_01.md)
- [代表的な混在ラックの継続再生と共通Example](native_dynamic_stability_01.md)
