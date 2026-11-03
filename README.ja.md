# Tetorica FM2612 — JavaScriptとWebAssemblyでレトロ音源を扱う

[English](README.md) | [日本語](README.ja.md) | [AI/SI](READMD.ai.md)

Tetoricaは、レトロゲームの音源を学び、調べ、音を作るためのサウンドチップ実験室です。
メガドライブのYM2612から始まり、再利用できるWASMコア、低レベルJavaScript／TypeScript API、
ライブコーディング、シンセサイザー、音楽ファイル解析へと広がっています。
ブラウザーツールで音源を調べ、同じ音声部品を自分のアプリやゲームへ組み込めます。

## プロジェクトの目標

このリポジトリーには4つの目標があります。

- YM2612チップを理解すること。
- 誰でもYM2612チップを理解できるドキュメントを作ること。
- ブラウザーアプリやゲームにYM2612の音声を組み込む方法を、誰でも理解できるドキュメントを作ること。
- 古いゲーム音楽や音源チップの技術を文化的な遺産として残すこと。保存・再生に加え、今の人たちが読み解き、調査し、学び、再構成できる形を目指します。

<a id="機能対応状況"></a>

## やりたいことから選ぶ

| やりたいこと | 入口 |
| --- | --- |
| インストールせずに試したい | [ブラウザー版ホーム](https://kyorohiro.github.io/hello_ymfm_wasm/index-ja.html) · [itch.io](https://kyorohiro.itch.io/) |
| ビルド済みWASMと低レベルJavaScriptが欲しい | [npmの`tetorica-fm2612`](https://www.npmjs.com/package/tetorica-fm2612) · [API一覧](packages/fm2612/README.md#api-entry-points) · [WASMとソースの配置](web/README.md) |
| 音源・音声再生・ライブコーディングを組み込みたい | [Synth／Transport API](packages/fm2612/README.md) · [Playground Runtime](web/README.md#playground-runtime) · [Web／Nodeの実行例](https://github.com/kyorohiro/tetorica-fm2612-examples) |
| 音楽ファイルを調べ、音色や楽譜を取り出したい | [VGM Analyzer](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html) · [`tetorica-vgm` CLI／Node API](packages/vgm/README.md) |
| C／C++コアを使い、NativeアプリやPluginを作りたい | [`tetorica-soundchip-native`](https://github.com/kyorohiro/tetorica-soundchip-native) · [SPU Pluginのソース／Preview](https://github.com/kyorohiro/tetorica-spu-plugin) |
| エディターに仮想ファイル・Shell・Gitを付けたい | [`tetorica-virtual-files`](packages/virtual-files/README.md) · [npm](https://www.npmjs.com/package/tetorica-virtual-files) |
| 実装範囲と制限を確認したい | [機能対応状況](docs/feature-status.md) · [Analyzer音源対応表](docs/vgm_analyzer/support.html) · [チップ別の記録](Memo.md) |

<a id="ブラウザーで試す"></a>
<a id="itchioで試す"></a>

## ブラウザーツール

| ツール | できること |
| --- | --- |
| [Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html) | JavaScriptライブコーディング、レジスター操作、音楽API、サンプル編集、FILES／Shell。音源modeを選んで使います。 |
| [FM2612 Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html) | FMオペレーター／エンベロープ編集、鍵盤試奏、VGM音色取込、TFI／VGI編集。 |
| [SPU Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-spu/index.html) | PlayStationのサンプル音源、PCMお絵描き、ADSR、PMON、Noise、SPU Reverb、PSF／VAB音色抽出。 |
| [SCSP Synth](https://kyorohiro.github.io/hello_ymfm_wasm/synth-scsp/index.html) | 実験的なSaturn PCM音源、波形描画／読込、エンベロープ、LFO。 |
| [VGM Analyzer](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html) | 再生、音源／チャンネルの観察、対応するサンプル／FM音色の抽出、参考採譜。 |
| [MIDI Playground](https://kyorohiro.github.io/tetorica-midi-playground/index.html) | 別プロジェクトのmacOS MIDIライブコーディングアプリ。[ソースと配布版](https://github.com/kyorohiro/tetorica-midi-playground)。 |
| [YM2612入門](https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index-ja.html) | JavaScriptを通じてFM合成とチップを学ぶ。 |

[Playgroundの画面](docs/tetorica_fm2612_playground_screen_shot.png) ·
[ブラウザー操作／SPC変換の詳細](docs/browser_workflows.ja.md) ·
[Runtime組み込みデモ](https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html)

## どんなゲーム機・形式に対応している？

対応範囲は、ゲームタイトルの一覧ではなく、**音源チップと入力形式**で管理しています。
このプロジェクトは音声のためのツールで、ゲームROMの実行やゲーム機全体のエミュレーションは行いません。
次は代表的な機種です。その機種のすべてのゲーム音楽や音色を復元できるという意味ではありません。

| 機種・音源系統 | 主な対象 |
| --- | --- |
| メガドライブ、メガCD、32X | YM2612＋Sega PSG、RF5C164 PCM、PWM。VGM解析と音源操作。CD-DAは独立した音声ソースです。 |
| PC-88／PC-98、Neo Geo | YM2203／YM2608／YM2610/B。FM、SSG、各音源のリズム／ADPCM。 |
| X68000、アーケードFM／PCM | YM2151、OKIM6258／OKIM6295、Sega PCM。VGMの併用構成には制限があります。 |
| Master System／Game Gear、MSX、AdLib／OPL | Sega PSG、AY8910、YM2413、Y8950、SCC／SCC+、OPL／OPL2／OPL3／OPL4。 |
| ファミコン／NES＋FDS、ゲームボーイ | APU音源の操作と、対応するVGMの再生／解析。リージョン・拡張の条件は音源ごとに異なります。 |
| PCエンジン／CD-ROM² | HuC6280、MSM5205 ADPCM、CD-DA API。対応するVGMの再生／解析。 |
| スーパーファミコン／SNES | SPCの曲再生、BRR音色、実験的な音程解析／編集可能なJavaScriptへの変換。 |
| PlayStation 1 | SPU音源の操作、PSF1／MiniPSFセットからのVAB静的抽出。**PSFの曲再生には未対応**です。 |
| セガサターン | 実験的なSCSP音源／レジスターAPI。**SSFの曲再生・68000実行には未対応**です。 |
| Atari 8-bit、WonderSwan | POKEYとWonderSwan音源。ファイル／解析の制限はAnalyzer対応表を参照してください。 |

| 入力 | 対応する使い方 |
| --- | --- |
| VGM／VGZ | Browser AnalyzerとCLIで再生／調査。チップ別に音色・サンプル・楽譜を出力。一部のPlayground modeでは編集可能なJavaScriptへ変換できます。 |
| S98 | 対応する単一Yamaha音源構成。圧縮S98・複数デバイスは対象外です。[入力仕様](CLI.md#s98-input-and-source-documents)を確認してください。 |
| SPC／BRR | SPCのCPU／DSP再生と解析、独立したBRR音色の作成。[変換仕様と制限](docs/browser_workflows.ja.md)。 |
| VAB、または対応するVH＋VB | Sony標準v6／v7のバンク。Playground／SPU SynthでToneを選び試奏できます。 |
| PSF1／MiniPSF＋PSFLib | ファイルまたはフォルダーを指定し、依存ライブラリーを解決して認識できるVABを静的抽出。ゲームドライバー実行・PSF2・すべての独自音色形式の復元には未対応です。[SPU取込ガイド](docs/synth-spu/README.md#ps1-sound-banks)。 |
| 音声・音色ファイル | PCM作成とチップ別のサンプル変換。TFI／VGI、OPM、SBI、DX7 SysExはそれぞれ取込／出力の対応範囲が異なります。 |

特定のVGMは`npx tetorica-vgm support song.vgz --json`で確認できます。
併用構成、外部ROMの要否、Exportの制限は[Analyzer対応表](docs/vgm_analyzer/support.html)を参照してください。
再生・音色編集・採譜は別の機能です。採譜は編集用の参考データで、原譜の復元ではありません。

## どんなSoundChipを使える？

| 系統 | 含まれるコア／API |
| --- | --- |
| Yamaha OPN | YM2203、YM2608、YM2610／YM2610B、YM2612、YM3438、YMF276、YMF288 |
| Yamaha OPM／OPP | YM2151／YM2164 |
| Yamaha OPLL／OPL | YM2413、YM3526、YM3812、Y8950、YMF262、YMF278B |
| PSG・波形メモリー・ゲーム機音源 | AY-3-8910／YM2149、Sega PSG、Game Boy APU、NES APU＋FDS、HuC6280、K051649／K052539、POKEY、WonderSwan |
| PCM／ADPCM | RF5C164、Sega PCM、OKIM6258、OKIM6295、MSM5205 |
| 独立した音源／プレイヤー | [PS1 SPU](docs/ps1_spu.md)、[Saturn SCSP](docs/scsp.md)、SNES S-DSP／SPC700、MSFA DX7 |

npmルートの`createSoundChip()`、Playgroundの`createSoundChip()`／`useSoundChip()`、
独立したクラス、高水準Synth APIは、入口と対応範囲が異なります。
例えばPS1とSCSPはnpmの専用subpathからimportします。Playgroundの音源名を、そのままnpmルートのfactoryへ渡せるわけではありません。
[用途別API一覧](packages/fm2612/README.md#api-entry-points)で選んでください。
YM2612の標準コアはymfmです。任意で使えるNuked-OPN2には別のライセンスが適用されます。

<a id="download"></a>
<a id="npmjs-package"></a>
<a id="tetorica-fm2612"></a>

## WASMと低レベルJavaScriptを入手する

```sh
npm install tetorica-fm2612
```

パッケージにはES modules、TypeScript型定義、ビルド済みの`generated/*_wasm.js`ローダーと
対応する`.wasm`、ソースアーカイブ、コンポーネントの通知を含みます。
ブラウザーとNode.jsで同じ直接PCM生成コアを使えます。Node.jsは22以降が必要です。

| 配布物・ソース | 場所 |
| --- | --- |
| npmのimportとアセットURL | [パッケージREADME](packages/fm2612/README.md)。`runtimeAssetUrl()`とWASMの独自ロード方法も記載。 |
| ソースcheckout | [JavaScriptソースの案内](web/README.md)、ビルド済みローダー／WASMの全一覧は[`web/generated/`](web/generated/)、Node音声は[`node/`](node/README.md)。 |
| 単独で使えるWeb Runtime ZIP | [生成手順とファイル名](README_RELEASE.md)。Runtime、生成済みアセット、通知を同梱します。 |
| C／C++と再現可能なWASMビルド | [Native SDK](https://github.com/kyorohiro/tetorica-soundchip-native)と[固定SDKのビルドガイド](docs/building_ym2612_wasm.md)。 |

## 使用例

低レベルAPIでYM2612のFM 1チャンネルを設定し、短いWAVをメモリー上に生成する例です。
直接レンダリングなのでスピーカーや音声デバイスは開きません。Node.js 22以降のES module、
またはnpm importを解決するブラウザー向けバンドラーで使えます。

```js
import {createSoundChip, encodeWav} from 'tetorica-fm2612';

const chip = await createSoundChip('ym2612');
try {
  chip.reset();
  for (const offset of [0, 4, 8, 12]) {
    chip.writeRegister(0x30 + offset, 0x01); // オペレーターの倍率。
    chip.writeRegister(0x40 + offset, offset === 12 ? 32 : 127);
    chip.writeRegister(0x50 + offset, 0x1f); // 速いAttack。
    chip.writeRegister(0x60 + offset, 0x00);
    chip.writeRegister(0x70 + offset, 0x00);
    chip.writeRegister(0x80 + offset, 0x0f);
  }
  chip.writeRegister(0xb0, 0x07); // Algorithm 7。1つのcarrierだけを鳴らす。
  chip.writeRegister(0xb4, 0xc0); // 左右へ出力。
  chip.writeRegister(0xa4, 0x24); // BLOCK／FNUM上位。およそA4。
  chip.writeRegister(0xa0, 0x3b); // FNUM下位。
  chip.writeRegister(0x28, 0xf0); // チャンネル1のKey On。
  const pcm = chip.generateStereo(4096);
  chip.writeRegister(0x28, 0x00); // Key Off。
  const wav = encodeWav({...pcm, sampleRate: chip.sampleRate()});
  console.log(wav.byteLength); // このバイト列を保存、またはPCMを自分の出力へ渡す。
} finally {
  chip.dispose();
}
```

音名やプリセットで操作する場合は各音源のSynthヘルパーを使います。ブラウザーで音を鳴らすには
ユーザー操作後にAudioWorklet Transportを開始します。Nodeの音声デバイス出力は任意のAudifyで扱います。
[Web／Nodeの実行用プロジェクト](https://github.com/kyorohiro/tetorica-fm2612-examples)、
[ローカルNode例](tetorica_examples/nodejs/README.md)、[Playgroundの例](docs/playground/examples/README.md)、
[パッケージのブラウザー／PCM例](packages/fm2612/README.md)も参照してください。

<a id="tetorica-vgm"></a>

ファイル解析とExportには`tetorica-vgm`をインストールするか、直接実行します。

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm render song.vgz --output song.wav
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
```

[CLI／Node APIリファレンス](CLI.md) · [音色Exportの例](docs/browser_workflows.ja.md#cliで音色と楽譜を出力する)

## 自分のプロジェクトで再利用する

レジスター／RAM／PCMなら低レベルチップ、音楽的な操作ならSynthヘルパー、音声出力ならTransport、
ライブコーディングならPlayground Runtimeと、必要な層だけを使えます。
npmの音声パッケージにはPlayground／Synthの編集画面全体は含まれません。
`tetorica-virtual-files`は、仮想ファイル／Shell／Gitを独立して使えるパッケージです。
Native SDKと[SPU DAW Plugin](https://github.com/kyorohiro/tetorica-spu-plugin)は、
C／C++への組み込み例を別プロジェクトとして提供します。デスクトップの対応環境はプロジェクトごとに異なります。

EmscriptenとPython 3を用意し、例えば`sh scripts/build_ym2612_wasm.sh`を実行するとソースからビルドできます。
レシピは`third_party/`の固定SDKを検証して使います。
[ビルド／SDK更新／分離したアセット検証の手順](docs/building_ym2612_wasm.md)。

## ライセンスとクレジット

独自ファイルとymfm由来のコンポーネントは、特記がない限り[BSD-3-Clause](LICENSE)です。
適用されるライセンスに従って改変・再利用できます。著作権表示を維持し、使用するコンポーネントが
求める通知やソースを配布物に含めてください。
全体が一律BSDではありません。SNES-SPCと任意のNuked-OPN2は**LGPL-2.1-or-later**、
MSFA DX7と関連するNESコンポーネントは**Apache-2.0**です。Sonic Piサンプルは**CC0-1.0**です。
ゲームROM、ゲーム音楽、PSFセット、市販音色バンクの利用許諾を、このプロジェクトが与えるものではありません。

[クレジットと実装参考資料の全文](docs/attribution.ja.md)に、上流の著作者、確認したリビジョン、
UIの着想、素材の由来を残しています。[コンポーネント別の通知](docs/licenses/)、
[DX7の通知](docs/licenses/tetorica-msfa-dx7-wasm/THIRD_PARTY_NOTICES.md)、
再配布するRuntimeに含まれるソース／ライセンスも確認してください。

<a id="リンク"></a>

## リポジトリーの構成と参考リンク

| ディレクトリー・資料 | 内容 |
| --- | --- |
| [`web/`](web/README.md) | JavaScript／TypeScriptの音源コア、Synthヘルパー、Transport、共有Runtime。 |
| [`docs/`](docs/index-ja.html) | 公開ツール、生成済みWASM、ガイド、使用例、ライセンス、詳細な設計記録。 |
| [`packages/`](packages/) | 音源、VGMツール、仮想ファイルのnpm manifest／README。 |
| [`node/`](node/README.md)、[`tetorica_examples/`](tetorica_examples/README.md) | Node用アダプターとTetorica独自のNode／Browser／C++実行例。 |
| [`src/`](src/)、[`examples/`](examples/README.md) | 元のディレクトリー配置を維持する、ymfm由来のコアと利用例。 |
| [`third_party/`](third_party/)、[`scripts/`](scripts/) | 固定した上流／SDKのソース、ビルド、パッケージ生成／検証スクリプト。 |
| [機能対応状況](docs/feature-status.md)、[Memo](Memo.md)、[CLI](CLI.md) | 実装範囲、チップの記録、解析APIの詳細。 |
| [リリース手順](README_RELEASE.md)、[itch.io ZIPの検証](docs/itch_web_release.md) | 開発者向けのビルド／配布手順。 |

ハードウェア・上流の参考資料：[ymfm](https://github.com/aaronsgiles/ymfm)、
[MAME](https://www.mamedev.org/)、[VGM仕様](https://vgmrips.net/wiki/VGM_Specification)、
[SMS Power!](https://www.smspower.org/)、[libymfm.wasm](https://github.com/h1romas4/libymfm.wasm)。
[参考リンクの全一覧](docs/attribution.ja.md#リンク)にはYM2612レジスター資料や関連プロジェクトも掲載しています。
