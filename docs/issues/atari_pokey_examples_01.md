# POKEY examples for the published npm package

Date: 2026-10-27

`w/tetorica-fm2612-examples` の依存を公開済み `tetorica-fm2612@0.2.31` へ更新し、次の3例を追加した。

| Example | 内容 |
| --- | --- |
| `pokey/tone/01-four-channels` | 4物理CHの矩形波・音名・音量・メロディ |
| `pokey/noise/01-distortion-joined` | distortion・poly9/poly17の比較、CH0+CH1の16-bit結合タイマー |
| `pokey/dual/01-eight-channels` | 2つの独立した4CHコアで合奏し、片方を止めても他方が演奏を続ける |

各例はREADME、編集して再実行できるWebページ、全コード、NodeのWAV出力を含む。
一覧・Runtimeガイド・manifestも更新し、`dist/` とGitHub Pages用の `docs/` を生成した。
既存の未commitだったWonderSwan追加分を維持し、既存のサンプルコードは変更していない。

## Audio and lifecycle

Webは共通factory → `PokeyWorkletTransport` → `PokeySynth`。
Playで音声を開始し、読み込み中/演奏中のStop、終了、エラー、ページ移動でリソースを解放する。
Nodeは直接生成したコアを `PokeyAudioEngine` で処理し、Synthの書き込みもengineを通す。
Webと同じunityの10 Hz DC blockerを使い、gain 0.25を一度だけ掛けた44,100 Hz stereo PCM16 WAVを保存する。
単体は1,789,790 Hz、dualの両コアは1,789,773 Hz。いずれもmonoを左右へ複製し、dualはホストで加算する。

noise比較はB4で行う。当初のA4はAUDF72、divider 2044 = 4×511となり、poly9を同じ位相で取り続けてDCになった。
DC blocker後に持続音が出ないことをWAV検査が検出したため、4種類とも比較が聞こえる共通の周期へ変更した。
結合中は下側をtimer helperとして消音し、上側CH1にだけ音程と発音を設定する。

## Verification

- 全33件のNodeサンプルとevent JSONが成功。
- 新3例は全フレーズの持続AC、mono、クリップなし、各消音区間と最後の4,410 framesの厳密なゼロを確認。dualは片側だけが演奏する区間も検査。
- 最終`docs/`をrepository subpathで配信し、Chromium 153.0.8010.12 / WebKit 26.6 × 3例の全6routeが成功。
- 実WASMと最終PCMを使い、4CH/8CH、noise各段階、結合timer bytes、量子化音程、音量0保持、Stop、エラー後・編集後の再実行、pagehide cleanupを確認。
- desktop3画面とmobile1画面で表示を確認。表示するだけではAudioContextを作らず、横方向のはみ出し・pageerror・404もない。
- `npm run dev` を一時起動し、HTML・catalog・公開runtime・WASMの5routeが元ファイルとbyte一致。確認用サーバーは終了済み。
- `docs/` と `dist/` は全1,120 fileがbyte一致し、Browserが読んだ73 assetも両方へ照合済み。
- 公開時に確認済みのtgzと、installed / docs vendor / dist vendorの各880 fileが全byte一致。開発中の本体packageをコピーしていない。

Node出力:

| Example | Frames | Peak | AC RMS |
| --- | ---: | ---: | ---: |
| tone | 145,530 | 0.079376 | 0.018999 |
| noise | 180,810 | 0.039734 | 0.017248 |
| dual | 145,530 | 0.122406 | 0.018506 |

検査では物理出力の直前で無音化し、PCMを測定した。今回の実聴・実機比較は行っていない。
詳細とhashは[同名JSON](atari_pokey_examples_01.json)に記録する。

```sh
cd w/tetorica-fm2612-examples
npm run dev
# 一覧の POKEY カテゴリから選んで Play

npm run check:node
npm run build
npm run check:pokey
npm run build:docs
```

commit/push、GitHub Pages公開、npm再公開は行っていない。
SDK 0.1.5は既存のlocal candidateのまま。次の候補はSDKのrelease文書整理と、公開後のconsumer provenance更新。
