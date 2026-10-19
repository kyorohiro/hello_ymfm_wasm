# Playground Sound Chip Mode 案

## OPN 系の先行実装

まずは既存の OPN 系 runtime を使い、Menu の Mode で次の環境を選べるようにする。

| mode | ID | ベース音源 | マスタークロック |
| --- | --- | --- | --- |
| Genesis | `genesis` | YM2612 + Sega PSG / DAC | YM2612: 7,670,454 Hz |
| Genesis Full | `genesis-full` | Genesis + Mega-CD RF5C164 + 32X PWM | YM2612: 7,670,454 Hz |
| Genesis Full (Nuked) | `genesis-full-nuked` | Genesis Full の YM2612 を Nuked-OPN2 にする | YM2612: 7,670,454 Hz |
| PC-98 (YM2203 / OPN) | `pc98-26` | YM2203 FM 3ch + SSG 3ch | 4,000,000 Hz |
| PC-98 (YM2608 / OPNA) | `pc98` | YM2608 FM 6ch + SSG 3ch + Rhythm 6音 + ADPCM-B | 8,000,000 Hz |
| Neo Geo | `neogeo` | YM2610 FM 4ch + SSG 3ch + ADPCM-A 6音 + ADPCM-B | 8,000,000 Hz |
| Neo Geo (YM2610B) | `neogeo-b` | YM2610B FM 6ch + SSG 3ch + ADPCM-A 6音 + ADPCM-B | 8,000,000 Hz |

ここでの Hz は CPU や音声出力のサンプルレートではなく、音源のマスタークロック。
型定義、FM チャンネル定数、補完、音程計算を、選んだ環境に合わせる。
音源タブも mode に合わせ、Genesis は FM / Sega PSG、Full はさらに RF5C164 / 32X PWM、
PC-98 と Neo Geo は対象の FM タブを表示する。Code や下部の共通ツールは引き続き使える。
`useSoundChip()` で追加した音源によって、mode に含まれないタブを自動表示することはしない。
PC-98 (YM2203 / OPN) は `fm` と `ssg`、YM2608 / OPNA は `fm` に加えて `ssg`・`rhythm`・`adpcm` を標準で公開する。
これらは同じ YM2608 を操作する。Neo Geo / YM2610B では `ssg`・`adpcmA`・`adpcmB`
（`adpcm` は ADPCM-B の別名）を標準で公開する。現時点で標準公開していない機能は、既存の
`useSoundChip()` / `createSoundChip()` で追加して使える。

切り替え時は停止・音声の終了処理を行い、現在のコード、バイナリ、フォルダー、
開いているコードファイル、実行対象、Cassette メタデータを引き継いで再読み込みする。
プロジェクトは IndexedDB で受け渡し、保存に失敗した場合は画面を移動しない。
デスクトップの下書きは mode ごとに保存し、既存の下書きは対応する基本 mode で読み込める。

新しい URL は `?mode=pc98` などを使う。既存の `chip=` / `engine=nuked` は入力互換として
残す。明示された mode が優先する。通常の Nuked 版は、過去のリンク用の
`genesis-nuked` として維持する。`neogeo-b` は標準の選択候補とし、既存リンクも引き継ぐ。簡易表示は `layout=simple` とし、
従来の `mode=simple` も読み込める。

YM2608 の `useSoundChip()` は、SSG・Rhythm・ADPCM・Timeline を含む既存のフル API を
保つため、標準の YM2608 とは別インスタンスのままとする。標準 FM と共有する YM2612・YM2203・
YM2610 とは扱いが異なる。単純な FM への別名化でフル import を壊さない。

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

以下は全体の設計メモ。OPN 系以外の mode は今後の対象とする。

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

名称・ID・構成は案。PC-98 を OPN / OPNA、Neo Geo を YM2610 / YM2610B に分けた次の16候補を出発点とする。

| 表示名 | ID 案 | 標準音源・構成の案 | 補足・未決事項 |
| --- | --- | --- | --- |
| Genesis | `genesis` | YM2612 + Sega PSG、YM2612 DAC | 現在の使い勝手を引き継ぐ基本環境。 |
| Genesis Full | `genesis-full` | Genesis + Mega-CD RF5C164 + 32X PWM | OPN 系の先行実装で対応。 |
| Genesis Full (Nuked) | `genesis-full-nuked` | Genesis Full の YM2612 部分を Nuked-OPN2 にする構成 | エンジン選択を mode に含める案。Full の音源構成は通常版と揃える。 |
| Master System | `master-system` | Sega PSG を中心とした構成 | FM 拡張を標準構成に含めるかは別途決める。 |
| Game Gear | `game-gear` | Sega PSG を中心とした構成 | Master System との違い、ステレオ制御の扱いを整理する。 |
| NES × FDS | `nes-fds` | NES + FDS | FDS を含む環境として用意する。 |
| Game Boy | `gameboy` | Game Boy 音源 | FM を前提としない API・サンプルを用意する。 |
| SNES | `snes` | SNES 音源 | サンプル・音色の初期構成と SPC 再生の位置付けを整理する。 |
| PC-98 (OPN) | `pc98-26` | YM2203 | FM 3ch・SSG 3ch を標準公開。 |
| PC-98 (OPNA) | `pc98` | YM2608 | FM 6ch・SSG 3ch・Rhythm・ADPCM-B を標準公開。 |
| Neo Geo | `neogeo` | YM2610 | FM 4ch・SSG・ADPCM-A/B を標準公開。 |
| Neo Geo (YM2610B) | `neogeo-b` | YM2610B | FM 6ch・SSG・ADPCM-A/B を標準公開。 |
| X68000 | `x68000` | YM2151 + OKIM6258 を想定 | 各音源の Playground 接続を確認する。 |
| PC Engine | `pc-engine` | HuC6280 を想定 | Playground 側の接続・API を確認する。 |
| DX7 | `dx7` | DX7 音源 | DX7 向けの音色選択・編集・演奏を中心とした環境。 |
| Empty | `empty` | なし | 音源は `useSoundChip()` などで明示的に用意する。 |

低レベルのチップ対応と、Playground から使えること、mode として環境が整っている
ことは分けて確認する。特に HuC6280 と OKIM6258 は、現状の Playground runtime の
追加音源一覧に含まれていないため、mode 化にあたって接続経路の確認が必要。

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

現在の Nuked-OPN2 による YM2612 を、`Genesis Full (Nuked)` という mode として
用意する案。mode を選ぶだけで音源構成とエンジンが決まり、別途エンジンを
選択しなくても使い始められる。

- `Genesis Full` と `Genesis Full (Nuked)` は、公開 API と標準音源の構成を揃える。
- Nuked 版は YM2612 の実装を切り替える。PSG や追加の PCM 音源まで Nuked 実装に
  変わるという意味ではない。YM2612 の DAC も含め、既存コードとの動作を確認する。
- エンジンによる音の違いを選べる環境として扱う。
- 通常の `Genesis (Nuked)` は `genesis-nuked` として旧リンクとの互換性を維持する。
  標準の選択候補には Full の Nuked 版を載せる。

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
`play()` をすべての音源の共通 API に作り直すことや、必ず音源オブジェクト側へ
移すことは、現時点では決定していない。

各 mode について、以下を決める。

- グローバル `play()` を提供するか。提供する場合は、どの音源・チャンネルを鳴らすか。
- `write()` などの操作先をどう示すか。複数音源をまとめた mode でも曖昧にしない。
- FM がない mode では、FM / OPN 固有の API をどう扱うか。
- Empty mode では、発音先を必要とするグローバル API をどう扱うか。

例えば Genesis mode の `play()` は FM を鳴らす、という偏りを認めてよい。
一方、FM のない mode で、便利さのために見えない YM2612 を用意する必要はない。
追加音源を取得するだけの `useSoundChip()` 呼び出しで、既存のショートカットの
操作先が暗黙に切り替わらない方針を維持する。

## 今後整理する点

- mode ごとの音源構成、クロック、公開名、初期コードの対応表。
- mode 標準音源を `useSoundChip()` で指定した場合の再利用範囲。
  YM2608 のフル API や Full の追加音源も踏まえ、既存コードとの互換性を保つ。
- 再読み込みを行わない mode 切り替えが必要か。
- 実行中に変更した音色や追加音源など、コード・ファイル以外の状態を保持する範囲。
- mode に対応した補完・型定義・ヘルプ・サンプルの提示方法。
- Main / Worker の両実行モードで、同じ音源構成と公開 API を使えること。

まずは mode ごとの環境を定義し、その上で既存 API の残し方を決める。
Genesis の使いやすさを保ちながら、他の機種にも、その機種に合った便利さを用意する。
