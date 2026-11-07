# ローカルSID corpus監査 · 2026-11-07

`ww/C64Music`の **61,157ファイル**についてmetadata確認を終え、受理したファイルの既定subtuneを現行WASMで実行した。監査処理はexit 0、残り0件、実行時間は約21.6分だった。[集計JSON](sid_corpus_audit_01.json)と[実行・再開手順](../sid-corpus.md)を参照。

条件は **2秒・48 kHz・PAL／6581・ROMなし・2 workers**。不明／両対応のclock・modelは明示PAL／6581を選択し、既知NTSC／8580等は対応範囲どおり分類した。各ファイルはheaderの既定subtuneだけが対象で、他のsubtune・曲全体・実聴・実機精度は未検証。無音は観測結果として残した。

## 結果

| 分類 | ファイル数 | 意味 |
| --- | ---: | --- |
| `executed_nonzero` | 26,497 | 2秒の有限PCMに非zero値があり、Stop検証を通過 |
| `executed_silent` | 1,050 | 2秒の有限PCMが全zeroで、Stop検証を通過 |
| `unsupported` | 32,448 | headerまたは実行backendの未対応機能 |
| `needs_rom` | 906 | BASICのROM要求、または実行中のmapped ROMアクセス |
| `runtime_failed` | 256 | init／play上限またはCPU JAM/KIL |
| `invalid` | 0 | 入力不正としての拒否なし |
| **合計** | **61,157** | 全ファイルを分類、未処理0 |

metadata段階で29,932件を分類し、31,225件を実WASMへ渡した。観測窓とStopを完走した27,547件の内訳は次のとおり。

| backend | 非zero | 全zero | 観測完走計 |
| --- | ---: | ---: | ---: |
| PSID VBI | 21,474 | 84 | 21,558 |
| PSID CIA | 3,631 | 105 | 3,736 |
| RSID | 1,392 | 861 | 2,253 |
| **計** | **26,497** | **1,050** | **27,547** |

`executed_silent`は故障判定ではない。初期休符、意図的な無音、現行SIDで未再現のD418 digiなどをこの短い窓だけでは区別できない。ROMアクセスの記録も、ROMを与えれば必ず再生できるという判定ではない。

## 主な拒否・停止理由

各ファイルの**最初に該当した理由**を数えている。複数の制約を持つ曲もあるため、1機能の追加でその件数がそのまま改善するとは見積もらない。

| 理由 | 件数 |
| --- | ---: |
| 既知8580指定（PSID 23,729＋RSID 602） | 24,331 |
| 既知NTSC指定（PSID 2,643＋RSID 344） | 2,987 |
| VBI backendで実VIC／CIA／拡張I/Oへアクセス | 2,831 |
| PSID payloadが現行RAM範囲`$0800..$CFFF`外 | 1,407 |
| 実行中のmapped ROMアクセス（VBI 177＋C64 361） | 538 |
| RSID BASICのROM要求 | 368 |
| PSID play entryが元payload外 | 364 |
| PSID追加SID model flag | 345 |

実行停止256件は、init timeout 223件、play timeout 27件、CPU JAM/KIL 6件。100k init／16k playはhostの安全上限であり、timeoutだけでは不正なprogramと判断しない。詳細行には数値code、address、確認できたphaseを残した。

### `$1EE4`とWestern Games

`GAMES/S-Z/Western_Games.sid`の既定song 1が、報告されたものと同じ`$1EE4`のinit timeoutを再現した。[個別診断JSON](sid_western_games_diagnosis_01.json)を参照。ユーザーの元ファイルと同一だと確認されたわけではない。

独立したscratch診断では、8,192 bytesの正常なcopy処理が進み、initは **132,113 cycles**で戻った。その後、playが **実際の`STA $DC04`（CIA1 Timer A）**へ到達してbounded VBI backendのI/O制限で止まる。indexed storeの捨てreadではない。

次の対応は、init PCMを失わない長いbounded初期化と、VBI宣言を保ったC64機械での実行を分けて検証する。上限だけを増やす、speed bitをCIAへ書き換える、実I/Oを無視する対応では再生確認にならない。製品source／WASMと元SID bytesはこの診断で変更していない。

## 再現性と保存場所

- policy／source／WASM fingerprint: `a28f055ae6a9f6a6b726cfbeaa8ac066ab3cb9e0b6466da69b6e7903fd131513`
- VBI WASM SHA-256: `467a893714280a9830bb421dd255aac4ad7956fa8fd2895359a5e056cb98ab76`
- C64 WASM SHA-256: `ef6ae771513cea3ec2f6bd6af90c2074c96ac733c5466fdc165a0b5c3480dc4e`
- 全結果: `release/sid-corpus-audit-20261107/results.jsonl`（44,117,106 bytes）
- checkpoint SHA-256: `84b8778bdbd9f2512154d9998ba5c2b90198fc4bf005ee5e5c0f076005ee3325`
- 入力manifest: `results.jsonl.inputs.json`、論理manifest SHA-256 `218b879d7e2c96d286368f5149e20c3e0342f88551456e7c89e3b437b6349cf9`

監査source・worker・実行WASMは実行中に凍結した。全結果・入力manifestはrelease配下へ置き、docsには集計と診断だけを残す。曲・ROM・PCMのpayloadは同梱していない。

全件`--resume`も完了し、61,157件を再利用、追加0件、上記checkpoint／入力manifest／policy-source-WASM fingerprintと分類件数はすべて不変だった。resume集計は`release/sid-corpus-audit-20261107/resume-summary.json`。終了後のlock残留もない。

[独立検証JSON](sid_corpus_audit_verification_01.json)も`passed: true`。61,157行の連続index・pathの一意性、欠落／重複0、全入力manifestとの一致、source／WASM／集計hashを確認した。完走27,547行はすべて96,000 frames、有限RMS／peak、Stop全zero・CPU停止状態不変を満たし、完走行の測定条件違反は0だった。失敗したcoreのStop／render例外を、出力が鳴り続けたという測定結果へ読み替えてはいない。
