# Tetorica FM2612 (hello_ymfm_wasm)

[English](README.md) | [日本語](README.ja.md) | [AI/SI](READMD.ai.md)

Tetoricaは、JavaScriptでメガドライブやゲームボーイなどのレトロゲームサウンドをライブコーディングするツールです。

このプロジェクトには、次の成果物が含まれます。

- `tetorica-fm2612`：レトロゲームの音源チップをJavaScriptから扱うnpmパッケージ
- `tetorica-vgm`：レトロゲームのVGMファイルを解析するnpmパッケージ
- VGMファイルから音色を取り出し、その場で試せるブラウザーシンセサイザーアプリ
- Sonic PiのAPIを参考に、ブラウザーでライブコーディングを試せるPlaygroundアプリ
- VGMファイルを解析・再生するブラウザー解析アプリ

![Tetorica FM2612 Playground](docs/tetorica_fm2612_playground_screen_shot.png)

[Tetorica FM2612 Playground](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)

## プロジェクトの目標

このリポジトリーには4つの目標があります。

- YM2612チップを理解すること。
- 誰でもYM2612チップを理解できるドキュメントを作ること。
- ブラウザーアプリやゲームにYM2612の音声を組み込む方法を、誰でも理解できるドキュメントを作ること。
- 古いゲーム音楽や音源チップの技術を文化的な遺産として残すこと。保存・再生に加え、今の人たちが読み解き、調査し、学び、再構成できる形を目指します。

## 機能対応状況

[機能対応状況 / Feature status](docs/feature-status.md)：Analyzer、CLI、Playgroundの実装範囲、検証記録、制約、リリース状況をまとめています。

チップごとの再生機能、制約、実装に関する詳しい記録は[Memo.md](Memo.md)を参照してください。

## ブラウザーで試す

公開ページでWebAssemblyビルド、JavaScriptラッパー、ブラウザーツールを直接試せます。ビルド環境を一式用意せずに、YM2612の操作、音色作り、Genesis / メガドライブ向けVGM解析を試すための入口です。

- メインページ：
  [https://kyorohiro.github.io/hello_ymfm_wasm/](https://kyorohiro.github.io/hello_ymfm_wasm/)
- JavaScriptで学ぶSega Genesis / メガドライブのYM2612 FM音源：
  [https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/introductions/index.html)
- Playground：
  [https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/playground/index.html)
- Playground Runtimeの組み込みデモ：
  [https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html](https://kyorohiro.github.io/hello_ymfm_wasm/demos/playground_runtime.html)
- Synth：
  [https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/synth/index.html)
- VGM Analyzer：
  [https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/index.html)

[VGM Analyzerの音源チップ対応状況と制約](https://kyorohiro.github.io/hello_ymfm_wasm/vgm_analyzer/support.html)


## npmjs package

### tetorica-fm2612

[`tetorica-fm2612`](https://www.npmjs.com/package/tetorica-fm2612)は、レトロゲームの音源チップをJavaScriptから操作するパッケージです。ブラウザーでの再生と、Node.jsでのPCM・WAV生成に使えます。

```sh
npm install tetorica-fm2612
```

主な対応チップ（抜粋）：

| 系統 | チップ |
| --- | --- |
| Yamaha OPN | YM2203、YM2608、YM2610 / YM2610B、YM2612 |
| Yamaha OPM | YM2151 |
| Yamaha OPL | YM2413、YM3812、YMF262 |
| PSG・ゲーム機音源 | AY8910、Sega PSG、Game Boy APU、NES APU + FDS、HuC6280 |
| PCM・ADPCM | RF5C164、Sega PCM、OKIM6258、OKIM6295 |

YM2612でド・レ・ミを鳴らすブラウザー向けの例です。npmのモジュールを読み込めるViteなどの環境で使い、表示されたボタンを押してください。

```js
import {createSoundChip} from 'tetorica-fm2612';
import {YM2612Synth, YM2612WorkletTransport} from 'tetorica-fm2612/ym2612synth.js';
import {FM_PRESETS} from 'tetorica-fm2612/megasynth-fm-presets.js';
import {hzToBlockFnum} from 'tetorica-fm2612/pitch.js';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const button = document.createElement('button');
button.textContent = 'ド・レ・ミ';
document.body.append(button);

button.addEventListener('click', async () => {
  button.disabled = true;
  let chip;
  try {
    chip = await createSoundChip('ym2612', {execution: 'worklet'});
    const transport = new YM2612WorkletTransport(chip);
    const fm = new YM2612Synth({transport});
    fm.setPreset(0, FM_PRESETS.sine);
    await transport.start();

    for (const hz of [261.63, 293.66, 329.63]) { // C4、D4、E4
      const {block, fnum} = hzToBlockFnum(hz);
      fm.noteOn(0, block, fnum);
      await wait(300);
      fm.noteOff(0);
      await wait(100);
    }
  } finally {
    await chip?.dispose();
    button.disabled = false;
  }
});
```

対応チップの全一覧とAPIの使い方は[パッケージのREADME](packages/fm2612/README.md)を、実行できるWeb / Nodeの例は[examples](https://github.com/kyorohiro/tetorica-fm2612-examples)を参照してください。高水準Synth APIの対応範囲はチップごとに異なります。

### tetorica-vgm

VGM Analyzerは、コマンドラインでの解析、エクスポート、WAV生成向けに[`tetorica-vgm` npmパッケージ](https://www.npmjs.com/package/tetorica-vgm)としても提供しています。Node.js 22以降が必要です。

```sh
npx tetorica-vgm analyze song.vgz --json
npx tetorica-vgm export song.vgz --format musicxml --output song.musicxml
npx tetorica-vgm render song.vgz --output song.wav
```

[CLIクイックスタート](packages/vgm/README.md)と[CLI / Node APIの詳細リファレンス](CLI.md)を参照してください。メンテナー向けの手順は[リリース手順](README_RELEASE.md)にまとめています。

OPL系のメロディー音色は、SBI（2opまたはOPL3の4op）として個別に、またはZIPにまとめてエクスポートできます。ブラウザーの**SBI Info**タブでは抽出した音色パラメーターを表示し、キーボードで試聴できます。

曲の1.5秒時点にあるチャンネル1の音色を取り出す例です（`--channel`は1から数えます）。

```sh
npx tetorica-vgm export song.vgz --format sbi --at 1.5 --channel 1 --output voice.sbi
```

曲全体からメロディー音色を抽出し、ZIPにまとめる例です。

```sh
npx tetorica-vgm export song.vgz --format sbi-zip --output voices.zip
```

## itch.ioで試す

- [https://kyorohiro.itch.io](https://kyorohiro.itch.io)

## ライセンスとクレジット

特記がない限り、このリポジトリーでは、上流のymfmに由来する部分と本プロジェクトで追加した独自ファイルの両方にBSD 3-Clause Licenseを適用しています。同梱する第三者のコンポーネントと、その変更部分には、それぞれに適用されるライセンスを維持しています。

Aaron Gilesによる[ymfm](https://github.com/aaronsgiles/ymfm)を使用しています。また、kyorohiroによる独自の実装も、同じBSD 3-Clause Licenseで含めています。ライセンス本文は`LICENSE`にあり、配布用のリリースファイルにも`LICENSE`を含めています。

次のファイル・ディレクトリーはymfmに由来します。

- `src/`（`src/segapsg.h`、`src/segapsg.cpp`を除く）
- `examples/`
- [GeneralInfo.md](https://github.com/aaronsgiles/ymfm/blob/main/GeneralInfo.md)

### LilyPondエクスポート

VGM Analyzerは`.ly`ファイルをエクスポートします。楽譜プレビューにはMusicXMLを使います。LilyPondのWASMエンジンとプレビュー用ソースはAnalyzerから削除しており、Analyzer、Webランタイム、Webランタイムexampleのパッケージには含みません。

保存したLilyPond WASMの実験、Safari向けの修正、ビルド手順、デモは、別プロジェクトの[kyorohiro/lilypond-wasm](https://github.com/kyorohiro/lilypond-wasm/tree/master/wasm)で管理しています。LilyPondとそのWASM移植には**GPL-3.0-or-later**の成果物を含みます。別プロジェクト側で、それぞれのライセンスと第三者通知を維持しています。

### MusicXMLプレビューの試用ページ

独立した[MusicXML試用ページ](docs/vgm_analyzer/osmd.html)では、OpenSheetMusicDisplay 2.1.2（BSD-3-Clause）とその依存ファイルを使っています。[クレジットとライセンス](docs/vgm_analyzer/vendor/osmd/README.md)を参照してください。LilyPondの`.ly`エクスポートは引き続き利用でき、楽譜プレビューにはMusicXMLを使います。

ローカルで試すには、リポジトリーのルートから`python3 -m http.server 38088 --directory docs`を実行し、`http://localhost:38088/vgm_analyzer/osmd.html`を開きます。VGM / VGZファイルを選び、チャンネルとBPMを指定してPreviewを押してください。サンプル音符やMusicXMLのダウンロードも利用できます。

Analyzerの**Export Music Sheet**ボタンにも、BPM・チャンネルの選択、楽譜プレビュー、MusicXMLダウンロードを用意しています。ダイアログの構成はLilyPondと共通です。独立した試用ページも配布パッケージに含めています。

MIDIとMMLのダイアログでは、LilyPondと同じ推奨BPMを使います。同じ曲でダイアログを開き直した場合、手動で変更した値を保持します。

### 先行事例・実装参考：libymfm.wasm

ymfmなどの音源チップエミュレーションをWebAssemblyへ移植した先行プロジェクトとして、Hiromasa Tanaka（h1romas4）による[libymfm.wasm](https://github.com/h1romas4/libymfm.wasm)を挙げます。本プロジェクトのブラウザーでの音源チップ再生と重なる部分があり、実装を検討するうえで参考にしています。

OKIM6258対応では、[`chip_okim6258.rs`の`bb006894793c573b33a79a211e2769d021556aec`時点の実装](https://github.com/h1romas4/libymfm.wasm/blob/bb006894793c573b33a79a211e2769d021556aec/src/rust/sound/chip_okim6258.rs)を確認しました。このファイルは、Barry RodewaldによるMAME実装をHiromasa TanakaがRustへ移植したものと記載されています。基となるMAMEのリビジョンは`70743c6fb2602a5c2666c679b618706eabfca2ad`で、ライセンスはBSD-3-Clauseです。[確認したリビジョンのlibymfm.wasmライセンス](https://github.com/h1romas4/libymfm.wasm/blob/bb006894793c573b33a79a211e2769d021556aec/LICENSE)も参照してください。

本リポジトリーのC++ OKIM6258デコーダーは、固定したMAMEソースから直接移植しています。libymfm.wasmのRust移植は先行事例として確認したもので、ここにコピーしていません。

### MAME / libvgm OKIM6295（`third_party/mame-okim6295/`）

JavaScriptのOKIM6295 ADPCMエンジンは、BSD-3-ClauseのMAME / libvgmソースをもとにしています。[ソースに関する記録](third_party/mame-okim6295/README.md)と[ライセンス](third_party/mame-okim6295/LICENSE)を参照してください。ゲームROMは同梱しません。

### MAME OKIM6258（`third_party/mame-okim6258/`）

OKIM6258デコーダーは、BSD-3-ClauseのBarry RodewaldによるMAME実装から移植しています。[ライセンス](third_party/mame-okim6258/LICENSE)と[固定したソース・移植に関する記録](third_party/mame-okim6258/README.md)を参照してください。Analyzerとランタイムexampleのパッケージでは、これらの通知を`licenses/mame-okim6258/`に含めています。

### MAME RF5C164（`third_party/mame-rf5c164/`）

Mega-CD / Sega CDのVGM再生で使うRF5C164 PCMエンジンは、Olivier GalibertとAaron Gilesによる[MAMEのRF5C68 / RF5C164実装](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/devices/sound/rf5c68.cpp)から移植しています。移植したコアと、生成する`rf5c164_wasm.wasm`には**BSD 3-Clause License**を適用しています。[ライセンス](third_party/mame-rf5c164/LICENSE)と[ソース・移植に関する記録](third_party/mame-rf5c164/README.md)を参照してください。このエンジンを含むパッケージには、`licenses/mame-rf5c164/`にこれらの通知を収録しています。

### MAME HuC6280（`third_party/mame-huc6280/`）

HuC6280コアは、Charles MacDonaldによるBSD-3-ClauseのMAME実装から移植しています。固定した元ソース、ライセンス、移植に関する記録は`third_party/mame-huc6280/`にあります。

### Nuked-OPN2（`third_party/nuked-opn2/`）

`third_party/nuked-opn2/`には、Alexey Khokholov（Nuke.YKT）による[Nuked-OPN2](https://github.com/nukeykt/Nuked-OPN2)を、固定したフォークの[kyorohiro/Nuked-OPN2](https://github.com/kyorohiro/Nuked-OPN2)経由で同梱しています。これは**任意で切り替えられる実験的なYM2612エンジン**です。Playground、Synth、VGM Analyzerのページで`?engine=nuked`を指定すると、標準のymfmベースのエンジンから切り替えられます。

リポジトリーの他の部分とは異なり、`third_party/nuked-opn2/`と、そこから生成する`nuked_opn2_wasm.wasm`のライセンスは、BSD 3-Clauseではなく**GNU Lesser General Public License v2.1 or later**です。詳細は`third_party/nuked-opn2/LICENSE`、`third_party/nuked-opn2/README.md`を参照してください。配布用のリリース・組み込みビルド（`scripts/package_*.sh`）には含めないため、標準のymfmビルドだけを組み込む場合には影響しません。

### Sonic Piのサンプル音声（`docs/playground/samples/sonic-pi/`）

`docs/playground/samples/sonic-pi/`の音声ファイルは、[Sonic Pi](https://github.com/sonic-pi-net/sonic-pi)のサンプル音声を、Playgroundのサンプル再生や実験に使っているものです。Tetoricaのソースコードとは別の素材で、Sonic Piでは**CC0 1.0**と記載されています。上流の[ライセンス](https://github.com/sonic-pi-net/sonic-pi/blob/stable/LICENSE.md)、[サンプルの説明](https://github.com/sonic-pi-net/sonic-pi/blob/stable/etc/samples/README.md)、ローカルの[サンプルに関する記録](docs/playground/samples/sonic-pi/README.md)を参照してください。

## リンク

- `ymfm`リポジトリー：
  - https://github.com/aaronsgiles/ymfm
- `Nuked-OPN2`（オリジナルと`third_party/nuked-opn2/`に同梱する固定フォーク）：
  - https://github.com/nukeykt/Nuked-OPN2
  - https://github.com/kyorohiro/Nuked-OPN2
- `MAME`：
  - https://www.mamedev.org/
- `retropc.net`：
  - http://retropc.net/cisc/m88/
- `ymfm`のサンプル：
  - https://github.com/aaronsgiles/ymfm/tree/main/examples
- `libymfm.wasm`：
  - https://github.com/h1romas4/libymfm.wasm
- YM2612のレジスターと動作に関する`ymfm`ソース：
  - `src/ymfm_opn.h`
  - `src/ymfm_opn.cpp`
- YM2612のピン情報：
  - http://www.chipdir.nl/pinusr/ym2612.txt
- YM2612の概要：
  - https://www.vgmpf.com/Wiki/index.php?title=YM2612
- Genesis開発の議論と実用的な情報：
  - https://gendev.spritesmind.net/forum/viewtopic.php?start=585&t=386
- YM2612の音楽投稿：
  - https://chipmusic.org/music#s=ym2612
- GENajam：
  - https://github.com/jamatarmusic/GENajam
- megatoy：
  - https://github.com/ulalume/megatoy
- Maple's Gardenの記事：
  - https://another.maple4ever.net/archives/3027/
- Aidan LawrenceのSega Genesis音楽プレーヤー：
  - https://www.aidanlawrence.com/hardware-sega-genesis-video-game-music-player/
- VGM仕様：
  - https://vgmrips.net/wiki/VGM_Specification
- SMS Power：
  - https://www.smspower.org/
