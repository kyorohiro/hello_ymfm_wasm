# クレジットと実装参考資料

[開発者向けREADME](../README.ja.md) | [English](attribution.md)

コード表記のパスはリポジトリールートからの相対パスです。各コンポーネントの通知も参照してください。

## ライセンスとクレジット

特記がない限り、このリポジトリーでは、上流のymfmに由来する部分と本プロジェクトで追加した独自ファイルの両方にBSD 3-Clause Licenseを適用しています。同梱する第三者のコンポーネントと、その変更部分には、それぞれに適用されるライセンスを維持しています。

Aaron Gilesによる[ymfm](https://github.com/aaronsgiles/ymfm)を使用しています。また、kyorohiroによる独自の実装も、同じBSD 3-Clause Licenseで含めています。ライセンス本文は`LICENSE`にあり、配布用のリリースファイルにも`LICENSE`を含めています。

次のファイル・ディレクトリーはymfmに由来します。

- `src/ymfm*`（互換includeの`src/segapsg.*`と`src/chip_state.h`はTetorica独自の追加）
- [`examples/cpp/buildall/`](https://github.com/kyorohiro/hello_ymfm_wasm/tree/main/examples/cpp/buildall)と[`examples/cpp/vgmrender/`](https://github.com/kyorohiro/hello_ymfm_wasm/tree/main/examples/cpp/vgmrender)（他のTetorica利用例は独自の著作物。`em_inflate`はソース内の通知を維持）
- [GeneralInfo.md](https://github.com/aaronsgiles/ymfm/blob/main/GeneralInfo.md)

### Tetorica Sega PSG

独自のSega PSGコアは[third_party/tetorica_sega_psg](../third_party/tetorica_sega_psg/README.md)に分離し、
kyorohiro名義のBSD-3-Clauseライセンスを明記しています。upstream ymfmのファイルではありません。
[SMS Power!のSN76489資料](https://www.smspower.org/Development/SN76489)をハードウェア仕様の参考元として記載しています。
組み込み方法、由来の確認結果、固定SDKの既存配置を維持する方針は、同ディレクトリーのREADMEを参照してください。

### LilyPondエクスポート

VGM Analyzerは`.ly`ファイルをエクスポートします。楽譜プレビューにはMusicXMLを使います。LilyPondのWASMエンジンとプレビュー用ソースはAnalyzerから削除しており、Analyzer、Webランタイム、Webランタイムexampleのパッケージには含みません。

保存したLilyPond WASMの実験、Safari向けの修正、ビルド手順、デモは、別プロジェクトの[kyorohiro/lilypond-wasm](https://github.com/kyorohiro/lilypond-wasm/tree/master/wasm)で管理しています。LilyPondとそのWASM移植には**GPL-3.0-or-later**の成果物を含みます。別プロジェクト側で、それぞれのライセンスと第三者通知を維持しています。

### MusicXMLプレビューの試用ページ

独立した[MusicXML試用ページ](vgm_analyzer/osmd.html)では、OpenSheetMusicDisplay 2.1.2（BSD-3-Clause）とその依存ファイルを使っています。[クレジットとライセンス](vgm_analyzer/vendor/osmd/README.md)を参照してください。LilyPondの`.ly`エクスポートは引き続き利用でき、楽譜プレビューにはMusicXMLを使います。

ローカルで試すには、リポジトリーのルートから`python3 -m http.server 38088 --directory docs`を実行し、`http://localhost:38088/vgm_analyzer/osmd.html`を開きます。VGM / VGZファイルを選び、チャンネルとBPMを指定してPreviewを押してください。サンプル音符やMusicXMLのダウンロードも利用できます。

Analyzerの**Export Music Sheet**ボタンにも、BPM・チャンネルの選択、楽譜プレビュー、MusicXMLダウンロードを用意しています。ダイアログの構成はLilyPondと共通です。独立した試用ページも配布パッケージに含めています。

MIDIとMMLのダイアログでは、LilyPondと同じ推奨BPMを使います。同じ曲でダイアログを開き直した場合、手動で変更した値を保持します。

### 先行事例・実装参考：libymfm.wasm

ymfmなどの音源チップエミュレーションをWebAssemblyへ移植した先行プロジェクトとして、Hiromasa Tanaka（h1romas4）による[libymfm.wasm](https://github.com/h1romas4/libymfm.wasm)を挙げます。本プロジェクトのブラウザーでの音源チップ再生と重なる部分があり、実装を検討するうえで参考にしています。

OKIM6258対応では、[`chip_okim6258.rs`の`bb006894793c573b33a79a211e2769d021556aec`時点の実装](https://github.com/h1romas4/libymfm.wasm/blob/bb006894793c573b33a79a211e2769d021556aec/src/rust/sound/chip_okim6258.rs)を確認しました。このファイルは、Barry RodewaldによるMAME実装をHiromasa TanakaがRustへ移植したものと記載されています。基となるMAMEのリビジョンは`70743c6fb2602a5c2666c679b618706eabfca2ad`で、ライセンスはBSD-3-Clauseです。[確認したリビジョンのlibymfm.wasmライセンス](https://github.com/h1romas4/libymfm.wasm/blob/bb006894793c573b33a79a211e2769d021556aec/LICENSE)も参照してください。

本リポジトリーのC++ OKIM6258デコーダーは、固定したMAMEソースから直接移植しています。libymfm.wasmのRust移植は先行事例として確認したもので、ここにコピーしていません。

### FMエンベロープ編集UIの着想：mmlx-lsp

マウスで編集できるFMエンベロープUIは、h1romas4による[mmlx-lsp](https://github.com/h1romas4/mmlx-lsp)（[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=h1romas4.mmlx-lsp)）のFM Voice編集体験から着想を得ています。本リポジトリーのエンベロープエディターは、TetoricaのYM2612操作に合わせて独自に実装しています。

### MAME / libvgm OKIM6295（`third_party/mame-okim6295/`）

JavaScriptのOKIM6295 ADPCMエンジンは、BSD-3-ClauseのMAME / libvgmソースをもとにしています。[ソースに関する記録](../third_party/mame-okim6295/README.md)と[ライセンス](../third_party/mame-okim6295/LICENSE)を参照してください。ゲームROMは同梱しません。

### MAME OKIM6258（`third_party/mame-okim6258/`）

OKIM6258デコーダーは、BSD-3-ClauseのBarry RodewaldによるMAME実装から移植しています。[ライセンス](../third_party/mame-okim6258/LICENSE)と[固定したソース・移植に関する記録](../third_party/mame-okim6258/README.md)を参照してください。Analyzerとランタイムexampleのパッケージでは、これらの通知を`licenses/mame-okim6258/`に含めています。

### MAME RF5C164（`third_party/mame-rf5c164/`）

Mega-CD / Sega CDのVGM再生で使うRF5C164 PCMエンジンは、Olivier GalibertとAaron Gilesによる[MAMEのRF5C68 / RF5C164実装](https://github.com/mamedev/mame/blob/d0f1c15a0f6df2dd51a754cb46e6175b7079c8f2/src/devices/sound/rf5c68.cpp)から移植しています。移植したコアと、生成する`rf5c164_wasm.wasm`には**BSD 3-Clause License**を適用しています。[ライセンス](../third_party/mame-rf5c164/LICENSE)と[ソース・移植に関する記録](../third_party/mame-rf5c164/README.md)を参照してください。このエンジンを含むパッケージには、`licenses/mame-rf5c164/`にこれらの通知を収録しています。

### MAME HuC6280（`third_party/mame-huc6280/`）

HuC6280コアは、Charles MacDonaldによるBSD-3-ClauseのMAME実装から移植しています。固定した元ソース、ライセンス、移植に関する記録は`third_party/mame-huc6280/`にあります。

### Nuked-OPN2（`third_party/nuked-opn2/`）

`third_party/nuked-opn2/`には、Alexey Khokholov（Nuke.YKT）による[Nuked-OPN2](https://github.com/nukeykt/Nuked-OPN2)を、固定したフォークの[kyorohiro/Nuked-OPN2](https://github.com/kyorohiro/Nuked-OPN2)経由で同梱しています。これは**任意で切り替えられる実験的なYM2612エンジン**です。Playground、Synth、VGM Analyzerのページで`?engine=nuked`を指定すると、標準のymfmベースのエンジンから切り替えられます。

リポジトリーの他の部分とは異なり、`third_party/nuked-opn2/`と、そこから生成する`nuked_opn2_wasm.wasm`のライセンスは、BSD 3-Clauseではなく**GNU Lesser General Public License v2.1 or later**です。詳細は`third_party/nuked-opn2/LICENSE`、`third_party/nuked-opn2/README.md`を参照してください。配布用のリリース・組み込みビルド（`scripts/package_*.sh`）には含めないため、標準のymfmビルドだけを組み込む場合には影響しません。

### Sonic Piのサンプル音声（`docs/playground/samples/sonic-pi/`）

`docs/playground/samples/sonic-pi/`の音声ファイルは、[Sonic Pi](https://github.com/sonic-pi-net/sonic-pi)のサンプル音声を、Playgroundのサンプル再生や実験に使っているものです。Tetoricaのソースコードとは別の素材で、Sonic Piでは**CC0 1.0**と記載されています。上流の[ライセンス](https://github.com/sonic-pi-net/sonic-pi/blob/stable/LICENSE.md)、[サンプルの説明](https://github.com/sonic-pi-net/sonic-pi/blob/stable/etc/samples/README.md)、ローカルの[サンプルに関する記録](playground/samples/sonic-pi/README.md)を参照してください。

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
