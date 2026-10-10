# 実装メモ

[README (English)](README.md) | [README（日本語）](README.ja.md)

## 既存の参考資料

SN76489
https://www.smspower.org/Development/SN76489?from=Development.PSG

## チップ別の再生メモ

### MAME / libvgm OKIM6295（`third_party/mame-okim6295/`）

AnalyzerとCLIは、OKIM6295単体、またはYM2151 / YM2164 / YM3812との組み合わせでの再生に対応しています。JavaScriptのADPCMエンジンはBSD-3-ClauseのMAME / libvgmソースをもとにしています。[ソースに関する記録](third_party/mame-okim6295/README.md)と[ライセンス](third_party/mame-okim6295/LICENSE)を参照してください。サンプルはVGM内のROMから供給し、ゲームROMは同梱しません。

テスト：`node --test web/okim6295.test.mjs`。

### MAME OKIM6258（`third_party/mame-okim6258/`）

Analyzerは、OKIM6258の4-bit ADPCMを単体、または主音源エンジン（YM2151を含む）と混ぜて再生できます。VGMの直接書き込みとDACストリームからサンプルを供給するため、外部サンプルROMは不要です。デコーダーは、BSD-3-ClauseのBarry RodewaldによるMAME実装から移植しています。[ライセンス](third_party/mame-okim6258/LICENSE)と[固定したソース・移植に関する記録](third_party/mame-okim6258/README.md)を参照してください。Analyzerとランタイムexampleのパッケージでは、これらの通知を`licenses/mame-okim6258/`に含めています。

3-bit ADPCM、録音、2つ目のOKIM6258インスタンスには対応していません。非対応のヘッダー設定は再生エラーを表示し、2つ目のインスタンスへの書き込み・ストリームは警告してスキップします。ここで追加するのは再生機能で、OKIの音色解析やサンプルエクスポートではありません。検証には合成VGMと実際のWASMコアを使っています。実際の曲の試聴は未確認です。

ビルド：`sh scripts/build_okim6258_wasm.sh`。
テスト：`node --test web/okim6258.test.mjs`。

### AY-3-8910 / YM2149のVGM再生

VGM Analyzerは、固定したMAME実装の移植を使い、AY-3-8910とYM2149の単体再生、またはYM2413との組み合わせでの再生に対応しています。Operator InfoではAYのレジスター設定とトーンの音程を表示し、チャンネル単位・音源単位のミュートを操作できます。これらのチップの音色編集とMIDI / MMLエクスポートには、まだ対応していません。対応フラグと制約は[AYの実装に関する記録](third_party/mame-ay8910/README.md)を参照してください。

ビルド：`sh scripts/build_ay8910_wasm.sh`。

### YM2151 / YM2164のVGM再生

VGM AnalyzerはYM2151（OPM）とYM2164（OPP）に対応し、ステレオ出力と、任意のSega PSG / Sega PCMの組み合わせを再生できます。VGMのYM2151クロックフィールドのbit 31でYM2164を選択し、同梱したymfmのOPP実装を使います。Timer Bの周期はYM2151の2倍です。Note-ish、MIDI / MML、OPM音色抽出は、互換のあるレジスター構成を共有しています。仕様が公開されていないYM2164のレジスター`0x00–0x07`には、専用のエミュレーションを行いません。

AY / YM2149、YM2413、Y8950、SCC / SCC+とのMSX構成では、再生、チップ・チャンネルのミュート、Live / Song Note-ish、MIDI / MusicXML / LilyPondエクスポートに対応しています。混合構成では通常のシークを使い、OPM音色エクスポートとMMLは提供しません。2つ目のチップインスタンスには対応していません。その他の対応音源との組み合わせは、後述の汎用再生ミキサーを使います。

ビルド：`sh scripts/build_ym2151_wasm.sh`。

JavaScriptエンジンでは`ym2151Variant: 'ym2164'`、チップラッパーでは`variant: 'ym2164'`を指定できます。どちらも標準はYM2151です。

### OPL2 / OPL3のVGM再生

AnalyzerではYM3812とYMF262のVGM / VGZを再生でき、任意でSega PSGを組み合わせられます。OPL3は両方のレジスターポートに対応し、4本の出力バスをステレオにまとめます（A+Cを左、B+Dを右）。YMF262は基本音程のNote-ishとMusicXML / LilyPondの楽譜に対応していますが、音色編集は未対応です。

2つ目のチップとOPLのDACストリームには対応していません。その他の対応チップとの組み合わせでは汎用再生ミキサーを使います。Sound BlasterのPCM / DMAハードウェアをエミュレートする機能ではありません。

ビルド：`sh scripts/build_ym3812_wasm.sh`、`sh scripts/build_ymf262_wasm.sh`。

Y8950（MSX-Audio、FM + ADPCM）とYMF278B（OPL4 / Moonsound、FM + PCM）もVGM / VGZの再生に対応しています。YMF278Bは18チャンネルのFM基本音程Note-ish（Live / Song）に対応し、4OPペアは先頭側のチャンネルを使います。PCM音声、リズム、音色、モジュレーション、リリースは採譜に含みません。FMのSheet Music / MIDI / MusicXML / LilyPondエクスポートに対応しています。MIDIではチャンネルごとのピッチベンドを独立させるため複数ポートを使い、再生にも複数ポート対応のプレーヤーが必要です。PCM Sample Explorerの対応は計画中です。

サンプルデータはVGM内に埋め込めます（Y8950はブロック`0x88`、YMF278Bは`0x84` / `0x87`）。Sonycなど、内蔵サンプルを含まないMoonsoundのログでは、自分で用意した`yrw801.rom`（2 MiB）をファイル選択またはドラッグ＆ドロップで読み込み、Playを押してください。ROMは、同じページのセッション中の曲変更やシークでも保持します。波形ROMは同梱しません。

それぞれ任意のSega PSGに対応していますが、2つ目のチップとDACストリームは未対応です。その他の対応チップとの組み合わせは汎用再生ミキサーを使います。

ビルド：`sh scripts/build_y8950_wasm.sh`、`sh scripts/build_ymf278b_wasm.sh`。

YM3526（OPL）は、メロディー・リズム両モードと任意のSega PSGを含むVGM / VGZ再生に対応しています。サンプルROMは不要です。OPL2コアで代用せず、固定の正弦波形を持つ`ymfm::ym3526`を使います。2つ目のYM3526とDACストリームには対応せず、音色編集も未対応です。

YM3526、YM3812、単体のY8950は、9チャンネルの基本音程Note-ish、MIDI、MusicXML、LilyPondエクスポートに対応しています。リズムモードのCH7–9とCSMの区間は採譜から除外し、Y8950のADPCMも含めません。音色、モジュレーション、エンベロープのリリースは再構成しません。任意のSega PSGトーンはエクスポートに含めます。MSXの混合構成でも、基本音程のNote-ishと楽譜エクスポートに対応しています。

Operator Infoでは両オペレーター、フィードバック・接続、波形の状態を表示し、現在のレジスター状態をJSON音色スナップショットとしてエクスポートします。YM3526とY8950は固定の正弦波形を使い、YM3812は波形選択の有効ビットを反映します。このJSONはTFI / VGI音色ファイルでも、音声の再生状態の保存でもありません。

この再生経路を調べ、再構成するには次を参照してください。

- `web/ym2612vgm.js`がVGM 1.51以降の`0x54`のクロックを読み、`0x5B rr vv`をYM3526のレジスター書き込みイベントへ変換します。`0xAB`は未対応の2つ目のチップを表します。
- `web/vgmplayer.js`が書き込みを`web/ym3526audioengine.js`へ送り、VGMの待機区間でチップを進め、モノラル出力をリサンプルしてステレオバッファーへ変換します。
- `web/ym3526.js`は、`wasm/ym3526_wasm.cpp`を通じてレジスターの読み書き、IRQフック、サンプル生成を公開します。チップ本体の実装は`src/ymfm_opl.*`です。
- `sh scripts/build_ym3526_wasm.sh`で再ビルドできます（Emscriptenが必要）。生成するブラウザー用ファイルは`docs/generated/`に置き、`sh scripts/sync_web_js_to_docs.sh`でJavaScriptを同期します。
- `node --test web/opl.test.mjs`で、レジスター書き込みの到達、音声出力、リズムモード、タイマー、波形動作、リセット・シークの再現性を検証します。

### MSXの複数チップ再生

Analyzerは、AY-3-8910 / YM2149、YM2413、Y8950、SCC / SCC+、YM2151 / YM2164から、各系統1つずつを任意に組み合わせてミックスできます。埋め込みY8950 ADPCMも含みます。チップ・チャンネルのミュート、Live / Song Note-ish、基本音程のMIDI / MusicXML / LilyPondエクスポートを提供します。混合モードでは音色編集、音色エクスポート、MMLは提供せず、2つ目のインスタンスも未対応です。

OPL4との組み合わせは汎用再生ミキサーを使い、組み合わせ全体の音符解析は行いません。合成テストでは、OPMとOPPをそれぞれ他の4系統の全15通りの非空の組み合わせと混ぜ、再生、シーク、ミュートの経路を検証しています。

`web/multichipaudioengine.js`は、チップの種類とインスタンス番号でエンジンを登録します。各エンジンは、レジスター状態、サンプルメモリー、リサンプリング状態を独立して持ちます。パーサーの書き込み先は、そのインスタンスへレジスター書き込みとサンプルブロックを送ります。ミキサーは全エンジンを同じ時間だけ進め、出力を足し合わせ、マスター音量を1回だけ適用します。ミュート中のエンジンも進み続けます。`web/msxaudioengine.js`がMSXのチップアダプターを組み立てます。

プログラムから指定する`chips`オプションは、`{type, index, options}`という記述を受け付けます。そのため、レジストリーは同じ種類のチップを、状態を共有せず複数登録できます。ただし、デュアルチップ再生は**未検証**であり、AnalyzerのUIでは引き続き拒否します。

その他の対応チップの組み合わせは共有再生コアが自動で構成するため、チップの組ごとの許可リストは不要です。AY、YM2413、Y8950のDACストリームは未対応で、警告を表示してスキップし、その他の再生は続けます。

`node --test web/ay8910.test.mjs`では、独立したレンダリングとの比較による3チップのミックス、埋め込みADPCM、リセット・シークの再現性、曲間のサンプル消去を検証します。テスト素材は合成データであり、実際のゲーム曲の再生は未確認です。

### ヘッダーに基づく複数チップ再生

AnalyzerとCLIは、1つのVGMヘッダーに記載された対応チップ系統を組み合わせて再生できます。Genesis、MSXなどの既存の構成では、それぞれのモニターと操作機能を維持します。それ以外の組み合わせは、レジスター・サンプルメモリーの書き込み先を独立させた共通の44.1 kHzミキサーを使い、マスター音量を1回だけ適用します。GenesisのFM / PSG / RF5C164 / PWMは、共有するタイミングを保つため同じ構成にまとめます。

汎用経路では、再生、WAVエクスポート、チップ単位のミュート（Genesisはまとめて1つのミュート）を提供します。通常のシークを使い、組み合わせ全体のNote-ish・音色解析とシーク用チェックポイントは提供しません。チップ固有のROM要件、未対応コマンド、デュアルチップの制限も引き続き適用します。

新しいチップコアを追加する機能ではなく、すべての実際の曲の再生を保証するものでもありません。テストでは、対応する全エンジンアダプター、FMの合成結果の等価性、異なる出力サンプルレートの混合、ミュート、サンプルメモリーへの書き込み経路を検証しています。

### NES APU

AnalyzerとCLIは、単体のNTSC NES APU再生に対応しています。パルス、三角波、ノイズ、埋め込みDMCサンプルを再生し、5チャンネルのミュートと、パルス・三角波のNote-ish、MIDI、Music Sheetエクスポートを提供します。

FDSでは、モジュレーション・エンベロープ再生を持つウェーブテーブル1チャンネルを追加し、基本音程のNote-ish / MIDI / MusicXML / LilyPondに対応しています。FDSのモジュレーションとエンベロープのタイミングは採譜せず、アナログのミックス比率は近似です。PALとデュアルチップには未対応です。

共有JavaScript APUは、Apache-2.0の[JSNES](third_party/jsnes/README.md)を使い、npmとブラウザー向け配布に含めています。

### MAME HuC6280（`third_party/mame-huc6280/`）

AnalyzerとCLIは、単体のHuC6280（PC Engine / TurboGrafx-16）再生に対応しています。6チャンネルのウェーブテーブル、DDA、ノイズ、LFO、ステレオバランス、チャンネルごとのミュート、WAVエクスポートを提供します。VGMの`0xB9`書き込みとHuC6280のPCMストリームを、外部ROMなしで再生できます。

Note-ishのLive / Songでは、6チャンネルのウェーブテーブルの基本音程を表示し、PCM / DDA、ノイズ、LFOのCH1 / CH2区間では音符を終了します。MIDI、MusicXML、LilyPondのエクスポートも、その基本音程の区間を使います。MIDIは音程の変化をピッチベンドとして保持し、MusicXML / LilyPondは既存の16分音符グリッドを使います。音色編集とデュアルチップ再生は未対応です。ノイズ・LFOの精度には、MAMEの既知の制約が残ります。

コアは、Charles MacDonaldによるBSD-3-ClauseのMAME実装から移植しています。固定した元ソース、ライセンス、移植に関する記録は`third_party/mame-huc6280/`にあります。

再ビルド：`sh scripts/build_huc6280_wasm.sh`（Emscriptenが必要）。

K052539（SCC+）のVGM / VGZ再生は、共有のK051649コアを使い、独立した波形を持つ5チャンネルに対応しています。単体、またはMSXのAY / YM2413 / Y8950との組み合わせ、チャンネルごとのミュート、CLIでのWAV生成を利用できます。SCC / SCC+とMSXのAY / OPLL / Y8950の組み合わせでは、Live / Song Note-ish、Sheet Music、MIDI / MusicXML / LilyPondエクスポートに対応しています。

SCCの音程には`clock / (32 × (period + 1))`を使います。波形の倍音や波形の書き換えは採譜しません。一定値の波形、停止した周期、未対応のテスト用周波数モードは除外します。SCCのCH4 / 5は波形を共有し、SCC+ではポート4を使って5チャンネルすべての波形を独立させます。ADPCMとノイズは音程を持つ音符から除外します。

メロディートラックが15を超えるMIDIでは複数ポートを使うため、対応するプレーヤーが必要です。デュアルチップは未対応です。

## Chip playback notes (English)

### MAME / libvgm OKIM6295 (`third_party/mame-okim6295/`)

Analyzer and CLI playback support OKIM6295 alone or with YM2151 / YM2164 / YM3812.
The JavaScript ADPCM engine is adapted from BSD-3-Clause MAME/libvgm sources;
see [source notes](third_party/mame-okim6295/README.md) and
[license](third_party/mame-okim6295/LICENSE). Embedded VGM ROMs supply samples;
no game ROMs are bundled. Tests: `node --test web/okim6295.test.mjs`.

### MAME OKIM6258 (`third_party/mame-okim6258/`)

Analyzer playback includes OKIM6258 4-bit ADPCM, alone or mixed with the primary
engine (including YM2151). VGM direct writes and DAC streams supply sample data;
no external sample ROM is required. The decoder is adapted from Barry Rodewald's
MAME implementation under BSD-3-Clause. See the
[license](third_party/mame-okim6258/LICENSE) and
[pinned source and adaptation notes](third_party/mame-okim6258/README.md).
Analyzer and runtime example packages include these notices in
`licenses/mame-okim6258/`.

3-bit ADPCM, recording, and a second OKIM6258 instance are not implemented.
Unsupported header configurations report a playback error; second-instance
writes/streams are warned about and skipped. This adds playback, not OKI
instrument analysis or sample export. Verification uses synthetic VGM and
real WASM cores; real-track listening remains to be checked.

Build: `sh scripts/build_okim6258_wasm.sh`.
Test: `node --test web/okim6258.test.mjs`.

### AY-3-8910 / YM2149 VGM playback

The VGM Analyzer supports AY-3-8910 and YM2149 playback, standalone or with
YM2413, using a pinned MAME adaptation. Operator Info shows AY register settings
and tone pitch, with channel and source mute controls. Instrument editing and
MIDI/MML export for these chips are not yet available. See the
[AY implementation notes](third_party/mame-ay8910/README.md) for supported flags
and limitations. Build with `sh scripts/build_ay8910_wasm.sh`.

### YM2151 / YM2164 VGM playback

The VGM Analyzer supports YM2151 (OPM) and YM2164 (OPP), including stereo
output and optional Sega PSG / Sega PCM. YM2164 is selected by bit 31 of
the VGM YM2151 clock field and uses the bundled ymfm OPP variant, with a
Timer B period twice that of YM2151. Note-ish, MIDI/MML and OPM voice
extraction share the compatible register layout. Undocumented YM2164
registers 0x00–0x07 are not emulated specially.
MSX mixtures with AY / YM2149, YM2413, Y8950 and SCC / SCC+ support
playback, chip/channel mutes, Live / Song Note-ish and MIDI / MusicXML /
LilyPond export. Mixed configurations use normal seeking and do not expose
OPM voice exports or MML. A second chip instance remains unsupported. Other supported chip families use
the generic playback mixer described below.
Build with `sh scripts/build_ym2151_wasm.sh`.
The JavaScript engine accepts `ym2151Variant: 'ym2164'`; the chip wrapper
accepts `variant: 'ym2164'`. Both default to YM2151.

### OPL2 / OPL3 VGM playback

YM3812 and YMF262 VGM/VGZ files can be played in the Analyzer, with optional Sega
PSG. OPL3 supports both register ports; its four output buses are folded into
stereo (A+C left, B+D right). YMF262 supports base-pitch Note-ish and
MusicXML / LilyPond scores; instrument editing remains unavailable.
Second chips and OPL DAC streams are not supported. Other supported chip
combinations use the generic playback mixer.
This does not emulate Sound Blaster PCM/DMA hardware. Build with
`sh scripts/build_ym3812_wasm.sh` and `sh scripts/build_ymf262_wasm.sh`.

Y8950 (MSX-Audio, FM + ADPCM) and YMF278B (OPL4/Moonsound, FM + PCM)
are also supported for VGM/VGZ playback. YMF278B supports FM base-pitch
Note-ish (Live / Song) for 18 channels, including 4OP pairs using the leading
channel. PCM voices, rhythm, timbre, modulation and release are omitted;
FM Sheet Music / MIDI / MusicXML / LilyPond export is supported. MIDI uses
multiple ports for independent channel pitch bends; a multi-port player is required.
PCM Sample Explorer support is planned. Sample data can be embedded in the
VGM (blocks 0x88 for Y8950, 0x84/0x87 for YMF278B). For Moonsound logs such as
Sonyc that omit the built-in samples, import your `yrw801.rom` (2 MiB) through
the file selector or drag and drop, then press Play. The ROM remains loaded
for track changes and seeking in the current page session; no wave ROM is bundled. Each supports optional Sega PSG; second chips and DAC streams are not supported. Other supported chip
combinations use the generic playback mixer. Build with `sh scripts/build_y8950_wasm.sh`
and `sh scripts/build_ymf278b_wasm.sh`.

YM3526 (OPL) VGM/VGZ playback is supported, including melodic and rhythm modes,
with optional Sega PSG. No sample ROM is required. This uses `ymfm::ym3526`,
including its fixed sine waveform, rather than substituting the OPL2 core.
Second YM3526 chips and DAC streams remain unsupported;
instrument editing is not yet available.

YM3526, YM3812 and standalone Y8950 support nine-channel base-pitch Note-ish, MIDI, MusicXML
and LilyPond export. Rhythm-mode CH7–9 and CSM intervals are omitted from
transcription; Y8950 ADPCM is also omitted. Timbre, modulation and envelope
release are not reconstructed. Optional Sega PSG tones are included in exports.
Combined MSX configurations also support base-pitch Note-ish and score exports.
Operator Info displays both operators, feedback/connection and waveform state,
and exports the current register state as a JSON voice snapshot. YM3526 uses
a fixed sine waveform, as does Y8950; YM3812 respects the waveform-selection enable bit.
The JSON snapshot is not a TFI/VGI instrument or an audio-state save.

To inspect and reconstruct this playback path:

- `web/ym2612vgm.js` reads the VGM 1.51+ clock at `0x54` and decodes `0x5B rr vv`
  into a YM3526 register-write event. `0xAB` identifies the unsupported second chip.
- `web/vgmplayer.js` sends writes to `web/ym3526audioengine.js`, which advances
  the chip during VGM waits and resamples its mono output to stereo buffers.
- `web/ym3526.js` exposes register writes, reads, IRQ hooks and sample generation
  through `wasm/ym3526_wasm.cpp`; the chip implementation is in `src/ymfm_opl.*`.
- Rebuild with `sh scripts/build_ym3526_wasm.sh` (Emscripten required). Generated
  browser assets go to `docs/generated/`; sync JavaScript with
  `sh scripts/sync_web_js_to_docs.sh`.
- Run `node --test web/opl.test.mjs` to verify register delivery, audible output,
  rhythm mode, timers, waveform behavior and reproducible resets/seeks.

### MSX multi-chip playback

The Analyzer mixes any subset of AY-3-8910/YM2149, YM2413, Y8950,
SCC/SCC+ and YM2151/YM2164 (one of each family), including embedded Y8950
ADPCM. It provides chip/channel mutes, Live / Song Note-ish and base-pitch
MIDI / MusicXML / LilyPond exports. Mixed mode does not provide instrument
editing, voice export or MML. Second instances remain unsupported. OPL4
mixtures use the generic playback mixer, without combined note analysis. Synthetic tests cover OPM and OPP with all 15 subsets of the
other four families, including replay, seek and mute routing.

`web/multichipaudioengine.js` registers engines by chip type and instance index.
Each owns its register state, sample memory and resampling state. Parser targets
route writes and sample blocks to that instance; the mixer advances every engine
by the same duration, sums outputs and applies master volume once. Muted engines
continue advancing. `web/msxaudioengine.js` constructs the MSX chip adapters.

The programmatic `chips` option accepts descriptors `{type, index, options}`,
so the registry can represent repeated types without sharing chip state.
Dual-chip playback is **not verified** and is still rejected in the Analyzer UI.
Other supported chip combinations are assembled automatically by the shared
playback core; no pair-specific allowlist is required.
AY, YM2413 and Y8950 DAC streams remain unsupported; they are skipped with a visible warning while other playback continues.

Run `node --test web/ay8910.test.mjs` for three-chip mixing against independent
renders, embedded ADPCM, reset/seek repeatability and sample clearing between
songs. These fixtures are synthetic; real-game playback remains to be checked.

### Header-driven multi-chip playback

Analyzer and CLI playback can combine the supported chip families declared in
one VGM header. Existing Genesis, MSX and other established configurations keep
their monitors and controls. Other combinations use a common 44.1 kHz mixer,
with isolated register/sample-memory targets and master volume applied once.
Genesis FM / PSG / RF5C164 / PWM stay together to preserve their shared timing.

The generic path provides playback, WAV export and chip-level mute (one combined
Genesis mute). It uses normal seeking; combined Note-ish/voice analysis and seek
checkpoints are not available. Existing chip-specific ROM requirements, unsupported
commands and dual-chip restrictions still apply. This does not add new chip cores
or guarantee every real-world track. Tests cover all supported engine adapters,
FM sum equivalence, mixed output rates, muting and sample-memory routing.

### NES APU

Analyzer and CLI support standalone NTSC NES APU playback (pulse, triangle,
noise and embedded DMC samples), five channel mutes, and pulse/triangle
Note-ish, MIDI and Music Sheet export. FDS adds one wavetable channel with modulation/envelope playback and base-pitch
Note-ish / MIDI / MusicXML / LilyPond. FDS modulation and envelope timing are
not transcribed; analog mix balance is approximate. PAL/dual remain unsupported.
The shared JavaScript APU uses [JSNES](third_party/jsnes/README.md), licensed
under Apache-2.0; it is included in npm and Browser distributions.

### MAME HuC6280 (`third_party/mame-huc6280/`)

Analyzer and CLI playback support a single HuC6280 (PC Engine / TurboGrafx-16):
six wavetable channels, DDA, noise, LFO, stereo balance, per-channel mute, and
WAV export. VGM 0xB9 writes and HuC6280 PCM streams are supported without an
external ROM. Note-ish Live and Song views show six-channel wavetable base
pitches, closing notes during PCM/DDA, noise and LFO CH1/CH2 intervals.
MIDI, MusicXML and LilyPond export reuse those base-pitch intervals. MIDI keeps
pitch changes as bends; MusicXML/LilyPond use the existing sixteenth-note grid.
Instrument editing and dual-chip playback are not implemented. Noise/LFO accuracy retains MAME's known limitations.

The core is adapted from Charles MacDonald's BSD-3-Clause MAME implementation.
Pinned originals, license and adaptation notes are in `third_party/mame-huc6280/`.
Rebuild with `sh scripts/build_huc6280_wasm.sh` (Emscripten required).

K052539 (SCC+) VGM/VGZ playback uses the shared K051649 core, with five
independent waveform channels. Standalone and MSX AY/YM2413/Y8950 mixtures,
per-channel muting and CLI WAV rendering are supported. SCC/SCC+ and MSX
AY/OPLL/Y8950 mixtures support Live / Song Note-ish, Sheet Music and MIDI /
MusicXML / LilyPond export. SCC notes use clock / (32 × (period + 1)); waveform
harmonics and waveform rewriting are not transcribed. Constant waves, halted
periods and unsupported test frequency modes are omitted. SCC CH4/5 share
waveforms; SCC+ port 4 keeps all five independent. ADPCM/noise are excluded
from pitched notes. MIDI with more than 15 melodic tracks uses multiple ports;
a compatible player is required. Dual chips remain unsupported.
