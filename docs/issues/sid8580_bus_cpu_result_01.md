# 独立8580試作のbus対応・実6502閉ループ検証（2026-11-07）

前段階のsidera試作へ、wrapper側のbounded bus近似と実6502の閉ループ経路を追加した。**本番SID Player／Synth／SDKは未変更**で、既知8580のfile import拒否も維持する。前段階の`_01`検証記録・source archiveは変更せず、ゼロ固定busだった当時の結果と今回を区別する。

## busの根拠と選択した近似

[一次資料・外部参照362probe](sid8580_bus_reference_01.json)で、write、OSC3／ENV3、write-only read、経過cycle、resetを調べた。固定GPL参照の別processをblack-box測定し、そのbus実装sourceは参照・移植していない。実SID実機や温度・電圧の違いは測定していない。

- wrapperの寿命は6581が7,424cycles、8580が663,552cycles。これは固定参照から観測したmodel別近似で、実機の普遍的定数ではない。
- 0～31の全offsetへのvalid writeがbyteを保持・寿命を更新する。OSC3／ENV3 readは候補自身の現在値をbusへ載せ、寿命を更新する。書込shadowとは別の状態で、read-only registerへのwriteがそのhardware値を書き換えるという意味ではない。
- write-only readは保持値を返し、残存寿命を半分・最小1cycleとする。明示clockだけが減衰を進め、最後の1cycleで消去する。参照では残存寿命が0へ短縮されるedgeに非zeroが残り続ける異常を観測したが、これを実機仕様としてコピーせず、boundedに消える方針を明示した。
- POTX／POTYは未実装のためerror5で拒否する。参照の既定255や固定0でanalog入力を偽装しない。直接readはbus／register／cycleを変えず失敗する。実CPU経路でも失敗値をCPUへ渡さず停止する。
- reset／Stopでbusをclearし、複数instanceは独立する。元のsidera library、DSP、sample phaseは変更していない。

## 実6502の閉ループ

固定・無変更のzlib `chips/m6502`をC11 shimで呼び、Rust側がRAMとSID Probeを所有する。1cycleごとにCPU tick→SID tick／sample→実bus accessを処理し、read値は次のCPU tickへ返す。JSがcycleごとに介入したり、参照engineのread値を注入したり、CPUを部分的に再実装したりしない。

自作programはRAM`$0800`とreset vectorから実行し、read値をRAM署名へ保存、CPU自身の条件分岐を通ってSIDへ書き込む。program bytes／hash、readのcycle・address・value／error、write hash、CPU stateを記録した。

| 自作program | 観測した因果関係 |
| --- | --- |
| immediate bus | cycle66のread`$A5`→RAM署名`$11`→SID frequency-low64 |
| aged bus | 同一programのcycle41,219で6581は0／8580は`$A5`→RAM署名`$32`／`$31`→SID frequency-low64／128 |
| OSC3／ENV3 | 実read`[0,255,177,255]`→RAM署名→SID frequency-low177 |
| 未対応POT | `$D419`のreadで12cycles、error5。value256はtraceの失敗sentinelで、CPUに渡す値ではない |
| JAM | `$0806`で15cycles、error10。RAM署名`$4A`を保持して停止 |
| 未対応ROM | `$E000`で12cycles、error3。架空のROM byteを返さず停止 |

有効なrunは最大32,768cycles／call、instance上限4。Stop／fault後はcycleが進まず、resetはRAM・CPU・SIDを新しいepochへ戻す。Nativeの不正protocolは全体を検証してからPCMを出す。これは自作RAM fixture環境で、C64のbanking／CIA／VIC／firmwareを備えたPlayerではない。

## 検証結果

| 検証 | 成功した範囲 | 証拠 |
| --- | --- | --- |
| 前段階の14fixture | 3rates × 2models、84 Native／WASM／chunk一致。以前の全84 PCM hashも不変 | [probe `_02`](sid8580_probe_verification_02.json) |
| bus fixture | 66 Native／WASM／chunkケース、境界・read更新・POT拒否・Stop／reset／instance | [bus](sid8580_bus_verification_01.json) |
| 実6502 fixture | 6programs × 3rates × 2models、36 Native／WASM／chunkケース | [CPU](sid8580_cpu_verification_01.json) |
| 実ブラウザー | Chromium／WebKit各50 chip・bus＋12 CPU、計124一致 | [browser `_02`](sid8580_probe_browser_02.json) |

計186 Native／WASM／chunkケースが成功した。外部参照との比較は引き続き診断であり、意図したbounded edge差、初期oscillator／envelope、filter／RC、samplingの差を含む。参照や実機への全面一致を示す件数ではない。

元の`clock()`／`clock_with_voices()`はCIと同じ手順で再確認し、6設定・376,200samplesが原本へ完全一致した。元の[API比較記録](sid8580_legacy_api_01.json)と候補libraryは保持している。

[Native `run(1)`測定](sid8580_tick_performance_01.json)は、毎回のoutput全消去を有効長0への更新に置き換え、M2でmedian94.54ms→18.57ms、約5.09倍を観測した。Stop／resetは全消去を維持し、valid PCM hashは不変。各call後に有効なのは`output[..output_len]`だけで、CPU bridgeは次call前に生成sampleをcopyする。このmicrobenchmarkにWASMやPlayerの速度保証は含まれない。

今回のCPU＋SIDを1つのWASMで進めるbatch測定は、Nodeで実時間の約40倍、ブラウザーで約42～45倍だった。C64全体、AudioContext／AudioWorklet、音切れ、長時間、実聴を検証した値ではない。

## 再開と残作業

```sh
sh scripts/build_sid8580_probe.sh
node scripts/check_sid8580_probe.mjs --baseline docs/issues/sid8580_probe_verification_01.json
node scripts/check_sid8580_bus.mjs
node scripts/check_sid8580_cpu.mjs
node scripts/sid8580_probe_artifacts.mjs --check build/sid8580-probe
```

Node.js、Rust1.91.1／`wasm32-unknown-unknown`、Native・WASM objectを作れるClangを使う。C shimはfreestandingで、原本m6502 headerを改変しない。optional Cargo playerや外部crate依存はbuildしない。外部GPL SID参照は別processの検証専用で、候補Native／WASM・source kitへlink／同梱しない。

## matching sourceと独立再build

[source kit proof `_02`](sid8580_probe_sourcekit_02.json)は59inputsを独立コピーし、親repositoryへのsource fallbackなしでNative2本／WASM2本とreceiptをbyte一致で再生成した。そのkit自身でも84＋66＋36チェックが成功した。新しいC compiler／target／flagsもreceiptへ記録している。Apple ClangにWASM backendがない場合はEmscripten配下のLLVM compilerを使えるが、Emscripten runtimeへ依存する音源ではない。

| 最終出力 | bytes | SHA-256 |
| --- | ---: | --- |
| chip／bus WASM | 1,391,574 | `2b82f306f1c9460ef4558d7faf73cf1eb49b7de2eead09d8c5e38c858429667d` |
| CPU＋SID WASM | 1,473,638 | `38118d68288cdde417a2fab099497ec057432de6c25058b7db467bb26e2dffb2` |
| source ZIP | 962,936 | `dc8cc1b3c358e0fe86b3dcfa0f3d658f540dbdbc3a271f6124bad898b0227835` |

`release/tetorica_sid8580_bus_cpu_20261107_sources.zip`は86files。可読source／Node checker、2本のWASM、MIT／BSD／m6502のzlib license、installed Rust標準ライブラリーのcopyright／license noticesを含む。Native binary、GPL SID参照、ROM／音楽は含めず、ZIP CRCと全filesのbyte一致も確認した。

固定runtime33builds／68outputs／75mirrorsと既存PSID／C64 receiptのcheckは成功。新CI workflowの9stepsはローカルで確認したが、GitHub Actionsでの実行結果ではない。

次の採用前課題は、reset初期条件・read pipeline・filter／resonance／RC／scale・参照samplingを揃えた品質比較、実8580曲、C64／Workletと実時間性能・安定性・実聴の確認。専用Model UI、parser／Main・Worklet／Native ABI、配布への統合はその後の判断であり、今回完了したとは扱わない。GitHub Actions実行、commit／push／tag／公開は行っていない。
