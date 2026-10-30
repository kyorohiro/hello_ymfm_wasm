# PSFの本文誤対応候補を除外 — 2026-10-30

[追加2作品の調査](spu_psf_multi_title_01.md)で見つかった誤候補に、共通抽出層で対策した。
想定するVB領域に別の構造がある場合、偶然準備できるToneがあってもそのVAB候補を採用しない。
Playground・SPU Synthの両方で、除外理由と衝突アドレスを表示する。
分離VH／VBの正しい対応付けを新たに実装したものではない。

## 変更

- 全VAB候補の表・サイズ・ロード済みヘッダーを先に検証し、別ヘッダーの位置を集める。
  そのヘッダー自身に対応Toneがない場合や、本文が未ロードの場合も、外側の候補との衝突を判定する。
- 想定VB内の有効なVABヘッダーは`ambiguous-vab-body`として除外。
- 想定VB内のSEQ v1ヘッダーは、バージョン・resolution・tempo・rhythmを確認した上で
  `ambiguous-seq-body`として除外。Crashで観測したrhythm両byteが0の場合も扱う。
  SEQの形式確認には[PSX-SPXのSEQ記述](https://psx-spx.consoledev.net/cdromfileformats/#seq-single-sequence)を参照。
- 識別子だけの一致、無効な表・タイミング値、bank外のSEQでは候補を除外しない。
  正常な16-byteサンプルも受理する。最初のEND以降にある構造も衝突検査の対象。
- CLIは各entryへ`diagnostics`（address／code／reason／任意のconflictAddress）を追加。
  両UIは先頭3理由まで表示。候補がなくなった場合は以前のbankを保持する。
  別の有効なbankが見つかった場合は一覧へ表示するが、明示的なToneロードまで演奏中の音色を変えない。

これは保守的な曖昧候補の除外。SEQイベント全体の解析や、全誤検出の排除を保証しない。
通常の本文に偶然これらのヘッダー構造が入っていても、曖昧として除外し得る。
手動で指定するVAB／VH＋VBの読み込み条件、SPU DSP、音量gainは変更していない。

## 同一入力での再検査

| 作品 | entries | 修正前の候補ありentry | 修正後 | 処理エラー |
| --- | ---: | ---: | ---: | ---: |
| Wild Arms | 66 | 3 | 1 | 0 |
| Crash Bandicoot | 25 | 6 | 0 | 0 |
| Clock Tower | 20 | 20 | 20 | 0 |

Wild Armsは61 entryにVABヘッダー衝突、Crashは全25 entryにSEQヘッダー衝突の診断を記録した。
衝突診断には以前から全Toneが拒否されていた候補も含むため、候補ありentryの減少数とは一致しない。
Wild Armsの残る`223 Run, Spirit.psf`は、今回の衝突条件に該当しない候補。
元音色との一致は未確認で、正しい音色の復元成功とは扱わない。
Clock Towerは全入力hashと20 entryのbank／Tone集計が前回と完全一致した。

[測定・入力hash・ブラウザ結果JSON](spu_psf_body_guard_01.json)。ゲーム由来ADPCM／PCM本文は保存していない。
既存の調査JSONを上書きせず、新しい記録へ保存した。

## 検証

- Node 128 tests成功：共通PSFパーサー14、CLI 8、Playgroundパネル、Synth全unit、Synth包装テスト。
- 合成fixtureでVAB／SEQ混在を再現し、修正前の失敗と修正後の成功を確認。
  無効識別子・短い正常サンプル・衝突する内側ヘッダーの未ロード本文／非対応Toneも検査。
- Playground：Chromium／WebKit × Main／Workerの4経路成功。
- SPU Synth：Chromium／WebKitの2経路成功。
  両UIで混在理由の表示、抽出時に現在の音色を変更しないことを確認。
  Synthは保持中のnoteも継続。従来の合成PSF／MiniPSF、folder、focus、preset等の回帰と、
  Clock Towerの代表Toneロード・実AudioWorklet PCMも成功。
- 物理出力はmute。人の耳での試聴は未実施。

```sh
node --test docs/playground/playground_ps1_psf.test.mjs docs/playground/playground_ps1_voice_panel.test.mjs docs/synth-spu/*.test.mjs scripts/inspect_psf_banks.test.mjs scripts/package_itch_spu_synth.test.mjs
node scripts/inspect_psf_banks.mjs /private/tmp/psf-wild-arms-validation --out /private/tmp/psf-wild-arms-guard-report.json
node scripts/inspect_psf_banks.mjs /private/tmp/psf-crash-bandicoot-validation --out /private/tmp/psf-crash-bandicoot-guard-report.json
node scripts/inspect_psf_banks.mjs /private/tmp/psf-clock-tower-validation --out /private/tmp/psf-clock-tower-guard-report.json
node scripts/check_ps1_voice_editor_browser.cjs --psf-only --psf-set /private/tmp/psf-clock-tower-validation --psf-entry 01-BOBBY_A.psf --out /private/tmp/spu-psf-guard-playground.json
node scripts/check_spu_synth_browser.cjs --psf-only --psfFixture /private/tmp/psf-clock-tower-validation --out /private/tmp/spu-psf-guard-synth.json
```

## 区切りと残作業

誤候補の再現・既知パターンの除外・理由表示・回帰確認まで完了。
PSの機能追加はいったん区切れる。分離VH／VBの自動対応付け、独自形式、忠実度確認は後続に残す。
今回の変更はソースのみ。配布ZIP作成・校正の再測定・公開・npm公開・commitは行っていない。
公開済みPlaygroundへ反映する際は、新しい配布候補で通常の包装・校正・ブラウザ検証を行う。
