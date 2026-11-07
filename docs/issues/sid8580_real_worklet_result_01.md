# 8580代表実曲のAudioWorklet検証（2026-11-08）

研究用[`/sid8580-lab/`](../sid8580-lab/index.html)で、ユーザーの`ww/C64Music`にある3曲・6subtuneケースをChromium／WebKitで各30秒確認した。**全12ケースが有限・非zero出力で完走し、3曲×2engineの停止／再開・失敗候補時の旧再生保持も成功**した。

これは研究用Labの限定した実行検証であり、通常SID Player／Synthの8580対応や、実聴による音質・音切れの確認ではない。今回、製品UI・DSP・WASMは変更していない。

## 実行前の選定

[固定plan](sid8580_worklet_cases_plan_01.json)を実行前に生成し、metadata-onlyで61,157件を確認した。各分類で複数subtuneを優先し、構造検証に通るpathの辞書順先頭を選んだ。元の宣言がPAL／8580・single SID・version 2であるものに限り、headerや曲データは変更していない。実行結果を見た成功曲への差し替えもない。

| 分類 | `ww/C64Music`からの相対path | subtune |
| --- | --- | --- |
| PSID VBI | `DEMOS/A-F/Bach4Xmas.sid` | 1、2 |
| PSID CIA | `GAMES/M-R/Mastermind.sid` | 1、2 |
| RSID | `MUSICIANS/F/Fanta/Desert_Dream.sid` | 4（既定）、1 |

全caseは元のPAL／8580宣言を保持し、minimal環境・研究用resonance／cutoff補正は両方Off。ROMは使用していない。Planは曲のSHA-256、元header、選定規則と選定script／parserのhashを記録している。構造上の受理は、曲全体の互換やROM不要性の証明ではない。

## 観測範囲と結果

[実行report](sid8580_real_worklet_01.json)は全caseの開始・終了状態、scalar PCM集計、約1秒間隔の経過、処理時間とcontext所有権を保存する。曲・PCM・ROMのbytesは保存・配布していない。[独立確認](sid8580_real_worklet_verification_01.json)も参照。

- 各engineは44,100Hz。各caseで**1,323,000 frames＝正確に30秒**の連続したproducer生出力を確認した。計15,876,000 mono framesで、非有限値・左右不一致・channel欠落は0。物理出力はgain0で、人の実聴ではない。
- 元の`processor.js`は変更せず、検証HTTP応答だけに観測用subclassを追加した。元の`process()`と時間計測を実行した後、全出力frameを読み取り集計する。renderを置換せず、chip-cycleごとのJS callbackも追加しない。生出力はMasterより前、post-Masterは別のanalyserで標本観測した。
- PCM集計は正確に30秒で止まる。終了時のCPU・処理時間指標は最後の128-frameブロック全体を含むため、各caseの指標差は1,323,008frames（8frames追加）／10,336blocks。開始時の保持init PCMがあるため、CPU cycle差がちょうど30秒になるとは扱っていない。
- CPU／SID cycleの一致、VBI／CIA／RSIDの実行経路、選択subtune、profile Off、実WASM関数の直接接続を確認した。2つのsubtuneを実際に選び直し、採用後は旧contextが閉じ、Play前に自動発音しないことも確認した。
- 再生中に不正な3-byte fileを候補として読み込ませ、同じWorklet／context・title・subtuneを保持してCPUが進むことを確認した。その後Stopで全contextが閉じ、再Playで新しいnode・先頭からの位置へ戻ることを確認。6組すべて成功した。
- JavaScript error・HTTP失敗・外部requestは0。最後は全contextがclosed。
- capture境界のWASM linear memory容量はmachine 4,194,304bytes／endpoint 1,179,648bytesで全case不変。これは確保済み容量の観測であり、allocation使用量・JS heap・長時間のmemory leak判定ではない。

## 処理時間の留意点

128frames／44.1kHzの予算は約2.902ms。既存timerは粗い`Date.now`で、renderの平均・回数はcapture開始／終了の差、最大値はinstance通算。loadは別計測。追加の観測処理は元のcore-render timerの外にあるが、実行負荷には加わる。

| engine | case平均core-render時間の範囲 | instance最大 | capture内の予算超過 | load |
| --- | --- | --- | --- | --- |
| Chromium 153.0.8010.12 | 約0.56～0.61ms | 3ms | 1／62,016blocks（約0.0016%） | 9～11ms |
| WebKit 26.6 | 約0.58～0.82ms | 9ms | 248／62,016blocks（約0.40%） | 15～22ms |

**予算超過0・音切れなしとは判定していない。** WebKitの超過には、観測負荷・coarse timer・schedulerの影響を含めた切り分けが残る。実聴、通常の無計測再生、長時間・background・device切替・高負荷の安定性は別確認とする。全曲／全subtune互換、DAC／digiやcombined wave等の正確な音、実機一致を示す結果でもない。

## 再開・再実行

repo rootで、既存のplanと現在のfile／sourceの一致を先に確認する。

```sh
node scripts/select_sid8580_worklet_cases.mjs --check
node scripts/check_sid8580_real_worklet.mjs --validate-only
```

再実行は過去reportを残して別の出力先へ保存する。local HTTPとheadless browserが必要で、物理出力は無音のまま約6分以上かかる。

```sh
node scripts/check_sid8580_real_worklet.mjs --out release/sid8580-real-worklet-next.json
```

片方のengineだけ再実行する場合は`--engines webkit`または`--engines chromium`を追加する。中断時は完了caseまでreportに残る。新しい出力先で対象engineを最初から再実行し、途中の結果を完成扱いにしない。archive更新でplanが変わる場合は、旧planとreportを残して新しいplanを別名で用意する。

人の実聴は、上の3曲・指定subtuneをLabで開いてPlayし、手元の参照再生と比較する。曲／ROMはrepoや配布ZIPへコピーしない。

通常Playerの6581／8580切り替えとSynthのmodel対応は[TODO](todo_sid_01.md)に残す。今回は新しいrepo専用の選定・検証toolと記録だけを追加し、既存研究用ZIPは作り直していない。commit／push・tag・公開は行っていない。
