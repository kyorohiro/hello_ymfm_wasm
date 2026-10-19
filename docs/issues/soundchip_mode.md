# Playground Sound Chip Mode 案

## 実装済み mode

Menu の Mode で次の環境を選べる。先頭は Genesis → Mega CD → 32X → 32X Nuked の順に並べる。
内部IDは互換性のため `genesis` / `mega-cd` / `genesis-full` / `genesis-full-nuked` を維持する。

| mode | ID | ベース音源 | クロック / 内部出力レート |
| --- | --- | --- | --- |
| Genesis | `genesis` | YM2612 + Sega PSG / DAC | YM2612: 7,670,454 Hz |
| Mega CD | `mega-cd` | Genesis + RF5C164 | YM2612: 7,670,454 Hz |
| 32X | `genesis-full` | Genesis + Mega-CD RF5C164 + 32X PWM | YM2612: 7,670,454 Hz |
| 32X Nuked | `genesis-full-nuked` | 32X の YM2612 を Nuked-OPN2 にする | YM2612: 7,670,454 Hz |
| PC-98 (YM2203 / OPN) | `pc98-26` | YM2203 FM 3ch + SSG 3ch | 4,000,000 Hz |
| PC-98 (YM2608 / OPNA) | `pc98` | YM2608 FM 6ch + SSG 3ch + Rhythm 6音 + ADPCM-B | 8,000,000 Hz |
| Neo Geo | `neogeo` | YM2610 FM 4ch + SSG 3ch + ADPCM-A 6音 + ADPCM-B | 8,000,000 Hz |
| Neo Geo (YM2610B) | `neogeo-b` | YM2610B FM 6ch + SSG 3ch + ADPCM-A 6音 + ADPCM-B | 8,000,000 Hz |
| Game Boy | `gameboy` | Pulse 2ch + Wave 1ch + Noise 1ch | 4,194,304 Hz |
| NES + FDS | `nes` | 2A03 Pulse 2ch + Triangle + Noise + DMC、FDS Wave | 1,789,773 Hz |
| SNES | `snes` | S-DSP、BRR サンプルによる8音 | 内部 PCM: 32,000 Hz |
| X68000 | `x68000` | YM2151 OPM 8ch + OKIM6258 ADPCM | OPM: 4,000,000 Hz、OKI: 8,000,000 Hz |
| PC Engine | `pc-engine` | HuC6280 Wave 6ch、うち2ch は Noise へ切り替え可能 | 3,579,545 Hz |
| Game Gear | `game-gear` | Sega PSG Tone 3ch + Noise、各音の左右出力切り替え | 3,579,545 Hz |
| Master System | `master-system` | Sega PSG Tone 3ch + Noise、モノラル | 3,579,545 Hz |

SNES を除く Hz は CPU や音声出力のサンプルレートではなく、音源のマスタークロック。
SNES の 32,000 Hz は S-DSP 内部の PCM 出力レートで、音声デバイスの出力レートとは別。
型定義、音源 API・チャンネル定数、補完、音程計算を、選んだ環境に合わせる。
音源タブも mode に合わせ、Genesis は FM / Sega PSG、Mega CD はさらに RF5C164、32X はさらに32X PWM、
PC-98 と Neo Geo は対象の FM タブを表示する。Code や下部の共通ツールは引き続き使える。
`useSoundChip()` で追加した音源によって、mode に含まれないタブを自動表示することはしない。
PC-98 (YM2203 / OPN) は `fm` と `ssg`、YM2608 / OPNA は `fm` に加えて `ssg`・`rhythm`・`adpcm` を標準で公開する。
これらは同じ YM2608 を操作する。Neo Geo / YM2610B では `ssg`・`adpcmA`・`adpcmB`
（`adpcm` は ADPCM-B の別名）を標準で公開する。現時点で標準公開していない機能は、既存の
`useSoundChip()` / `createSoundChip()` で追加して使える。

切り替え前のダイアログで、初期コードから始めるか現在のコードを維持するかを選ぶ。
選択後に停止・音声の終了処理を行い、バイナリ、フォルダー、Cassette メタデータを引き継いで
再読み込みする。キャンセルした場合は停止や保存・画面遷移を行わない。
プロジェクトは IndexedDB で受け渡し、保存に失敗した場合は画面を移動しない。
デスクトップの下書きは mode ごとに保存し、既存の下書きは対応する基本 mode で読み込める。

Tauri の macOS WebView では、切り替え元の `pagehide` で開始した下書きの書き込みが
完了せず、切り替え先の引き継ぎデータの読み取りを塞ぐことがあった。
mode 切り替えでは保存完了後に自動保存を終了して DB 接続を閉じ、`pagehide` で再保存しない。
キャンセル時は自動保存を継続する。

新しい URL は `?mode=pc98` などを使う。既存の `chip=` / `engine=nuked` は入力互換として
残す。明示された mode が優先する。通常の Nuked 版は、過去のリンク用の
`genesis-nuked` として維持する。`neogeo-b` は標準の選択候補とし、既存リンクも引き継ぐ。簡易表示は `layout=simple` とし、
従来の `mode=simple` も読み込める。

YM2608 の `useSoundChip()` は、SSG・Rhythm・ADPCM・Timeline を含む既存のフル API を
保つため、標準の YM2608 とは別インスタンスのままとする。標準 FM と共有する YM2612・YM2203・
YM2610 とは扱いが異なる。単純な FM への別名化でフル import を壊さない。

### mode ごとの初期コードと examples

各 mode の初期コードは `docs/playground/defaults/<mode ID>/index.js` を原本とし、
新規プロジェクトの `/index.js` に入れる。同梱 examples の選択は
`docs/playground/playground_mode_examples.js` にまとめる。
Genesis は従来の豊富なサンプル集を維持し、他の mode はその標準 API を使う代表例を2〜3個に絞る。
互換用の `genesis-nuked` は Genesis のサンプル構成を引き継ぐ。
初期コード・サンプルは `scripts/build_playground_examples.mjs` で文字列として生成し、読み込み時には実行しない。

mode 切り替え時は **Start with initial code / Keep current code / Cancel** から選ぶ。
初期コードを選んだ場合だけ `/index.js` を切り替え先の初期コードにし、エディターと実行対象も
`/index.js` にする。編集済みの元の index は `/index-<元 mode ID>.js` に退避し、衝突時は連番を付ける。
維持を選んだ場合は、未編集の初期コードでも内容とエディター・実行対象の選択を保持する。
同梱 examples は元のパスと内容が完全一致する未使用のものだけを整理し、切り替え先の examples を不足分だけ追加する。
編集済みのコード、自作・移動済みのファイル、バイナリ、チェックポイント、Cassette メタデータは保持する。
追加先にファイルやフォルダーがある場合は上書きしない。
維持を選んだ場合、現在開いている example と実行対象の example も整理から保護する。
旧下書きや Cassette の復元も維持が既定で、初期コードの自動差し替えは行わない。

同じ mode の初期状態からやり直す場合は **Menu → New Cassette** を使う。
確認後、現在のプロジェクトを選択 mode の初期コード・ファイル構成に戻す。

### Game Gear / Master System の標準 API

両 mode は PSG を標準音源とし、`psg`・`PSG1`〜`PSG3` を公開する。
`psg.tone()` / `psg.off()` と `psg.noise()` / `psg.noiseOff()` で演奏し、待機には
`beat()` / `sleep()` を使う。`pg.psg`、`livePrepare()`、`useSoundChip('segapsg')` からも
同じ標準 PSG を操作できる。FM の `play()`・`fm`・`write()` は公開しない。
音源タブは Sega PSG のみとし、各 mode の初期コードと2〜3個の examples を同梱する。
下書きは mode ごとに分け、切り替えダイアログでコード維持・初期化を選べる。

Game Gear の `psg.setStereo(mask)` は8ビットの左右出力レジスターに対応する。
上位4ビットが左、下位4ビットが右で、各組の下位から Tone 1 / 2 / 3 / Noise。
`0xff` で全音を両側に出力する。対応は [Sega の Game Gear 公式資料](https://www.smspower.org/Development/GGOfficialDocs#(7)_I/O_port_06H_(Write_Only)) に基づく。
Master System の標準 PSG はモノラルを左右に同じ波形で出し、ステレオ切り替えを公開しない。
独立した `createSoundChip('segapsg')` はステレオ対応の別音源を作る。

### PC-98 / OPN の標準 API

`?mode=pc98-26` では、Main / Worker の両方で `fm`（3ch）と `ssg`（3ch）を使える。
`ssg.tone()`・`ssg.noise()`・`ssg.setEnvelope()` などを、FM と同じ YM2203 に対して操作する。
`pg.ssg`・`livePrepare({ssg})` にも同じ API を公開し、型・補完も対応する。
SSG の実効クロックはマスターの1/2で、`fm.setClock()` の変更に追従する。
音源出力はモノラル信号を左右両チャンネルへ同じ波形で送る。
Stop で全3ch を消音し、再開用の音量・エンベロープ設定は保持する。
外部ファイル不要の例は `examples/pc98/pc98-opn-ssg.js`。

### PC-98 / OPNA の標準 API

`?mode=pc98` では、Main / Worker の両方で次の入口を使える。

- `fm`：FM 6ch。型表示は `YM2608FMApi`。
- `ssg`：3ch の tone / noise / envelope。
- `rhythm`：6音のリズム。標準の合成リズム ROM を使用し、`loadRom()` で差し替えも可能。
- `adpcm`：ADPCM-B。`loadMemory()` または PCM / WAV からの `loadSample()` で準備して発音する。

`pg.ssg`・`pg.rhythm`・`pg.adpcm` と `livePrepare()` の引数にも同じ API を公開する。
補完・型定義はこの mode に合わせる。`fm.setClock()` の変更は SSG の音程計算と
ADPCM の再生レート計算にも反映し、Stop で全セクションを停止する。
SSG・Rhythm・ADPCM 用のタブ追加は、この実装には含めない。

```javascript
ssg.tone(0, {frequency: 440, volume: 10});
await beat(1);
ssg.keyOff(0);

rhythm.setVolume(48);
rhythm.setVoice('snare', {volume: 24, left: true, right: true});
rhythm.keyOn('snare');

const sample = await adpcm.loadSample(
  await file('./voice.wav', {type: 'arrayBuffer'}),
);
adpcm.setVolume(180);
adpcm.setPan(true, true);
adpcm.keyOn();
await sleep(sample.duration);
adpcm.keyOff();
```

外部ファイル不要の実行例は `examples/pc98/pc98-opna-sections.js`。

### Neo Geo / YM2610B の標準 API

`?mode=neogeo` は YM2610 の FM 4ch、`?mode=neogeo-b` は YM2610B の FM 6ch を使う。
型表示もそれぞれ `YM2610FMApi` / `YM2610BFMApi` になる。
通常版の論理 FM ch 0..3 はハードウェア ch 1・2・4・5 に対応し、B 版は ch 0..5 を使う。
Worklet の実チップも YM2610 / YM2610B の variant を mode に合わせて選ぶ。

両方の mode で、FM と同じチップの次の機能を Main / Worker から操作できる。

- `ssg`：3ch のトーン・ノイズ・エンベロープ。ノイズは `ssg.noise()` から設定する。
- `adpcmA`：6音。音ごとのサンプル範囲・音量・パンを設定できる。再生レートはクロック / 432。
- `adpcmB` / `adpcm`：1音。Delta-N / 再生レート指定・繰り返し再生に対応。

`pg` と `livePrepare()` にも同じ名前・同じオブジェクトを公開する。
A/B はそれぞれに符号化済みデータを `await loadMemory()` で読み込み、256-byte 境界の
`setSample()` で範囲を選んでから発音する。A と B のメモリ領域は別々に扱う。
`fm.setClock()` に SSG の音程計算と ADPCM-B のレート計算が追従し、Stop で全音源を停止する。
外部 ROM 不要の例は `examples/neogeo/neogeo-opnb-sections.js`。

### Game Boy の標準 API

`?mode=gameboy` では `gameboy` を標準 APU とし、`pg.gameboy` と
`livePrepare(({gameboy}) => ...)` からも同じ音源を操作する。

- `gameboy.pulse`：2ch。音色・デューティ・エンベロープ・音程・発音を指定する。
- `gameboy.wave`：32個の4-bit波形、音量レベル・音程・発音を指定する。
- `gameboy.noise`：ノイズの分周・シフト・7/15-bit幅・エンベロープを指定する。
- `gameboy.setPan()`：APU 4ch の左右出力を指定する。

Game Boy mode では、グローバルの `play()`・`fm`・`write()`、OPN の音程変換・FM 定数を
公開しない。時間制御は共通の `beat()`・`sleep()`・`liveLoop()` を使い、発音は
`gameboy.pulse.noteOn()` などで対象を明示する。初期コードも Game Boy 用とし、
FM・Sega PSG・PCM・PWM タブと FM Keyboard は表示しない。
追加の OPN 音源は `useSoundChip()` などで取得したオブジェクトから操作できる。

Main / Worker の両方に対応し、Stop で全4ch を停止する。標準 APU は Run ごとに
破棄せず、音色設定を保持する。`useSoundChip('gameboy')` は標準 APU を再利用し、
`createSoundChip('gameboy')` は独立した追加音源を作る。
初期コードは `defaults/gameboy/index.js`。同梱例は
`examples/gameboy/gameboy-mode-pulse.js`・`gameboy-mode-wave.js`・`gameboy-mode-noise.js`。

### NES / SNES / X68000 / PC Engine の標準 API

次の mode は Main / Worker の両方で、機種の音源名を発音の入口にする。
`pg` と `livePrepare()` の引数にも同じ名前・同じ音源を公開する。

| mode | 標準 API | 初期コード | 同梱 examples |
| --- | --- | --- | --- |
| NES + FDS | `nes` | `defaults/nes/index.js` | `nes-mode-pulse.js`、`nes-mode-fds.js`、`nes-mode-rhythm.js` |
| SNES | `snes` | `defaults/snes/index.js` | `snes-mode-brr.js`、`snes-mode-stereo.js` |
| X68000 | `opm`、`adpcm` | `defaults/x68000/index.js` | `x68000-mode-opm.js`、`x68000-mode-adpcm.js` |
| PC Engine | `pce` | `defaults/pc-engine/index.js` | `pce-mode-wave.js`、`pce-mode-stereo.js`、`pce-mode-noise.js` |

これらと Game Boy では、グローバルの `fm`・`play()`・`write()`・OPN の音程変換、
`FM_PRESETS`・`CH1` などの FM 定数、MIDI の FM ルーティングを公開しない。
FM 用タブと FM Keyboard も表示しない。時間制御、`sample`・`stream`・`noise`、
mixer と FX は共通で使える。音源を追加する場合は `useSoundChip()` / `createSoundChip()` を使う。

`useSoundChip('nes')`・`useSoundChip('snes')`・X68000 の `useSoundChip('ym2151')` /
`useSoundChip('okim6258')`・PC Engine の `useSoundChip('huc6280')` は、それぞれ標準の音源を返す。
標準音源の寿命は mode が管理し、返される API は `dispose()` を持たない。
`createSoundChip()` は同じ名前でも独立した追加音源を作る。
Stop は標準音源を消音し、アップロード済みサンプルや波形を次の Run に保持する。

NES は標準で FDS を有効にする。`nes.pulse`・`triangle`・`noise`・`dmc`・`fds` を使い、
DMC のメモリ転送は `await nes.dmc.loadSample()` で完了を待つ。
独立した `createSoundChip('nes')` で FDS を使う場合は `{fds:true}` を指定する。

SNES は SPC700 のゲームプログラムを動かす API とは別の、CPU を使わない S-DSP 音源。
`await snes.loadBRR(bytes, {rootNote:'C4'})` でサンプルを読み、`snes.setPreset()` で
0..7 の物理チャンネルへ割り当て、`snes.noteOn()` で演奏する。
内部出力は 32,000 Hz 固定。`setClock()` は提供しない。
SPC ファイル再生は従来どおり `useSoundChip('spc')` で追加できる。

X68000 の `opm` は YM2151 の8ch。`setOperator()`・`setAlgo()`・`setPan()`・
`setNote()` / `noteOn()`・`setPitch()`・`setNoise()` を公開する。
OPN の `setPreset()` や OPN の LFO 設定はこの API に含めない。
`adpcm` は OKIM6258 であり、PC-98 / Neo Geo の ADPCM-B とは別の API。
PCM / AudioBuffer / WAV は `await adpcm.loadSample()` でモノラルに変換して OKI ADPCM4 へ符号化する。
符号化済みの low-nibble-first データは `await adpcm.loadMemory(bytes)` で読み込める。
`adpcm.play({repeat:true})`・`stop()`・`setPan(left,right)` を使い、
再生終了と Stop では出力をゼロにして最後の ADPCM 値が残らないようにする。
`setPlaybackRate(hz)` は現在のマスタークロック / 1024、/ 768、/ 512 のうち近いレートを選んで返す。
標準 8 MHz では 7,812.5 / 10,416.67 / 15,625 Hz。
`await adpcm.setClock(4000000)` と組み合わせると低速側のレートを選べる。

PC Engine は `pce.setWaveform(ch, samples)` で32個の 0..31 の波形値を設定し、
`setVolume()`・左右 0..15 の `setPan()`・`noteOn()` / `keyOff()` で0..5 の6ch を演奏する。
`setNoise(4|5, {enabled:true,frequency:...})`、5-bit DAC の `setDda()` / `writeDda()`、
ハードウェア LFO の `setLfo()` も公開する。
`createSoundChip('huc6280')` と `createSoundChip('okim6258')` は他の mode からも利用できる。

## 背景

Playground は Genesis / YM2612 向けの環境から始まったため、グローバルの
`fm`、`play()`、`write()`、`FM_PRESETS`、PSG、DAC などに、その出自が残っている。

mode 導入前の `?chip=` はベースの OPN 音源を選ぶ仕組みであり、例えば
`?chip=ym2203` では `fm` と `play()` の発音先も YM2203 になる。
一方、`useSoundChip()` で別の音源を追加しても、そのベースは切り替わらない。

NES、Game Boy、SNES、PC Engine など、FM ではない音源も扱うようになった。
また、OPN 系同士でも音に違いがあり、単に同じ FM API で操作できるという理由で
一つの音源へ寄せたいわけではない。

音源の追加が一段落する段階なので、揃ってきた音源を前提に、
「どの機種・音源環境で曲を書くか」を選べる形に整理する。

以下は全体の設計メモ。未実装の mode は今後の対象とする。

## 方針

**mode は、その機種・音源で曲を書き始めやすくするための環境セットとする。**

ユーザーが初期環境を選ぶ設定は mode に統一し、従来の chip 選択はなくす。
`useSoundChip("ym2612")` などで指定する個別のチップ名は引き続き使う。

Genesis mode に FM、PSG、DAC が最初から用意され、`play()` が標準の FM を鳴らす
ことは、その環境では自然な便利さとして扱える。全音源に同じ書き方を強制せず、
各 mode に合った API や初期設定を用意する。

機種に偏っていることを欠点として消すのではなく、その機種らしく使いやすい
ことを mode の価値とする。DX7 のように、コンピューターやゲーム機以外の
音源を中心にした mode も含める。

`useSoundChip()` は引き続き利用できる。mode は追加可能な音源を制限しない。
例えば NES mode で DX7 を追加するなど、独自の構成も作れる。

- mode：最初から用意された、すぐ曲を書ける環境。
- `useSoundChip()`：その環境に好きな音源を追加する入口。
- Empty mode：標準の音源を用意せず、自分で環境を組むための入口。

## mode 候補

名称・ID・構成は案。PC-98 を OPN / OPNA、Neo Geo を YM2610 / YM2610B に分けた次の17候補を出発点とする。

| 表示名 | ID 案 | 標準音源・構成の案 | 補足・未決事項 |
| --- | --- | --- | --- |
| Genesis | `genesis` | YM2612 + Sega PSG、YM2612 DAC | 現在の使い勝手を引き継ぐ基本環境。 |
| Mega CD | `mega-cd` | Genesis + RF5C164 | 32X PWMを含めず、PCMの作曲・サンプリングを扱う。 |
| 32X | `genesis-full` | Genesis + Mega-CD RF5C164 + 32X PWM | OPN 系の先行実装で対応。 |
| 32X Nuked | `genesis-full-nuked` | 32X の YM2612 部分を Nuked-OPN2 にする構成 | エンジン選択を mode に含める案。32X の音源構成は通常版と揃える。 |
| Master System | `master-system` | Sega PSG を中心とした構成 | FM 拡張を標準構成に含めるかは別途決める。 |
| Game Gear | `game-gear` | Sega PSG を中心とした構成 | Master System との違い、ステレオ制御の扱いを整理する。 |
| NES + FDS | `nes` | NES + FDS | 標準 `nes` API と3個の代表例を実装。 |
| Game Boy | `gameboy` | Game Boy 音源 | 標準 `gameboy` API・初期コードを公開。グローバル `play()` は提供しない。 |
| SNES | `snes` | S-DSP | 標準 `snes` API と BRR 初期コードを実装。SPC ファイル再生は追加音源として扱う。 |
| PC-98 (OPN) | `pc98-26` | YM2203 | FM 3ch・SSG 3ch を標準公開。 |
| PC-98 (OPNA) | `pc98` | YM2608 | FM 6ch・SSG 3ch・Rhythm・ADPCM-B を標準公開。 |
| Neo Geo | `neogeo` | YM2610 | FM 4ch・SSG・ADPCM-A/B を標準公開。 |
| Neo Geo (YM2610B) | `neogeo-b` | YM2610B | FM 6ch・SSG・ADPCM-A/B を標準公開。 |
| X68000 | `x68000` | YM2151 + OKIM6258 | 標準 `opm` + `adpcm`、PCM からの OKI ADPCM4 読み込みを実装。 |
| PC Engine | `pc-engine` | HuC6280 | 標準 `pce`、Wave / Noise / DDA / LFO と代表例を実装。 |
| DX7 | `dx7` | DX7 音源 | DX7 向けの音色選択・編集・演奏を中心とした環境。 |
| Empty | `empty` | なし | 音源は `useSoundChip()` などで明示的に用意する。 |

低レベルのチップ対応と、Playground から使えること、mode として環境が整っている
ことは分けて確認する。HuC6280 と OKIM6258 は、高級 API と Playground の
Main / Worker → AudioWorklet 経路を追加し、標準音源・独立した追加音源の両方から使える。

## 設定と表示

現在の `Chip: YM2612` などの表示・設定箇所を、`Mode: Genesis` のような
環境の選択へ置き換える。chip と mode を並行した環境選択として残さない。

mode が決める内容の候補は、標準音源の組み合わせに加えて次のとおり。

- コードへ公開する音源名・ショートカット。
- 音源の初期設定。クロックなど、機種による音の違いに関わる設定も含む。
- 最初に表示する音源パネル・エディター。
- その環境で始められる初期コード・サンプル。

選択中の mode に加え、実際に使っている音源・エンジンも確認できるようにする。
内部のチップ ID や音源 API まで mode という名前に変更する必要はない。

URL とデスクトップの下書き保存キーも mode に揃える。
例えば `?mode=genesis-full-nuked` だけで初期構成と YM2612 エンジンを決める。
既存の `chip=` / `engine=` URL は互換入力として読み替え、新しい環境選択は mode に統一する。

### Nuked 版の扱い

現在の Nuked-OPN2 による YM2612 を、`32X Nuked` という mode として
用意する案。mode を選ぶだけで音源構成とエンジンが決まり、別途エンジンを
選択しなくても使い始められる。

- `32X` と `32X Nuked` は、公開 API と標準音源の構成を揃える。
- Nuked 版は YM2612 の実装を切り替える。PSG や追加の PCM 音源まで Nuked 実装に
  変わるという意味ではない。YM2612 の DAC も含め、既存コードとの動作を確認する。
- エンジンによる音の違いを選べる環境として扱う。
- 通常の `Genesis (Nuked)` は `genesis-nuked` として旧リンクとの互換性を維持する。
  標準の選択候補には 32X Nuked を載せる。

## API の扱い

### 音源に依存しない API

`beat()`、`sleep()`、`liveLoop()` などの時間・実行制御は、mode をまたいで使える
共通 API として扱う。mode を切り替えても、時間やループの基本的な意味は変えない。

### mode に合った音源 API

Genesis mode では `fm`、`psg`、`dac` など、既存の便利な入口を活かす。
NES や Game Boy などに、FM の概念や OPN の音程表現を当てはめる必要はない。
各 mode で何が用意され、どの名前で使えるかを明確にする。

### 暗黙の発音先・操作先がある API

現状、次のグローバル API はベースの FM / OPN 音源に依存している。

- `play()`：ベースの FM で音符を鳴らす。
- `write()`：ベースの FM にレジスタを書き込む。
- `scheduleWritesSamples()`：ベースの FM への書き込みを予約する。
- `noteToBlockFnum()` / `hzToBlockFnum()`：ベースの OPN 音源に合わせて音程を変換する。

mode が環境を明示するなら、その環境に合ったショートカットを残すこともできる。
Game Boy ではグローバル `play()` を提供せず、音源オブジェクト側の API を使う。
NES / SNES / X68000 / PC Engine も、各音源の発音方法を明示する。

各 mode について、以下を決める。

- グローバル `play()` を提供するか。提供する場合は、どの音源・チャンネルを鳴らすか。
- `write()` などの操作先をどう示すか。複数音源をまとめた mode でも曖昧にしない。
- FM がない mode では、FM / OPN 固有の API をどう扱うか。
- Empty mode では、発音先を必要とするグローバル API をどう扱うか。

例えば Genesis mode の `play()` は FM を鳴らす、という偏りを認めてよい。
一方、FM のない mode で、便利さのために見えない YM2612 を用意する必要はない。
追加音源を取得するだけの `useSoundChip()` 呼び出しで、既存のショートカットの
操作先が暗黙に切り替わらない方針を維持する。

### 初期コードのノイズ対策

- PC-98 / Neo Geo の SSG は、初期コードで `setMixer(0, {tone:true, noise:false})`
  を指定する。リセット直後の mixer は `0` なので、音量だけ上げるとトーンと
  ノイズが同時に鳴る。Neo Geo (YM2610B) の初期コードは FM のみを使う。
- SNES の BRR 初期音色は `adsr1:0x8e` の短いアタックを使い、最速アタックによる
  発音直後の大きな段差を抑える。
- PC Engine の初期コードは、音符の間も波形を進めるレガート奏法にする。
  `noteOn()` / `keyOff()` 自体はレジスタ操作のままで、任意のエンベロープを加えない。
- YM2203 / YM2608 / YM2610(B) / YM2151 の Worklet は、予約イベントの境界ごとに
  PCM をまとめて生成する。位相と予約フレームを保ち、毎サンプルの配列生成を避ける。

SSG の混入ノイズと発音境界の段差は実 PCM で確認した。Safari で発生するすべての
ノイズが同じ原因とは限らないため、持続音中の不規則な途切れは別途切り分ける。

追加調査では、YM2203 / YM2608 / YM2610(B) と Nuked の Worklet も、通常 Genesis と
同じ再利用 PCM バッファーを使うようにした。`generateStereo()` の戻り値を所有できる
従来の契約は維持し、Worklet だけ `generateStereoView()` を即時に消費する。
32X の PWM も毎サンプルの出力ペア配列を生成しないようにした。

同じ持続 FM 音を7モードで比較した WebKit の最終出力には、途切れや異常な波形の
飛びを検出できなかった。Nuked の処理時間には再生中7msの突出があったが、可聴ノイズ
との因果は未確認。Safari 18.6 のシステム JavaScriptCore でコア単体を測ると、OPN
3種とも128フレーム・48kHzの処理期限超過は再現しなかった。

`playground/audio-check.html` は、持続音または同じ初期コードのリアルタイム再生・録音再生・ブラウザー
標準サイン波を比較する確認用ページ。録音再生の前には音源とその AudioContext を終了し、
音源の処理負荷を残さず比較する。Mac版Safariの継続するノイズは、現時点で原因未確定。

利用者の Mac Safari では、この確認ページはノイズなし、本体は Worker オフでもノイズが
出ると報告された。Main 実行の音源生成オプション、FX 初期化、マスター音量、音符の
待機時計は両ページで同じ。本体の UI 監視は非表示時に停止し、通常の `play()` の
音符ごとに Operator の表示を書き換える処理もない。画面表示・同じ Runtime の再利用・
実行ソースなど、本体にだけある条件を引き続き切り分ける。確認ページが静かなことだけで、
本体の継続ノイズが解消したとは判断しない。

同じ PC-98 初期コードを WebKit で20秒ずつ、順序を入れ替えて本体 Main と確認ページで
比較した。平均処理負荷・レジスタ書き込みの到達差に一貫した差はなく、音符数と PCM の
ピーク・RMS も同等だった。本体では約19.2秒時点の Worklet 処理に両試行とも4msの
停滞があったが、録音は実デバイスへの出力欠落を直接測れないため、原因とは断定しない。

`defaults/history.json` は、初期コードから始める操作で旧 index が既知の同梱コードかどうかを
識別するために使う。履歴を含む初期コードも、維持を選んだ場合や復元時は自動更新しない。

利用者の Safari はブラウザー再起動後にノイズが聞こえなくなり、個別の再現調査は
いったん終了した。以下の共通経路の修正は、元の Safari ノイズの原因を断定するものではない。

### 音声経路全体のノイズ要因の除去

- 独立した OPN Worklet と YM2608 エンジンも、イベント境界まで PCM をまとめて生成する。
  既存の借用 PCM ビューを使い、音声サンプルごとの WASM 呼び出し・配列生成を避ける。
  YM2608 の同期 IRQ フックがある場合は、従来の観測・書き込み時刻を保つ。
- 共通音源 Worklet は既存の出力バッファーへ直接書き込む。PCM DAC の細かいイベントで
  分割しても、区間ごとの出力配列や YM2612 中間 PCM のコピーを生成しない。
- 音色編集の ALGO / FB は対象のアルゴリズムレジスターだけ、AMS / PMS は対象の
  パン・変調レジスターだけを更新する。毎操作で全 Operator・LFO・DAC・CH3 特殊周波数を
  再送していたため、別チャンネルの音程まで変わり得た。音色選択時も対象チャンネルだけを
  変更し、再生中の CH3 とチップ全体の設定を保持する。
- 音声イベントの表示同期は、モデルの値を直ちに更新し、DOM 描画だけを
  `requestAnimationFrame()` ごとに集約する。非表示では描画せず、復帰時に最新値を表示する。
  表示同期から音声への再送は行わない。
- OPN Runtime も FM 操作完了後に変更通知を発行する。従来は Main の UI と音声だけが
  変わり、Worker の音色状態に変更が届いていなかった。UI コールバックがない場合も同期し、
  状態の転送は1ターン1回に集約する。Worker からの表示用通知では音声を再送しない。
- OPN の周波数 high / low は一つの Worklet メッセージにまとめる。公開 `onWrite` への
  通知も両レジスターの適用後に行い、フックの再入による共有 high ラッチの混線を防ぐ。
  単発の raw write・keyOff・Worker の予約時刻は維持する。
- OPN の Operator パラメーターは全項目を検証してから変更する。不正な値を含む操作が
  例外になった後、部分的な変更が残って次の操作で意図しない detune などを生まないようにする。
- `liveFx` はチャンネル数・型・長さ・有限値を検証する。不正な配列が NaN を出力したり、
  次の FX で未捕捉例外を起こしたりする場合は、その FX だけをバイパスする。
  正常な同じ長さの `Float32Array` への差し替えと、通常処理のバッファー再利用は維持する。
- 非表示にした TFI / VGI 試聴音源は専用 AudioContext を suspend する。keyOff だけでは
  長いリリースや RR=0 の音が本体の演奏に混ざるため、開始・再開中の非表示も扱う。
- FX の準備を同時に呼んでも一つの Rack だけを作る。close 中に遅れて完了した Rack は
  破棄し、古い音声経路が復活しないようにする。

PCM 変更のない最適化は実 WASM 出力を従来処理と比較し、音符・VGM・クロック・IRQ の
境界を検証する。音作りの操作は、再生中の連続パラメーター変更で不要な書き込み・
音程変更・非有限 PCM・音声停止がないことをブラウザーでも確認する。
`scripts/check_playground_control_audio_browser.cjs --webkit` では、Chromium / WebKit ×
Genesis / PC-98 × Main / Worker の8条件、計136回の連続操作が成功した。
NES / SNES / X68000 / PC Engine も WebKit の Main / Worker 再生・停止・再開を確認した。

Menu 表示中のノイズも報告された。Genesis の持続音を Chromium / WebKit の Main / Worker で
閉じる→開く→閉じる各1.2秒ずつ計測した全12区間では、PCM のピーク・最大サンプル差は同じで、
Menu 内の継続 DOM 更新・Canvas 描画・音源への書き込み・AudioContext の状態変更はなかった。
実デバイスへの出力欠落はこの計測では判定できないため、Safari の聴感上の原因は未確定。
Menu の描画領域を背後のエディターから分離し、ぼかしの大きい影を軽減する。
キーボードによる Menu 操作は実行中の演奏処理へ渡さず、押していたキーの解放は維持する。

閉じた子メニューは CSS でも `display: none` にし、WebKit で内容の領域だけが残る空白を防ぐ。
Import / Export の展開状態は親 Menu の開閉で変更せず、再表示時も保持する。
FM 用出力しかない Export は、SNES など FM を持たない mode では親ごと非表示にする。

### VGM の Write / High 変換での周波数破損

Mega CD の「Backup Creation」で、Analyzer と Schedule は正常、Playground の Write / High は
音程が変わる問題を再現した。周波数の high と low の間に2〜3サンプルの待機があると、
チャンネル別 liveLoop の再開順によって別チャンネルの high が割り込み、共用ラッチを上書きする。
約0.85秒の CH1 は本来 BLOCK=3 / FNUM=1216 だが、BLOCK=4 / FNUM=704 になっていた。
Write は Hz 変換を通らず、High の3引数 `setFrequency()` も生の BLOCK/FNUM を使うため、
A4=440Hz の補正による変化ではない。

Write / High でも **Split by channel の指定を維持する**。high/low の間に待機や別トラックへの
依存がある場合は、元の順序で確定した high を low の直前に再設定し、別チャンネルのラッチを
拾わないようにする。元の書き込みと短い待機を残し、再設定の high だけを追加する。
生成コードではコメントを付けた直前の high/low の組を編集する。チャンネル間の待ち合わせは設けない。
先頭に high 未設定の low がある場合は、初回の0と次周以降の元データ末尾の high を区別する。
Note-ish の通常周波数は既に完全な high/low を一度に送るため、重複して再設定しない。
Schedule の生成方法は維持する。既に変換済みのコードは再取り込みが必要。

実ファイル全25.8秒の分割した Write / High 出力で、元のFM 2269書き込みと時刻を維持し、
114回の high 再設定だけを追加した。全424回の確定音程・PSG 1429書き込み・RF5C164 232書き込み・
2個のRAMブロックの内容と時刻が元データと一致した。global / CH1〜CH6 / PSG / RF の各ループは独立する。
Chromium / WebKit の実再生でも、分割したまま元の約0.85秒・1.65秒の2音が正常になることを確認した。
標準 YMFM の high はラッチ更新だけだが、Nuked の既存 WASM wrapper は書き込み時にも
内部クロックを進めるため、追加 high による PCM の完全一致までは保証しない。

### Mega CD mode

`mega-cd` は Genesis の YM2612・Sega PSG に RF5C164 を加えた環境にする。
表示名は `Mega CD` に統一する。実機の北米名は Sega CD。32X PWMは含めず、
音源タブは FM / PSG / RF5C164 のみを表示する。

`const pcm = await useSoundChip('rf5c164')` は組み込みの8音PCMを借用し、
モニターやミキサーと同じ音源を操作する。PCMをもう一台追加したい場合は
`createSoundChip('rf5c164')` を使う。借用した組み込み音源の寿命はRuntimeが管理し、
`dispose()` は公開しない。32X / 32X Nuked も同じ借用規則にする。
型宣言は FM / PSG / DAC の既存機能を保ち、追加のグローバル `pcm` は作らない。

初期コードはFMとPCMのベースを組み合わせる。専用examplesは、同じ波形RAMを8音で
異なる音程・左右位置に鳴らす例、FM / PSG / PCM の合奏、入力音声のサンプラーの3例。
サンプラーは `inputAudio({title})` からファイル選択またはマイク録音を開き、
キャンセル時は `null`、完了時は名前・入力種別・サンプルレート・Float32Arrayの各チャンネルを返す。
`pg.inputAudio()` とMain / Workerからも同じ契約を使う。

初期コードのPCMは、立ち上がり・減衰を波形に含む短いサンプルとする。
音符の終端で非ゼロのループ波形を切るクリックを避けるため、消音命令より前に自然減衰させる。
ループ波形のexampleは、高い再生stepでも終端を飛び越えない長さの終了マーカーを置く。

サンプラーは入力を短いモノラル素材に整えてRF5C164の64 KiB RAMへ載せ、
Keyboardの押下・解放で物理8チャンネルを割り当てて演奏する。
入力音を基準音から半音単位に再生速度で移調し、8音PCM、共有RAM、8bit相当の波形、
左右各4bitのパンといった音源の特徴を体験できるようにする。
録音素材は自動で音高を検出するものではなく、素材の基準となるキーを決めて演奏する。

### Game Boy / NES + FDS の音色情報と試奏

OPNの音源タブと同じ目的で、modeに一致する **Game Boy**／**NES + FDS** タブを用意する。
表示は各チップのチャンネル構成に合わせ、FM operatorの形へ合わせない。

- Game Boy：Pulse 1/2のDuty・Envelope・Sweep、Wave RAM 32点と出力レベル、Noiseのクロック・幅、Pan・Length・APU出力。
- NES + FDS：Pulse 1/2のDuty・Envelope・Sweep、TriangleのLinear/Length、Noise、DMCの素材情報・レート、FDSの64点波形・音量・変調。
- `Prepare audio` でコードをRunせずに標準音源を準備できる。タブを開いただけでは音源を作らない。
- `Hold to play`／`Release` で選択チャンネルを試聴し、`Use Keyboard` で既存Guitar形式のKeyboardへ接続する。
  Keyboardへ接続した後は、音色の画面とKeyboardを並べて操作できる。
- 試奏は選択チャンネルだけを一時的に使用する。コードの他チャンネルは継続し、解放後はコードの次の音から戻る。
  古い押下の解放や先読み済みの書き込みが、新しい試奏音を止めたり音程を変えたりしないよう所有者を区別する。
- 表示は適用済みレジスターを読むだけで、表示更新から再発音やパラメーター送信をしない。
  非表示時は読み取りを止め、フォーカス中の編集値は更新で上書きしない。
- Gateは最後に観測したレジスター操作の状態を表す。ハードウェア内部のEnvelope・Length終了や実音量の測定値ではない。
- DMCの試聴には、コードから読み込んだDPCM素材が必要。UI変更は実行中の音源へ適用する。
  Game Boyは設定をJavaScriptとして表示・コピーできる。コードやCassetteへ音色編集を自動反映するものではない。

## 今後整理する点

- mode ごとの音源構成、クロック、公開名、初期コードの対応表。
- mode 標準音源を `useSoundChip()` で指定した場合の再利用範囲。
  YM2608 のフル API や 32X の追加音源も踏まえ、既存コードとの互換性を保つ。
- 再読み込みを行わない mode 切り替えが必要か。
- 実行中に変更した音色や追加音源など、コード・ファイル以外の状態を保持する範囲。
- mode に対応した補完・型定義・ヘルプ・サンプルの提示方法。
- Main / Worker の両実行モードで、同じ音源構成と公開 API を使えること。

まずは mode ごとの環境を定義し、その上で既存 API の残し方を決める。
Genesis の使いやすさを保ちながら、他の機種にも、その機種に合った便利さを用意する。
