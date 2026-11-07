# C64 SID: playback reference, Playground, Synth

## 方針（2026-11-06）

ユーザー承認: VGM PlayerへのSID再生、Playground先行、Synth先行のうち、
実装・検証しやすい順で進める。最初に音源単体を動かす入口と比較手順を作り、
その後に通常のPlayground／Synthへ広げる。標準VGMにSIDを独自追加したとは扱わない。
既存Synthの操作と、可読ソースを改造・再利用できる配布方針を維持する。

## 1. コア選定と検証の入口

- [x] 既存SIDコアのlicense、6581／8580、filter、Native／WASM対応、依存関係を確認して採用理由を記録する。
- [x] 固定revisionの原本・license・変更点・再ビルド手順を同梱する。既存fixed SDK snapshotを直接変更しない。
- [x] SID単体のregister read／write、clock、reset、renderをNativeとWASMから使えるようにする。
- [x] 自作register列でTriangle／Saw／Pulse／Noise、ADSR／Gate、3声、Sync／Ring、Filter routing／LP／BP／HP／cutoff／resonanceを検証する。
- [x] 比較条件（core revision、model、PAL／NTSC clock、sample rate、sampling方式）とWAV／測定結果を保存する。Native／WASM一致は移植検証であり、実機一致とは区別する。
- [x] ブラウザーで音を試せる最小の可読コードと操作入口を作る。AIの無音測定と人の実聴を区別する。

## 2. Playground／公開API

### 通常mode接続の今回の作業（2026-11-06）

ユーザーの「進めて」により、第1段階の独立ラボから通常Playgroundへの接続を開始する。
正本のSID core／WASMを再利用し、固定SDK snapshotへ直接追加しない。
mode idは `c64`、chip名／global APIは `sid` とする。6581専用・creation時のclockは固定。

- [x] `SidSynth` のvoice／filter／note helperと、Main／logic Workerから直接使うclient、AudioWorklet endpointを実装する。予約時刻・Loop所有権・Stop／再Runを既存performance queueへ接続する。
- [x] `createSoundChip('sid')`／`useSoundChip('sid')`、SID primary／追加instance、Clock／model optionsの検証を揃える。未対応Native audio backendでは明示的に拒否する。
- [x] C64 mode、自作コード例、3voice／shared filterの状態表示、モード別型と補完からのsource参照を追加する。
- [x] SID専用receiptで通常Playground ZIPとmatching sourceを検証・同梱し、既存SDKの認証は維持する。可読コードを保持する。
- [x] Main／Worker、追加instance、予約された発音／離鍵、Stop／再Run、非対応option拒否、source／独立ZIPのChromium／WebKit、型・配布を検証し記録する。
- [x] README en／ja／AI、接続マップ、再開TODO、CIを今回の実装範囲へ更新する。npm公開、SID曲再生、Synthは後続。

- [x] JS API・型・Main／Worker／AudioWorklet、音声の開始／停止／再発音を既存構成へ接続する。
- [x] Playground mode／サンプル／voice・filter表示／補完からの実装参照を用意する。
- [x] 独立ラボのbuild、checked WASM／JS配布、対応source kit、license、offline ZIP、CI workflowを追加する。通常Playgroundのartifact profile／SDKへの登録は後続。
- [x] 独立ラボの実WASMを使ってChromium／WebKitで発音・停止・parameter変更・エラーを検証する。通常modeのMain／Workerは後続。

## 3. SID曲の比較／解析

### VBI曲をC64実行環境へ接続する今回の作業（2026-11-07）

ユーザーが全体監査後の次段階として、VBI曲のC64実行環境対応を承認した。
Western_Games.sidの132,113-cycle initと実CIA操作を基準にし、元headerのVBI timingを維持する。

一次仕様は[HVSC SID file environment](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt)。VBIはVIC raster比較値`<$100`／IRQ有効、CIA1 timer Aは`$4025`でcounter稼働／IRQ無効、他timerは`$FFFF`で停止。毎回のinit／playでentryに応じたbankを書き、play後にVIC（`$D019`のwrite-one-to-clear）とCIA（ICR read）をackする。programのtimer／raster／mask変更は保持する。
UIはC64 VBIをdefault、Direct VBIを明示選択とする。共有parserのAPI defaultは従来互換の`direct`、C64 wrapperは`c64`を指定。C64 modeのdriver空きpageなし／`$FF/0`は理由付き拒否としてDirect VBIを案内し、header変更・隠れたfallback・RAM上書きをしない。
新VBI entryは100k-cycle preflight後もinitをstreamingで継続し、bootstrap開始から2M-cycleで打ち切る。UI候補はchunk間でyieldしRTS後に採用、workletはfresh loadのinit PCMから再生する。play上限16kは維持。新VBI経路だけ、I/O mapped時の未実装`$DE00..$DFFF`を拒否する。既存CIA／RSIDの実行policyを黙って拡張しない。
前61,157件の監査結果はimmutableなDirect VBI baselineとして保持した。旧VBI失敗3,233件（I/O 2,831・bank53・ROM177・init167・play5）とcontrol64件の計3,297件を、別checkpointで再検証した。旧失敗のうち3,025件が完走し、残りはROM195・play timeout9・init deadline3・expansion1。[結果と範囲](sid_c64_vbi_result_01.md)、[独立比較18項目](sid_c64_vbi_retry_comparison_01.json)は成功。61,157件すべての再実行ではない。

- [x] PSID VBIのVIC／CIA初期状態・IRQ呼出／ack・bank／driver RAM規約を確認し、自作fixtureを用意する。
- [x] 既存C64 machineへVBI entryを追加し、実VIC raster IRQでplayを呼ぶ。既存CIA／RSID経路の回帰を保つ。
- [x] 長いinitをbounded streamingで進め、init PCMを保ちながらStop／timeout／候補失敗時の旧音を保持する。
- [x] Main／Worklet／UI／parserへ接続し、driver空きRAMなし・ROM設定・subtune切替・従来VBI比較の扱いを明示する。
- [x] Western Gamesと他の実I/O失敗例、自作VIC／CIA・長いinit、既存CIA／RSID、source／実ZIPブラウザーを検証する。
- [x] 前監査の失敗対象を再検証し、matching sources／再build／可読ZIP・guide／README／CI・再開記録を更新する。

### ローカルHVSC全体の実行監査（2026-11-07）

ユーザーが`ww/C64Music`配下を一通り動作確認するよう依頼した。Zyx修正後の音は正常になっていそうとの実聴コメントあり。
全ファイルをmetadata確認し、現行backendで受理できる各ファイルの既定subtuneを短時間実行する。
曲全体・全subtune・聴感の正しさを確認したとは扱わず、silentも初期無音／D418等と区別せず記録する。

実行手順と分類は[ローカルSID corpus監査](../sid-corpus.md)。`npm run test:sid-corpus`の自作corpus8件が成功した。
5demoのpilotは全件nonzero／Stop成功、resumeは5件再利用・追加0件・checkpoint SHA不変。
`node scripts/check_sid_corpus.mjs --root ww/C64Music --checkpoint release/sid-corpus-audit-20261107/results.jsonl --out docs/issues/sid_corpus_audit_01.json`を既定2秒／48kHz／2workersで実行し、61,157件の分類が完了した（残0、約21.6分）。[結果](sid_corpus_audit_01.md)は非zero26,497／全zero1,050／未対応32,448／ROM要求・アクセス906／実行停止256。全件resumeは追加0件、checkpoint SHA・入力manifest・fingerprint・分類件数不変、lock残留なし。[独立検証](sid_corpus_audit_verification_01.json)も成功し、61,157行の欠落・重複0、完走27,547行すべて96,000 frames／有限PCM／Stop全zero・停止状態不変を確認した。
中断後は同じcommandへ`--resume`を追加する。JSONLと入力manifestはrelease配下、compact summaryだけdocs/issuesへ置く。実行中はfingerprint対象のsource／WASMを変更しない。

- [x] 実WASMによるVBI／CIA／RSID、PAL／6581の明示選択、ROMなし環境の全体監査CLIを作る。
- [x] 非対応header／ROM要求／不正入力／CPU・I/O・timeout失敗／有限PCM・有音／無音／Stopを別集計する。
- [x] JSONL checkpointと再開時の入力・source／WASM／条件一致確認、worker watchdog、無変更・非同梱を検証する。
- [x] 自作corpusのテストと小規模benchmark後、`ww/C64Music`全体の既定subtuneを実行して結果を残す。
- [x] 全件resumeの追加0件・checkpoint不変、入力manifestとsource／WASM／条件の一致を確認する。
- [x] 結果行の一意性と測定値を独立確認する。
- [x] 失敗上位と代表例を整理し、次の修正TODOと再実行手順をまとめる。元$1EE4のfileは未確認と区別する。
- [x] VBI宣言のままC64機械を使う再生経路と、init PCMを保持する長いbounded初期化に対応する。Western_Games song1の旧$1EE4停止・scratch132,113cycles後の実STA$DC04は[診断](sid_western_games_diagnosis_01.json)へ保持し、実C64経路では全3subtunesを各10秒確認した。speed bitは変更していない。下記第12段階へ記録した。

### PSID実行診断とZyx.sidの予備読み出し（2026-11-07）

ユーザーが `PSID init/play subroutine exceeded its cycle budget or did not return (at $1EE4)` を報告した。
対象ファイル・subtuneを確認し、正常な長い初期化／実行環境不足／returnやCPU処理の問題を区別する。
ユーザー添付の`Downloads/Zyx.sid`は別のエラーで、local HVSCのZyx.sidとbyte一致した。
initは750cyclesで戻り、playの`STA $D3FF,X`が最終SID書込$D418の前にdummy read $D318を行うため、
bounded VBI hostが未対応I/Oとして拒否していた。$1EE4の元ファイルはまだ特定していない。

[HVSC一次仕様の実行環境](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt)はPAL時`$02A6=1`と、毎回のinit／play entryに応じたbank選択を要求する。VBI hostのzero RAMと前callのbank保持を修正する。
100k init／16k playは本hostの安全上限でありPSID仕様・音源chipの制約ではない。元ファイルの原因確認前に上限は増やさず、init／play timeoutとCPU JAM/KILを区別して表示する。init PCMのbounded queueも維持する。
[固定m6502の一次source](https://github.com/floooh/chips/blob/9e88298ce56319953ac7a43213a1120359f7a3a6/chips/m6502.h)で、`STA abs,X`／`abs,Y`のpost-IR phase3、`STA (zp),Y`のphase4は次のstoreへ渡さない予備readと確認した。修正はwrong-page実bus addressと補正後SID addressが一致する場合のside-effect-free readに限定し、CPU／SIDのclockを省略しない。read時にcollision latchをclearするmirrored register `$1E/$1F`は拒否する。VICを一般的に再現する変更ではなく、実VIC／CIA／ROM readは拒否を保つ。
回帰・実ファイル・配布検証は下記第10段階に記録した。Zyx.sidの別症状を直しても、未特定の$1EE4 timeoutを解決済みとは記録しない。

- [ ] 後続: $1EE4の元ファイルで停止したroutine・cycle数・PC周辺を確認する。上限を増やすだけで無条件に受理しない。
- [x] 添付Zyx.sidのD318エラーを再現し、indexed SID storeの実bus cycleを確認する。
- [x] indexed SID storeの予備VIC readを厳密に識別し、実SID read／実VIC・CIA・ROMアクセスと区別する。
- [x] VBIの初期メモリ／bank／CPU／呼出・復帰条件を一次仕様と既存C64 backendに照合する。
- [x] 原因に必要な修正とinit／play別の診断、bounded実行・旧音保持の回帰を用意する。
- [x] 実ファイル・自作fixture・既存VBI／CIA／RSID・browser／配布・再開記録を確認する。

### PSIDの再配置情報による拒否を改善する今回の作業（2026-11-07）

ユーザーが `unspecified relocation (0/0) only` を報告した。
先にPSIDのstartPage／pageLengthと各backendのRAM使用を確認し、音楽payloadの移動要求と誤解してheaderを書き換えない。

[HVSC一次仕様の+78／+79](https://hvsc.c64.org/download/C64Music/DOCUMENTS/SID_file_format.txt)では、再配置情報は再生driver用の空き領域を示す。`0/0`はdriver範囲でpayload外を書かないclean file、`$FF/0`は空きpageなし、それ以外は最大の連続空き範囲。
今回の方針はVBIとCIAを分ける。VBIは既存`$0200..$0203` callerのまま、構造が正当な明示範囲・`$FF/0`を受理する。
CIAは明示範囲内で最初のalways-visible page（`$04..$9F`または`$C0..$CF`）へ独自driverを1pageで配置する。範囲全体がそのRAM内に収まる必要はなく、使える1pageがあればよい。`$FF/0`／使えるpageなしはCIA用の理由付き拒否とする。
`0/0`の従来driver配置は保持し、音楽payload／header／load・init・play addressは変更しない。ABIは`sidr_load_psid`末尾の`driverPage`（0=従来配置）と`sidr_driver_address`。parserは選択subtuneごとにVBIなら`null`、CIAなら0またはpageを返す。旧CLIの実行subsetと既存strict parserを黙って拡大しない。検証・配布記録は下記第9段階。

- [x] 一次仕様で再配置情報の意味を確認し、VBI trampoline／CIA RAM driverとの関係と受理条件を決める。
- [x] 正当な明示範囲・$FF/0を必要に応じて扱い、不正範囲・payload overlap・RAM競合は区別する。
- [x] parser／Main／Worklet／nativeを必要範囲で変更し、元header・target・ROM snapshot・失敗時の旧音を保持する。
- [x] 自作fixture・実HVSC・既存VBI／CIA／RSID・strict CLI・Chromium／WebKitで確認する。
- [x] 可読ZIP／matching sources／再build・guide／README／CI・再開記録を揃える。

### PSID CIA再生と8580指定の扱い（2026-11-07）

ユーザーがPSIDのCIA-speed拒否と既知8580拒否を報告した。先にTODOを残し、PSID CIA再生をC64 machineへ接続する。
PSIDは選択したsubtuneのspeed bitでVBI／CIAを分け、CIAはC64 machineの割り込みからplayを呼ぶ。
8580は6581での代替試聴を追加せず、専用modelを選択できる方針で次の調査・試作へ進む。現行版の8580拒否は維持する。
既存のVBI／RSID・strict CLI・未commit／stage済み変更を保持する。

- [x] PSIDのsubtune別speed bitとCIA timer／play呼出／bank規約を確認し、自作PSID CIA fixtureを用意する。
- [x] 既存C64機械でPSIDのinitとCIA割り込み駆動のplay routineを実行し、固定host VBIで代用しない。
- [x] parser／Main／Worklet／native ABIへPSID CIAを接続し、subtune切替・Stop／旧音保持・明示targetを維持する。
- [x] 8580は専用modelを調査する方針にする。6581 preview overrideは実装せず、元のmodel宣言を保持する。
- [x] 自作IRQ／可変CIA・実HVSC、既存VBI／RSID、strict CLI・source／独立ZIPのChromium／WebKitを確認する。
- [x] source／license／再build／配布・guide／README／CI／再開記録を更新する。
- [ ] 後続: VBI宣言でもCIA／VICへアクセスするPSIDをC64環境で扱う。今回の実ファイル検証ではKayak song3（$D019）とIcicle Works song1（$DC04）が従来VBI backendのI/O制限で止まる。CIA-speed対応やheader受理だけで全PSID互換とはしない。

### 専用8580 modelの調査と次の段階（2026-11-07）

CIA再生を先に仕上げ、次は6581／8580を明示的に選択できる音源を検討する。以下は一次資料の調査結果で、採用・音質・ブラウザー性能の検証完了を意味しない。

- [perfect6581](https://github.com/libsidplayfp/perfect6581) はMITだが、READMEはdigital partsのみと明記し、現treeは6581 netlistを持つ。analog filter／PCM出力を備えた8580音源としてそのまま採用しない。
- [sidera](https://docs.rs/sidera/latest/sidera/) はMITの6581／8580候補。integer／no_stdのfilter・DC modelを持つが、公開 `clock()` は出力sample単位。C64 CPUとのcycle単位read／writeにはadapterまたは公開APIの追加が必要。combined wave／cutoff curveは近似で、実機完全一致とは扱わない。
- [MAMEのMOS6581／8580](https://github.com/mamedev/mame/blob/master/src/devices/sound/mos6581.cpp) はBSD wrapperを持つ候補。SID本体・tables・依存closureのlicense、単独buildとcycle接続は未監査。
- [libresidfp](https://github.com/libsidplayfp/libresidfp) は両model・cycle単位read／write／renderを持ち、既存の外部参照toolでも使う。ただしGPL-2.0-or-laterであり、採用時は配布物と対応source／licenseを別途設計する。別WASMにするだけで条件を回避できるとは扱わない。
- 現行zlib m6581へ線形cutoffだけを追加して8580対応とはしない。DAC／DC、combined waves、bus／pipelineなどを含むmodel差を検証する。

- [ ] permissive候補のrevision／全license／依存sourceを固定し、cycle単位adapterの小さなNative試作で比較する。
- [ ] OSC3／ENV3／bus read、wave／TEST／Sync／Ring／ADSR、filter／resonance／D418を自作fixtureと外部参照で確認する。既存6581の結果を保持する。
- [ ] 既知8580曲、PSID CIA／VBI、RSIDで実行・音声を確認する。実機と参照engineの近似も区別する。
- [ ] Chromium／WebKitのCPU負荷・memory・音切れを計測して採用を決める。未計測の性能や安定性を保証しない。
- [ ] 採用後にModel UI／parser／Main・Worklet／Native ABIへ接続し、原宣言と実行modelを別表示する。可読source／license／build receipt／ZIPを揃える。

### PSIDの不明／両対応clock・model指定を改善する今回の作業（2026-11-07）

ユーザーがPSIDのPAL／6581必須エラーを報告した。RSIDで導入した明示選択をPSIDにも揃える。
旧CLIの厳密な参照条件と、既知NTSC／8580の非対応は維持する。既存のRSID作業と変更は保持する。

- [x] PSIDの宣言clock/modelを保ち、browserでは不明／両対応を明示PAL／6581選択で受理する。CLIのparsePsidは従来どおりstrictにする。
- [x] 共通の再生設定とApply/retryをPSIDにも接続し、AudioWorkletへ選択を渡す。PSIDにRSID用ROMを要求しない。
- [x] 未指定／両対応・既知NTSC／8580・保存済みsubtune・無効候補保持・取消のテストと既存RSID回帰を確認する。
- [x] 実ブラウザー／独立ZIP、可読sourceとhash、guide／TODO／CI記録を更新する。

### RSID再生を優先する今回の作業（2026-11-07）

ユーザーがbrowserでPSIDの実再生を確認し、次の作業として **RSID再生を先に対応する** と明示した。
音色取り込みは後続のまま。先に調査・TODOを残し、既存のbounded PSID playerを保って進める。

- [x] RSIDのfile／boot／timing仕様、CIA・VIC・IRQ／NMI、ROM初期化の条件を一次資料と既存参照engineで調査する。
- [x] browser用C64実行環境とlicense／ROM取扱いを決める。非対応ROM依存を黙って推測・偽装せず、対応範囲と必要入力を画面で説明する。
- [x] 自作RSID fixtureと実HVSC候補を用意し、割り込み・周辺機器がSID write／音声を動かすことを検証する。ゲーム／ROMデータを配布しない。
- [x] 既存画面のOpen SID／Play／StopへRSIDを接続し、subtune・失敗時の旧曲保持・起動取消・無音化を維持する。
- [x] 新しいcore／WASMの実行上限・render分割・再現性・異常系と、既存PSIDの回帰を確認する。
- [x] Chromium／WebKit・実ZIP、matching source／license／再build、README en／ja／AI・CI・再開記録を更新する。

### ブラウザーでSIDファイルを再生する今回の作業（2026-11-07）

ユーザーの「次に進めて」により、コマンド操作なしで `.sid` を選び、再生・停止できる入口を作る。
最初にブラウザー向けC64 program実行方法とlicense／ROM条件を確認し、対応するPSID subsetを明示する。
既存Synthの楽器編集、SDK／校正値、外部GPL参照CLIの境界を維持する。

- [x] ブラウザーで動くCPU／SID接続方法、実行上限、対応PSIDとROM／license条件を決める。
- [x] SIDファイル選択、曲情報、subtune選択、再生／停止、エラー表示と自作デモのある可読画面を作る。
- [x] AudioWorkletでprogram実行とSIDを接続し、読み込み中Stop／再読み込み／無効入力時の保持・無音化を整える。
- [x] 自作PSIDの期待write列、実音声、分割render、停止、異常入力を自動検証する。人の実聴と区別する。
- [x] Chromium／WebKit、mobile幅、配布・source／license／再ビルド手順、READMEと再開メモを更新する。

### 参照再生／比較CLIの今回の作業（2026-11-07）

ユーザーの「進めて」により、SID曲を基準にした検証を開始する。
最初は単一SID・PAL／6581の自作PSIDを対象に、既存C64再生engineを外部の検証toolとして使う。
本体のBSD／zlib runtime・Synth・WASM・SDK／校正値は変更せず、engineのlicenseと依存・ROM条件を記録する。

- [x] 参照engineの固定revision、license、build依存、PSID／RSIDとROM条件、cycle付きSID write取得方法を調査する。
- [x] 著作物を含まない自作PSID fixtureを用意し、実C64 program実行によるSID write列を検証する。
- [x] clock／model／sample rate／engine revision／入力hash／cycle順を持つbounded trace形式を定義し、無効・巨大・非対応入力を明示拒否する。
- [x] 外部engineでの参照再生／trace取得と、同じwrite列を既存Tetorica SIDへ流す比較CLIを実装する。WAVと測定JSONを保存する。
- [x] timing／render分割／再現性、wave／ADSR／filter変化、自作programの期待write列、エラー経路を自動確認する。参照engineとの差は実機一致・PCM完全一致とは扱わない。
- [x] 再現可能なbuild／実行手順、license境界、対応範囲、CIと再開メモを更新する。実ゲームSID、人の実聴、RSID／ブラウザー統合／音色取り込みは後続に分ける。

- [x] sidplayfp等を用いた外部再生／WAV比較手順を用意する。初版はPAL／6581を明示して揃え、NTSC／8580は拒否する。
- [x] PSID／RSIDのprogram実行を扱う既存engineとlicense・ROM依存を調査する。
- [x] SID再生またはtimed register trace取得を試作する。初版は外部比較CLIとし、既存VGM Player／Analyzer／browserへの統合は後続とする。
- [ ] 後続: voiceの設定と時間変化を試奏用に取り込む。snapshotだけで元のinstrumentを完全復元したとは表示しない。
- [ ] 後続: SID volume-DAC／D418 digi音声のモデルを検討する。現行m6581はDC wave／mixer offsetを0にしており、Gary等はCPU／SID writeが進んでも無音になる。既存Synth／校正／Native・WASM／source receiptへの影響を分けて検証し、RSID file対応と混同しない。

## 4. Synth／配布

### 独立Synthの今回の作業（2026-11-06）

ユーザーの「進めて」により、通常Playgroundの検証済みSidCore／SidSynthを使う独立Synthを開始する。
仮称 **Tetorica SID Synth**、product id `tetorica-sid-synth`、入口 `docs/synth-sid/index.html`。
初版は6581近似・PAL985,248Hz、Native SDK／既存校正値を変えず、共有runtime／WASMも再利用する。
名称専用iconは今回新規生成せず、既存シリーズと整合する明るい筐体色とcompact controlsで作る。

- [x] strict v1 portable preset（wave／Pulse幅／hardware ADSR／TEST／Sync・Ring／software modulator ratio／shared filter・chip volume）と可読Playground JavaScript出力を実装する。
- [x] 通常は実3voiceをround-robinで割当。steal後の古い離鍵を無効化し、hardware release中のvoiceも保持する。Sync／Ring時はsilent voice3→carrier voice1の1pairへ切り替え、最大1音にする。
- [x] Pulse幅／ADSR／filter／resonance／chip volume／ratio／Pitchは保持音へ反映する。pair topology変更・preset load・Stopは所有権と尾音を安全に破棄する。発音・pitch範囲エラーは現在音を保持して拒否する。
- [x] AudioWorkletで実coreをrenderし、lazy audio・startup中Stop・障害時の無音化／retry・FIFOのpreset反映を整備する。既存の最終Master0..380%と100%超orange、Waveform／Spectrumを使う。
- [x] 既存Synthのcompact keyboard／Octave、2箇所Pitch、stepper／slider、演奏を妨げないfocus、折りたたみ、save/load presetとCopy JavaScriptへ接続する。hardware機能とsoftware割当／ratioを明示する。
- [x] unit／実WASM／Chromium・WebKit／独立ZIPで3音・pair・live編集・保存復元・出力・keyboard・startup取消を検証する。可読JS／CSS・対応source／license／再ビルド手順を同梱しREADME・CI・再開記録を更新する。

- [x] 既存FM2612／SPU／DMG等と同じ操作感で、3声の割当、wave／Pulse幅、ADSR、shared filter、Sync／Ringを操作する。
- [x] shared filterと実voice間の依存、hardware機能とsoftware割当・modulationを区別する。
- [x] preset保存／復元、可読JavaScript出力、keyboard focus、2箇所Pitch、Master380%、waveform／spectrumへ接続する。
- [x] readable source付きWeb ZIP、README en／ja／AI、home、既存Native例・再ビルド手順への入口を用意する。
- [ ] 人が実聴し、和音／Pulse幅／ADSR／filter／Sync／Ringを確認する。
- [x] 専用iconを作成する（2026-11-07追記）。[1254px WebP](../tetorica_sid_synth.webp)・[元PNG](../tetorica_sid_synth.png)・[生成プロンプト](tetorica_sid_icon_prompt_20261107.txt)。既存シリーズと同じ寸法、C64のbeige／brownとfilter波形を使った。
- [x] 選択済みiconを採用する（2026-11-07、ユーザー「これでお願い」）。Synth header／favicon／Apple touch icon、home en／ja、配布ZIPとsource receiptへ同じWebPを反映した。既存音声コードを保持し、source／実ZIPのdesktop／390px表示とlocal画像読込を確認した。
- [ ] Webの実聴後にTauri版を検討する。

## 再開メモ

TODOを作成してから調査を開始した。第1段階のcore／Native・WASM／独立ラボは実装済み。
通常Playground modeは下記第2段階、独立Synthは第3段階、限定PSID参照CLIは第4段階、
限定browser PSID Playerは第5段階、RSIDは第6段階、PSIDのsubtune別CIA再生は第8段階、再配置情報は第9段階で対応した。
第11段階で61,157件の既定subtune監査、第12段階でC64 VBI・長いinitと対象3,297件の再検証まで完了した。全件のC64再監査や実聴・全曲互換の確認ではない。
package-root raw chip factory／Native出力／専用8580 model・完全なC64互換は後続。
`.sid`はC64演奏programとdataを含むため、単体SIDのregister APIと曲再生を別段階にする。
既存の公開済みS-DSP、SDK receipt、npm packageはこのTODO作成時点では変更していない。

## 第1段階の結果（2026-11-06）

- 採用: [chips/m6581の選定メモ](sid_core_selection_01.md)。zlib、6581専用の簡略モデル。
  GPLのreSID／libresidfpは別の比較候補として調査した。8580、実機analog個体差、SID曲再生は未対応と画面・ガイドに表示する。
- `docs/playground/sid-lab/index.html` に独立した **SID Register Lab** を追加した。
  通常PlaygroundのMode一覧に入れたとは扱わない。Play 220 Hz／3声triad／Release gate／Stop、
  Triangle／Saw／Pulse／Noise、ADSR、LP／BP／HP／Notch、cutoff／resonance、Sync／Ring、PAL／NTSC、
  同じcanvasのWaveform／Spectrumを操作する。test note／triad／output gainはsoftwareと表示する。
- `SidCore`と`SidTestInstrument`をcanonical runtimeと公開コピーへ追加。readRegisterは実bus、
  getStateのregister配列は書込みshadow。pin access1回で1cycle進み、その間のPCMを落とさずqueueへ保存する。
  12Hzのsoftware DC blockerを明記した。
- 原本を保持したmarked adaptationで、sample clockの丸め、Sync方向と同時抑止、TEST時のedge残留、
  triple-waveの論理演算、8-bit envelopeのretrigger overflow、C++ cutoff表の並列初期化を修正した。
  詳細は `third_party/chips-m6581/PATCHES.md`、生成は `scripts/prepare_sid_core.py`。
- `npm run test:sid`: **12件成功**。発音、周波数、分割render一致、register access中のPCM保持、
  filter／Pulse／Sync／Ring、release／Stop、無効編集時の保持、dispose等を実WASMで確認した。
- [Native比較](sid_native_01.json): **18ケース・1,881,000 mono frames、最大PCM誤差0**。
  44.1／48／96kHz × PAL／NTSC × 波形・変調／filter sweep／retriggerの3場面。
  self-testで20 clock条件、queue満杯、Sync／TEST／8-bit retriggerの回帰も確認する。
  Native fixtureをASan／UBSanで確認し、C++初期化は別のTSan probeでも8 threads・800 instances・1600回のreset/renderで診断0だった。
- `release/sid-validation/wav/` に自作register列のWAV2本（各2秒、PCM16、clip0）を作成した。
  実ゲームのreference音源ではなく、このcoreを試聴するための出力。
- Source kitだけをZIPから展開して別の出力directoryへ実ビルドし、WASM SHA-256が
  `7069bfb865d51c4b7493560561f42f1f1541555c867c79d969d234ee634b9025` で配布用と一致した。
  WASMは14,502 bytes。原本hash・13個のbuild入力・JS／公開sourceコピーを別receiptで検証する。
- README en／ja／AI、ラボguide、`.github/workflows/sid-lab.yml` を追加した。
  CIはunit／Native／browser／独立ZIPを実行する構成で、GitHub上の実行はまだ行っていない。
  `npm run check:runtime-artifacts` は既存33 SDK builds／66 outputs／73 mirrorsの一致を維持した。
- [Source browser](sid_lab_browser_01.json)と[独立ZIP browser](sid_lab_zip_browser_01.json)は
  **Chromium／WebKit各9項目成功**。実WASMとAudioWorkletで発音・停止・live filter／cutoff／resonance・
  Sync／Ring配線・clock変更・読み込み中Stop・processor障害からの復帰・390px表示を確認した。
  speakerはmute、page／console error・404・外部通信は0。desktop／mobile画像も目視確認した。
- [配布記録](sid_lab_package_01.json): `release/sid-lab-0.0.1.zip`、31 files、75,422 bytes、
  SHA-256 `9d2934aed0f20550e49fdb351392ac484ddac63d818438014bde78266a8ad925`。
  実ブラウザーで再生したpreview ZIPとの違いはTODOのsnapshot2件のみで、全実行asset・元sourceはbyte一致。
  ZIP CRCと原本・Native／WASM source・再ビルド手順の同梱も確認した。

上記は第1段階の記録。通常Playgroundへの接続は下記で完了した。

## 第2段階: 通常Playground（2026-11-06）

- `playground/index.html?mode=c64` に **C64 (SID 6581)** を追加。global `sid`、primary／追加instance、
  `createSoundChip('sid')`／`useSoundChip('sid')`をMain／Workerで使える。default melodyとtriad／filter sweepの3例を用意した。
- `SidSynth`とport clientで3つの実voiceのwave／Pulse幅／ADSR／Sync／Ring／TEST、音階／周波数、shared filter／routing／chip volumeを操作する。
  初期routing0・filter mode off・chip volume8でdry発音。mode offはfilter出力bits0なので、routing7のままでは無音になるhardware semanticsをガイドに明記した。
- SIDタブは3voice、shared filter、written shadowのread-only表示。表示やgetStateはbusをclockしない。
  SID向けのkeyboard audition／tabからの編集は後続。既存のkeyboard対象へ未対応SIDを出さない。
- 予約されたCTRL Gateをvoiceごとに所有し、古いloopの離鍵が新しいownerを切らない。async readRegister／getState後もcaller contextを復元する。
  keyOff／allNotesOffはhardware release、Transport Stopはqueue／envelope／DC尾音をflushして適用patchを保持する。
- modelは6581のみ、creation時clock900,000..1,100,000Hz、出力8..96kHzを検証。異なるclockへのsetClockとNative出力は明示拒否する。
- SID runtime unit **35件成功**（既存Core12を含む）。担当AのMain／Worker／既存音源のfocused回帰は14files・**691件成功**。
  mode／例／source navigation／panelの関連テストと、全mode型・default／3例のcheckJsも成功。
- `npm run build:fm2612` と実tarballの隔離offline install検証成功。403宣言のstrict check、28 WASMのロード／既存音源PCM、
  NodeNext／Bundler／Node ambient無しのbrowser型を確認。SIDの明示型3本を同梱し、raw SDK factoryへSIDを誤追加していないことも型で確認した。npm公開はしていない。
- [Source browser](sid_playground_browser_01.json)と[展開ZIP browser](sid_playground_zip_browser_01.json)で、
  Chromium／WebKit × Main／Workerの**各4構成・各7項目成功**。初期化中Stop、3例、再Run、RPC、cache／追加SID、
  live LP／BP／HPの実PCM変化、同名LoopのApply／古いfinally、SID表示と390pxでFiles非侵食を確認した。
  speakerはgain0。既存MonacoのCDN通信はeditorDependenciesへ分離記録し、想定外の外部通信・page／console error・404は0。
- [配布記録](sid_playground_package_01.json): `release/hello_ymfm_wasm_sid-playground-01_itch_playground_for_run.zip` は
  **993 entries**でitch.ioの1000件上限内。対応sourceを展開したdownload版も作成した。SIDの実行JSは可読のまま保持し、
  重複するSID source-kit scripts／typesは完全なcorresponding-source.zipへ収録する。guideに取り出し方を表示した。
  `prepare_itch_playground_run`7件とruntime artifact／builder／staging29件の検証が成功。
- 固定SDKは33 buildsのまま。SIDは別receipt付きapplication instrumentとして通常catalog／full・Playground profileへ追加し、
  **68 outputs／75 mirrors**を検証する。matching Native／WASM source、原本・license・型と再ビルド手順を同梱した。
- 既存測定JSON／target／他音源gainは変更せず、SIDはunityを明示しunmeasuredKindsへ登録した。
  [SID追加だけのsource receipt](sid_playground_source_revision_01.json)と別pinの復元helperで、既存校正時のsource hashを厳密に維持する。
  20pathsの完全なbefore／after hashと80逆差分を検証し、1byteの将来変更・gain／DSP／WASMの許可外変更を拒否する。
  このreceiptは実機精度やSID音量を測定した証拠ではない。
- 校正／source／legacyの24 test filesは`--test-concurrency=1`で**534件成功**。
  実ファイルを一時変更する拒否テストも含むため、browser／配布検証とは別枠で直列実行した。
  検証前後の336ファイルのhashを比較し変更0、receipt／両policy generatorのcheck成功を確認した。
- [ガイド](../sid.md)、README en／ja／AI、source kit、配布チェック、SID CI workflowを更新した。
  GitHub上のCI実行／commit／push／npm公開／tag作成は今回行っていない。

第2段階終了時の候補だった **SID Synthの鍵盤／3声の割当／shared filter UI** は下記第3段階で対応した。
人がC64 modeの3例とfilterを試聴する作業は残る。
外部sidplayfpや実機との比較、PSID／RSID program実行／register trace、Native SDK／出力は独立した後続として残る。

## 第3段階: 独立SID Synth（2026-11-07）

- 仮称 **Tetorica SID Synth** を `docs/synth-sid/index.html` に追加。
  固定PAL985,248Hz・6581近似の既存SidCore／SidSynthを再利用し、共有runtime／WASM／既存校正値を変更していない。
  固定SDK33 buildsを保持し、runtime artifacts全体の68 outputs／75 mirrors、両Mixer policyのcheckも成功した。
- 通常は3実voiceのround robin。未使用／envelope0、古いrelease tail、古いheldの順に割り当て、stale noteOffを拒否する。
  Sync／Ring時はsilent voice3→carrier voice1の1pair・最大1音。ratio／Pitch／鍵盤割当はsoftwareと画面で区別する。
  RingはTriangleのみ。sourceのGateはOFF、filter routing対象外・voice3offで、位相によるhardware couplingを使う。
- wave／Pulse幅／ADSR／filter／resonance／chip volume／ratio／Pitchのlive編集はheld所有権と位相を保持。
  範囲外のnote／ratio／Pitchはrelease中のvoiceも含め事前検証し原音を保持する。
  Sync／Ring／TEST変更・preset load・Stopはheld／tailをflushしPitch0へ戻す。
  実SIDのrapid Gate／ADSR255のwrap・freeze挙動はraw coreと一致させ、software envelopeの補正を追加していない。
- 最初の鍵盤／Enable時だけaudioを作る。startup中の離鍵・Stop、fatal後の無音化と明示retry、FIFO ACKを検証した。
  coalesceされたload／topologyのreset義務をlatestへ継承し、古いStop ACK／連続invalid Pitch／未ACK draftでheld keyを失う競合も修正した。
- compact keyboard／Octave、2箇所Pitch、stepper／slider、演奏を妨げないfocus、折りたたみ、post-Master Waveform／Spectrumを接続。
  Masterは0..380%、100%超はorange。filter modeの選択で自動Enableし、OFF時はdryへrouteする。
  strict v1 JSONは最大64KiB、cancel／invalidは既存presetを保持。Copy JavaScriptは同じC64 APIで試奏できる。
- `npm run test:sid-synth`: **42件成功**。実WASM44.1／48／96kHzで独立した手書きregister列とのPCM完全一致、
  Copy JavaScriptの実行・PCM一致、割当／尾音／配線／live編集／atomic reject／startup取消／UI競合を確認した。
  最終CSS変更後にも配布テスト2件を再実行し成功。
- [Source browser](sid_synth_browser_01.json)／[実ZIP browser](sid_synth_zip_browser_01.json)は、
  **Chromium／WebKit各11項目、計44チェック成功**。実PCMのfilter変化、380%とMaster比率、rapid load／topology、
  error復帰、390pxの横overflow0、閉じたpanelの高さを確認した。page／console／HTTP error・外部通信は0。
  speakerは最終gain0で無音化し、人の実聴は行っていない。Stop後の実PCMはRMS／peak0。
- [配布記録](sid_synth_package_01.json): `release/tetorica_sid_synth_0.0.1_itch.zip`、
  **57 files／234,160 bytes**、SHA-256 `93b905423e26d7b33b8e5c8a1713a94ca05e1e35077b109643b354000779d501`。
  可読JS／CSS14 modules、26個の元browser入力とhash receipt、元WASM、13個のNative build入力、原本／license／再ビルド手順を同梱。
  独立した2回のpackagingでZIP byte一致、全元入力と最終sourceのhash一致、CRC、local import／WASMのclosureを確認した。
- README en／ja／AI、両home、feature status、Synth guide、配布手順と `.github/workflows/sid-synth.yml` を更新。
  GitHub上のActions実行・commit／push・tag・公開は行っていない。

次は人が `/synth-sid/index.html` で3声、Pulse幅、ADSR、filterのCutoff／Resonance、TriangleのRingとSyncを実聴する。
名称案はTetorica SID Synth、専用iconは上記で作成した。Webの実聴後にTauriを検討する。
SID曲／音色抽出、外部reference／実機比較、Native出力は別TODOとして残る。

### 選択iconの採用（2026-11-07）

- ユーザーが選択したbeige／brownの1254px WebPをheader、favicon／Apple touch、英日homeへ適用。
  desktop112px／mobile72pxで表示し、音声JS／WASMは変更していない。
- 配布は同じWebPをlocal同梱し、root／nested entry両方のhref／srcを調整。
  元WebPと生成プロンプトをsource archive／hash receiptへ含め、PNG原本はrepositoryへ保持する。
- 配布テスト2件成功。[Source](sid_synth_icon_browser_01.json)と[実ZIP](sid_synth_icon_zip_browser_01.json)は
  Chromium／WebKit各12項目、**計48チェック成功**。画像3参照のSHA・1254角、homeの参照、1180px／390pxの横overflow0、
  従来の演奏／filter／preset／停止も確認した。page／console／HTTP error・外部通信0、speakerはmute。
- [配布記録](sid_synth_icon_package_01.json): `release/tetorica_sid_synth_0.0.1-icon_itch.zip`、
  **57 files／1,301,238 bytes**、SHA-256 `a7001d835a0893c6c9aea4f86373bf2bb867fb502fcc148b7461f9a1716260a0`。
  WebPは元とbyte一致、27個のbrowser入力も最終sourceのhashと一致する。旧0.0.1のZIP／検証記録はその時点のsnapshotとして保持した。
  CIの監視対象にもicon／生成記録／両homeを追加した。commit／push／公開は行っていない。

## 第4段階: 外部PSID参照／比較CLI（2026-11-07）

- [手順・対応範囲](../sid-reference.md)。`npm run sid:reference -- --fixture melody-filter --seconds 2`
  で自作PSIDを実C64 programとして実行し、PHI2 cycle付きのSID write、参照／Tetorica／DC前のfloat WAVと比較JSONを保存する。
  `npm run sid:reference -- ./my-tune.sid --subtune 1 --seconds 10 --offline` も使える（先に参照toolをbuildする）。
  毎回uniqueなdirectoryを作り、入力・既存の測定・WAVを上書きせず、deviceは開かない。
- 外部toolはGPL-2.0-or-laterのlibsidplayfp **3.1.2**（`b1e8f1deedf41d343123319237c0d008d72cbea7`）と
  libresidfp **1.2.3**（`32c8525418a643eaed8dfafa3d7039e250050cfa`）。official release archiveのSHAを固定する。
  [license／再ビルド](../../third_party/sid-reference/README.md)・GPL通知・元archive・marked patchのbefore/after hashを保持。
  参照専用GPL adapterを別processにし、browser／npmのentry closureや既存SDKへ追加していない。
- 元libresidfpのfilter table初期化が並列に共有dither stateを更新して微小な実行差を出すことを確認し、
  参照toolだけに **serial-table-init** patchを適用。初期tableの順序だけを固定し、DSP式／gain／sampling式は変えていない。
  engineを`1.2.3+serial-table-init`と識別する。36回の4profile／3rate／chunk・repeat検証でPCM／write列が一致し、
  patch前後のCPU write列も同じだった。両hostの初期register／volumeは0に揃え、上流から要求されたreset volume15は別metadataで保持する。
- 初版は **PSID v2・単一SID・明示PAL／6581・全VBI・relocation0・RAM$0800..$CFFFのexplicit init/play**。
  ROM dump／ゲーム音楽を同梱せず、upstream KERNAL stubで動く自作programを使う。
  parserのv3/v4 metadata対応と実行subsetを区別し、RSID・CIA速度・IRQ play0・NTSC／8580・追加SID等は理由付きで拒否する。
  実ゲームdriverのROM独立性や完全再現をheaderだけで保証していない。
- `tetorica-sid-trace` v1は32MiB／最大100万write、clock985248Hz、cycle0からtick後commit、終端exclusive。
  同cycle重複・逆順・範囲外・coercion・非JSON metadata等を拒否し、RO／reservedを含むreg0..31や同値writeも省略しない。
  読込はfdを固定して上限+1byteまでに抑え、file成長でも無制限にreadしない。compact保存と読込の上限を一致させた。
- 新Native replayerは既存patched m6581を直接tickし、write中のsampleを含め全部回収する。
  既存12Hz DC後／rawを分け、render()でwrite時刻をsample境界に丸める処理をしない。
  実WASMと44.1／48／96kHzでPCM・register・ENV・phaseが一致し、chunk1／17／128／4096／8192でも同一。
- 参照clock985248.611111／sampling float985248.625とTetorica整数985248を別記する。
  参照の2段RESAMPLEの1/1024周期量子化により、48kHz指定でも実効約48010.4765Hzとなるframe差を保存する。
  CPU eventの終端overshootと、SID自身を指定cycleでclampする処理も区別した。
  元PCMのgain／DC／位相／長さを補正せず、共通index範囲のRMSE・correlation・level／bandを診断値として出す。
  waveform・filter等の差は別model間の測定結果であり、実機一致の合否には使わない。
- `npm run test:sid-reference`: **29件成功**。PSID／trace異常系、元bytecode、実WASM、time／chunk／DC、
  float WAVの非clip保存、compiler／flags／OS／archのcache改変拒否、bounded読込を確認した。
- [統合結果](sid_reference_comparison_01.json): **6ケース＋完全repeat＋init0の2load形式** が成功。
  toneを44.1／48／96kHz、pulse／noise／melody-filterを48kHzで実行し、各init36write＋play順が期待値と一致した。
  既知A4のpitchも確認。player event chunk4096→1／render chunk4096→1でtraceと両backendのPCMが完全一致。
  initAddress0がeffective loadへ解決されることを、embedded／explicit loadの実CPU実行・PCM一致で確認した。
- `.github/workflows/sid-reference.yml`、README en／ja／AI、SID guide／feature statusを更新。
  固定SDK33 builds／全68 outputs／75 mirrorsと、両Mixer policy checkも成功。runtime／WASM／校正値は変更していない。
  GitHub上のCI実行・commit／push・npm／Web公開は行っていない。

第4段階のコマンドと比較WAVはAI側の検証用。ユーザーには第5段階のbrowser画面を入口として案内する。
時変parameterを含む音色取り込みは後続。
CLIの比較結果をSynth音色の完全復元や実機精度と呼ばない。

## 第5段階: ブラウザーSID Player（2026-11-07）

- 入口は `docs/sid-player/index.html`。**Load demo → Play**、または **Open SID… → Play**。
  ファイルはブラウザー内で処理しuploadしない。曲名／作者／subtune、3voiceのwave／frequency／Pulse幅／Gate／ENV／ADSR、
  shared filter、post-Master Waveform／Spectrumを表示する。Master0..380%と100%超orangeを継承。
- GPL参照engineをbrowserへ移さず、同じ固定revisionのzlib **chips/m6502** と既存のadapted **m6581** を
  新しい独立WASMで接続。既存Synth／Playground SID WASM、固定SDK33 builds／68 outputs／75 mirrorsは変更していない。
  CPUの1bus cycleでSIDも1tick進み、writeはtick後commit。実SID readも同じbusで処理する。
- 初版は **PSID v2・明示PAL／6581・単一SID・全VBI・relocation0/0・RAM$0800..$CFFF・explicit init/play**。
  65,660-byte上限。init=0はload addressへ解決し、subtuneは1-based。共有parserをbrowser-safeに抽出しCLI互換entryも維持した。
  Windows-1252 metadataのdecodeはpure JSで、TextDecoderのないAudioWorkletでもimportできる。
- 完全なC64の代わりにbounded init/play driverを提供する。RAM／stack／JSRを用意し、initはA=subtune-1、
  playはA/X/Y=0。init上限100,000 cycles、play上限16,000 cycles、PAL frame19,656 cyclesごとに呼ぶ。
  init中の音声を保持し、initで過ぎたVBIをまとめて呼び戻さない。RSID／CIA／VIC／IRQ／ROM依存／非対応bankingは理由・address付きで拒否する。
  $A000..$BFFFのentryを呼ぶ際、BASICがmappedならLORAMだけclearして$37→$36にする。
  これはPSID host側のbank選択で、SID I/Oを隠さず、既に適合するmapは保持する。
- 旧CLIのlibsidplayfp driverには起動warmup／IRQ／driver命令があり、browser direct hostと絶対cycleは異なる。
  自作toneの最初のwriteはCLI168,000、browser16で、どちらも同じsubroutine内のSTA間隔は6cycles。
  driverを跨ぐPCM完全一致とは呼ばず、browserが記録した同じcycleのwriteを既存SidCoreへ再生したPCM一致を確認する。
- 候補のparse／initと最初0.25秒の無音preflightが成功するまで選択・再生中の曲を保持する。
  Stopは起動中のengineも即disposeし、遅れたACKで再発音させない。subtune変更取消時もaccepted選択へ戻す。
  persisted pagehideは音声だけ退役し、Back/Forward復帰後も同じ選択から再生できる。
- [HVSC metadata調査](sid_player_hvsc_metadata_01.json): ユーザーの `ww/C64Music`（Release85）をread-onlyで確認。
  **61,157件中15,214件**がheader条件を通過した。これは再生成功数ではない。
  [実WASM実行](sid_player_hvsc_playback_01.json): 候補10曲・16subtunesを各2秒、**14件でfinite/nonzero PCMとStop後0**。
  残り2件はCIA$DC04／VIC$D020で明示拒否。Cybernoidは両subtune成功。
  入力hash／metadata／scalar測定だけを保存し、ゲーム音楽／PCM／ROMを配布物へコピーしていない。実聴・長時間再生・原曲との一致は未確認。
- [配布記録](sid_player_package_01.json): 可読JS／CSS・自作4demoと元generator・source receipt・license・matching native source kitを同梱。
  source kitだけから別directoryへ再buildしたWASMが配布用とbyte一致した。
  最終WASMは74,012 bytes、SHA-256 `a47d619195117e2b4b0a43de06cd99eaa3da05e25364c9b070aa92b48a920491`。
  最新候補は `release/tetorica_sid_player_0.0.1-preview4_itch.zip`、40files／1,293,564bytes、
  SHA-256 `48f7737c4fe6fd87b4784bcc254465ac006cd1cbe98e1178ccebc642d6ababca`。
  旧preview〜preview3は修正前の履歴で、今回の最終候補には使わない。
- `npm run test:sid-player`: **27件成功**。4自作program×44.1／48／96kHz×chunk1／128／4096、
  期待CPU write列と6cycle間隔、VBI周期、既存SidCoreへの同cycle replay PCM一致、OSC3／ENV3 read→STAと実read値一致、
  A000／BFFFのinit／playとbank再選択、96kHzで4096を超えるinit音声queue、atomic load／Stop／fault無音化を確認。
  parser／TextDecoderなしWorklet／bounded input、RPC起動・取消、metadata scan、可読ZIP・hash／CRCも含む。
  既存SID Synth42件、PSID CLI／trace／共有parser関連38件、外部CLI6ケース＋repeat＋init0の2load形式も成功した。
- [Source browser](sid_player_browser_01.json)／[実ZIP browser](sid_player_zip_browser_01.json):
  **Chromium／WebKit各11項目、計44チェック成功**。実PCM・4demo・2subtune・pending preflightの取消・
  pending startのStop・不正候補で旧曲保持・runtime fault復帰・Master比率・380%・1出力pathを確認。
  persisted pagehide/pageshowはsynthetic eventでの停止・再Play確認で、実historyのBFCache適用条件を保証しない。
  desktop1180／mobile390のpage overflow0。mobileのcanvasはCSS幅に合わせ文字の縮小潰れを防ぎ、画像も目視した。
  page／console／HTTP error・外部通信0。speakerは最終gain0でmuteし、人の実聴はしていない。最終PCMはRMS／peak0。
- README en／ja／AI、両home、SID Synthからのlink、guide、feature statusとSID Player専用CIを更新。
  commit／push／公開・npm更新はしていない。ローカル入口は `http://localhost:8008/sid-player/index.html`。

PSID曲の再生はユーザーが実聴して「再生はできてる」と確認した。RSID未対応エラーの説明後、
次は音色取り込みよりRSID再生を先にする、と明示されたため下記第6段階へ進んだ。
その後、演奏中のvoice設定／時間変化から試奏用の音色を取り込む設計へ進む。
瞬間snapshotを元instrumentの完全復元とは扱わない。RSID／CIAは下記で進め、8580等の拡張は別の段階とする。

## 第6段階: RSID再生（2026-11-07）

- 同じSID Playerへ **RSID v2／PAL／単一6581** の入口を追加した。自作 **RSID · CIA interrupt** demoも選べる。
  `Open SID… → Play` は共通。PSIDは従来のbounded VBI backendを使い続ける。
- RSIDは固定revision `9e88298ce56319953ac7a43213a1120359f7a3a6` のzlib **chips/c64** とCPU・CIA1/2・VIC・既存adapted SIDを連続clockする。
  CPUへIRQ／NMIが届き、音楽program自身のhandler／RTIが演奏を進める。hostの周期play呼出で代用しない。
  upstream C64 headersは無変更のC11、既存SIDとoriginal hostはC++17の別TUでlinkする。
  SID DSP／既存PSID WASM／Synth／固定SDK／校正値は変更していない。
- 新しい `sid_rsid.js` は旧PSID parser／CLIと分離。RSIDのreserved load/play/speed、全RAMのload、非ROMのinit、
  BASICのinit0、byte上限65,660、1-based subtune、relocation、version／clock／modelを検証する。
  不明・両対応flagはcheckboxでPAL／6581を明示選択した場合だけ受け付け、既知NTSC／8580／複数SIDは拒否する。
- 既定は独立に書いたBSDの限定boot／IRQ／NMI shim。元C64 ROMやGPL player/stubを使わない。
  RSID規約のCIA1 timerA／VIC／bankを初期化し、未実装のmapped ROM data／codeはaddress付きで拒否する。
  initの100,000-cycle preflight後に戻っていなくてもbusy loop／IRQ演奏を継続できる。固定queue16,384frames、出力8..96kHz、chunk4096。
- 任意のuser ROM modeはCharacter4KiB／BASIC8KiB／KERNAL8KiBをmemoryだけへ読む。
  exact sizeをread前に検証し、detached copyで候補へ渡す。保存／upload／自動download／配布への収録はしない。
  2,000,000-cycle boot音声を捨てた後にprogramをphysical RAMへloadし、RUN／SYS、$030Cのsong値を渡す。
  自作synthetic firmwareでBASIC SYS／RUN／songの経路を検証したが、実Commodore firmware／一般BASIC曲の互換性は未確認。
- failed candidateは旧曲／ROM snapshot／次のPCMを保持する。ROM read中のApply／新規候補は旧ROMを誤採用しないよう拒否し、
  古いread完了を最新ROMへ上書きさせない。accepted曲のPlay／subtuneは保存済みROMを使う。
  Stopしたsubtune候補はApply retry先へ残さず、数値Native error codeも正常な失敗として表示する。
- [RSID header調査](sid_rsid_hvsc_metadata_01.json): local HVSC Release85のRSID3,924件、うちnonBASIC3,335／BASIC589。
  明示PAL／6581のnonBASIC候補2,319件。header候補数は再生成功数ではない。
  [実WASM](sid_rsid_hvsc_playback_01.json)は候補6曲を各2秒、**6件CPU実行・5件nonzero PCM・全Stop0**。
  GaryはD418-only volume-DAC/digiとみられ、SID writeが進むがPCM0。既存SID modelの未対応として隠さず記録した。
  music／ROM／PCMは同梱せず、hash／metadata／scalar測定だけを保存する。原曲との実聴一致や長時間再生は別確認。
- `npm run test:sid-player`: **50件成功**。自作CIA IRQ／VIC raster IRQ／SEI中NMI／one-shot／no-ack／可変timer／busyloop、
  44.1／48／96kHz×chunk1／128／4096のPCM・trace・CPU state一致、mapped ROM data/code／JAMのaddress、ROM所有権／Stop、
  synthetic firmware、旧PSID、parser、RPC、ZIPとuser ROM除外を確認した。
- 新RSID WASMは102,775bytes、SHA-256 `496f32f4bbdf2d788f42124c385da033861852b738147f59b61a338580b91a18`。
  matching source kitだけから別directoryへrebuildして同一WASMを確認した。独立receiptは `scripts/sid_rsid_artifacts.mjs --check`。
  [配布記録](sid_rsid_player_package_01.json): `release/tetorica_sid_player_0.0.2-rsid-preview_itch.zip`、80files、10 readable modules。
  最終ZIPは1,543,175bytes、SHA-256 `55375c33d86e1b324e26c1f5550da420989dc02c964ab00c4b5e25361952d6a6`。
- [Source browser](sid_rsid_player_browser_01.json)／[実ZIP browser](sid_rsid_player_zip_browser_01.json):
  **Chromium／WebKit各21項目、計84チェック成功**。旧PSID、RSID CIA/raster/NMI/multispeed、busyloop、
  数値Native ROM errorで旧曲保持、unknown flagsの明示Apply、synthetic3ROM/BASIC／song、取消候補のretry非採用、
  遅いROM read・ROM_PENDING・accepted ROM所有権、RSID起動取消、backend切替、storage書込0を確認。
  1180／390pxでROM controlsを開いてoverflow0、画像も目視確認した。未Applyの設定をaccepted曲へ混ぜない。
  page／console／HTTP error・外部通信0、最終PCM RMS／peak0。speakerはgain0でmuteし実聴はしていない。
- 固定SDK33 builds／68 outputs／75 mirrors、既存PSID／SID source receipts、両Mixer policy checkも成功。
  target amplitude `0.12881777435541153` と既存gainを保持した。旧PSID parser／CLIと両従来WASMはbyte不変。
- README en／ja／AI、home en／ja、player guide／scope、feature status、CIを更新。
  commit／push／tag／公開・npm更新はしていない。人はページをreloadして、RSID demoか
  `ww/C64Music/MUSICIANS/T/Tel_Jeroen/Hard_Rock.sid` 等の対応曲を試す。

次の候補はD418 digiモデル、実ROM／BASIC・長時間／実聴の確認、または音色取り込み。
RSID完全互換や実機精度の保証とは扱わず、ユーザーの優先順を確認して進める。

## 第7段階: PSIDのclock／model明示選択（2026-11-07）

- ユーザーがPSIDの「PAL／6581を明記する必要がある」エラー2種を報告した。
  不明／両対応flagと、実際に非対応のNTSC／8580専用を区別し、browserだけ明示選択を許可する。
- private構造parserを共有しつつ、公開 `parsePsid` はstrict PAL／6581条件・戻り値・exportを維持した。
  `validateBrowserPsid(bytes,{clock:'pal',model:'6581'})` は不明／両対応を受け付け、未選択時は `PSID_CHOICE_REQUIRED`。
  既知NTSC／8580は明示optionでも拒否する。v2／VBI／relocation0／RAM／entrypointの従来制約は維持。
  original bytes／flags／raw clock・modelは書き換えず、selectedClock／selectedModel／selectionを別に持つ。
- 共通パネルを **Playback settings · PAL / 6581 & RSID ROMs**、ボタンを **Apply / retry SID** とした。
  エラー時は設定を開き、**Use PAL / 6581 → Apply / retry SID → Play** で失敗したファイルを再選択せず試せる。
  PSIDはRSID ROMの未選択／読込中でもOpen／Applyでき、subtuneはaccepted targetを保つ。
  取消した候補はretry先へ残らず、Play／Workletで再検証する際にもclock／model optionを渡す。
- `SidPlayerCore.getState()` は実行値model6581／clockHz985248を保ち、declaredClock／declaredModel／detached targetSelectionを追加。
  新しいmetadataもnative候補成功時だけcommitし、失敗時は旧機械・metadata・次のPCMを保持する。
- `npm run test:sid-player` **55件成功**、CLI／trace／metrics **29件成功**。
  [外部参照の回帰](sid_reference_target_choice_01.json)は6ケース＋完全repeat＋init0の2load形式が成功し、
  旧baseline6ケースのwrite hash・参照／Tetorica／raw PCM hashがすべて一致した。WASM／Native／SID DSPは変更していない。
- [実HVSC検証](sid_psid_target_choice_hvsc_01.json): 元ファイル無変更、各2秒48kHz。
  A_P_E_X_preview（unknown/unknown）、Addams_Family（PAL/unknown）、Task_Force（PAL/any model）の3件で有音・Stop0。
  同じ3件はstrict CLIでは従来どおり拒否し、PAL/8580とNTSC/6581の実ファイル2件もbrowserで引き続き拒否した。
  入力hash／metadata／scalarのみを保存し、曲／PCM／ROMは同梱しない。
- [配布記録](sid_psid_target_choice_package_01.json): `release/tetorica_sid_player_0.0.3-target-choice-preview_itch.zip`、
  80files／10 readable modules／1,546,049bytes、SHA-256 `aa059accfeb783072903064f9ca1dd9185309821a83e0f7f5d584bae7c421f97`。
  両native WASMは前RSID版とbyte一致。旧PSID／RSID package記録は保持した。
- [Source browser](sid_psid_target_choice_browser_01.json)／[実ZIP browser](sid_psid_target_choice_zip_browser_01.json):
  **Chromium／WebKit各24項目、計96チェック成功**。追加3項目でPSID choice errorの旧音保持・設定開示、
  Applyから実Workletへ届くraw declaration／selected target／PCM、未Applyのcheckbox変更後のsubtune、取消後Apply、
  RSID ROM未選択／読込中でもPSIDが独立してOpen／Applyできること、既知NTSC／8580の保持付き拒否を確認。
  既存PSID／RSID・ROM・Stop・Master・mobile項目も成功。page／console／HTTP error・外部通信0、
  1180／390pxのoverflow0、speakerはmuteで最終PCM RMS／peak0。人の実聴は別。
- ガイド・英語AI README・TODOを更新。commit／push／公開・npm更新はしていない。

## 第8段階: PSIDのsubtune別CIA再生（2026-11-07）

- 選択songのspeed bitでVBI／CIAを決める。bit31はsong32以降にも適用する。
  VBIは既存bounded host、CIAはC64 machine／CIA1 Timer Aの実IRQからoriginal RAM driverでplayを呼ぶ。
  strict `parsePsid`／参照CLIはVBI限定のまま。既知NTSC／8580の拒否と元のheaderを保持した。
- CIAの初期latchは$4025、他timerは停止・$FFFF。initのlatch／control／IRQ mask変更を保持し、
  play後にICRをackする。init100k／play16k cycles、A／X／Y／bank復元、optional ROM boot、
  候補失敗時の旧機械・次PCM保持に対応。RSIDのnonreturning initは従来どおり許可する。
- Main／Workletをsubtune単位で切替え、CIA／VBI表示とplay回数を追加した。
  ROM読込中はCIAの新規Applyを待ち、VBIは独立して使える。
  適用済みROMはCIA→VBI→CIAでも保持し、未Applyのdraftや読込中の差し替えに置換されない。
- `npm run test:sid-player` **68件成功**、`npm run test:sid-reference` **29件成功**。
  自作CIA10テストで44.1／48／96kHzとrender分割、可変周期、IRQ mask／停止、ICR観測、
  bank、ROM初期値、timeout、Stopを確認した。旧RSIDのPCM／trace／状態は12ケース完全一致。
- [実HVSC](sid_psid_cia_hvsc_playback_01.json): 各2秒48kHz、CIA5件すべて有音・Stop0。
  VBIも2件成功、上記2件の既存I/O制限は明示した。曲／ROM／PCM payloadは保存・同梱しない。
- [source kit再build](sid_psid_cia_sourcekit_rebuild_01.json): 独立コピー29 inputsのみで再生成し、
  104,302bytesのWASMとreceiptが公開コピーへbyte一致。
  WASM SHA-256 `188bfbf25383233ca6cf820fa1fb753016969c1e76220ab06b3ed7a5c929fe00`。
- [Source](sid_psid_cia_browser_01.json)／[実ZIP](sid_psid_cia_zip_browser_01.json):
  **Chromium／WebKit各26項目、合計104チェック成功**。CIAの実Worklet音声・backend往復・ROM保持、
  既存VBI／RSID／BASIC synthetic firmware・失敗保持・取消・Masterを確認した。
  1180／390px overflow0、page error0、最終PCM0。physical outputはmuteで、人の実聴は別。
- [配布記録](sid_psid_cia_package_01.json):
  `release/tetorica_sid_player_0.0.4-cia-preview.1_itch.zip`、80files／10 readable modules／1,554,732bytes。
  SHA-256 `65116b390424588789ae949a23b6df0f889ac6836a307131e7efaab5db8fd797`。
  可読JS／CSS、matching native sources／license、68 original inputsのsource ZIPを検証した。
- 固定SDK33 builds／68 outputs／75 mirrorsと両Mixer policy checkは成功し、既存gainを保持。
  SID Synth／Playground音源、旧VBI WASM、npm／Native SDKは変更していない。
  README英日AI・guide・CI trigger／test登録を更新した。commit／push／tag／公開はしていない。
- 8580は専用model候補と採用条件を上のTODOへ記録した。6581 preview overrideは追加していない。
  実ROM／BASIC、長時間・実聴、D418 digi、音色取り込みも後続。

## 第9段階: PSIDの再配置情報（2026-11-07）

- `0/0 only` のbrowser guardを置き換え、VBIは正当な空き領域と$FF/0を受理する。
  CIAは明示範囲内のalways-visibleな1pageへ独自driverを配置する。音楽payload、header、entrypointは移動しない。
  $FF/0／利用可能pageなしのCIAは具体的理由で拒否し、不正範囲やpayload overlapも従来どおり拒否する。
- native側もpage範囲とpayload overlapを再検証し、IRQ／NMI／caller／bootstrapのemit境界を設けた。
  parserとstateに元のrelocation情報、選んだpage／実driver addressを保持し、UIに空きRAMと配置先を表示する。
  古いWASMのexport不在・配置address不一致は候補のみ破棄し、旧音と次PCMを保つ。
- `npm run test:sid-player` **76件成功**、`npm run test:sid-reference` **29件成功**。
  $20／$CFの1page配置、旧$0400／$0600／$0700領域を使う自作programの保護、44.1／48／96kHzの
  分割render、FF/0・不正範囲・ABI不整合時の保持を確認。旧CIA0/0の9ケースとRSID12ケースは
  PCM／trace／状態が完全一致し、既存VBI WASM・SID DSPは変更していない。
- [実HVSC](sid_psid_relocation_hvsc_01.json): Ski Weltcup／Bullseye／Hooper／Monty Moleの
  4ファイル×2subtunes、**8件すべて有音・Stop0**。CIA4件は宣言された$08／$20／$09／$04ページ、
  VBI4件は既存backendで実行した。元ファイル無変更、曲／ROM／PCM payloadは保存・配布しない。
- [独立source kit再build](sid_psid_relocation_sourcekit_01.json): 29 inputsのコピーだけから再生成し、
  WASM113,890bytes・receiptとも公開コピーへbyte一致。
  WASM SHA-256 `ef6ae771513cea3ec2f6bd6af90c2074c96ac733c5466fdc165a0b5c3480dc4e`。
- [Source browser](sid_psid_relocation_browser_01.json)／[実ZIP browser](sid_psid_relocation_zip_browser_01.json):
  **Chromium／WebKit各28項目、合計112チェック成功**。追加2項目で元metadataと実driver address、
  再配置CIAの実PCM、FF/0 VBIからCIAへの切替拒否、不正候補時の旧音保持を確認した。
  既存ROM snapshot／Stop／Masterと1180／390px表示も成功。physical outputはmuteで実聴とは別。
- [配布記録](sid_psid_relocation_package_01.json):
  `release/tetorica_sid_player_0.0.5-relocation-preview_itch.zip`、80files／10 readable modules／1,561,381bytes。
  SHA-256 `6921f7830a5bb16e22dfdbcd554dd5deaf32edadc4dab87d2caaeea74197aebf`。
  source ZIPの68 original inputs、同梱native sources／license、全hash・CRC・実展開file一致を確認した。
- README英日AI・home・guide・scannerの対応範囲を更新。既存CIが今回のtest／fixtureも実行する。
  固定SDK33 builds／68 outputs／75 mirrors、両Mixer policy checkは成功。commit／push／tag／公開はしていない。
  8580、実ROM／BASIC・長時間／実聴、VBIのfull C64 I/O、D418 digi、音色取り込みは引き続き後続。

## 第10段階: Zyx.sidのindexed storeとVBI実行環境（2026-11-07）

- 添付Zyx.sidはlocal HVSCと同一746bytes、SHA-256 `86636945eefd200ef6ebdaee2af0afba48a21f7c0064c51bd380887e0bc1c373`。
  init750cyclesで戻り、`STA $D3FF,X`がSID $D418へ書く前のdummy read $D318で止まっていた。
  最初の$1EE4 timeoutとは別症状とユーザーも確認した。元timeoutの入力は未特定で、上限を増やしていない。
- 固定m6502の正確なSTA abs,X／abs,Y／(zp),Y cycleで、wrong-page addressと補正後SID addressを照合する。
  返り値を使わない副作用なしVIC readだけを通し、CPU／SID clockは進める。
  read-to-clearの$1E／$1F mirrors、実VIC／CIA／ROMアクセス、他opcodeは引き続き拒否する。
- 必須PAL flag $02A6=1と、毎callのentry bank $37／$36を修正した。
  init100k／play16k上限は維持し、timeoutのphaseを区別、12種類のCPU JAM/KILをcode10／opcode addressで報告。
  読込失敗時の表示に候補ファイル名を加えた。
- `npm run test:sid-player` **83件成功**、参照CLI／trace／metrics **29件成功**。
  PAL分岐、12 bank組合せ、STA3方式の25 register blockと独立SidCore PCM／readback、
  timeout／JAM／実I/Oの区別・旧音保持を確認。従来4fixture×3rateのVBI12ケースはPCM／trace／状態が完全一致。
- [Zyx実ファイル](sid_zyx_vbi_verification_01.json): Native／実WASMとも10秒、501plays、RMS約0.113528／peak約0.351852、
  finite／有音・Stop0・cycle停止。入力は無変更、曲／PCM／ROMは保存・同梱しない。
  ユーザーは音が正常になっていそうとコメントした。全曲の実聴確認とは分ける。
- [source kit単独再build](sid_vbi_environment_sourcekits_01.json): VBI14inputs／C6429inputsで両WASM・receiptがbyte一致。
  VBI74,326bytes SHA `467a893714280a9830bb421dd255aac4ad7956fa8fd2895359a5e056cb98ab76`。
  共有CPU guide修正のためC64 receiptも更新したが、C64 WASMは前ef6ae771…480dc4eと不変。
- [Source browser](sid_vbi_environment_browser_01.json)／[実ZIP browser](sid_vbi_environment_zip_browser_01.json):
  **Chromium／WebKit各29項目、計116チェック成功**。追加項目でPAL／bank／STA／phase診断と候補名・旧音保持を実Workletで確認。
- [配布記録](sid_vbi_environment_package_01.json): `release/tetorica_sid_player_0.0.6-vbi-env-preview_itch.zip`、
  80files／10 readable modules／1,566,529bytes、SHA `b758542f6c9152f3e5ce5b2aa057658f8ab62df289dba68249b8969de031a5f8`。
  original inputs68件、matching sources／license、ZIPのhash・CRC・実展開一致を検証した。
- 固定SDK33 builds／68 outputs／75 mirrorsと両Mixer checkは成功、SID Synth／PlaygroundのDSP・gainは不変。
  commit／push／tag／公開はしていない。次は上のローカルHVSC全体監査を進める。

## 第11段階: ローカルSID corpus全体監査（2026-11-07）

- [全体結果](sid_corpus_audit_01.md)と[独立検証](sid_corpus_audit_verification_01.json): 61,157件すべてを分類し、27,547件が既定subtuneの2秒／48kHz実行・有限PCM・Stop検証を完走した。Direct VBIを使った当時のbaselineで、今回のC64経路とは区別する。
- 全件resumeは追加0件・入力manifest／fingerprint／checkpoint不変。元曲／ROM／PCMはコピー・同梱していない。全subtune・曲全体・実聴の確認は後続。

## 第12段階: C64 VBIと長い初期化（2026-11-07）

- 上の6作業は完了。[結果報告](sid_c64_vbi_result_01.md)に設計、対象限定再検証、残る制限と再開情報をまとめた。UIのdefaultはC64 machine、Direct VBIは明示選択。元header・payload・VBI timingを保ち、driver空きRAMがない場合は理由付き拒否とする。
- `npm run test:sid-player` **93件**、`npm run test:sid-corpus` **10件**、`npm run test:sid-reference` **29件**が成功。[Source](sid_c64_vbi_browser_01.json)／[実ZIP](sid_c64_vbi_zip_browser_01.json)のChromium／WebKit各31項目、**合計124チェック成功**。Stop／失敗保持・ROM snapshot・subtune・mobile表示を確認した。
- [実ファイル7ケース](sid_c64_vbi_verification_01.json)を各10秒確認し、すべて有限PCM・nonzero・init復帰・Stop成功。Western Games全3subtunesを含む。synthetic firmwareでの確認を含むが、実Commodore ROM／BASIC互換の検証ではない。元$1EE4のユーザー入力は未確認として区別する。
- [対象再検証](sid_c64_vbi_retry_01.json)は3,297件完了。旧失敗3,233件のうち3,025件が完走（nonzero3,015／全zero10）。control64件はstatusを維持し、CIA／RSID32件はRMS／peakも完全一致した。全完走3,089件で96,000frames／有限PCM／Stop zero・CPU停止／PSID init復帰を確認した。[独立比較18項目](sid_c64_vbi_retry_comparison_01.json)とresume追加0件・全hash不変も成功。全61,157件の再監査ではない。
- [source kit単独再build](sid_c64_vbi_sourcekit_01.json)は29 inputsのみからWASM116,131bytes・receiptがbyte一致。WASM SHA `d05d625d863c434e6992a2b553019b4a261c00d484faeff7633bc357ac5b5c9c`。
- [配布記録](sid_c64_vbi_package_01.json): `release/tetorica_sid_player_0.0.7-c64-vbi-preview_itch.zip`、80files／10 readable modules／1,573,534bytes、SHA `730c1c4d596506e96fba6cca40cbcc73c20d097f57a38c300697a9c6887ed895`。68 original inputs、43 native inputs、matching sources／license、ZIP・nested ZIPのCRCと実展開byte一致を確認した。
- 固定SDK33 builds／68 outputs／75 mirrorsと両Mixer checkは成功。既存SID Synth／PlaygroundのDSP・gainを保持した。known8580／NTSCは未対応、実ROM／BASIC・実聴／長時間・D418 digi・音色importは後続。commit／push／tag／公開はしていない。

参考: [VGM specification](https://vgmrips.net/wiki/VGM_Specification)、
[HVSC](https://hvsc.c64.org/faq)、
[sidplayfp manual](https://github.com/libsidplayfp/sidplayfp/wiki/sidplayfp)。
