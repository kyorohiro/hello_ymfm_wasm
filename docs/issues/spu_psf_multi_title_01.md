# PSF追加2作品の静的抽出・ブラウザ検証 — 2026-10-30

後続：[既知の本文誤対応候補の除外](spu_psf_body_guard_01.md)を実装・検証済み。以下は修正前の調査記録。

次の優先課題は、**VHとVBの対応付け、および誤候補の除外**。
現行抽出器が採用した候補はブラウザへ渡せたが、本文として読む領域に別の構造が見つかった。
今回の結果は「2作品の元音色を正しく復元できた」という対応実績には数えない。

## 全entryの調査

| 作品 | PSF関連files | entries | 候補あり | 候補なし | 処理エラー |
| --- | ---: | ---: | ---: | ---: | ---: |
| Wild Arms | 112 | 66 | 3 | 63 | 0 |
| Crash Bandicoot | 25 | 25 | 6 | 19 | 0 |

「候補あり」は現行の構造検証と`prepareVabTone`を少なくとも1 Toneが通ったentry数。
候補なしには、ヘッダーがあっても全Toneが拒否された場合を含む。
`playableTones`は読み込み前検証の成功数であり、元音色の復元成功数ではない。
拒否理由はENDなし、複数LOOP START、不正なpredictor／shift、非対応flagsなど。
依存不足などの処理エラーは今回の91 entriesでは発生しなかった。

詳細は[測定JSON](spu_psf_multi_title_01.json)。入力ファイル名・hash、entryごとのbank・Tone数と拒否理由、
PCM統計、ブラウザcheckerとruntimeのhashを保存した。ADPCM／PCM本文は含まない。

## 本文の対応に疑いがある観測

- Wild Armsの`206 Fallen into a Trap.psf`：VAB候補は`0x80152530`。
  想定するVB先頭`0x80153150`に、別の構造的に有効なVABヘッダー
  （32 programs／67 Tones／27 samples）がある。
- Crash Bandicootの`10 Bonus Round (Tawna).PSF`：VAB候補は`0x8010000c`。
  想定VBは`0x8010242c`から始まるが、最初の想定サンプル内の`0x8010502c`に`pQES`がある。
  コンテナー先頭のオフセット値20524もその位置を指す。コンテナー形式全体の解明は未完了。
- Wild Armsの採用4 Tonesは16または48 bytes、Crashの採用6 Tonesのうち5つは16または32 bytes。
  誤った本文中の早いENDを受理している可能性がある。短いという理由だけで一律拒否する方針ではない。

以上は連続配置を仮定した本文範囲に別構造が存在するという観測。
非連続のVH／VBを誤って対応付けている可能性があるが、正しいVB位置は今回まだ確定していない。
サイズ表の範囲検証や、一部Toneの読み込み成功だけでは対応付けの保証にならない。

## 発音経路の機械検証

各作品の代表entryは上記の2ファイル。最初に準備可能なToneを使用した。

| UI | 選択範囲 | ブラウザ経路 | 結果 |
| --- | --- | --- | --- |
| Playground | 各作品のPSF関連ファイル全体 | Chromium／WebKit × Main／Worker、2作品で8経路 | 成功 |
| SPU Synth | 代表entry＋同作品のlibrariesのみ | Chromium／WebKit、2作品で4経路 | 成功 |

既存checkerを変更せず実行。合成fixtureの回帰に加え、実候補のロード、有限・非ゼロPCM、Stopを確認した。
Synthでは選択UIのfocus後のPC鍵盤発音も検査した。
物理出力はmute。実聴と元音色との比較は行っていない。
これら12経路の成功はUIとDSPへの受け渡しの確認であり、音程・ループ・離鍵の忠実度を保証しない。

別途、採用された全10 Tonesを実WASMでnote 55、44.1 kHz、0.5秒レンダーした。
9 Tonesは非ゼロPCM、Crashの`23 Heavy Machinery.PSF`のTone index 14は最初の0.5秒がゼロ。
同Toneを2秒まで延長すると左右各87 samplesのみ非ゼロとなったため、完全な無音とは記録しない。
波形データを保存せず統計だけをJSONへ収録した。

## 再現と入力

入力配布ページ：[Wild Arms](https://www.zophar.net/music/playstation-psf/wild-arms)、
[Crash Bandicoot](https://www.zophar.net/music/playstation-psf/crash-bandicoot)。
取得archiveのSHA-256は測定JSON内。Wild Armsに含まれる16 XAはPSF走査対象外。
ゲーム由来の入力・展開データ・試奏用subsetは`/private/tmp`だけに置き、リポジトリ・配布ZIPへ入れていない。
一時領域が消えた場合は同じ入力を別途用意する必要がある。

```sh
node scripts/inspect_psf_banks.mjs /private/tmp/psf-wild-arms-validation --out /private/tmp/psf-wild-arms-report.json
node scripts/inspect_psf_banks.mjs /private/tmp/psf-crash-bandicoot-validation --out /private/tmp/psf-crash-bandicoot-report.json
node scripts/check_ps1_voice_editor_browser.cjs --psf-only --psf-set /private/tmp/psf-wild-arms-validation --psf-entry '206 Fallen into a Trap.psf' --out /private/tmp/psf-wild-arms-playground.json
node scripts/check_ps1_voice_editor_browser.cjs --psf-only --psf-set /private/tmp/psf-crash-bandicoot-validation --psf-entry '10 Bonus Round (Tawna).PSF' --out /private/tmp/psf-crash-bandicoot-playground.json
node scripts/check_spu_synth_browser.cjs --psf-only --psfFixture /private/tmp/psf-wild-arms-audition --out /private/tmp/psf-wild-arms-synth.json
node scripts/check_spu_synth_browser.cjs --psf-only --psfFixture /private/tmp/psf-crash-bandicoot-audition --out /private/tmp/psf-crash-bandicoot-synth.json
```

Synth用`wild-arms-audition`には代表PSFと46 libraries、`crash-bandicoot-audition`には代表PSFのみを
元ファイルと同じbyte列でコピーした。Synth checkerは最初のentryを選ぶため、このsubsetを使用した。

## 次の実装

1. 別VABヘッダー／SEQを本文として誤採用するケースを、ゲームデータを使わない合成fixtureで再現する。
2. 共通PSF抽出層で本文の根拠を検証し、曖昧な候補を診断へ回す。
3. 分離VH／VBの対応付けを調査し、根拠のある形式から対応する。
4. 改善後に全91 entriesと両UIを再検査し、正しい元音色との比較を行う。

ADPCM flagsの許容拡大だけでは本文の誤対応を解決できない。
今回、製品コード・校正gain・配布ZIPは変更していない。追加リリース・npm公開・commitは行っていない。
