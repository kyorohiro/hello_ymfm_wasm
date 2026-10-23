# Playground examples

FILES の `examples/` を開き、フォルダー内の `.js` を選択して Run を押す。
ファイルを選ぶとエディターと Run file の両方が切り替わる。
サンプルはプロジェクト内で編集でき、Cassette Export にも保存される。

各 mode は `../defaults/<mode ID>/index.js` を初期コードとして持つ。
初期の `/index.js` と `/examples/` は、選択した mode の API でそのまま実行できる構成にする。
Genesis（互換用の `genesis-nuked` を含む）は従来の豊富なサンプルを残し、
それ以外の mode は代表的なサンプルを2〜3個に絞る。
表示対象は `../playground_mode_examples.js` で定義する。このフォルダーには、
表示対象以外の独立音源・共通機能サンプルの原本も保持する。

mode を切り替えると、ダイアログでコードの扱いを選べる。

- **Start with initial code**：切り替え先の初期コードを `/index.js` に入れ、開くファイルと
  Run file も `/index.js` にする。編集済みの元の index は、重複しない `/index-<元 mode ID>.js` に退避する。
- **Keep current code**：初期コードを編集していなくても、現在のコード・開いているファイル・Run file を維持する。
- **Cancel**：mode を変更せず、再生や編集中の内容を維持する。Escape でもキャンセルできる。

使用中でない未編集の同梱 examples は切り替え先の組み合わせに整理する。
編集済みの examples、自作・移動済みのファイル、バイナリ、チェックポイントは保持する。
追加先にファイルやフォルダーがあれば上書きしない。下書きや Cassette の復元も、保存されたコードを自動で初期コードに置き換えない。

同じ mode の初期状態からやり直す場合は、**Menu → New Cassette** を使う。
確認ダイアログで作成を選ぶと、現在のプロジェクトをその mode の初期コード・ファイル構成に戻す。

以下は原本のフォルダー構成。FILES に最初から入るサンプルは mode ごとに異なる。

| Folder | 内容 |
| --- | --- |
| basic | グローバル fm・psg・dac と、liveLoop・context・FX・MIDI・noise・samples |
| chip-raw | 音源レジスタを直接操作する例 |
| genesis | 独立 Sega PSG・Mega CD PCM（RF5C164） |
| gameboy | Game Boy mode の標準 pulse、独立音源の wave・noise・複数音源の設定 |
| nes | NES APU の pulse・triangle・noise、FDS 波形と変調、DMC サンプル |
| snes | SNES mode の BRR サンプル、8ch の演奏とステレオ配置、独立 S-DSP の例 |
| pc98 | PC-98 OPN の FM・SSG、OPNA の FM・SSG・rhythm・ADPCM-B と、独立 YM2608 の例 |
| neogeo | Neo Geo / YM2610B mode の標準 FM・SSG tone/noise・ADPCM-A/B |
| x68000 | X68000 mode の標準 OPM・OKIM6258 ADPCM と、独立 YM2151 の FM |
| pc-engine | PC Engine mode の6ch Wave、ステレオ、Noise |
| dx7 | MSFA DX7 の16音発音、Object での音作りと SysEx 音色の読み込み |

FILES ではこの順に表示します。機種別のサンプルは各フォルダーに直接置きます。`basic/` 内の共通機能サンプルは機能別に分類しています。
`chip-raw` は直接レジスタを書く入口として残しています。
`basic/fm`・`basic/psg`・`basic/dac` は選択中の音源や Playground のグローバル API を使います。
機種別フォルダーには、その mode の標準音源や `useSoundChip()` / `createSoundChip()` で取得する独立音源の例を置きます。

`Game Boy` mode の初期コードは `../defaults/gameboy/index.js`。
`gameboy/gameboy-mode-pulse.js`・`gameboy-mode-wave.js`・`gameboy-sampler.js` を同梱します。
標準の `gameboy.pulse` を `beat()`・`liveLoop()` と組み合わせて鳴らします。
`gameboy.wave`・`gameboy.noise` も同じ APU を操作します。`pg.gameboy` と
`livePrepare(({gameboy}) => ...)` でも同じ音源を使えます。
Game Boy mode の演奏は音源ごとの API で行い、グローバルの `play()` は OPN mode の FM 用です。
`gameboy-saw-*.js` と `gameboy-synth.js` は独立音源を作る例です。

Mega-CD・Game Boy・PC-98・Neo Geo の `*-sampler.js` は、Sample Editor で録音／読み込みした
`/samples/sampler.sample.json` を Keyboard の楽器にします。Mega-CD は8音の RF5C164、
Game Boy は選択した1周期を32点・4 bitの wave RAM、PC-98 / Neo Geo は1音の ADPCM-B を使います。
ADPCM-B のループはサンプル全体の繰り返しです。

`NES + FDS` mode は `../defaults/nes/index.js` と、`nes-mode-pulse.js`・
`nes-mode-fds.js`・`nes-mode-rhythm.js` を使います。標準の `nes` は FDS を有効にしています。
`nes.pulse`・`triangle`・`noise`・`dmc`・`fds` を演奏できます。

`SNES` mode は `../defaults/snes/index.js` と、`snes-mode-brr.js`・`snes-mode-stereo.js` を使います。
標準の `snes` は CPU を使わない8音の S-DSP です。BRR の読み込みを `await` し、
`setPreset()` でサンプルを割り当てて `noteOn()` で演奏します。内部 PCM は 32,000 Hz 固定です。
SPC ファイル再生は、独立した `useSoundChip('spc')` の API を使います。

`X68000` mode は `../defaults/x68000/index.js` と、`x68000-mode-opm.js`・`x68000-mode-adpcm.js` を使います。
`opm` は4 MHz の YM2151、`adpcm` は8 MHz の OKIM6258 です。
ADPCM の例はコード内で PCM を作り、`await adpcm.loadSample()` で OKI ADPCM4 に変換します。
`adpcm.play()` / `stop()` は PC-98 の ADPCM-B 用 API と異なります。

`PC Engine` mode は `../defaults/pc-engine/index.js` と、`pce-mode-wave.js`・
`pce-mode-stereo.js`・`pce-mode-noise.js` を使います。
`pce` の0..5 の6ch に32個の 0..31 の波形値を設定し、`noteOn()` / `keyOff()` で演奏します。
Noise はチャンネル4・5で使えます。独立音源の作成名は `huc6280` です。

これらの mode と Game Boy は `pg`・`livePrepare()` にも同じ標準音源を公開します。
共通の `beat()`・`sleep()`・`liveLoop()` と組み合わせ、グローバルの `play()`・`fm`・
OPN の音程変換・FM 定数は使いません。`useSoundChip()` で標準音源を取得しても
同じ音源を再利用し、`createSoundChip()` では独立した追加音源を作ります。

`pc98/pc98-opn-ssg.js` は Mode を `PC-98 (YM2203 / OPN)` にして実行します。
標準の `fm` と `ssg` で、FM・SSG のトーン・ノイズ・エンベロープを順番に鳴らします。
SSG は3ch、音程計算にはマスタークロックの1/2を使います。

`pc98/pc98-opna-sections.js` は Mode を `PC-98 (YM2608 / OPNA)` にして実行します。
標準の `fm`・`ssg`・`rhythm`・`adpcm` で、同じ YM2608 の各機能を順番に鳴らします。
Main / Worker の両方で使え、ADPCM 用の音声もコード内で作るため外部ファイルは不要です。
他の `pc98/ym2608-*.js` は独立音源を使うため、どの mode でも実行できます。

`neogeo/neogeo-opnb-sections.js` は `Neo Geo` または `Neo Geo (YM2610B)` mode 用です。
同じチップの FM・SSG のトーンとノイズ・6音の ADPCM-A・ADPCM-B を順番に鳴らします。
ADPCM はコード内で作るテスト用の符号化済みパターンを使い、外部 ROM は不要です。
`adpcm` と `adpcmB` は同じ API です。A/B の `loadMemory()` は、それぞれに対応した
符号化済みデータを受け取り、WAV / PCM の直接読み込みは行いません。

`basic/fm/soundchip-tone-controls.js` は共通の音程・発音操作の例です。
`setFrequency(ch, hz)`、`setNote(ch, note)`、`keyOn(ch)`、`keyOff(ch)`、`noteOn(ch, note)` を使います。
音名やMIDI番号を渡すnoteOnと、Hzを渡すsetFrequencyは別の入口です。

`genesis/mixed-chip-stability.js` は独立した YM2612・RF5C164・DX7 を混ぜる40秒の反復曲です。
Genesis / Mega CD / 32X の examples から同じソースを開き、Web Audio / Native、Main / Worker を切り替えて比較できます。
素材はコードで生成する短いベース音と自作の音色だけです。Run 後の Keyboard は `scene-fm` の CH2–6 を演奏し、曲の CH1 と分かれています。
Mixer の `scene-fm` / `scene-pcm` / `scene-dx7` で各音源を Solo / Mute して確認できます。コード内の音量はこの曲の初期バランスで、共通初期値は変更しません。
長時間再生・メニュー操作・Keyboard・Stop 後の再 Run を実際に聴いて比較してください。録音や自動検査だけでは、出力機器でのノイズの有無を断定できません。

`nes/nes-pulse-frequency.js` は Hz 指定の例です。`nes.pulse.setFrequency(0, 440)`
で周波数を設定し、`keyOn(0)` / `keyOff(0)` でその音程の発音・停止を行います。
`noteOn(0, 'A4')` は音名または MIDI ノート番号を指定して発音する別の入口です。

`dx7/dx7-object-preset.js` は SysEx 不要の音作りです。`setPreset({...})`、
`setOperators([[op, params], ...])`、`setOperator(op, params)` を使い、OP1〜6 を設定します。
すべて `await` で適用完了を待ち、`await dx7.getPreset()` で現在の設定を取得できます。
`setPreset` の未指定項目は INIT SINE に戻り、`setOperator(s)` は部分更新です。
読み込んだバンクでは選択中の音色だけを更新し、他の音色は保持します。
FM 0.2.16 / DX7 0.3.0 では OP の outputLevel/mode/coarse/fine/detune と setFeedback が、同じ音色由来の
発音中の音（release を含む）にも反映されます。EG 形状・algorithm 等は次の Note On 用です。
setPreset/loadSysex で音色を置換すると以前の発音は別扱いになります。共有 LFO は
音色の選択・置換時には既存の声にも影響しますが、ライブ編集では変更しません。
`dx7-live-parameters.js` は、発音したまま拍／秒の tween で OP を変える例です。
DX7 の outputLevel は0..99で、大きいほど大きな音。EG の rates／levels も0..99の値で、秒数ではありません。

`dx7/dx7-init-sine.js` は、独立した16音の DX7 音源を使います。
`dx7.noteOn(60, 100)` は MIDI C4、velocity 100 です。チャンネル引数はありません。
初期音色は自作の `INIT SINE` なので、そのまま Run で演奏できます。
自分の `.syx` ファイルを FILES に読み込んだ場合は、次のようにバイナリーとして渡します。

```javascript
const dx7 = await useSoundChip('dx7');
await dx7.loadSysex(await file('/presets/my-bank.syx', {type:'arrayBuffer'}));
console.log(dx7.voices); // {index, name} の一覧
dx7.selectVoice(0);
dx7.noteOn(60, 100);
await beat(1);
dx7.noteOff(60);
```

`loadSysex()` の完了は音色が Worklet に適用された通知です。発音前に必ず `await` してください。
DX7 1 Voice / 32 Voice Bank の完全な SysEx に対応し、不正なデータでは既存音色を保持します。
`useSoundChip('dx7')` は同じ音源を再利用し、`createSoundChip('dx7', {id:'pad'})` は独立音源を作ります。
音量・mixer・FX に接続され、STOP で破棄されます。Main / Worker の両方で使えます。
`allNotesOff()` はリリース、`panic()` は即時消音です。同じノートの Note Off は同音の全声をリリースします。
上流の16音割り当てを保ち、16声を保持中の追加発音は無視します。独自のボイススティーリングはありません。
内部は44,100 Hz固定、出力は AudioContext の44,100 / 48,000 Hzに対応します。
48,000 Hzは出力側で線形補間します。`setClock` やサンプル精度の予約APIはありません。
msfa の AM・transpose 等の制約は [DX7 ライブラリの README](../../js/msfa_dx7/README.md) を参照してください。
外部の音色バンクは同梱していません。

`?ex=...` は廃止。`?src=...` によるコード共有は引き続き利用できる。
各サンプルの利用可能な音源・機能はコード内の API に依存する（DAC/PSG 等は YM2612 モード）。

## サンプルを追加・修正する場合

このフォルダーの JavaScript がサンプルの原本。サンプル名（拡張子を除くファイル名）は重複させない。
初期コードは `../defaults/<mode ID>/index.js` を編集し、同梱するサンプルを変える場合は
`../playground_mode_examples.js` も更新する。`../defaults/index.js` は旧初期コードの識別用に残す。

```sh
node scripts/build_playground_examples.mjs
node scripts/build_playground_examples.mjs --check
```

生成された `playground_examples.js` は、各 mode の初期コードとサンプルを実行せず文字列として配布するためのバンドル。
直接編集しない。itch.io パッケージ生成時にも更新する。
