# Daily01：性能監査の再測定

結果の読み方と優先順位は[レポート](../aaa_daily01_report.md)。
対象commit・環境・主要ファイルのSHA256は[environment.json](environment.json)。
ここにある比較実装と測定値は、実装前の監査記録。

監査後にP1の2件を本番へ実装したため、現在の作業ツリーでは一部probeの置換anchorが一致しない。
元の比較を再現する場合は、`environment.json`の`gitHead`を別checkoutに用意し、
このフォルダーのprobeを使って、各コマンドのroot引数にそのcheckoutを指定する。
実装後の互換性確認は[追記](../aaa_daily01_report.md#p1実装追記2026-10-21)と
[結果・再検証スクリプト](implementation/)を参照。

計測は一度に1プロセスずつ実行する。以下はリポジトリーrootからのコマンド。
結果は別の一時ディレクトリーへ出し、保存済みの生データと分ける。
当日のNodeはv26.12.0。時間計測とHeapProfilerの数値を混ぜないこと。

## HuC6280：同一realmのowned PCM比較

```sh
node --expose-gc docs/issues/aaa_daily01_audit/wasm/huc-same-realm.mjs --root=. --out=/tmp/tetorica-daily01-huc
```

WASM・波形・音量・公開owned結果を保ち、mapped `Float32Array.from`と添字コピーを比較。
記録：[huc-same-realm-results.json](wasm/huc-same-realm-results.json)。

## 実WorkletソースのNode VM比較

```sh
node --expose-gc --experimental-vm-modules docs/issues/aaa_daily01_audit/wasm/audit.mjs --root=. --out=/tmp/tetorica-daily01-wasm
```

Genesisの現行基準、Game Boy、YM2413、HuC6280を比較する。
全10条件の時間と修正済みの別allocation passを組み合わせた当日の記録は
[report-results.json](wasm/report-results.json)。VM境界の費用も含む。
条件・`--smoke`／`--phase=alloc`等は[詳細](wasm/README.md)。

## LiveFX：検証を保つ添字ループ

```sh
mkdir -p /tmp/tetorica-daily01-fx
cp docs/issues/aaa_daily01_audit/fx/probe.mjs docs/issues/aaa_daily01_audit/fx/indexed-hook.mjs /tmp/tetorica-daily01-fx/
node --expose-gc /tmp/tetorica-daily01-fx/probe.mjs prepare-js . indexed
node --expose-gc /tmp/tetorica-daily01-fx/probe.mjs compare-js . indexed
node --expose-gc /tmp/tetorica-daily01-fx/probe.mjs timing . indexed
node --expose-gc /tmp/tetorica-daily01-fx/probe.mjs alloc . indexed
node --import /tmp/tetorica-daily01-fx/indexed-hook.mjs --test web/custom_fx.test.mjs
```

emcc不要。`prepare-js`は一時ディレクトリーに比較モジュールを生成する。
本番の`web/custom_fx.js`を書き換えず、最後のコマンドは既存テストのimport先だけを置き換える。
時間と割り当ての記録は[time](fx/timing-indexed.json)／[allocation](fx/alloc-indexed.json)。

停止noiseのC候補を再測定する場合のみ、別途ローカルemccが必要。
自動ダウンロードはしない。`build`は出荷物へ書き戻さず、一時ディレクトリーに
基準と候補のWASMを同じcompiler・flagsで生成する。
`helper-guard`と`indexed`は独立した比較実装なので、生データの`jsCandidateFlavor`を確認する。
[FXの詳細手順](fx/README.md)、[各候補の所見](fx/findings.md)、[使用compiler](fx/compiler.txt)。

## スケジューラー：処理回数と処理所要時間

```sh
node docs/issues/aaa_daily01_audit/scheduling/probe.mjs --root=. --out=/tmp/tetorica-daily01-queue-counts
node docs/issues/aaa_daily01_audit/scheduling/benchmark.mjs --root=. --out=/tmp/tetorica-daily01-queue-time
```

合成8 kHz／10秒raw DAC等をメモリー内で作る。提供VGZを再測定する場合は、
各コマンドへ`--vgm='/path/to/01 - Backup Creation.vgz'`を付ける。
VGZ本体、抽出イベント、楽曲音声は保存・同梱していない。
当日の[処理回数](scheduling/operation-counts.json)と[時間](scheduling/timings.json)には実曲subsetも含む。
配列長に基づく処理回数は、実copy bytesやGC量ではない。

## ブラウザーの現行基準

既存のPlaywright依存とChromium／WebKitが必要。

```sh
mkdir -p /tmp/tetorica-daily01-browser
node docs/issues/aaa_daily01_audit/browser-baseline.cjs --root=. --out=/tmp/tetorica-daily01-browser --seconds=12 --stall-ms=0
```

隔離したブラウザーcontextでPlaygroundを開き、Genesisの固定音順をMain／Workerで実行する。
現在のソースをHTTP応答内だけで計測用に加工し、PCMと命令適用frameを取得して終了する。
既存のユーザープロファイルや保存プロジェクトは使わない。[当日の4結果](browser/)。
左chを解析し、両stageのNaN／差と連続frameを確認する。
Workerの約500 ms先読みを「通信が500 ms遅い」とは解釈しない。
graph内の正常PCMから、音声デバイスのunderrunは否定できない。

## 保存したもの

- 元の本番ソース／出荷WASMはリポジトリーにあるものを参照。
- 計測スクリプト、要約統計・heap sampling・PCM hash・検証ログのみ保存。
- 生成済み候補モジュールやWASM、具体的な一時パス入りbuild scriptは保存しない。
- ソース内の置換anchorが変わった場合、probeは失敗する。新しいソースへ合っているか見直してから比較する。
- 実機の出力期限やSafari／Tauriでの候補性能は、次の実装段階で別途確認する。
