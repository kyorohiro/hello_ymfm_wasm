# C64 VBI・長いinitと対象限定再検証（2026-11-07）

PSID VBIをC64 machineの実VIC raster IRQから呼び出す経路を追加した。ブラウザーの既定はこちらとし、従来のDirect VBIも明示選択で残した。長いinitは開始時のPCMを保持して進め、Western Games全3subtunesを含む実ファイル7ケースが各10秒の検証を完走した。

今回のcorpus検証は**旧失敗3,233件とcontrol64件、計3,297件の対象限定再検証**。以前の61,157件すべてをC64経路で再実行した結果ではない。旧Direct VBIの[全体監査](sid_corpus_audit_01.md)とcheckpointは変更していない。

## 実装と実行条件

- UIの`PSID VBI playback`は`C64 machine · VIC / CIA`を既定とし、`Direct VBI · limited I/O`を比較用に選べる。共有parserのAPI defaultは従来互換の`direct`、C64 wrapper／UIは`c64`を選ぶ。strict参照CLIの制約は変えていない。
- C64 VBIはPAL／6581、VIC raster IRQ有効、CIA1 Timer Aは`$4025`でcounter稼働／IRQ無効から開始する。各init／play entryでbankを選び、play後にVIC／CIAをackする。曲が変更したtimer／raster／IRQ maskは保持する。
- 100k-cycle preflight後もinitが未復帰なら、bounded renderでPCMを保持して継続する。bootstrap開始から2M-cycleをdeadlineとし、play上限16kは維持した。UI候補はchunk間でyieldし、復帰確認後に採用する。実Workletはfresh loadからstartup PCMを再生する。
- driverは利用可能なalways-visible RAMへ配置する。`$FF/0`や空きpageなしは具体的理由で拒否し、VBI曲にはDirectを案内する。header／payload／speed bitの変更、隠れたfallback、宣言された空き領域外への配置は行わない。
- 新C64 VBI経路の未実装expansion I/O `$DE00..$DFFF`は明示拒否する。完全なC64／cartridge／disk互換の実装とは扱わない。
- 監査は既定subtuneのみ、2秒／48kHz／2workers、PAL／6581、minimal環境。unknown／either headerには明示targetを渡すが、既知NTSC／8580は拒否する。実ROMは読み込んでいない。

## 対象限定再検証

[実行summary](sid_c64_vbi_retry_01.json)と[独立比較18項目](sid_c64_vbi_retry_comparison_01.json)は成功した。

旧失敗3,233件の内訳はI/O2,831・bank53・ROM177・init timeout167・play timeout5。新経路で3,025件が完走した。

| 旧失敗3,233件の新結果 | 件数 |
| --- | ---: |
| 有限nonzero出力で完走 | 3,015 |
| 有限・全zero出力で完走 | 10 |
| ROM要求・アクセス | 195 |
| play timeout | 9 |
| init deadline | 3 |
| expansion I/O未対応 | 1 |

control64件はすべて従来の分類を維持した。VBIはnonzero24／全zero8、CIAとRSIDはそれぞれnonzero8／全zero8。CIA／RSID計32件はRMS／peakも完全一致した。VBIは実VIC schedulingへ変わるためPCM一致を要求せず、完走と従来のzero／nonzero分類を確認した。

全3,297件の合計はnonzero3,055・全zero34・ROM195・runtime failure12・unsupported1。完走3,089件すべてで96,000frames／有限PCM／Stop全zero・CPU停止状態不変を確認し、PSIDはinit復帰も必須とした。RMS／peakは最初の2秒だけから計算し、その後のinit復帰確認用`validationExtraFrames`は別に記録する。2M-cycle deadlineの3件を「初期無音の成功」として数えていない。

ROM分類はアクセスを観測した結果で、ROMを与えれば成功するという保証ではない。無音はその観測窓の測定結果であり故障判定ではなく、nonzeroも聴感や曲の正確さの証明ではない。

実行は約4.31分、3,297件完了・残0。resumeは全3,297件を再利用し、追加実行0、fingerprint／入力manifest／checkpoint／分類件数は不変だった。入力hash・元header・選択pathの一致、重複・欠落0も独立確認した。

| 再開記録 | SHA-256 |
| --- | --- |
| checkpoint | `5fa642e82f713fad34bbe5c3cf02ded0271881f020b963d7958eba3b86412c79` |
| 入力manifest | `4ffe0e8bdf9fd82c6c0225fae8017416eea11c604a0c1b53014dc32d07f28a82` |
| source／WASM／policy fingerprint | `48017fe357bae18fc4128281895bde629d33e037eb607aa04ee660f21ea664b7` |
| 選択path一覧 | `db124a8b7a08e651caab637183f0a2ba335657cf37a56524970594050eb1e0fc` |

JSONL／入力manifest／選択path／resume summaryは`release/sid-c64-vbi-retry-20261107/`へ保存した。元曲、実ROM、PCM payloadはコピー・同梱していない。

## 実ファイル・ブラウザー・配布検証

- [実ファイル検証](sid_c64_vbi_verification_01.json): Western Games subtunes1～3、Kayak、Icicle Works、Zyxのminimal／synthetic firmware、計7ケースが各10秒・有限nonzero PCM・init復帰・Stop成功。Western song1はC64経路で139,793cyclesのinitを完了した。以前のDirect hostによるscratch診断132,113cyclesとは実行環境が異なる。ユーザーの元`$1EE4`入力の同定は未確認として区別する。
- `npm run test:sid-player` **93件**、`npm run test:sid-corpus` **10件**、`npm run test:sid-reference` **29件**が成功。
- [Source browser](sid_c64_vbi_browser_01.json)／[実ZIP browser](sid_c64_vbi_zip_browser_01.json): Chromium／WebKit各31項目、sourceとZIPで**計124チェック成功**。C64／Direct切替、長いinit、Stop／late ACK、候補失敗時の旧音、ROM snapshotと混在subtune、1180／390px表示を確認した。physical outputはmuteで実聴とは別。
- [独立source kit再build](sid_c64_vbi_sourcekit_01.json): matching source29 inputsだけからWASMとreceiptを再生成し、公開コピーへbyte一致。C64 WASMは116,131bytes、SHA-256 `d05d625d863c434e6992a2b553019b4a261c00d484faeff7633bc357ac5b5c9c`。Direct VBI WASMとSID Synth／PlaygroundのDSP・gainは保持した。
- [配布proof](sid_c64_vbi_package_01.json): `release/tetorica_sid_player_0.0.7-c64-vbi-preview_itch.zip`、80files／10 readable browser modules／1,573,534bytes。SHA-256 `730c1c4d596506e96fba6cca40cbcc73c20d097f57a38c300697a9c6887ed895`。minify／bundleなし、68 original inputs・43 native inputs、source／license、outer・nested ZIP CRC、全80展開filesと現sourceのbyte一致を確認した。
- 固定runtime33 builds／68 outputs／75 mirrors、両Mixer policy check、native receiptsも成功。commit／push／tag／公開・npm更新は行っていない。

既知8580／NTSCは引き続き未対応。実Commodore ROM／BASIC互換、全subtune・全曲・長時間・実聴、D418 volume-DAC digiと実機忠実度はこの結果から判断しない。C64経路での全61,157件再監査は実施していない。
