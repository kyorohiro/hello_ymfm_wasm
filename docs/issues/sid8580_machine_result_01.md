# 8580研究用C64／AudioWorklet接続（2026-11-07）

独立入口 [`docs/sid8580-lab/index.html`](../sid8580-lab/index.html) を追加した。docsを配信するserverでは`/sid8580-lab/`から試せる。PAL・single SID・8580のPSID／RSID v2を対象に、実CPU／CIA／VICとSID、AudioWorkletを接続する**研究用lab**であり、本番Player／Synth／SDKの8580対応ではない。既存のparser拒否・WASM・固定runtimeは変更していない。

## 接続とsource境界

[設計](sid8580_machine_design_01.md)に原本・生成物・ownershipの境界を残した。固定chips C64 headerは無変更。既存BSD hostからmarked research copyを生成し、固定MIT sideraのendpointへ接続する。NativeはRust static library、browserは**2つのWASMの関数を直接import**する。per-cycleのJS closure／messageや、記録済みtraceによる再生は使わない。別々のlinear memoryを持ち、SID自身の実readがCPUの次のtickへ渡る。

reset／reload／disposeは各machineのSID handleを管理する。snapshotは公開せず、未対応POT readは定数を返さずaddress付き停止。live envelope／phase値を捏造せず、Core state／APIのOSC3／ENV3はcycle付きの実CPU readの観測値を返す。

元header宣言と明示選択を別に保持し、unknown／eitherのPAL・8580には明示選択が必要。既知6581・NTSC／multi-SIDは研究用入口でも拒否する。構造parserの生成viewを別に使い、本番strict parserは緩めない。resonance／cutoffの独立研究flagは**両方とも既定Off**。音声は候補の外部RC・整数samplerの後に元hostの**12Hz software DC blocker**を通すため、前段の単体filter測定と同じ出力段とは扱わない。

## 自動検証

[Native／WASM検証](sid8580_machine_verification_01.json)は13自作fixture×44.1／48／96kHzの39ケースと、4通りのprofile positive control、計**43ケース**でPCM／RAM／read・write trace／997分割renderを確認した。CIA IRQ・VIC raster IRQ・NMI・可変timer、PSID VBI／CIA・長いinit、bus・OSC3／ENV3 read→RAM／CPU分岐→SID write、banked RAMと実SID readの区別を検証している。Stop／reload・失敗候補の旧状態と将来PCM・共有moduleのinstance分離も成功した。従来m6581とのPCM一致や実機品質の判定ではない。

parser6件と[pending init6件](../../test/sid8580_machine_preflight.test.mjs)も成功。長いPSID VBI initは候補をbounded chunkでRTSまで進めてから採用する。late ROM・取消・2M-cycle deadlineで失敗しても旧状態と将来PCMを保持する。実AudioWorkletはfresh loadから元のinit PCMを再生し、Stopと古いstartup ACKを所有権で分ける。

[実AudioWorklet browser](sid8580_machine_browser_01.json)はChromium／WebKit各13項目・計**26項目成功**。VBI／CIA song2／RSID、実readに依存するCPU書込、独立flag、失敗したWorklet POT RPC、load取消・pending init／Start ACK中Stopと再Playを確認した。音声destinationの最後は無音にし、有限PCMを測定している。人の実聴ではない。

[local実ファイルのsmoke](sid8580_machine_hvsc_smoke_01.json)は、PAL8580宣言のPSID v2を3件、各2秒／48kHzでCore実行し、96,000framesの有限・非zero PCMとStop全zeroを確認した。CIAは199回、VBI2件は各100回のplayを観測した。曲・PCMを保存せず、AudioContext／実Workletでの実曲再生や実聴は行っていない。

44.1kHz／128framesの短い測定では、通常render平均約0.19～0.47ms・最大1～2ms、quantum目安2.902ms。同期load preflightは別に10～20msを記録した。`Date.now`の粗い値であり、loadの長さをrender平均へ混ぜず、worst-case deadlineやglitch-free切替・長時間の保証とはしない。

[独立source kit検証](sid8580_machine_sourcekit_01.json)は**99 inputsから2WASM＋Nativeの全3出力とreceiptがbyte一致**し、build・parser view・unit12件・Native／WASM43件・receiptの5検証commandが成功した。親sourceへのfallbackやGPL参照engineを使っていない。Darwin Native linkでは絶対archive pathを持つdebug記録を省き、移動したkitでも一致させた。SID／機械処理は変更していない。

最終`release/tetorica_sid8580_machine_20261107-machine.1_research.zip`は**161files／856,803bytes**、SHA-256 `c7b725a2fe7c212597188454dc4e4a03b7b35a4f2d257dd6c33a666d8a3f8d6f`。CRCと全archive filesのbyte一致も確認した。可読app／C・C++・Rust source／生成器／test／2WASM／matching receipt、zlib・MIT・BSD license、Rust・Emscripten標準library notices、自作3demoを含む。Native binary・GPL SID oracle・user ROM・ゲーム曲・PCMは含めず、local HVSC smoke toolもrepo専用でZIP対象外とした。初回の失敗stageは保存し、上書き・削除せず別versionへ分けた。

CIは12stepsで独立build、生成物、unit、実機械、receipt、可読closureと既存製品receiptを確認する構成。GitHub Actions実行、commit／push／tag／公開は行っていない。

## 残る確認

- 自分で用意した既知8580曲を、正しいsubtune・VBI／CIA／RSIDで試奏し、参照再生と聴き比べる。自作fixtureの成功を全曲互換としない。
- 長時間・background・device切替・負荷中の音切れやmemory、手動Stop／再開を確認する。短い無音測定と実聴を分ける。
- 低FC残差、mode gain／loading、read・audio pipeline、DAC／digi・combined wave等の近似を引き続き分離する。研究用接続の成功から、本番採用や実機一致を推定しない。

ROM／ゲーム曲は配布せず、labの3demoはBSDの自作programだけ。UIにROM uploaderはなく、lower-level Coreのcaller-supplied firmwareと、本番の対応範囲は分けて扱う。
