# Save Point

Last updated: 2026-10-26

## 最新の再開ポイント — 2026-10-26

この節が現在の作業状態。末尾まで残している旧記録には、現在と異なる構成・未実装扱い・次の作業案が含まれる。
再開時はこの節と実際の各リポジトリの状態を先に確認する。

### 現在地

現在は代替Nuked YM2612のSDK移行・ローカル検証・5構成CIまで完了した。SDK `0.1.1`の単体ターゲットを追加し、
TauriのGenesis Nuked／32X Nukedと独立追加Nukedのビルド入力を固定SDKへ切り替えた。最終同梱数は379ファイル。
今回着手時の本体`f22249959...`、Tauri`baec0b9a...`、SDK`affd1059...`はすべてclean。
直前の成功CI run `40171879716`は今回のNuked移行を含まない。
作業内容・最終pinと検証結果は[native_sdk_nuked_adoption_01.md](native_sdk_nuked_adoption_01.md)を参照する。
対応ソースZIP全1,801ファイルとSDK379ファイルを含む22件の固定記録は照合済み。
本体`02b2e3ad...`とTauri`367fd7a...`へcommit／pushし、Nuked移行を含む
[Tauri CI run 40175615215](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40175615215)は全5構成の検証・インストーラー生成が成功した。
対象は`367fd7a851ffadd3a01c3cfb985972112156ca63`、attempt 1。SDKの修正版CI run `40175263453`もNative 5構成＋WASMの全6ジョブ成功。
通常22音源IDと代替NukedのSDK参照が揃った。機種用補助処理・Rustの所有／予約・Mixer／FXはアプリ側に残る。
本体の通常YM2612 WASMビルドも、その後同じ固定SDKソースへの切り替えを完了した。
同梱379ファイルをoffline検証し、SDKのWASM用レシピで既存APIを維持して生成する。
実施内容と検証は[YM2612 WASMのSDK移行](wasm_sdk_ym2612_adoption_01.md)を参照する。
続いてYM2203 WASMも同じ固定SDKへ切り替えた。
旧レシピ再ビルド／配布済みWASMとの比較各432ケースで差0、Browser・npmも検証済み。
詳細は[YM2203 WASMのSDK移行](wasm_sdk_ym2203_adoption_01.md)を参照。
続くYM2608 WASMも同じ固定SDKへ切り替えた。旧再ビルド／配布済みWASMとの各586比較で差0。
リズム・ADPCM・RAM転送／状態復元、Browser／npmも検証済み。校正04の全数値は旧03と一致した。
今回の詳細は[YM2608 WASMのSDK移行](wasm_sdk_ym2608_adoption_01.md)。
続くYM2610／YM2610Bの共有WASMも同じ固定SDKへ切り替えた。
通常OPN系5種類／4 artifactのWASMビルドが同梱SDKを使う。Mixer値・公開APIは維持する。
詳細は[YM2610／YM2610B WASMのSDK移行](wasm_sdk_ym2610b_adoption_01.md)を参照。
続くYM2151／YM2164の共有WASMも同じ固定SDKへ切り替えた。
既存8CH・LFO／noise・timer／状態APIとMixer値を維持する。
詳細は[YM2151／YM2164 WASMのSDK移行](wasm_sdk_ym2151_adoption_01.md)を参照。
続くOKIM6258 WASMも同じ固定SDKへ切り替えた。旧配布版・再ビルド・SDKのJS／WASMがbyte一致。
X68000のFM・ADPCM双方のビルド元が揃った。詳細は[OKIM6258 WASMのSDK移行](wasm_sdk_okim6258_adoption_01.md)を参照。
続くYM2413 WASMも同じ固定SDKへ切り替えた。既存snapshot APIはないため、reset／再演奏／seekで復帰経路を比較した。
詳細は[YM2413 WASMのSDK移行](wasm_sdk_ym2413_adoption_01.md)を参照。
続くYM3526 WASMも同じ固定SDKへ切り替えた。9CHの2OP FM・リズム・timer／IRQ／CSMとreset／再演奏／seekを比較した。
詳細は[YM3526 WASMのSDK移行](wasm_sdk_ym3526_adoption_01.md)を参照。
続くYM3812 WASMも同じ固定SDKへ切り替えた。OPL2の4波形・gate、9CH FM・リズム・timer／IRQ／CSMと再演奏／seekを比較した。
詳細は[YM3812 WASMのSDK移行](wasm_sdk_ym3812_adoption_01.md)を参照。
続くYMF262 WASMも同じ固定SDKへ切り替えた。18CH・4OP・8波形・4bus合算とreset／再演奏／seekを比較した。
詳細は[YMF262 WASMのSDK移行](wasm_sdk_ymf262_adoption_01.md)を参照。
続くY8950 WASMも同じ固定SDKへ切り替えた。FM・リズム・ADPCM、2MiB RAMとJSミラーのreset差、VGMサンプルブロックのseekを比較した。
詳細は[Y8950 WASMのSDK移行](wasm_sdk_y8950_adoption_01.md)を参照。
続くAY-3-8910／YM2149 WASMも同じ固定SDKへ切り替えた。tone・noise・envelopeと全対応type／flag、register読出し、reset／再演奏／seekを比較した。
JS／WASMは配布済み版・旧手順再ビルド・SDK版・通常出力がすべてbyte一致した。
詳細は[AY-3-8910／YM2149 WASMのSDK移行](wasm_sdk_ay8910_adoption_01.md)を参照。
続くSega PSG WASMも同じ固定SDKへ切り替えた。Genesis系・Game Gear・Master System・追加PSGで共有するartifactのビルド元を統一した。
3 tone／noise・Game Gear stereo、状態保存／復元とowned／borrowed PCMを比較し、生成物は旧版とbyte一致した。
詳細は[Sega PSG WASMのSDK移行](wasm_sdk_segapsg_adoption_01.md)を参照。
続くRF5C164 WASMも同じ固定SDKへ切り替えた。Mega CDと追加PCMのビルド元を統一した。
8 voice、64 KiB RAM・bank OR、bus読出しと状態復元を比較し、生成JS／WASMは旧版とbyte一致した。
詳細は[RF5C164 WASMのSDK移行](wasm_sdk_rf5c164_adoption_01.md)を参照。
続く32X PWM WASMも同じ固定SDKへ切り替えた。FIFO／timer・DAC／duty・状態復元とborrowed PCMを比較した。
配布用PWM sourceも固定SDKのstandalone recipeへ揃え、source単体で再buildした生成物の一致を確認した。
詳細は[32X PWM WASMのSDK移行](wasm_sdk_pwm32x_adoption_01.md)を参照。
続くHuC6280 WASMも同じ固定SDKへ切り替えた。PC Engineと追加音源のビルド元を統一した。
既存の6CH・wave RAM・DDA・noise・LFOとowned PCMを維持し、snapshot APIは追加していない。
詳細は[HuC6280 WASMのSDK移行](wasm_sdk_huc6280_adoption_01.md)を参照。
続くGame Boy APU WASMも同じ固定SDKへ切り替えた。2 pulse・wave・noiseと既存保存状態APIを維持した。
直接Web用に残っていた保存状態exportのない旧生成物も、別のPCM比較後にSDK版へ揃えた。
詳細は[Game Boy APU WASMのSDK移行](wasm_sdk_gameboy_adoption_01.md)を参照。
続くNES APU／FDS WASMも固定SDKへ切り替えた。31項目の観測ABIとowned／borrowed PCMを維持し、保存状態APIは追加していない。
配布ソースもSDKの検証済み入力とstandalone recipeから作り、単体再buildを確認した。
詳細は[NES APU／FDS WASMのSDK移行](wasm_sdk_nesapu_adoption_01.md)を参照。
続くSNES／SPC WASMも固定SDKへ切り替えた。32 kHzのSPC700／accurate S-DSPと33 C exportを維持した。
旧再ビルド・配布済み・配布ソース単体の各80ケースでSDKとの差0。パスを埋め込むassertionによりWASMのbytesは異なる。
対応ソース単体の再build、FM／VGM npm・Analyzer ZIPも検証した。WebKitの初期化中close試験は未解決として分けて記録した。
詳細は[SNES／SPC WASMのSDK移行](wasm_sdk_spc_adoption_01.md)を参照。
その後、Game BoyのMixer初期値をユーザー指定の`0.36`へ調整した。
Playground Systemの主音源／追加音源とAnalyzer、npm向けcalibrated presetへ適用し、元の測定値は保持した。
内容と検証は[gameboy_mixer_balance_01.md](gameboy_mixer_balance_01.md)を参照。
その後、未反映だったPSG・AY・NES・PC Engineの初期値も揃えた。
Mixerは調整値そのものを表示し、Genesisの既存倍率は接続側で相殺するsource単位へ整理した。
旧保存設定の読込み時換算と検証は[psg_mixer_balance_02.md](psg_mixer_balance_02.md)を参照。
続く指示で`tetorica-fm2612@0.2.28`をnpmへ公開し、latest・integrity・公開tarballの全byte一致を確認した。
[npm公開記録](npm_mixer_source_units_release_01.md)を参照。Tauriの同梱frontendとExamplesの更新は未実施。
さらにCLIのWAV描画へ同じ調整を入れた`tetorica-vgm@0.2.14`も公開済み。
11種類のWAV一致、latest・integrity・公開tarballの全byte一致を確認した。[VGM公開記録](npm_vgm_mixer_release_02.md)を参照。
その後、itch.io Analyzerの校正ソースhash検証が旧記録で停止する問題を修正した。
Extra／PSGを実際に再測定した`_02`記録へ切り替え、音量定数を変えずにZIP作成と両ブラウザー検証を完了。
手順と生成物は[校正記録の更新](analyzer_mixer_calibration_refresh_01.md)を参照。
その後、Synthで内蔵音色のOP配列を1つずらして読み、OP4へ以前の設定が残るバグを修正した。
`1OP Basic`のTLは`[127, 127, 127, 2]`へ戻る。記録は[SynthのOP対応修正](synth_preset_operator_mapping_01.md)を参照。
Synth修正はユーザーがrelease済み。その後、通常YM2612 WASMのSDK参照を実装し、
旧ビルド・配布済みWASMとの比較各444ケースでPCM・内部envelope・read/status/IRQ・状態bytes差0。
Analyzerの影響する校正は03として実測し直し、校正値・Mixerの数値は維持した。

`tetorica-soundchip-native`で全22種類のPlayground音源IDの単体Nativeターゲットが揃い、
最初の利用側としてPlayground TauriのYM2612を固定SDKソースへ切り替えた。
ユーザーがcommit／pushした`v0.90.2+test`で、5構成すべての試験とインストーラービルドが成功済み。
その後、PC-98と追加生成のYM2203も切り替え、ローカル検証後にユーザーが`16610b0e...`としてコミット済み。
YM2608移行もローカル検証後、Tauriでは`53ab3d27...`、本体では`26f6e6e5...`にコミット済み。
Neo Geoと追加生成のYM2610／YM2610BもSDK参照へ切り替え、PCM／状態一致、Rust全試験、再生・混合試験まで成功。
その後ユーザーがTauriの移行を`5280f83a...`としてcommit／pushし、本体のcheckerと記録も`562fcbcf...`にコミット済み。
CI確認を開始する前は、本体・SDK・Tauriの3リポジトリともcleanだった。SDK本体と取り込み記録の変更はない。
ユーザーの指示で、全OPN移行を含むTauriのmainを5構成のActionsへ手動実行した。
全5構成のNative検証とインストーラービルドが成功し、run全体も`completed`／`success`。
このCI確認では音源・ビルドコードを修正せず、本体の記録とTauriのSDK取り込みガイドだけを更新している。
そのCI結果をTauriの`6f4d4db0...`、本体の`ce4dc4de...`へユーザーがコミット済み。
YM2151移行の着手前は両作業ツリーがcleanで、TauriのCI対象`5280f83a...`からの差分はガイド1ファイルのみだった。
その後、X68000のFMと追加生成YM2151のSDK参照も切り替えた。
同梱版を変えず、OPM providerと独立YM2151の接続をSDKからビルドする。
このYM2151作業はTauriの`e4d68b27...`、本体の`f0e00dda...`へユーザーがコミット済み。
X68000と追加生成OKIM6258のデコーダー、および追加生成OKI接続もSDK参照へ切り替えた。
SDK原本は保持し、ビルド時の生成で従来と同じスレッド安全なテーブル初期化を適用する。
X68000の機種用接続・サンプル管理・混合はアプリ側に保持する。
このOKIM6258作業もTauriの`250489fd...`、本体の`fed03f7a...`へユーザーがコミット済み。
追加生成YM2413と共有OPL provider／PCM依存のSDK参照も切り替えた。
Master System／MSXの機種用接続・NativeOpllCore、PSG／AY、DOS PC／Y8950の接続はアプリ側に保持する。
このYM2413作業はTauriの`634e56f4...`、本体の`6c0b5770...`へユーザーがコミット済み。
その後、同コミットを対象とする5構成のActions確認を行った。
GitHub上のmainとローカルHEADの一致、両作業ツリーがcleanであることを確認してから、
ユーザーの指示で[Build Desktop — run 40137093552](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40137093552)をmainへ手動実行した。全5構成の試験とインストーラービルドが成功し、run全体も`completed`／`success`。
今回のCI確認では、音源やビルドコードを変更せず、本体の記録とTauriの取り込みガイドだけを更新している。
TauriのCI結果ガイド更新はユーザーが`a8edd891...`にコミット済みで、CI対象との差はガイド1ファイルのみだった。
DOS PC／MSX Audioと追加生成のOPL系4音源の接続も固定SDKへ切り替えた。
共有providerは変更せず、選択中／追加生成cppとY8950メモリーhelperの参照先をSDKへ移した。
Y8950の最大2 MiBの可変RAMページの所有・COW・予算・回収、RF5C164の接続とホスト処理はアプリ側に保持する。
このOPL作業と前回CIの記録は、本体の`4137e903...`、Tauriの`4451195...`へユーザーがコミット済み。
AY-3-8910の共有コアと追加生成用接続も固定SDKへ参照を切り替えた。
選択中MSX／MSX Audioの機種用接続とAYレート変換、Rustの予約・owner・混合は保持する。
AY着手時は本体・Tauri・SDKともcleanだった。その後ユーザーが本体を`ce2ad308...`、Tauriを`276e744e...`としてcommit／pushした。
両作業ツリーがcleanであることを確認し、ユーザーの指示でOPL接続移行と今回のAY差分を含む
[Build Desktop — run 40142510765](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40142510765)を`main`へ手動実行した。
CIは`completed`／`failure`で終了し、macOS ARM64・Windows・Linux 2構成の4ジョブ成功、macOS x86_64の1ジョブ失敗。
試験だけのローカル修正後はRust全試験が723成功、対象試験の反復も50／50成功した。
その後ユーザーが本体`a278e1d5...`とTauri`842245dd...`をcommit／pushした。
両作業ツリーがcleanでremote mainと一致することを確認し、修正を含む別の5構成CI
[Build Desktop — run 40143851548](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40143851548)を`main`へ手動実行した。
修正版CIは`completed`／`success`で終了し、macOS x86_64を含む全5構成の検証とインストーラービルドが成功した。
全5構成の検証JSONと取得ZIPのdigest照合も成功し、計10アーティファクトの存在を確認した。
先行するrun `40137093552`の成功と、後続のOPL接続／AY移行のローカル検証・今回のCI結果は区別する。
修正版CIの結果は本体で`29b9b885...`にコミット済み。Tauriガイドの同結果はステージ済みだった。
Sega PSGの共通コアとraw C APIも固定SDKへ参照切り替えした。
Genesis／Mega CD／32X系、Game Gear／Master Systemと追加PSGが、同じSDKコアを一度だけコンパイルして使う。
機種用接続、NativePsgCore、GenesisのDC／gain／混合・Rustの制御は維持する。
このPSG作業は本体`1da2fb00...`、Tauri`51dca52...`へユーザーがコミット済み。
RF5C164の選択中／追加生成接続、共通decoderとraw C APIも固定SDKへ参照を切り替えた。
双方の64 KiB所有RAM、追加接続の声別保持出力、Rustの転送payload・予約・寿命・予算管理を維持する。
RF着手時は本体・Tauri・SDKともcleanだった。ローカル検証後、本体を`1d35f48a...`、
Tauriを`4939ddc7...`へcommit／pushし、両作業ツリーがcleanでremote mainと一致することを確認した。
ユーザーが承認したPSG／RF両移行の5構成CI
[Build Desktop — run 40148943609](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40148943609)を`main`へ手動実行した。
CIはattempt 1で`completed`／`success`となり、全5構成の検証とインストーラービルドが成功した。
全5構成の検証JSON・取得ZIPのdigestと、計10アーティファクトのrun／commit一致も確認した。
RFのCI結果記録は本体の作業記録2ファイルとTauriガイドだけで、コード変更やローカル試験の再実行はしていない。
Tauriガイドは`66004f00...`へcommit／push済み。更新後の対応ソースZIPも再生成・照合し、CI入力との差はガイド1ファイルだけだった。
32X PWMのNative接続cpp／headerと`pwm32x_core.h`も固定SDKへ参照を切り替えた。
既存のPWM archive、C++17・O2・`/EHsc`・`-ffp-contract=off`と、Rustの予約・owner・混合を維持する。
PWM着手時は本体`88049cad...`、Tauri`66004f00...`、SDKともcleanだった。ローカル検証後、本体`2b1b8cf1...`、Tauri`39a02786...`へ保存済み。その時点ではPWMを含む新しいCIは未実施だった。
固有Native命令列132件・911,616フレームで旧／SDKがbyte一致し、実WASMのblock分割比較282回・1,800,960フレームとJS参照の差も0だった。
`npm test`は31／31成功。sandbox内Cargoの2件のTCP bind制限を受け、製品を修正せず制限外で再実行し、723成功・0失敗・4件ignoredだった。
22 mode・88 Run／Stopと既存の3混合構成・7単独音源、受入れ／16台制限・Stop後の予算回収も成功した。直前run `40148943609`はPWM移行を含まない。
その後、PC Engineの選択中／独立追加HuC6280のNative接続とコアの固定SDK参照へ切り替えた。
接続cppはinclude2行だけが異なり、接続headerとコアcpp／headerはbyte一致。直接includeを維持し、同archive内の1翻訳単位だけでコンパイルする。
HuC6280着手時は本体`2b1b8cf1...`、Tauri`39a02786...`、SDKともcleanだった。Rustの予約・PCM・Stopと機種APIは維持する。
旧／SDKはbyte一致し、実WASM比較192回・1,556,352フレームの差は0だった。
選択中39入力が追加側51入力の部分集合のため、両suiteの延べ90入力を重複加算せず、固有Native入力は51件・438,912フレームとする。
既存fixtureとSDK既存の検証fixtureによる公開状態・Stop／reset・waveコピー・callback allocation／free 0も成功。
`npm test`は31／31、Rust全試験は723成功・0失敗・4件ignored。今回はMCPのTCP bindのため初めから制限外で実行し、sandbox内の失敗や製品修正はない。
再生ライフサイクル22 mode・604,032フレーム・88 Run／Stopと、3混合構成・7単独音源、受入れ／16台制限で17台目の拒否も成功。両制限試験でStop後の予約予算は0、両runnerはexit code 0・`deviceOpened: false`だった。
HuC6280のローカル検証終了後、ユーザーが本体`a8169ac2...`、Tauri`2125896b...`へcommit／pushした。
両作業ツリーがcleanでremote mainと一致することを確認し、PWM／HuC6280を含む5構成CI
[Build Desktop — run 40162092207](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40162092207)を`main`へ手動実行した。
attempt 1、対象は`2125896b7173c5c662c6eaf2f2b69b4a010f12b7`。runは`completed`／`success`で終了した。
全5構成のsources／Cargo／再生／混合とインストーラービルドが成功し、検証レポート5組のJSON・ZIP digest監査も成功した。
計10アーティファクトのrun／commit一致・有効期限内・非空と、全5ドラフトリリース添付stepのskippedも確認した。
このCI開始後にコード・試験を変更せず、本体の結果記録とTauriガイドだけを更新した。
その結果記録は本体`77d93c04...`、Tauri`0191864a...`に保存済み。
先行する成功CI `40148943609`はPWMもHuC6280も含まない。
その後、Game Boyの選択中／独立追加音源に共通のNative接続とMAME由来APUを固定SDK参照へ切り替えた。
接続cpp／headerとAPU cpp／headerの4入力はbyte一致。既存のarchive・コンパイル設定・リンク順序を維持し、Rustの予約・PCM・Stopや機種APIは変更しない。
Game Boy着手時は本体`77d93c04...`、Tauri`0191864a...`、SDKともcleanだった。
`npm test`は31／31、Rust全試験は723成功・0失敗・4件ignored。MCPのTCP bindのため初めから制限外で実行し、sandbox内の失敗や製品修正はない。
旧／SDKのstdoutはbyte一致し、実WASMの分割比較186回・1,714,080フレームの差は0。延べ90入力のうち36入力の重複を除き、固有Native入力は54件・488,208フレームだった。
公開60バイトABIやStop／reset・NR52／DMG波形RAM・clock・位相、render allocation／free 0の自己試験と、22 mode・604,032フレーム・88 Run／Stopも成功。
追加音源の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否が成功し、両制限試験でStop後の予約予算は0。再生／混合の両runnerはexit code 0・`deviceOpened: false`だった。
Game Boyのローカル検証終了時点ではcommit／pushと新しいCIは未実施だった。その後ユーザーが本体`62fc578e...`、Tauri`407a75b3...`へ保存済み。
その後、選択中NES＋FDSと独立追加NESの共通Native接続と、その中のAPU／FDS移植実装を固定SDK参照へ切り替えた。
接続cpp／headerはbyte一致し、既存の1翻訳単位・archive・flags・リンク順序を維持する。RustのDMC転送payload所有・予約・予算と回収、PCM・Stopや機種APIは変更しない。
NES着手時は本体`62fc578e...`、Tauri`407a75b3...`、SDKともcleanだった。
`npm test`は31／31、Rust全試験は723成功・0失敗・4件ignored。MCPのTCP bindのため初めから制限外で実行し、sandbox内の失敗や製品修正はない。
旧／SDKのstdoutはbyte一致し、実WASMの分割比較315回・3,064,320フレームとJS参照の差は0。選択中72入力の重複を除き、固有Native入力は81件・784,512フレームだった。
400バイトABI、64 KiB DMCコピー・reset後の全RAM読出し、IRQ・最終バイト保護・FDS・6声のmuteとrender allocation／free 0の自己試験も成功。
再生ライフサイクル22 mode・604,032フレーム・88 Run／Stopと、追加音源の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否も成功。両制限試験でStop後の予約予算は0、再生／混合の両runnerはexit code 0・`deviceOpened: false`だった。
NESのローカル検証終了後、ユーザーが本体`3349ac14...`、Tauri`a70e86d2...`へcommit／pushした。
本体・Tauriがcleanでremote mainと一致し、SDKの作業ツリーもcleanであることを確認し、Game Boy／NES＋FDSを含む5構成CI
[Build Desktop — run 40168462256](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40168462256)を`main`へ手動実行した。
attempt 1、対象は`a70e86d2061349a396de7e4816a5438fea5dcb4f`。runは`completed`／`success`で、全5構成の検証とインストーラービルドが成功した。CIのためのコード修正は不要だった。
全5構成の検証JSON・取得ZIPのdigestと、計10アーティファクトのrun／commit一致・有効期限内・非空を確認した。全5ジョブのドラフトリリース添付stepはskipped。
このCI開始後にコード・試験を変更せず、本体の結果記録3ファイルとTauriガイドだけを更新した。その記録もユーザーが本体`95bba16c...`、Tauri`853d87f9...`へコミット済み。
先行する成功CI `40162092207`はGame BoyもNES移行も含まない。今回のCIと、先行するローカルの旧／SDK・WASM比較結果は区別する。
新しいタグ、ドラフトリリース、一般公開は作成していない。

その後、選択中／独立追加DX7の共通Native接続とMSFAを固定SDK参照へ切り替えた。
着手時は本体`95bba16c...`、Tauri`853d87f9...`、SDKともcleanだった。
接続cpp／headerはbyte一致。24共有ファイルと6 Native overrideを`OUT_DIR/tetorica_sdk_dx7_msfa/`へコピーして組み立て、既存の14翻訳単位・archive・flags・リンク順序を維持する。
SDKのNative Panicは事前確保済み`Dx7Note`へ初期状態を値代入し、feedback履歴をallocation／freeなしで初期化する。
このPanic後の再発音は意図した差分のため、通常再生の旧／SDK一致と分けて検証する。Rustの音色所有・lease・16 slot制御・予約、PCM・Stop・Mixer／FXと機種APIは変更しない。
既存135入力・1,032,192 Nativeフレームは旧／SDKのstdoutがbyte一致。新しいPanic／再発音96入力はSDKと実WASMの差0で、旧版79入力の意図した再発音後の差と区別した。
合計231固有Native入力・1,818,624フレーム、実WASM273比較・2,297,856フレームの最大差0。Panic後の新規インスタンス一致96／96とrender／制御中allocation／free 0の自己試験も成功。
`npm test`のPython 22件・Node 31件、Rust全試験723成功・0失敗・4件ignored。MCPのTCP bindのため初めから制限外で実行し、sandbox内失敗や製品修正はない。
22 mode・604,032フレーム・88 Run／Stopと、3混合構成・7単独音源、受入れ／16台制限で17台目の拒否が成功。両制限試験でStop後の予約予算0、両runnerはexit code 0・`deviceOpened: false`。
直前の成功CI `40168462256`はDX7移行を含まない。DX7ローカル検証後、ユーザーが本体`24ab8cbd...`、Tauri`46920010...`へコミット済み。

最新の作業では、選択中／独立追加SNES S-DSPと独立追加SPC700ファイルプレーヤーの共通コア・接続を固定SDK参照へ切り替えた。
着手時は本体`24ab8cbd...`、Tauri`46920010...`、SDKともclean。2接続cpp／2 ABI headerとSNES-SPC 24ファイルの28組はbyte一致する。
既存の`tetorica_native_snes` archive内の6翻訳単位を維持し、共有`SPC_DSP.cpp`を一度だけコンパイルする。既存のflags・リンク順序も保持する。
SNESの所有RAM／借用timeline、SPCのコピーloadと元ファイル保持、control側の準備とcallbackへの公開・回収は既存のRust実装を使う。
旧34件のsnapshot pin・LGPLライセンス・由来、SDK374ファイル・版と取り込み記録は保持する。
旧／SDKのstdout／stderrはbyte一致。SNESの重複を除く75入力・761,856フレームと、SPCの84入力・688,128フレームで、実WASM比較519回・4,792,320フレームの最大差は0。
SNES／SPCの公開ABI・RAMコピー／timeline／load／seek／観測とallocation／free 0の自己試験、実Cargoの6 object・35 C ABIの各1回の定義も確認した。
`npm test`のPython 22件・Node 31件、Rust 723成功・0失敗・4件ignored。初めから制限外で実行し、sandbox内失敗はない。
22 mode・604,032フレーム・88 Run／Stopと3混合構成・7単独音源、受入れ／16台制限と17台目拒否も成功。両制限試験のStop後予約予算0、両runnerはexit code 0・`deviceOpened: false`。
ローカル検証・文書と対応ソースZIPの照合後、本体`8898a75f...`、Tauri`8b9e922a...`へcommit／pushした。
両作業ツリーがcleanでremote mainと一致し、SDKもcleanであることを確認し、DX7とまとめた5構成CI
[Build Desktop — run 40171879716](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40171879716)をmainへ手動実行した。
attempt 1、対象は`8b9e922ad6e9c1f8d33cf5719b05330b58311944`。runは`completed`／`success`で、全5構成の検証・インストーラービルドとアップロードが成功した。
検証レポート5組のJSON・取得ZIP digestを照合し、計10成果物の対象run／commit一致・有効期限内・非空を確認。全5ドラフトリリース添付stepはskipped。
CI開始後は結果記録だけを更新し、製品・試験入力は変更していない。直前run `40168462256`はDX7もSNES／SPC移行も含まない。
これで通常の22音源IDのSDK参照が揃う。代替Nuked YM2612と機種用の補助処理はアプリ側に残る。

作業ルートは `/Users/kyorohiro/development8/wfm/hello_ymfm`。
`w/`以下はそれぞれ独立したGitリポジトリなので、本体だけのcommitで保存できたと判断しない。

| リポジトリ | ローカルパス | 直前の成功CI run `40171879716`の基準コミット（すべてmain） |
| --- | --- | --- |
| 本体 | `hello_ymfm/` | `8898a75fc4424aca11596d8cd7fb6046d1c3b585` (SNES／SPC移行・ローカル検証までcommit／push済み。CI開始時はclean) |
| Native SDK | `w/tetorica-soundchip-native/` | `affd1059599f3c7598191c14f5a864b44963d4aa` (`tetorica::spc`) |
| Playground Tauri | `w/tetorica-fm2612-playground-tauri/` | `8b9e922ad6e9c1f8d33cf5719b05330b58311944` (DX7／SNES／SPCを含む成功CI run `40171879716`の入力) |

本体には次のメモがある。SNES／SPCまでの移行・ローカル検証は上記基準コミットへ保存済み。
その後のDX7／SNES／SPCの成功CI結果も記録済みで、現在は上記Nuked移行を進めている。表は直前の成功CI入力を固定して示し、現在のSDK pinはNuked移行節とTauriの取り込み記録で、最新HEADは各リポジトリの`git log -1`／`git status`で確認する。

- [native_sdk_ym2612_adoption_01.md](native_sdk_ym2612_adoption_01.md)：YM2612移行と5構成のCI結果。
- [native_sdk_ym2203_adoption_01.md](native_sdk_ym2203_adoption_01.md)：YM2203移行とローカル検証。
- [native_sdk_ym2608_adoption_01.md](native_sdk_ym2608_adoption_01.md)：YM2608移行とローカル検証。
- [native_sdk_ym2610_adoption_01.md](native_sdk_ym2610_adoption_01.md)：YM2610／YM2610B移行と全OPNの5構成CI。
- [native_sdk_ym2151_adoption_01.md](native_sdk_ym2151_adoption_01.md)：YM2151／X68000移行とローカル検証。
- [native_sdk_okim6258_adoption_01.md](native_sdk_okim6258_adoption_01.md)：OKIM6258移行と初期化対策の保持。
- [native_sdk_ym2413_adoption_01.md](native_sdk_ym2413_adoption_01.md)：YM2413／共有OPL provider移行と先行する5構成CI。
- [native_sdk_opl_adoption_01.md](native_sdk_opl_adoption_01.md)：OPL系4音源の接続移行とRAM付きY8950比較。
- [native_sdk_ay8910_adoption_01.md](native_sdk_ay8910_adoption_01.md)：最新の共有AYコアと独立接続の移行、OPL接続／AY移行後のCIと追加SNES試験のローカル修正。
- [native_sdk_segapsg_adoption_01.md](native_sdk_segapsg_adoption_01.md)：Sega PSG共通コア／raw C APIの移行。
- [native_sdk_rf5c164_adoption_01.md](native_sdk_rf5c164_adoption_01.md)：RF5C164接続／decoder／raw C APIの移行と、PSGと合わせたCI。
- [native_sdk_pwm_adoption_01.md](native_sdk_pwm_adoption_01.md)：32X PWM接続／コアヘッダーの移行とローカル検証。
- [native_sdk_huc6280_adoption_01.md](native_sdk_huc6280_adoption_01.md)：HuC6280接続／コアの移行とローカル検証、PWMと合わせたrun `40162092207`の全5構成成功。
- [native_sdk_gameboy_adoption_01.md](native_sdk_gameboy_adoption_01.md)：Game Boy共通接続／APUの移行とローカル検証、NESと合わせたrun `40168462256`の全5構成成功。
- [native_sdk_nes_adoption_01.md](native_sdk_nes_adoption_01.md)：NES＋FDS共通接続の移行とローカル検証、Game Boyと合わせたrun `40168462256`の全5構成成功。
- [native_sdk_dx7_adoption_01.md](native_sdk_dx7_adoption_01.md)：DX7共通接続／MSFAの移行、通常再生の一致とNative Panicのfeedback履歴初期化、ローカル検証。
- [native_sdk_snes_spc_adoption_01.md](native_sdk_snes_spc_adoption_01.md)：SNES S-DSP／SPC700共通コア・接続の移行、所有・再リンク境界と検証。
- [todo_schedule_register_01.md](todo_schedule_register_01.md)：AY／YM2149等の高速レジスタ制御の別案。今回のSDK移行では実装していない。

### SDK側の完了範囲

- 全22音源IDを18個のstatic libraryで提供。公開alias／headerは汎用OPLを含め23種類。
- 21 fixture実行ファイルから22件のCTestを実行。SNESだけ同じfixtureに2つの試験モードがある。
- 外部ROMやゲーム素材を必要としない17種類のWAV Exampleを用意。
- SDK版は `0.1.0`、stageはまだ `bootstrap`。全WASMレシピの実行や全低レベルAPIの統一を完了したという意味ではない。
- 代替エンジンのNuked YM2612は、SDKの単体Nativeターゲットとしてはreference-only。Tauriには既存のNuked実装がある。
- Analyzer専用のMSM5205／OKIM6295等の追加資料・JS参照は、上記22種類とは別枠。
- 直近のDX7追加では、SDKのNative overrideだけPanic後のフィードバック履歴初期化を修正済み。原本／修正版ハッシュを保持している。

詳細はSDKの[Nativeガイド](../../w/tetorica-soundchip-native/native/README.md)、
[検証記録](../../w/tetorica-soundchip-native/docs/verification.md)、
[音源ごとの差分](../../w/tetorica-soundchip-native/docs/chip-differences.md)を参照。

### Tauriで固定しているSDK

同梱先は `src-tauri/vendor/tetorica-soundchip-native/`。配布ソース全374ファイルを保持している。
取り込み記録の正本は [src-tauri/soundchip-sdk.json](../../w/tetorica-fm2612-playground-tauri/src-tauri/soundchip-sdk.json)。

| 項目 | 固定値 |
| --- | --- |
| SDK版 | `0.1.0` |
| 元コミット | `affd1059599f3c7598191c14f5a864b44963d4aa` |
| 元ZIP | `tetorica-soundchip-native-0.1.0-sources.zip` |
| 元ZIP SHA-256 | `26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce` |
| SDKマニフェスト SHA-256 | `d82f98a36cc934591e23d0ffb86b180e6bcead72e1fc25145246d9c59028ff88` |

元コミットは由来の記録で、署名検証の意味ではない。取り込み時のZIPハッシュと、
同梱マニフェスト／全ファイルのサイズ・ハッシュを照合する。
通常のTauriビルドに別のSDK checkout、submodule、GitHubからの音源ソース取得、CMake呼び出しは不要。
コンパイラーやCargo／npm依存まで同梱しているわけではない。

SDK同梱先を直接編集せず、更新時だけTauriの `scripts/import_soundchip_sdk.py` で検証済みローカルZIPを取り込む。
インポーターは既存の同梱内容に変更があると上書きを拒否する。
アプリ側で開発・検証した変更をSDK配布へ反映し、利用側が固定版を明示更新する運用を維持する。
ソース、ライセンス、NOTICE、原典記録も一緒に保持する。

### 今回切り替えたビルド境界

Tauriの [src-tauri/build.rs](../../w/tetorica-fm2612-playground-tauri/src-tauri/build.rs) は次をSDKからコンパイルする。

- Genesis主音源の `wasm/ym2612_wasm.cpp`。ファイル名にwasmを含むが、ここではNative C++として使う。
- 共通PSGの `wasm/segapsg_wasm.cpp` と `vendor/ymfm/segapsg.cpp`／`.h`、引用する`chip_state.h`。
- 追加生成YM2612の `native/reference/tauri/native_genesis_ym2612.cpp`。
- PC-98／追加生成YM2203の `native/reference/tauri/native_genesis_ym2203.cpp`。
- PC-98／追加生成YM2608の `native/reference/tauri/native_genesis_ym2608.cpp`。
- Neo Geo／追加生成YM2610・YM2610Bの `native/reference/tauri/native_genesis_ym2610b.cpp`。
- 追加生成YM2151の `native/reference/tauri/native_genesis_ym2151.cpp`。
- 追加生成YM2413の `native/reference/tauri/native_genesis_ym2413.cpp`。
- 追加生成AYの `native/reference/tauri/native_genesis_ay8910.cpp` と、選択中MSX／MSX Audioにも共通の `vendor/mame-ay8910/ay8910.cpp`／ヘッダー。
- DOS PC／選択中Y8950の `native/reference/tauri/native_genesis_opl.cpp` と、追加生成4種類の `native/reference/tauri/native_genesis_extra_opl.cpp`。
- 両接続が引用する `native/reference/tauri/native_genesis_y8950_memory.h`。
- 追加生成OKIの `native/reference/tauri/native_genesis_extra_okim6258.cpp`。
- 選択中RF5C164と追加RF5C164の `native/reference/tauri/native_genesis_rf5c164.cpp`、`native_genesis_extra_rf5c164.cpp`。
- 共通RF decoderの`vendor/mame-rf5c164/rf5c164.cpp`／`.h`とraw C APIの`wasm/rf5c164_wasm.cpp`。
- 選択中／追加生成Game Boyの`native/reference/tauri/native_genesis_gameboy.cpp`と、共通APUの`vendor/mame-gameboy/gameboy_apu.cpp`／`.h`。
- 選択中NES＋FDS／追加生成NESの共通接続とAPU／FDS実装を含む`native/reference/tauri/native_genesis_nes.cpp`／`.h`。
- 選択中／追加生成DX7の`native/reference/tauri/native_genesis_dx7.cpp`／`.h`と、`vendor/msfa/`の24共有ファイルおよび`native/reference/overrides/msfa/`の6ファイルからコピーして組み立てるMSFA。
- 選択中／追加生成SNES S-DSPの`native/reference/tauri/native_genesis_snes.cpp`／`.h`、追加SPC700の`native_genesis_spc.cpp`／`.h`と、`vendor/snes-spc/snes_spc/`の共通コア4翻訳単位。
- `vendor/mame-okim6258/okim6258.cpp`原本へ既存の初期化対策を適用して`OUT_DIR/tetorica_sdk_okim6258.cpp`へ生成したデコーダー。
- 共有 `native/src/ymfm_opn_provider.cpp`、`native/src/ymfm_opm_provider.cpp`、`native/src/ymfm_opl_provider.cpp` と `vendor/ymfm/ymfm_ssg.cpp`、`ymfm_adpcm.cpp`、`ymfm_pcm.cpp`。

共有providerは従来のarchive位置で一度だけコンパイルする。
上記のOPN接続は共通providerを使い、OPLL／OPL側も共通ADPCMを参照する。
共有OPL provider／PCMは従来の`tetorica_native_master_system` archive内で一度だけコンパイルする。
選択中Master System／MSXの機種用接続・NativeOpllCoreと選択中AYのレート変換はアプリ側に残す。
PSGのNativePsgCoreもアプリ側に残し、共通PSGコアとraw C APIはSDKを一度だけコンパイルする。
Game GearはSDKヘッダーを優先し、Master Systemも既存のSDK優先includeで同じヘッダーを使う。AYコアもSDKを共有する。
DOS PC／Y8950の選択中・追加生成接続とメモリーhelperもSDKを使用する。メモリーhelperはページを借用し、RAM本体の所有権をSDKへ移す変更ではない。
同じOPL archive内の追加RF5C164接続もSDKへ切り替えた。選択中接続・共通decoder・raw C APIは既存のMega-CD archiveを使う。
SDK接続は各64 KiB RAMを所有し、追加接続の声別履歴も維持する。Rust転送payload・予約・予算・寿命管理はホスト側。
OPLとRFの実cpp／headerをSDK側で監視し、実消費元のない旧native-opl／native-megacdディレクトリのソース監視は外した。
原典、ライセンスの同梱先、旧コピーとsyncスクリプトは保持する。
追加生成YM2413はSDKの独立接続を使用する。独立接続はNativeOpllCoreを流用する構造ではない。
CargoはSDKのOPL provider／ymfmと独立YM2413接続を監視する。
実消費元のなくなった旧native-master-systemディレクトリの監視は外し、ローカルの機種用接続／NativeOpllCoreの監視は保持する。
今回のAY移行ではSDKのAYディレクトリと独立接続cpp／headerを監視し、旧native-msxのソース監視も外す。
旧コピーとBrowser比較用固定記録、同梱AYライセンスの参照先は保持する。旧syncスクリプトの実行だけではSDKを更新しない。
X68000の機種用接続はアプリ側の`src/native_genesis_x68000.cpp`を保持し、FMのincludeとOPM providerをSDKから解決する。
OPM providerは従来の`tetorica_native_x68000` archive内で一度だけコンパイルする。
同archive内のOKIM6258デコーダーはSDK原本から生成し、選択中／追加生成で共用する。
SDKのコンストラクターへC++の関数内staticを使う置換を1箇所だけ適用し、従来のTauri生成物と同じバイト列にする。
置換元が1箇所でなければビルドを止める。SDKの374ファイルや固定記録を直接編集しない。
サンプル所有・保持、FM／OKI混合は引き続きアプリ側。
CargoはSDKのmame-okim6258ディレクトリと追加生成OKI接続を監視し、実消費元のなくなった旧native-x68000ディレクトリの監視は外した。
機種用接続のcpp／headerの監視と旧スナップショットの由来・ハッシュ照合は保持する。
他音源の接続全体までSDKへ移したわけではない。重複providerを追加したり、旧スナップショットをまとめて削除したりしない。

Genesisのgain／DC除去／PSG混合、Rustの予約・owner・回収・予算、CPAL、Mixer、FX／liveFx、録音、WebView／JS APIはアプリ側。
PSGのcpp／ヘッダーは既存のSDK ymfm／wasmディレクトリ監視で覆う。
旧native-genesisにはFX／noise等が参照する共通ヘッダーもあるためディレクトリ監視を維持し、原典やsyncスクリプトも保持する。
Browser／npmのWASM配布とTauriの `dist/` は今回の取り込みで変更していない。
Cargoは取り込み記録、SDKのymfmディレクトリ、wasmディレクトリ等を監視し、明示更新時に再ビルドする。
YM2608のRhythm ROMはRustが従来の`native-ym2608/snapshot/web/`から読むため、同ディレクトリの監視も保持する。
DX7はSDKから`OUT_DIR/tetorica_sdk_dx7_msfa/`へ13個のccと17個のheaderをコピーして組み立て、接続cppと合わせて既存archiveの14翻訳単位を維持する。
引用includeのヘッダー解決を統一するため、全翻訳単位が同じprivateツリーを使う。SDK本体を編集せず、新しいPython／CMake依存も追加しない。
Native Panicの修正だけは旧版と意図した差があり、事前確保済みnoteへの値代入でfeedback履歴を消す。通常note-on／release／kill、Rustの音色所有・lease・slot管理・予約、PCM・Mixer／FXは保持する。
CargoはSDKのMSFA共有／overrideディレクトリと接続cpp／headerを監視し、実消費元のない旧native-dx7／ローカル接続のソース監視を外す。
旧32ファイルのスナップショット、原本／修正版のハッシュとライセンスの同梱先、syncスクリプトは保持する。旧syncだけではSDKを更新しない。
SNES／SPCは2接続と4コアを既存の`tetorica_native_snes` archive内の6翻訳単位としてコンパイルし、`SPC_DSP.cpp`を重複しない。
SDKの独立CMakeターゲットを追加せず、C++17・O2・MSVC `/EHsc`・wrapv／noalias／ffp設定と既存のリンク順序を維持する。
SNESの所有64 KiB RAM／借用timelineとSPCのコピーload／元ファイル保持、control側の生成・seek・破棄とcallbackへの公開・回収は既存のRust実装。
CargoはSDKのSNES-SPCディレクトリと2接続cpp／headerを監視し、実消費元のない旧`native-snes/`／ローカル接続のソース監視を外す。
旧34件の固定記録とLGPLライセンス・由来・syncスクリプトを保持し、実際のSDKを改変して再リンクする手順を`NATIVE-SOURCES.md`へ更新する。

最初に読むファイルはTauriの [SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)。
配布ソースの再ビルドは [NATIVE-SOURCES.md](../../w/tetorica-fm2612-playground-tauri/NATIVE-SOURCES.md) を参照する。

### YM2612移行時のローカル検証

2026-10-25、macOSで実施。デバイスを開かない自動試験と実機で聴く確認は区別する。

| 対象 | 結果 |
| --- | --- |
| 旧ソース／SDKの入力 | 14組が同一。OPN providerの差分はinclude相対パス |
| 主YM2612の移行前後比較 | 24ケース、240,000フレームでPCM／status／IRQ／read等がbit一致 |
| 追加YM2612と実WASM | 198比較、1,216,512フレームでPCM／status／IRQ／4 readの差分0 |
| 主GenesisとWorklet | 6項目、49,152フレーム。最大差 `3.725290298e-9`、移行前と同じ |
| TauriのPython／Node | 22テスト／31テスト成功 |
| Cargo | 723成功、明示実行用4件ignored。`cargo check --locked --offline`も成功 |
| 再生ライフサイクル | 22 mode、604,032フレーム、88 Run／Stop遷移が成功 |
| 追加音源混在 | 3混合構成、代表7音源、受入れ・台数制限の試験が成功 |
| 同梱ソース | SDK374ファイル、22件の固定記録、アプリの対応ソースZIP1,796ファイルを照合 |
| 独立展開 | 対応ソースZIPからSDK照合、YM2612 fixtureのC++14ビルド／自己試験に成功 |

Sandbox内のCargo試験では既存HTTP bind試験2件が権限制限で失敗したが、承認済みの制限外実行では全体が成功。
この制限を回避するための製品変更は入れていない。
最終対応ソースZIPは文書のみ再更新した後にも照合済みで、独立ビルド時からコンパイル入力は変わっていない。

### YM2203移行のローカル検証 — 2026-10-25

同梱SDKの版を変えず、PC-98と追加生成のYM2203接続の参照先を切り替えた。
詳細は[native_sdk_ym2203_adoption_01.md](native_sdk_ym2203_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| 接続／includeのソース一致 | 9組が同一 |
| PC-98用の移行前後と実WASM | 186ケース、1,142,784フレーム。旧／SDKがbyte一致、WASMとの差分0 |
| 追加生成用の移行前後と実WASM | 195ケース、1,198,080フレーム。同じくbyte一致、WASMとの差分0 |
| 完全な状態取得 | 6ケース、49,152フレーム。280バイトの状態とPCM／status／IRQ／readが一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・88 Run／Stop、3混合構成・7単独音源、受入れ／台数制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP1,796ファイルの照合成功 |

本体の`scripts/check_native_ym2203.mjs`と追加生成用checkerは既定で実際のSDKをコンパイルし、
両方のWASM比較が成功している。使用した5つのcppのパス／SHA-256も記録する。
既定ビルドでの再確認を、381件の固有PCM比較へ二重に加算しない。
今回の結果はmacOS ARM64で、音声デバイスを開かない検証。ローカル検証時点ではYM2203差分の5構成CIは未実行で、後続の全OPN移行CIを下記で追跡している。

### YM2608移行のローカル検証 — 2026-10-25

PC-98と追加生成のYM2608も同じ固定SDKを使う。
Rhythm ROMの素材は引き続きRustが従来のスナップショットから読み込むため、その監視は残す。
詳細は[native_sdk_ym2608_adoption_01.md](native_sdk_ym2608_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| 接続／includeのソース一致 | 9組が同一 |
| PC-98用の移行前後と実WASM | 30ケース、184,320フレーム。旧／SDKのPCMがbyte一致、WASMとの差分0 |
| 追加生成用の移行前後と実WASM | 252ケース、1,585,152フレーム。PCM／status／statusHi／IRQ／4 readが一致、WASMとの差分0 |
| Native状態・RAM比較 | 6ケース、49,152フレーム。524／536バイトの状態とPCM／read、RAMの3範囲が一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・88 Run／Stop、3混合構成・7単独音源、受入れ／台数制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP1,796ファイルの照合成功 |

本体のYM2608用checkerも既定でSDKをコンパイルし、PC-98用／追加生成用の両方で比較成功。
固有の音声比較は282件、1,769,472フレーム。既定ビルドでの再確認は二重加算しない。
状態比較はNative同士、RAM比較は1観測あたり96バイトの3範囲で、全RAMの毎フレーム比較ではない。
今回の結果はmacOS ARM64で、音声デバイスを開かない検証。ローカル検証時点ではYM2608差分を含む各OSのCIは未実行で、後続の全OPN移行CIを下記で追跡している。

### YM2610／YM2610B移行のローカル検証 — 2026-10-25

Neo Geoの選択中音源と追加音源の両変種を、同じ固定SDKからビルドする。
詳細は[native_sdk_ym2610_adoption_01.md](native_sdk_ym2610_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース差分 | ヘッダー／interface 8組がbyte一致。SDK cppとの差は説明コメント1行のみ |
| 選択中音源の移行前後と実WASM | 72ケース、442,368フレーム。PCMがbyte一致、WASMとの差分0 |
| 追加音源の移行前後と実WASM | 504ケース、3,096,576フレーム。PCM／status／statusHi／IRQ／4 readが一致、WASMとの差分0 |
| Native状態・ROM比較 | 12ケース、98,304フレーム。524／536バイトの状態とPCM／read、256バイトのROM観測が一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・88 Run／Stop、3混合構成・7単独音源、受入れ／台数制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP1,796ファイルの照合成功 |

固有PCM比較は576件、3,538,944フレームで、両変種を含む。既定ビルドの再確認は二重加算しない。
Native状態の比較とWASM内部状態の比較は区別し、ROM全域の毎フレーム比較は行っていない。
選択中音源の連続ROMと追加音源の不変ページ方式、callback中のallocation／freeゼロも既存fixtureで検証した。
SDK cpp／headerの監視へ切り替え、素材の実消費元がない旧`native-ym2610b`ディレクトリの監視は外した。
今回の結果はmacOS ARM64で、音声デバイスを開かない検証。ローカル検証時点では今回の差分を含む各OSのCIは未実行で、後続の全OPN移行CIを下記で追跡している。

### YM2151／X68000移行のローカル検証 — 2026-10-25

同じ固定SDKを使い、独立YM2151接続と共有OPM providerを切り替えた。
X68000の機種用接続とOKIはアプリ側に保持する。
詳細は[native_sdk_ym2151_adoption_01.md](native_sdk_ym2151_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース差分 | 接続・混合・コア・ヘッダー11組がbyte一致。providerの差はinclude相対パスのみ |
| X68000の移行前後と実WASM | 42ケース、258,048フレーム。FM左右・OKI左右の4出力がbyte一致、WASMとの差分0 |
| 追加生成YM2151の移行前後と実WASM | 252ケース、1,548,288フレーム。PCM／status／IRQ／read等がbyte一致、WASMとの差分0 |
| Native状態比較 | 6ケース、49,152フレーム。272／292バイトの状態形式全体とPCM／status／IRQ／readが一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP全1,796ファイルのオフライン照合成功 |

固有の音声比較は計294件、1,806,336フレーム。更新したcheckerの既定ビルドでも成功し、
実際のSDKソースのパス／SHA-256を記録した。再確認分は固有ケースへ二重加算しない。
状態比較はNative同士で、WASM内部状態や全サンプルRAMの毎フレーム比較ではない。
今回の結果はmacOS ARM64／Clangで、音声デバイスを開かない検証。
先行する全OPNの5構成CIは今回のYM2151差分を含まない。各OSのCIと実機確認は別途行う。

### OKIM6258移行のローカル検証 — 2026-10-25

固定SDKから追加生成OKI接続とデコーダー原本を使う。
デコーダーにはビルド時に既存の初期化対策を適用し、SDK原本は編集しない。
詳細は[native_sdk_okim6258_adoption_01.md](native_sdk_okim6258_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース一致 | 接続・混合・ヘッダー6組がbyte一致。生成デコーダーも旧Nativeとbyte一致 |
| X68000の移行前後と実WASM | 42入力、258,048フレーム。FM左右・OKI左右の4出力がbyte一致、WASMとの差分0 |
| 追加生成OKIの移行前後 | 45入力、264,192フレーム。PCMとclock／divider／pan／再生状態等がbyte一致 |
| 追加生成OKIと実WASM | 3ブロック分割の135比較、792,576フレーム。差分0 |
| Native状態比較 | 6ケース、49,152フレーム。292／28バイトの状態全体とPCMが一致。借用バッファは破棄後も不変 |
| 並行生成 | 旧／生成SDK版でそれぞれ16スレッド・513インスタンス。初期化は各1回のみ |
| Cargo | 723成功、4件ignored |
| 再生 | 22 mode・604,032フレーム・88 Run／Stopが成功 |
| 混合 | 3混合構成・7単独音源、受入れ／16台制限が成功 |
| 配布ソース | SDK374ファイルを含む22件の固定記録と、最終ZIP全1,796ファイルのオフライン照合成功 |

固有Native入力は87件、522,240フレーム。実WASMは177比較、1,050,624フレームで、
同じ追加生成入力を3種類のブロック分割で再生する比較を含む。177件をすべて固有入力と数えない。
更新checkerの既定ビルドも成功し、SDK原本と実際の生成デコーダーのハッシュを記録した。
Cargoが生成した`OUT_DIR/tetorica_sdk_okim6258.cpp`自体も旧デコーダーと一致した。
今回もmacOS ARM64／Clangで音声デバイスを開かない検証。各OSのCIや実機確認とは区別する。

### YM2413／共有OPL provider移行のローカル検証 — 2026-10-25

同じ固定SDKから追加生成YM2413、共有OPL providerとPCM依存をビルドする。
機種用接続・NativeOpllCore・PSG／AYとDOS PC／Y8950の接続全体はアプリ側に保持する。
詳細は[native_sdk_ym2413_adoption_01.md](native_sdk_ym2413_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース一致 | 15入力がbyte一致。providerの差はinclude相対パスのみ。保持するローカル13入力は変更なし |
| Master System／MSX／追加YM2413 | 60／93／558ケース、計711件・3,225,600フレーム。旧／SDKがbyte一致、実WASMとの差分0 |
| DOS OPL／追加OPL・Y8950／MSX Audio | 198／552／138ケース、計888件・5,455,872フレーム。同じくbyte一致、WASMとの差分0 |
| Native公開状態比較 | 9ケース、36,864フレーム。72／100／104バイトの公開状態全体とPCM／status／IRQ／readが一致 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限が成功 |

固有比較は計1,599件、8,681,472フレーム。更新した6つのcheckerの既定ビルドも成功し、
実際のSDK入力のパス／SHA-256を記録した。既定ビルドの再確認分は固有件数へ加算しない。
状態比較は公開C ABI snapshotをNative同士で比べたもので、ymfm非公開メモリーやWASM全内部状態の比較ではない。
SDK優先で解決するsegapsg.hも旧コピーと同一で、PSGのcpp実装はアプリ側のまま。
今回もmacOS ARM64／Clangで音声デバイスを開かない検証。このローカル検証終了時点では各OSのCIと実機確認は未実行で、後続のCI結果は下記に記録している。
最終文書を含む対応ソースZIP全1,796ファイルと、SDK374ファイルを含む22件の固定記録のオフライン照合も成功。

### OPL系4音源の接続移行 — 2026-10-25、ローカル検証

共有providerは既にSDKへ移行済みで、今回は選択中／追加生成の接続とメモリーhelperだけを切り替えた。
詳細は[native_sdk_opl_adoption_01.md](native_sdk_opl_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース一致 | 採用する4ファイルはbyte一致、追加生成cppはコメント1行のみ差分 |
| 選択中DOS OPL | 198ケース、1,216,512フレーム。旧／SDKがbyte一致、実WASMとの差分0 |
| 追加OPL系4種類 | 552ケース、3,391,488フレーム。同上 |
| 選択中Y8950 | 138ケース、847,872フレーム。PCM／status／IRQ／read等が一致、WASMとの差分0 |
| RAM付きY8950 | 選択中／追加生成で72ケース、589,824フレーム。RAMを使うPCM／状態が一致、WASMとの差分0 |
| Native公開状態・RAM | 6ケース、24,576フレーム。524／520バイトの状態全体とPCM／read／revision・毎観測384バイトのRAMが一致。終了時の全借用バッファは破棄後も不変 |
| Cargo | 723成功、4件ignored |
| 再生／混合 | 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限が成功 |

計960件、6,045,696フレーム。更新した4つのcheckerの既定ビルドも実SDKを使って成功し、パス／ハッシュを記録した。
再実行分と別のNative公開状態比較は二重加算しない。全RAMの毎フレームdumpやWASM内部状態全体の比較ではない。
前回の5構成CI `40137093552`は今回の接続差分を含まない。今回もmacOS ARM64で音声デバイスを開かない検証。
最終文書を含む対応ソースZIP全1,796ファイルと、SDK374ファイルを含む22件の固定記録のオフライン照合も成功。

### AY-3-8910移行 — 2026-10-25、ローカル検証

共有AYコアと独立追加接続の参照を、同梱済みSDKへ切り替えた。
選択中MSX／MSX Audioの機種用接続とAYレート変換、Rustの制御・混合は維持する。
詳細は[native_sdk_ay8910_adoption_01.md](native_sdk_ay8910_adoption_01.md)。

| 対象 | 結果 |
| --- | --- |
| ソース一致 | 独立接続cpp／headerとコアcpp／headerの4ファイルがbyte一致 |
| 選択中MSX | 93ケース、571,392フレーム。旧／SDKがbyte一致、実WASMとの差分0 |
| 独立追加AY | 114ケース、466,944フレーム。PCM／公開状態が一致、実WASMとの差分0 |
| Native公開状態 | 6ケース、24,576フレーム。104／24バイトの状態全体、PCMと毎フレーム16個のAY readが一致 |
| 共通fixtureの追加YM2413回帰 | 558ケース、2,285,568フレーム。実WASMとの差分0 |
| Cargo | 723成功、0失敗、4件ignored |
| 再生／混合 | 22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限とStop後の予算回収が成功 |

AYの移行比較は計207ケース、1,038,336フレーム。既定ビルドの再確認分や追加YM2413回帰は二重加算しない。
全16 envelope形状、tone／noise、clock、明示的な音量0、Stop／reset／再試奏を含む。
公開状態比較はコアの非公開全メモリーやWASM内部状態のdumpではない。
fixture自己試験のcallback操作中のallocation／freeは0。macOS ARM64／Clangで音声デバイスを開かずに検証した。
このローカル検証終了時点では、OPL接続と今回のAY差分を含む5構成CIは未実行だった。
下記run `40142510765`は4構成成功・macOS x86_64失敗で終了した。実機の音声確認は未実行。

### Sega PSG移行 — 2026-10-25、ローカル検証

共通コア／raw C APIと関連ヘッダー4ファイルが旧コピーとbyte一致。
機種用接続は維持し、同じ固定SDKのコアを既存のGenesis archive内で一度だけコンパイルする。
詳細は[native_sdk_segapsg_adoption_01.md](native_sdk_segapsg_adoption_01.md)。

| 対象 | 比較数 | フレーム | 実WASMとの最大差 |
| --- | --- | --- | --- |
| Game Gear／追加PSG共通接続 | 69 | 454,656 | 0 |
| Master System | 63 | 387,072 | 0 |
| Nuked＋PSG | 222 | 1,363,968 | `2.9802322387695312e-8` |
| Genesis＋PSG | 6 | 49,152 | `3.725290298461914e-9` |

全360ケース・2,254,848フレームで旧／SDKの出力がbyte一致。混合FMのWASM丸め差は旧実装と同じ。
既定の4コンパイル経路も成功し、再確認分は二重加算しない。
raw C API別比較は6ケース・36,864フレームでPCMと全40バイトの直列化フィールドが一致した。
これはNative同士・同一ビルドの状態API比較であり、WASM内部状態や非公開オブジェクトのdumpではない。
状態APIはvectorを確保するためcallback割当てゼロの主張とは分ける。
Game Gear／Master System／Nukedのfixture自己試験は公開状態・独立性・callback allocation／freeゼロも成功。
PSGのattenuation 0は最大音量で、新しい比較はこの設定をStop／off／再試奏後も保持するもの。

Rust全試験は723成功・0失敗・4件ignored。
22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限と17台目拒否、Stop後の予算回収も成功。
両runnerはexit code 0、deviceOpened false。今回もmacOS ARM64／Clangでのローカル検証で、sanitizerは実行していない。
先行するrun `40143851548`の全5構成成功は今回のPSG移行を含まない。

### RF5C164移行 — 2026-10-25、ローカル検証

選択中／追加生成接続、共通decoder、raw C APIとヘッダー8ファイルが旧コピーとbyte一致。
詳細は[native_sdk_rf5c164_adoption_01.md](native_sdk_rf5c164_adoption_01.md)。

| 対象 | ケース | フレーム | 結果 |
| --- | --- | --- | --- |
| 選択中Mega CD | 21 | 98,304 | 旧／SDK byte一致、実WASM最大差0 |
| 独立追加生成 | 75 | 448,512 | 同上、毎フレーム95項目のPCM／公開状態／位置read／RAM probe |
| raw C API／追加状態の別比較 | 6 | 24,576 | PCM／毎フレーム16 readと、27観測点ずつの全64 KiB RAMが独立期待値・旧SDKの双方と一致 |

WASM比較は96ケース・546,816フレーム。既定2コンパイル経路の再確認は重複加算しない。
別比較のraw直列化状態は65,660バイト、追加公開状態は100バイト。これはNative同士の同一ビルド比較で、WASM内部状態や全RAMの毎フレームdumpではない。
追加fixtureのfull-RAM転送／保持／範囲拒否・9通りのrate／clock分離・声別取り消し・Stop／reset・callback allocation／freeゼロも成功。
Rust全試験は723成功・0失敗・4件ignored。22 mode・604,032フレーム・88 Run／Stopと、3混合構成・7単独音源・受入れ／16台制限・Stop後の予算回収も成功した。
両runnerはexit code 0／deviceOpened false。今回もmacOS ARM64／Clangで、sanitizerは実行していない。
ローカル検証後、下記run `40148943609`でPSG移行と合わせた5構成CIを実行し、検証とビルドが全5構成で成功した。
先行run `40143851548`は両移行を含まない。

### YM2612移行のGitHub Actions — 2026-10-25

- 対象: `v0.90.2+test`、Tauriコミット`9ef583e8e7fa9e75546b24dd89e119dab7d412c6`。
- [Build Desktop — run 40125688503](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40125688503)は全体が`completed`／`success`。
- 重複したmainの手動実行`40125700793`はキャンセル済み。タグ側の全5ジョブが成功した。
- タグ名とは別に、アプリの`package.json`／Tauri設定の版は`0.90.1`。

| 構成 | Native検証レポート | インストーラービルド |
| --- | --- | --- |
| macOS ARM64 | 成功 | 成功（DMG） |
| macOS x86_64 | 成功 | 成功（DMG） |
| Windows x86_64 | 成功 | 成功（NSIS） |
| Linux ARM64 | 成功 | 成功（DEB／AppImage） |
| Linux x86_64 | 成功 | 成功（DEB／AppImage） |

5環境それぞれの`native-validation-<platform>`を取得し、次のJSON内容まで照合した。

- `sources.json`: 22件の固定記録、SDK全374ファイル、対応ソースZIP全1,796ファイルが成功。
- `stability.json`: 22 mode、604,032フレーム、88 Run／Stop遷移が成功。
- `extra-stability.json`: 3混合構成、7単独音源、受入れと台数制限が成功。
- 全環境で`deviceOpened: false`。デバイスを開かない実Rustの生成処理の検証。

集計は`/private/tmp/tetorica-sdk-adoption-ci-40125688503/inspection-summary.json`。
ZIPのSHA-256はWindowsと他環境で異なるため、環境別の記録を参照する。
各環境でマニフェストとcheckoutに対する全ファイル照合は成功している。

インストーラーはDMG 2個、NSIS EXE 1個、DEB 2個、AppImage 2個の計7個を確認。
Actionsにもインストーラー5構成分と検証レポート5構成分の計10アーティファクトが保存されている。
タグのリリースは`isDraft: true`で未公開。インストーラーのダウンロード・インストールは今回の自動確認では行っていない。
今回のCIでOS間のPCM bit一致や各OSのWASM比較を確認したわけではない。
実機の音声出力・ノイズ・Keyboard操作・インストール後の起動も別に確認する。

Tauriの `Build Desktop` は `workflow_dispatch` または `v*` tagのpushで起動する設定で、通常のmain pushだけでは起動しない。

### 全OPN移行のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40130334227](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40130334227)をmainで手動実行。
- 対象コミットは`5280f83adebc542fdba1f49c5ff9bc8b51860734`。YM2612／YM2203／YM2608／YM2610／YM2610BのSDK移行を含む。
- run全体が`completed`／`success`で、macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5ジョブが成功。CIに通すためのコード修正は不要だった。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行なので、新しいドラフトリリースや一般公開は行わない。
- 各OSでのPCM bit一致、実機の音声出力・ノイズ・インストール後の起動は、このCIとは別の確認。

| 構成 | Native検証レポート | インストーラービルド |
| --- | --- | --- |
| macOS ARM64 | 成功 | 成功（DMG） |
| macOS x86_64 | 成功 | 成功（DMG） |
| Windows x86_64 | 成功 | 成功（NSIS） |
| Linux ARM64 | 成功 | 成功（DEB／AppImage） |
| Linux x86_64 | 成功 | 成功（DEB／AppImage） |

5つの`native-validation-<platform>`を取得し、各JSONの内容まで確認した。

- `sources.json`: SDK374ファイルを含む22件の固定記録と、対応ソースZIP全1,796ファイルの照合が成功。
- `stability.json`: 22 mode、604,032フレーム、88 Run／Stop遷移が成功。
- `extra-stability.json`: 3混合構成、7単独音源、受入れ・台数制限が成功。
- 全環境でrunnerのexit codeが0、`deviceOpened: false`。音声デバイスを使わない生成処理の結果。

SDK配布ZIPの固定ハッシュは全環境で同じ`26db7518...`。
対応ソースZIPはmacOS／Linuxが`d8930453ce6121b6ba63276c38a5b955c05360abe8a4a1b9eb140db3f4a1b502`、
Windowsが`f5ff2ada000b786419d1e5835a9d4fbdf391d779f588a877a0b4ff8a65959a53`で、
各環境のcheckout／マニフェストとの照合が成功した。
集計は`/private/tmp/tetorica-opn-ci-40130334227/inspection-summary.json`。

GitHub APIで、Native検証レポート5構成分とインストーラー5構成分の計10アーティファクトを確認した。
すべて有効期限内で、サイズは0より大きい。インストーラーをダウンロード・インストールして起動する確認は行っていない。
今回の手動実行はタグを作らず、新しいドラフトリリースも一般公開も行っていない。
実機の音声出力・ノイズ・UI操作・OS間のPCM bit一致を確認したという意味ではない。

結果を参照する場合は、対象runを次で確認できる。

```sh
gh run view 40130334227 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### YM2151／OKIM6258／YM2413移行後のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40137093552](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40137093552)をmainで手動実行した。
- 対象は`634e56f4dcbacd3d204ea5dace454d39fe0fc9ca`。全OPNに加え、YM2151、OKIM6258、YM2413／共有OPL providerの移行を含む。
- macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の5構成で、run全体と全5ジョブが成功した。CIのためのコード修正は不要だった。
- 全5環境の検証JSONとGitHubのアーティファクトdigestを照合済み。SDK374／22件の固定記録／ZIP1,796ファイル、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源と受入れ／16台制限が成功。両runnerはexit code 0、deviceOpened false。
- インストーラービルドも全5構成で成功。macOSはDMG、WindowsはNSIS、Linuxは各DEB／AppImage。
- 検証レポート5構成とインストーラー5構成の計10アーティファクトをGitHub APIで確認した。すべて有効期限内・サイズ0より大きい。インストーラー自体のダウンロードや起動は未確認。
- タグを作らない`workflow_dispatch`で、アプリ版は`0.90.1`のまま。新しいドラフトリリースや一般公開は作らない。
- 記録は[native_sdk_ym2413_adoption_01.md](native_sdk_ym2413_adoption_01.md)、取得したJSONと集計は`/private/tmp/tetorica-ym2413-ci-40137093552/`。
- CIのソースZIPに対する比較基準のマニフェストを同ディレクトリの`before-docs-source-manifest.json`に保存した。
  CI結果をTauriガイドへ追記した後のZIPも別に生成・照合済みで、差分は`docs/native-sdk-ym2612.md`のみ、コンパイル入力は同一。
- CIの対応ソースZIPはmacOS／Linuxが`2829e9f948e257535bf71aac86a702ffe75701ba878cc01cb5c8900787c5a2ee`、Windowsが`ba9920701daf4513d586ef92037c2afcf7bb8d84a83842d665286623ca6e1c20`。
  全環境でマニフェスト／checkoutとの照合は成功。Windowsとの差の原因は未断定で、SDK固定ハッシュは同じ。
- 先行する各ローカル検証の「CI未実行」はその時点の記録。今回のCIはYM2151／OKIM6258／YM2413移行を含むが、OS間のPCM bit一致や各OSでのWASM比較、実機の音声出力・ノイズ・インストール後の起動は別の確認。

```sh
gh run view 40137093552 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### OPL接続／AY移行後のGitHub Actions — 2026-10-25、4構成成功、macOS x86_64失敗

- [Build Desktop — run 40142510765](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40142510765)を`main`へ`workflow_dispatch`で手動実行した。
- 対象コミットは`276e744ee5ed00513558b1d995e950a3ef91884c`。`4451195...`のOPL接続移行と、今回のAY移行を含む。
- attempt 1は`completed`／`failure`。5ジョブ中4成功・1失敗で、再実行はしていない。
- 開始前に本体`ce2ad30833a96607721ce8ea3122aaf5e6fefa3d`とTauriの対象HEADがユーザーによりcommit／push済みで、両作業ツリーがcleanであることを確認した。
- macOS ARM64・Windows x86_64・Linux ARM64／x86_64の4ジョブは検証・インストーラービルドとも成功。macOSはDMG、WindowsはNSIS、LinuxはDEB／AppImage。
- macOS x86_64のRust試験は722成功・1失敗・4件ignoredでexit code 101。`native_genesis::extra_snes_tests::extra_snes_completion_wait_releases_control_and_history_expires`で、CI対象の`src/native_genesis_extra_snes_tests.rs:656`の`unwrap()`が`Native additional SNES state changed while reading; retry`を返す`Err`でpanicした。
- 検証アーティファクト5件のZIP digestを照合し、全環境の`sources.json`を確認した。SDK374ファイルを含む22件の固定記録とソースZIP1,796ファイルが成功。macOS x86_64の再生／混合reportは欠けており、成功とは扱わない。
- 残る4構成の完全なreportは、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源・受入れ／16台制限が成功。両runnerはexit code 0、`deviceOpened: false`。OS間のPCM bit一致や各OSでのWASM比較は未確認。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行で、新しいドラフトリリースや一般公開は行わない。
- 確認用レポートの取得先は`/private/tmp/tetorica-opl-ay-ci-40142510765/`。
- 集計は`inspection-summary.json`、失敗ログは`macos-intel-job.log`。最終状態は`run-final.json`、`jobs-final.json`、`artifacts-final.json`、`jobs-audit.json`。
- GitHub APIで検証レポート5件とインストーラー4件の計9アーティファクトを確認し、すべて有効期限内・サイズ0より大きかった。全5ジョブのドラフトリリース作成stepはskipped。実機の音声・UI操作・インストーラーのダウンロードや起動は別の確認。
- このCI対象と、その後のローカル試験修正は区別する。OPL／AY移行との因果関係は未確定で、元のCI入力ZIPのハッシュ`cf24143b...`は保持している。

```sh
gh run view 40142510765 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### 追加SNES試験のローカル修正と検証 — commit済み

Tauriの`src-tauri/src/native_genesis_extra_snes_tests.rs`だけを修正し、
上記のretryエラーに限って5秒を上限に`yield_now()`を挟んで再読取する。
ほかのエラーは検証へ渡し、通知受信の待機も200 msから5秒へ延長した。
完了前の待機・履歴失効・状態値などの意味上のassertは保持する。音源・製品のRust実装・ビルド・APIは変更しない。
修正後のRust全試験は723成功・0失敗・4件ignored。対象試験の反復も50／50成功し、
同じCI記録ディレクトリの`snes-test-fix-validation.json`に記録した。
この修正は最初のCI対象`276e744...`には含まれない。ローカル検証終了時点では未コミット・修正版CI未実行だったが、
その後ユーザーが修正とガイドをTauriの`842245dd...`へ、本体の記録を`a278e1d5...`へcommit／pushした。
Tauriのガイドも今回の結果に合わせて更新し、試験修正とガイドを含む対応ソースZIPを再生成・照合した。
CI入力とのマニフェスト差分はガイドとSNES試験の2ファイルだけ。製品のソース入力は変わらない。

### SNES試験修正後のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40143851548](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40143851548)を`main`へ`workflow_dispatch`で手動実行した。
- 対象は`842245ddf060fedaeb42e6b01d30175b488816b7`。OPL接続／AY移行に加え、SNES試験修正と前回CIのガイド更新を含む。
- attempt 1は`completed`／`success`。全5ジョブの検証とインストーラービルドが成功した。
- 開始前に本体`a278e1d565d0ef345bcdf1532763480cd156614d`とTauriの対象HEADがremote mainと一致し、両作業ツリーがcleanであることを確認した。ユーザーがcommit／push済みのため、追加のcommitはしていない。
- macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5構成で、ソース照合・Cargo・再生ライフサイクル・追加音源混合のstepが成功した。
- macOS ARM64／x86_64はDMG、Windows x86_64はNSIS、Linux ARM64／x86_64はDEB／AppImageが成功。最初のCIで失敗したIntel Macも今回はジョブ全体が成功した。
- 検証JSONと取得した検証ZIPのdigestは全5構成で照合成功。SDK374ファイルを含む22件の固定記録とソースZIP1,796ファイル、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源・受入れ／16台制限・Stop後の予約予算回収が成功。両runnerはexit code 0、`deviceOpened: false`。
- 前回reportが欠けたmacOS x86_64も、今回は`sources.json`／`stability.json`／`extra-stability.json`が揃って成功した。
- 最初に失敗したrun `40142510765`とは別の実行。アプリ版は`0.90.1`のままで、タグ・新しいドラフトリリース・一般公開は作成しない。
- 確認用レポートの取得先は`/private/tmp/tetorica-opl-ay-fixed-ci-40143851548/`。
- 集計は`inspection-summary.json`と`native-artifact-metadata.json`。対応ソースZIPはmacOS／Linuxが`2cafb70e...`、Windowsが`0cbc716f7d277d2a2e0e24f42134cb0f6b6ffb15f767fe0f74ea377b84c00920`で、各checkout／マニフェストとの照合は成功。差の原因は断定していない。
- 最終状態は`run-final.json`、`jobs-final.json`、`artifacts-final.json`。検証レポート5件とインストーラー5件の計10アーティファクトは、すべて有効期限内・サイズ0より大きかった。全5ジョブのドラフトリリース作成stepはskipped。
- インストーラーや対応ソースZIPのダウンロード、インストール後の起動・実機の音声・UI操作は未確認。OS間のPCM bit一致や各OSでのWASM比較も、このCIの確認範囲には含まれない。
- このチェックポイント更新は本体の2ファイルとTauriガイド。コードは変更せず、完了したローカル試験は再実行していない。ガイドを含む対応ソースZIPだけ再生成した。

```sh
gh run view 40143851548 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### Sega PSG／RF5C164移行後のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40148943609](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40148943609)を`main`へ`workflow_dispatch`で手動実行した。
- 対象は`4939ddc7f7125f47d969e29c975264eaa528d81c`。Sega PSGとRF5C164のSDK移行を含む。
- attempt 1は`completed`／`success`。全5ジョブの検証とインストーラービルドが成功した。
- 本体`1d35f48a16dbc5b0264755f82ec3e97242e34e8a`とTauriの対象HEADをpushし、remote mainとの一致と両作業ツリーがcleanであることを確認してから開始した。
- 全5構成の検証JSONと検証ZIPのdigest照合が成功。macOS ARM64／x86_64はDMG、Windows x86_64はNSIS、Linux ARM64／x86_64はDEB／AppImageのビルドも成功した。
- 各環境の`sources.json`でSDK374ファイルを含む22件の固定記録とソースZIP1,796ファイル、`stability.json`で22 mode・604,032フレーム・88 Run／Stopが成功。
- `extra-stability.json`では3混合構成・7単独音源、受入れ／16台制限とStop後の予約予算回収が成功。両runnerはexit code 0、`deviceOpened: false`。
- 最初のSSH公開鍵認証ではpushに失敗したが、コマンド単位のgh HTTPS認証で成功した。remoteやGit設定は変更していない。
- アプリ版は`0.90.1`のまま。タグを作らない手動実行で、新しいドラフトリリースや一般公開は行わない。
- 確認用レポートの取得先は`/private/tmp/tetorica-psg-rf-ci-40148943609/`。
- `inspection-summary.json`は全5構成がpassedで、不足reportは0。CIの対応ソースZIPはmacOS／Linuxが`e1433b21...`、Windowsが`cac895015a0a3737fcb5116adf214c24b0ee7722d18938a4eae3c296592fe48a`で、各checkout／マニフェストとの照合は成功。差の原因は断定していない。
- 最終根拠は`final-ci-summary.json`、`jobs-audit.json`、`artifact-metadata.json`。検証レポート5件とインストーラー5件の計10アーティファクトは対象run／commitと一致し、すべて有効期限内・サイズ0より大きかった。全5ジョブのドラフトリリース添付stepはskipped。
- この結果記録は本体の作業記録2ファイルとTauriガイドだけ。コードは変更せず、完了したローカル試験は再実行していない。ガイド確定後の対応ソースZIPも別に再生成・照合した。Tauriガイドは`66004f00e66e7dba2394777cd281f7feeec46da0`へcommit／push済み。
- インストーラーや対応ソースZIPのダウンロード・起動・独立照合は未確認。OS間のPCM bit一致や各OSでのWASM比較、実機の音声・ノイズ・UI操作・インストール後の起動も別の確認。

```sh
gh run view 40148943609 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### Game Boy／NES＋FDS移行後のGitHub Actions — 2026-10-25、全5構成成功

- [Build Desktop — run 40168462256](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40168462256)は`main`への`workflow_dispatch`、attempt 1。対象は`a70e86d2061349a396de7e4816a5438fea5dcb4f`で、Game Boy／NES＋FDSのSDK参照切替を含む。
- 2026-10-25 06:15:32 UTC開始、06:34:34 UTC更新の最終結果が`completed`／`success`。macOS ARM64／x86_64、Windows x86_64、Linux ARM64／x86_64の全5ジョブの検証とインストーラービルドが成功した。CIのためのコード修正は不要だった。
- macOSはDMG、WindowsはNSIS、LinuxはDEB／AppImageのビルドが成功。アプリ版は`0.90.1`のまま。
- 全5構成で`npm test`のPython 22件とNode 31件が成功。CargoはWindowsが726成功・0失敗・3件ignored、ほか4構成が723成功・0失敗・4件ignored。OS固有の試験数を同一扱いしない。
- `sources.json`でSDK374ファイルを含む22件の固定記録と対応ソースZIP1,796ファイルが成功。SDK元ZIPのSHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`、frontend archiveは`97433be4f9573cc328ec3e943ce2de6267a84c5c84852f8283cbfb47d0683706`で、全5構成で一致。
- `stability.json`はGame Boy／NESを含む22 mode・604,032フレーム・88 Run／Stopが成功。`extra-stability.json`は既存の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否、両制限試験のStop後の予約予算0が成功。両runnerはexit code 0、`deviceOpened: false`。既存の混合構成はGame Boy／NES専用の組合せを追加したものではない。
- 検証レポート5組のJSONと取得ZIPのdigestを照合した。検証5件・インストーラー5件の計10アーティファクトは対象run／commitと一致し、有効期限内・非空だった。全5ジョブのドラフトリリース添付stepはskipped。
- 証拠は`/private/tmp/tetorica-gb-nes-ci-40168462256/`の`final-ci-summary.json`、`inspection-summary.json`、`test-log-summary.json`、`native-artifact-metadata.json`。CIの対応ソースZIPはmacOS／Linuxが`1fb6bf89c2a372abbad9190761b678ec611d944f12fabe7a0ac8f6ce8c7f0bec`、Windowsが`ac7cef894eff5ce76f14ebb25a47b3921b0068c6789840883c1e58674240d5ea`。各CIのソース照合は成功し、ハッシュ差の原因は断定しない。
- 取得したのは検証レポートZIPだけで、インストーラーや対応ソースZIPのダウンロード・起動・独立照合はしていない。OS間のPCM一致や各OSでのWASM比較、実機の音声出力・ノイズ・UI操作は別の確認。
- この結果記録は本体の3ファイルとTauriガイドだけ。コードを変更せず、完了したローカル試験は再実行していない。今回の記録更新のcommit／pushと、新しいタグ・releaseの作成は行っていない。

```sh
gh run view 40168462256 --repo kyorohiro/tetorica-fm2612-playground-tauri --json status,conclusion,headSha,jobs
```

### DX7移行 — 2026-10-25、ローカル検証

選択中／独立追加DX7の共通接続とMSFAを固定SDKへ切り替えた。接続cpp／headerとMSFA 30入力中29ファイルはbyte一致し、
Native-only `synth_unit.cc`のPanicで16個の事前確保noteへ初期状態を値代入する点だけが異なる。
SDKの374ファイル・版・取り込み記録、旧32件のsnapshot pin・ライセンスとBrowser／npmのWASMは変更していない。
詳細は[native_sdk_dx7_adoption_01.md](native_sdk_dx7_adoption_01.md)。

| 対象 | 固有Native入力数 | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| 選択中DX7の既存再生比較 | 114 | 792,576 | 114 | 792,576 |
| 独立追加DX7の既存比較 | 21 | 239,616 | 63 | 718,848 |
| 32 algorithm × 3 rateのPanic／再発音 | 96 | 786,432 | 96 | 786,432 |
| 合計 | 231 | 1,818,624 | 273 | 2,297,856 |

既存135入力の旧／SDK stdoutはbyte一致。新しいPanic比較はSDKと実WASMが全96入力で差0で、
旧版は79入力で再発音後だけに差があり、17入力は一致した。frame 1,403の再発音直前までは全入力が一致し、
最大差は`0.0002746583195403218`。全273比較のSDK／実WASM最大差は0だった。
追加側のblock分割3通りを固有Native入力へ加算せず、追加checker内の選択中再実行や既定経路の再確認・自己試験も集計へ加算していない。

旧／SDKのTauri既存fixture自己試験が成功。SDKの強化fixtureはrate境界、不正slot、保護slot／release tail、16音確保、live edit／voice identity、即時Panic無音と新規音源一致96／96が成功。
強化したPanicの新規音源一致判定は旧版で意図どおり失敗し、別に実行した旧版の制御試験は成功した。
本体＋16 noteの確保量35,320バイト、17通りの部分生成失敗の回収、render／制御中allocation／free 0、LFO／filter／resampler独立性、単一slot killも確認した。
private全状態やWASM内部状態を毎フレームdump比較したものではない。
公開JS adapterは44.1／48 kHzで確認し、96 kHzは実WASM exportsへ同じ整数位相変換を適用した比較。公開APIの96 kHz対応を追加したという意味ではない。

既定checker2本、inline fixture／out指定が成功し、不正12形式をコンパイル前に拒否。各fixtureのSDK32＋fixture側2の34入力のハッシュと、30組立入力の実読み込みを確認した。
実Cargo生成物も30入力がSDKとbyte一致し、32ソース入力の監視・14 archive object・10 C ABI exportの各1回の定義を確認。旧ヘッダー混入や新しい動的ライブラリー指示はない。
`npm test`はPython 22件・Node 31件成功、Rustは723成功・0失敗・4件ignored。TCP bindのため初めから制限外で実行し、sandbox内失敗はない。
22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源と受入れ／16台制限も成功。両制限試験のStop後予約予算は0、両runnerはexit code 0・`deviceOpened: false`。
このDX7ローカル検証の終了時点ではcommit／pushと新しいCIは未実施だった。後述のrun `40171879716`でSNES／SPCとまとめて確認した。
sanitizer、実機聴音やUI操作・速度保証は別の確認。
比較・ソース監査は`/private/tmp/tetorica-sdk-dx7-adoption/`の`parity-summary.json`、`source-audit.json`、`self-tests.json`、`build-assembly-audit.json`。
ホストログは`/private/tmp/tetorica-sdk-dx7-npm-test.log`と`/private/tmp/tetorica-sdk-dx7-cargo-test-unrestricted.log`。
再生／混合レポートは`/private/tmp/tetorica-sdk-dx7-stability.json`と`/private/tmp/tetorica-sdk-dx7-extra-stability.json`。

### SNES／SPC移行 — 2026-10-25、ローカル検証

選択中／独立追加SNES S-DSPと独立追加SPC700プレーヤーを固定SDK参照へ切り替えた。
28組のソース・ABI header・由来ファイルは旧コピーとbyte一致し、旧34件のsnapshot pinを保持した。
既存archiveの6翻訳単位と共有S-DSPの1回の定義を維持する。詳細は[native_sdk_snes_spc_adoption_01.md](native_sdk_snes_spc_adoption_01.md)。
macOS ARM64／Clang・Nodeで旧／SDKを別々にコンパイルし、全入力のstdout／stderrがbyte一致した。

| 対象 | 固有Native入力数 | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| SNES（選択中と追加生成の重複を除く） | 75 | 761,856 | 267 | 2,727,936 |
| 独立追加SPC | 84 | 688,128 | 252 | 2,064,384 |
| 合計 | 159 | 1,449,984 | 519 | 4,792,320 |

実配布WASM／Workletの最大差は0。選択中SNESの42入力は追加側75入力の部分集合で二重加算しない。
追加側の3通りのblock分割比較をNative入力へ加算せず、既定経路の再確認やfixture指定・自己試験も集計から除く。
実WASM SHA-256は`cbbe06819574249217f35da16eebd45a53274e53251f31242e7dd407b03d0d70`。
SNESの既存／SDK fixtureを旧／SDKで2種類の自己試験へ実行し、8回とも成功。152バイトstate ABI、ローカル確保量67,280バイト、コピーRAM・全体reset・境界・安定view、8声・保護gate、保持Stop・独立性と借用timelineのpause／完了／再開、render／制御allocation／free 0を確認。
SPCの28シナリオ×3 rateと、実WASMへの810 snapshot・358,056 DSP書込みを照合した。強化fixtureも旧／SDKで成功し、56バイトstate／16バイトevent ABI、ローカル確保量204,624バイト、コピーload・control側seek・pause・独立mute・観測／overflow・失敗／reload、render allocation／free 0を確認。
公開状態や限定された観測点の比較であり、毎フレームのprivate全状態のdump比較ではない。
3本の既定checkerとinline指定が成功し、不正18形式をコンパイル前に拒否。指定fixtureは保持し、SNES 10入力／SPC 15入力を依存列と実ファイルのSHA-256へ照合した。
実Cargo archiveは6 objectを保持し、35個のNative C ABI exportは各1回だけ定義された。6 CPPの依存preprocessでSDK側headerだけを解決し、SDK入力の監視を確認。旧sourceの全体監視を外し、個別のlicense／対応ソースresource監視を保持する。
`npm test`はPython 22件・Node 31件成功、Rustは723成功・0失敗・4件ignored。MCPのTCP bindのため初めから制限外で実行し、sandbox内失敗はない。
再生ライフサイクル22 mode・604,032フレーム・88 Run／Stopと、3混合構成・7単独音源、受入れ／16台制限で17台目拒否も成功。両制限試験のStop後予約予算は0、両runnerはexit code 0・`deviceOpened: false`。
証拠は`/private/tmp/tetorica-sdk-snes-spc-adoption/`の`source-audit.json`、`snes-parity-summary.json`、`spc-parity-summary.json`、`independent-checker-audit.json`、`build-audit.json`、`host-summary.json`。
ホストログは`/private/tmp/tetorica-sdk-snes-spc-npm-test.log`と`/private/tmp/tetorica-sdk-snes-spc-cargo-test-unrestricted.log`。
再生／混合レポートは`/private/tmp/tetorica-sdk-snes-spc-stability.json`と`/private/tmp/tetorica-sdk-snes-spc-extra-stability.json`。
直前の全5構成成功CI run `40168462256`はDX7も今回のSNES／SPC移行も含まない。
ローカル検証と対応ソースZIP照合後にcommit／pushし、次の5構成CIでも確認した。

### DX7／SNES／SPC移行後のGitHub Actions — 2026-10-25、全5構成成功

[Build Desktop — run 40171879716](https://github.com/kyorohiro/tetorica-fm2612-playground-tauri/actions/runs/40171879716)をmainへ手動実行した。
attempt 1、2026-10-25 07:12:01 UTC開始、07:26:29 UTC完了。対象は`8b9e922ad6e9c1f8d33cf5719b05330b58311944`。
本体の基準は`8898a75fc4424aca11596d8cd7fb6046d1c3b585`。dispatch前に両作業ツリーがcleanでremote mainと一致し、SDKもcleanと確認した。
runは`completed`／`success`で、Windows x86_64、Linux x86_64／ARM64、macOS x86_64／ARM64の全5構成の検証・インストーラービルドとアップロードが成功した。
CIのための製品・試験修正は不要だった。
全5構成のログでPython 22件・Node 31件成功。Rust全試験はmacOS／Linuxが723成功・0失敗・4件ignored、Windowsが726成功・0失敗・3件ignoredだった。

- 全5構成でSDK374ファイルを含む22件の固定記録と対応ソースZIP全1,796ファイルの照合成功。
- 各構成の22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源と受入れ／16台制限が成功。17台目を拒否し、受入れ・台数制限の両方でStop後の予約予算は0、両runnerはexit code 0・`deviceOpened: false`。
- 5検証レポートZIPのdigest／サイズをGitHub metadataへ照合。検証5組とインストーラー5組の計10成果物は対象run／commitと一致し、有効期限内・非空だった。
- 全5ジョブのドラフトリリース添付stepはskipped。アプリ版`0.90.1`のままで、新しいタグ・ドラフトリリース・一般公開は作成していない。

CIの対応ソースZIP SHA-256はmacOS／Linuxが`39cd14b113557665c039d0af3960839ed566c7ad2fdc49286859d8b5c53fa684`、Windowsが`f3ac24c3a08277ebcdf3651dce8f2620ebae6dc05bc149fac4de48cb89fb19e3`。
各CI内の照合は成功し、ハッシュ差の原因は断定しない。証拠は`/private/tmp/tetorica-dx7-snes-spc-ci-40171879716/`の`final-ci-summary.json`、`jobs-audit.json`、`inspection-summary.json`、`test-log-summary.json`、`artifact-metadata.json`、`native-artifact-metadata.json`。
先行run `40168462256`はDX7もSNES／SPC移行も含まない。今回のCIと、ローカルDX7 273比較／SNES・SPC 519比較を区別する。
取得したのは検証レポートのみで、インストーラー／対応ソースZIP自体の取得・独立照合・起動、各OSのWASM比較、OS間PCM一致、実機聴音・UI操作は未確認。
CI開始後の変更は結果記録だけで、製品・試験入力は同じ。完了済みのローカル試験は再実行していない。

### Nuked YM2612移行 — 2026-10-25

通常の22音源IDに加えて、Genesis Nuked／32X Nukedと独立追加YM2612のNukedエンジンを固定SDKへ切り替える。
SDK `0.1.1`の単体ターゲットを追加するが、Tauriは既存の2 archiveとconsumer → adapter → provider順を維持する。
全8 OPN2 exportのprefix、初回のglobal chip type選択、選択中音源の自然なDC・PSG混合・gain／ramp、
独立エンジンの6CHと通常CH3／CSM取消し・Stop／reset、Rustの所有・予約・Mixer／FXを保持する。
接続cppはinclude位置だけが異なり、`.inc`・共通state header・C wrapper・コア・LICENSE等7組はbyte一致。
旧9 pin・由来・LGPLライセンスは保持し、syncスクリプトだけで実際のSDK入力が変わらないことを再ビルド手順にも記す。
選択中222入力・1,363,968フレームと追加198入力・1,216,512フレームの旧／SDK stdoutはbyte一致。
API profileを区別した合計420入力・2,580,480フレームを実配布WASMへ比較し、独立追加は差0、
選択中は既存のFloat32 ramp差`2.9802322387695312e-8`を保持する。共有する符号化命令列39件は同じAPI入力ではない。
旧／SDKのfixture自己試験でStop／再発音・6CH・公開状態とcallback allocation／free 0、
各providerの8 exportの各1回の定義と非prefix定義0を確認した。
SDK `0.1.1`・元コミット`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`の379ファイルを取り込み、配布ZIP SHA-256
`939fb035aef36c84cac3d1e058271ca3ddfc6ebd9ce5cfa4b3d04bc92876416b`とmanifestを照合した。
SDKのソースZIPを独立展開した全24 CTest・18 WAV exampleとJavaScript参照10試験は成功。
Tauriの`npm test`もPython 22件・Node 31件成功。ツール試験はSDK最終取り込み前の実行で、合成fixtureを使いreceiptに依存しない。
2本の既定checkerは初回取り込み後のSDK入力から成功し、選択中12入力／追加8入力のハッシュと不正12形式の拒否を確認した。
その後比較ツールにもSDKのLinux監査用shimを使い、記録対象は13／9入力になった。両既定checkerの同じ222／198ケース・自己試験も再実行して成功。再実行は合計420ケースへ加算しない。
実Cargoの2 archive各1 objectはSDK接続cpp／コアCから生成された。10 raw C ABI・16独立C ABI・8 prefix済みexportは各1定義、非prefix定義0。
6音源入力のSDK解決、実入力監視と旧ソース監視の除去、既存リンク順序も確認した。
Rust全試験は723成功・0失敗・明示実行用4件ignored。MCPのローカルTCP bindのため初めから制限外で実行し、sandbox内の失敗はない。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stopが成功した。
既存の追加音源3混合構成・7単独音源、受入れ／16台制限と17台目拒否も成功し、両制限試験のStop後予約予算は0へ戻った。
再生／混合runnerはともにexit code 0、`deviceOpened: false`。
この既存混合表に独立追加Nukedは含まれず、Nukedは別のPCM比較・同時リンクfixture・Rust試験と選択中modeの再生試験で確認した。
これらのホスト試験はSDK `60f06e629395b65f1777e7e28c80be9eefca2381`／378ファイルの初回取り込み後に実行した。
初回取り込みから最終配布への差は`RELEASE-MANIFEST.json`、`docs/verification.md`、`native/CMakeLists.txt`と新しい試験用`native/tests/nuked_audit.cpp`の4ファイルだけだった。
実際にTauriが使うコア・接続入力の全バイト列が一致することを`final-import-audit.json`で確認したため、完了済みのホスト試験を再実行していない。
最終ソースZIPを独立展開した全24 CTest・18 WAV exampleとJavaScript参照10試験は改めて成功し、検証scriptのexit codeは0だった。
SDKの初回CI run `40174420834`はLinux 2構成で試験専用のallocation macroと標準ヘッダーのinclude順によりコンパイル失敗。
SDKの監査用shimで標準ヘッダーを先に読む形へ修正済みで、製品音源・接続は変更していない。
修正コミット`e4b7d7e...`のSDK CI run `40175263453`は全6ジョブ成功。Native 5構成それぞれで19ライブラリー・24 CTest・18 WAV exampleが成功し、診断ZIP 5個のdigestも照合した。
移行を本体`02b2e3ad...`、Tauri`367fd7a...`へcommit／push後、両作業ツリーがcleanでremote mainと一致することを確認し、Tauri CI run `40175615215`を手動実行した。attempt 1、対象`367fd7a851ffadd3a01c3cfb985972112156ca63`で全5構成の検証・インストーラービルド／アップロードが成功。
全構成でPython 22件・Node 31件成功。CargoはWindows 726成功／3 ignored、ほか4構成723成功／4 ignored。検証JSONでSDK379／22固定記録／ZIP1,801、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源・受入れ／16台制限・Stop後予算0も成功。両runnerはexit code 0、`deviceOpened: false`。
取得した検証ZIP 5個のGitHub digestと、計10アーティファクトのrun／commit一致・非空・有効期限内を確認した。ドラフトリリース添付は全5構成skipped。
CI内のソースZIP SHAはWindows`013f72711887d4cc9cfa7b0901fce422f1ee2f54a164ea72be920b35470456b4`、ほか4構成`1a56f72f99db7f09e71c6bbc588d5430823bd9ae408780f5965cdfc2b295420c`。内容照合は全構成成功し、ハッシュ差の原因は断定しない。
SDK CI証拠は`sdk-ci/summary.json`、Tauri証拠は`tauri-ci/final-ci-summary.json`ほか。後者のSHAは`df46e7fc4764bdb243f46a9e5970b193d87653dc0de8ec159d832640093c415b`。
TauriのCI対象からの差分は結果記録ガイドだけ。本体比較ツールはSDK監査shimへ揃えて同じケースを再検証した。インストーラーの取得・起動、実機聴音・UI操作は別の確認で、新しいタグやreleaseは作成していない。
証拠は`/private/tmp/tetorica-sdk-nuked-adoption/`。毎frameのprivate全状態・各OSでのWASM比較・実機聴音は別の確認。

### 再開手順

Nuked移行のCI前チェックポイントでは、対応ソースZIP全1,801ファイルのSHA-256は
`1a56f72f99db7f09e71c6bbc588d5430823bd9ae408780f5965cdfc2b295420c`。
全22件の固定記録・SDK379ファイル・ZIPの照合結果は`/private/tmp/tetorica-sdk-nuked-adoption/sources.json`。
CI結果記録後の最終ZIPも全1,801ファイルを照合し、SHA-256は
`0413ecb4f5c9fe8f96a4b6a87ac46bd244a32c393af05e819363cbae9fc9c720`。
CI入力との差はTauriガイド1ファイルのみで、結果は同ディレクトリの`local-final-sources.json`と`final-doc-source-audit.json`へ保存した。
文書変更だけなので完了済みの製品試験は再実行していない。

まず現在の差分とHEADを確認する。保存時点のHEADへ無条件に巻き戻さない。

```sh
cd /Users/kyorohiro/development8/wfm/hello_ymfm
git status --short
git -C w/tetorica-soundchip-native status --short
git -C w/tetorica-soundchip-native log -1 --oneline
git -C w/tetorica-fm2612-playground-tauri status --short
git -C w/tetorica-fm2612-playground-tauri log -1 --oneline
```

Tauriで同梱SDKと配布ソースを確認する。

```sh
cd /Users/kyorohiro/development8/wfm/hello_ymfm/w/tetorica-fm2612-playground-tauri
python3 scripts/import_soundchip_sdk.py --check
python3 scripts/prepare_native_sources.py
python3 scripts/check_native_sources.py --bundle --out=native-validation/sources.json
```

コードを変更した場合の通常の検証手順は次のとおり。変更していなければ、完了済みの重い試験をやり直す必要はない。

```sh
npm test
cargo test --locked --offline --manifest-path src-tauri/Cargo.toml
node scripts/check_native_stability.mjs --out=native-validation/stability.json
node scripts/check_native_extra_stability.mjs --out=native-validation/extra-stability.json
```

`--offline`は依存キャッシュがある環境向け。別PC／fresh checkoutでは、
先にNATIVE-SOURCES.mdに従ってNode／Rust／C++環境とロック済み依存、音声sidecarを準備する。
SDK自体をリモートから自動取得する設計には戻さない。

### 完了した作業 — 本体YM2612 WASMの固定SDK参照

[ビルドスクリプト](../../scripts/build_ym2612_wasm.sh)は完全同梱したSDK `0.1.1`／
`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`のWASM用レシピを使う。
Native用wrapperへの置換ではなく、既存と同じWASM ABI・同期JS APIを維持した移行。
全379ファイルをmanifestと取り込み記録でoffline検証し、通常ビルドでリモート取得は行わない。
改変検出・分離したfresh copyからの入力解決と出力先も試験した。

旧レシピの再ビルド／配布済みWASMとSDK版の2比較が各444ケースで差0。
状態の継続、内部envelope、全6CH、timer/IRQ、DAC、block分割も一致した。
Chromium／WebKitの実Workletと隔離したnpm配布物・型も検証済み。
SDKとコンパイラー・入力／出力hashは[移行記録](wasm_sdk_ym2612_adoption_01.md)とそのJSON、
`docs/generated/build-info.json`に記録した。

この節はYM2612移行時の記録。続けて実施したYM2203移行は次の節に記載する。
JS adapterのパッケージ分離・公開API再設計、高速レジスタ演奏は扱っていない。

### 完了した作業 — YM2203 WASMの固定SDK参照

`scripts/build_ym2203_wasm.sh`も同梱SDK `0.1.1`のWASM用レシピを使う。
固定SDK原本379ファイルと取り込み記録は変更せず、必須入力の検査とビルド経路の試験を拡張した。
通常出力先での実ビルドが比較用SDK出力とbyte一致し、既存YM2612の生成記録・出力も維持した。

旧レシピ再ビルド／配布済みWASMとSDKの2比較は、各432ケース・9,770,400出力ステレオフレームで差0。
FM／SSG、プリスケーラー、timer／IRQ、mute、状態復元、既存Engineのリサンプリングを含む。
Python23件、既存OPN／YM2203試験34件、Chromium／WebKit計4経路、隔離npm配布物と型も成功。
校正記録の再測定は不要で、Mixer値・公開API・モノラル左右同値の出力は維持した。
詳細と入力／出力hashは[YM2203移行記録](wasm_sdk_ym2203_adoption_01.md)とそのJSONを参照する。

この節はYM2203移行時の記録。続けて実施したYM2608移行は次の節に記載する。

### 完了した作業 — YM2608 WASMの固定SDK参照

`scripts/build_ym2608_wasm.sh`も同梱SDK `0.1.1`のWASM用レシピを使う。
固定379ファイルと取り込み記録は変更せず、共有検査・ビルド経路試験を拡張した。
生成物と共有build-infoを更新し、先行するYM2612／YM2203の記録と出力を保持した。

旧再ビルド／配布済みWASMとSDKの2比較は各586ケース・7,264,744出力ステレオフレームで差0。
FM／SSG／リズム／ADPCM、2MiB RAM転送／clear、22設定での保存状態継続を含む。
Python27件、既存OPN／YM2608試験38件、両Browser計4経路、隔離npm配布物と型も成功。
影響する校正を04として実際に測定し直し、旧03と全数値が一致した。Mixer値・APIは維持する。
詳細と入力／出力hashは[YM2608移行記録](wasm_sdk_ym2608_adoption_01.md)とそのJSONを参照する。

この節はYM2608移行時の記録。続くYM2610／YM2610B移行は次の節に記載する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM2610／YM2610B WASMの固定SDK参照

`scripts/build_ym2610b_wasm.sh`も同梱SDK `0.1.1`の共有WASMレシピを使う。
固定379ファイルと取り込み記録は変更せず、4CH／6CHのvariant選択と既存ABIを維持する。
通常出力と比較用SDK出力はbyte一致し、先行3音源の生成記録・出力も保持した。

FM／SSG／ADPCM-A／Bと独立ROM、状態復元・既存Engineを旧再ビルド／配布済み版の両方と比較した。
各1,108比較・14,063,856出力ステレオフレームで差0。重点36設定のown／cross／resetを各72回確認した。
A全6声とBの終了フラグ・再発音、B repeatの末尾折返しも別枠で確認した。
Python31件、既存OPN／YM2610試験40件、両Browser計8経路、隔離npm配布物・型・Analyzer ZIPは成功。
旧配布版でも失敗するCLI比較試験のMixer適用漏れも、試験側だけを直して比較条件を揃えた。
影響する校正hash参照はなく、再測定・Mixer値・公開APIの変更は不要だった。
詳細と最終比較結果・hashは[YM2610／YM2610B移行記録](wasm_sdk_ym2610b_adoption_01.md)とそのJSONを参照する。

これで通常OPN系5種類／4 artifactのWASMビルドが固定SDK参照になった。
この節はYM2610／YM2610B移行時の記録。続くYM2151／YM2164移行は次の節に記載する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM2151／YM2164 WASMの固定SDK参照

`scripts/build_ym2151_wasm.sh`も同梱SDK `0.1.1`の共有WASMレシピを使う。
固定379ファイルと取り込み記録は変更せず、OPM／OPPのvariant選択と既存ABI・ビルド条件を維持する。
通常出力と比較用SDK出力はbyte一致し、先行4音源の生成記録・出力も保持した。

旧再ビルド／配布済み版との各1,408比較・17,640,320出力ステレオフレームで差0。
重点32設定でown／cross／resetを各64回確認し、LFO4波形・noise全32periodとTimer BのOPP倍周期も検証した。
Python35件、既存YM2151／Synth／state／Playground・MSX複合試験53件、両Browser計4経路と音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。
影響する校正hash参照はなく、再測定・Mixer値・公開APIの変更は不要だった。
詳細と最終比較結果・hashは[YM2151／YM2164移行記録](wasm_sdk_ym2151_adoption_01.md)とそのJSONを参照する。

これで通常OPN用4 artifactとOPM／OPP用1 artifactのWASMビルドが固定SDK参照になった。
この節はYM2151／YM2164移行時の記録。続くOKIM6258移行は次の節に記載する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — OKIM6258 WASMの固定SDK参照

`scripts/build_okim6258_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録を保持し、旧配布版・旧再ビルド・SDKの生成JS／WASMがすべてbyte一致した。
先行5音源の生成記録・出力を保持し、API・Mixer値も維持する。

旧再ビルド／配布済み版との各2,048比較・23,949,880出力ステレオフレームで差0。
重点34設定でown68回（raw48／公開20）・cross68回・reset68回を確認した。
FIFO・部分nibble・clock／divider・pan・10／12-bit clampも検証した。
Python39件、既存OKI／Synth／state／Playground・VGM試験52件、両Browser計4経路とPCM音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
SDK個別catalogにchip_state.hの列挙漏れがあり、全379検証と実依存hash・改変拒否試験で補足した。SDK原本は変更していない。
詳細と比較結果・hashは[OKIM6258移行記録](wasm_sdk_okim6258_adoption_01.md)とそのJSONを参照する。

これで通常OPN用4 artifact、OPM／OPP用1、OKIM6258用1の計6 artifactが固定SDK参照になった。
この節はOKIM6258移行時の記録。続くYM2413移行は次の節に記載する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM2413 WASMの固定SDK参照

`scripts/build_ym2413_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行6音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。
既存WASM／JSにはsnapshot機能がないため、reset再生成／raw reset／再演奏／seekを区別して比較した。

旧再ビルド／配布済み版との各1,284比較・16,133,748出力ステレオフレームで差0。
重点54設定のpublic reset／再演奏108回と、実VgmPlayerの9構成×6seekを確認した。状態bytes比較は行っていない。
Python43件、既存YM2413／Synth／Inspector・MSX描画／OPM混合試験37件、両Browser計8経路とMaster System音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。
校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[YM2413移行記録](wasm_sdk_ym2413_adoption_01.md)とそのJSONを参照する。

この節はYM2413移行時の記録。続くYM3526移行は次の節に記載する。
前回のOKIM6258 catalogのchip_state.h追記はSDK更新時の候補として保持する。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM3526 WASMの固定SDK参照

`scripts/build_ym3526_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行7音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。OPL1のsineのみという既存仕様も維持する。
既存snapshot機能はないため、raw／public reset・再演奏・seekを比較した。

旧再ビルド／配布済み版との各1,494比較・18,759,234出力ステレオフレームで差0。
重点75設定のpublic reset／再演奏150回と、実VgmPlayerの9構成×6seekを確認した。
全9CH・5打楽器、timer A/B・IRQ・masked CSM単独発音、OPL2波形registerの無効動作も確認した。
Python47件、既存OPL／Synth／Inspector／VGM試験81件、両Browser計4経路とYM3526音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[YM3526移行記録](wasm_sdk_ym3526_adoption_01.md)とそのJSONを参照する。

この節はYM3526移行時の記録。続くYM3812移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YM3812 WASMの固定SDK参照

`scripts/build_ym3812_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行8音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。OPL2の4波形とregister `0x01` bit5のgateも維持する。
既存snapshot機能はないため、raw／public reset・再演奏・seekを比較した。

旧再ビルド／配布済み版との各1,848比較・23,074,584出力ステレオフレームで差0。
重点84設定のpublic reset／再演奏168回と、実VgmPlayerの9構成×6seekを確認した。
全9CH・5打楽器、波形gate無効中の編集保持、timer A/B・IRQ・masked CSM単独発音も確認した。
Python51件、既存OPL／Synth／Inspector／VGM試験81件、両Browser計4経路とYM3812音色／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[YM3812移行記録](wasm_sdk_ym3812_adoption_01.md)とそのJSONを参照する。

この節はYM3812移行時の記録。続くYMF262移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — YMF262 WASMの固定SDK参照

`scripts/build_ymf262_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行9音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。同期IntoとAudioEngineのscratch再利用も維持する。
既存snapshot機能はないため、raw／public reset・再演奏・seekを比較した。

旧再ビルド／配布済み版との各3,456比較・44,658,756出力ステレオフレームで差0。
重点162設定のpublic reset／再演奏324回と、実VgmPlayerの9構成×6seekを確認した。
全18CH・6組の4OP・8波形・4busのstereo合算／clamp、NEW切替、5打楽器、timer／IRQとCSM無効の既存仕様も確認した。
Python55件、既存OPL／Synth／Inspector／VGM試験81件、両Browser計4経路とYMF262音色／4OP stereo／Keyboard UIが成功。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[YMF262移行記録](wasm_sdk_ymf262_adoption_01.md)とそのJSONを参照する。

この節はYMF262移行時の記録。続くY8950移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — Y8950 WASMの固定SDK参照

`scripts/build_y8950_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、APIとMixer値を保持し、先行10音源の生成記録・出力も維持した。
通常生成物は比較用SDK出力とbyte一致する。snapshot／Into APIは追加していない。

旧再ビルド／配布済み版との各1,794比較・22,833,498出力ステレオフレームで差0。
重点171設定のpublic reset／再演奏342回と、実VgmPlayerの9構成×6seek・0x88データブロックを確認した。
9CH OPL1 FM・5打楽器・ADPCM、2MiB境界、CPU writeとJS uploadミラーの違い、raw／public resetも比較した。
既存read_dataの09／1A割当は外部RAMのreadbackへ届かないため、その機能を追加・検証したとは扱わない。
Python59件、既存OPL／ADPCM／Inspector／VGM／MSX試験126件、FM Worklet4経路とFM UI両Browserが成功。
ADPCMも両Browserのprimary／追加音源でPCM・Stop・Sample Editor／Keyboardが成功した（Web Audio／mainのみ）。
Y8950 WAV比較試験の手組み参照側に校正Mixerが抜けていた既存問題を、配布済みWASMで再現後に試験だけ修正した。
隔離npm配布物・型・Analyzer ZIPも検証済み。校正値の変更と再測定は不要だった。
詳細と最終比較結果・hashは[Y8950移行記録](wasm_sdk_y8950_adoption_01.md)とそのJSONを参照する。

この節はY8950移行時の記録。続くAY-3-8910／YM2149移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — AY-3-8910／YM2149 WASMの固定SDK参照

`scripts/build_ay8910_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、公開APIとMixer値を保持し、先行11音源の記録・22生成物も維持した。
AYのC++17・10個の公開C export・EXPORT_ALLなしを保持する。
配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各8,208比較・37,468,404出力ステレオフレームで差0。
6つの対応type／flag、3CH tone・noise・全16 envelope shape、register latch／実効mask、mute位相とresetを確認した。
54構成の実VgmPlayerと各6地点のseek、重点reset／再演奏1,260回も成功。snapshot APIは追加していない。
Python63件と既存AY／MSX試験45件、両Browserの6 Worklet経路、MSX／AY音色・Keyboard UIを検証済み。
隔離npm配布物と型、Analyzer ZIPも成功。出力bytesと校正hashが変わらず、再測定や音量変更は不要だった。
詳細と最終比較結果・hashは[AY移行記録](wasm_sdk_ay8910_adoption_01.md)とそのJSONを参照する。

この節はAY移行時の記録。続くSega PSG移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — Sega PSG WASMの固定SDK参照

`scripts/build_segapsg_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、公開APIとMixer値を保持し、先行12音源の記録・24生成物も維持した。
PSGのC++14／O2・ASSERTIONS／EXPORT_ALL・12個の公開C exportを保持する。
配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各7,074比較・32,864,256出力ステレオフレームで差0。
3CH tone・noise・byte latch、全256 Game Gear stereo mask、mute位相と40byte状態を比較した。
public同一instance復元414回・raw状態の相互復元324回・reset／再演奏432回も成功。
実GenesisAudioEngineのFM＋PSG継続と、実VgmPlayerの状態／checkpoint／seekを確認した。
既存VGM parserが0x4fをskipする仕様は保持し、直接APIのGame Gear stereo検証と区別する。
Python67件と既存PSG／Genesis試験52件、両Browserの10 Worklet経路、SMS／GGのKeyboard UIを検証済み。
隔離npm配布物と型、Analyzer ZIPも成功。出力bytesと校正hashが変わらず、再測定や音量変更は不要だった。
詳細と最終比較結果・hashは[PSG移行記録](wasm_sdk_segapsg_adoption_01.md)とそのJSONを参照する。

この節はSega PSG移行時の記録。続くRF5C164移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — RF5C164 WASMの固定SDK参照

`scripts/build_rf5c164_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルと取り込み記録、公開APIとMixer値を保持し、先行13音源の記録・26生成物も維持した。
C++14／O2・ASSERTIONS／EXPORT_ALL・16 C exportとHEAPU8を維持する。
配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各828比較でPCM・bus読出し・RAMを含むstate差0。
8 voice、sign-magnitude・loop marker・左右pan、64 KiB境界と16 window bankのORを確認した。
chipのresetはRAMを保持し、GenesisAudioEngineのresetは追加でRAMをclearする既存の違いを維持する。
public同一instance復元234回・raw状態の相互復元144回・reset／再演奏342回も成功。
実GenesisAudioEngineの混合と、実VgmPlayerのRAM転送／checkpoint／seekを確認した。
Python71件・既存RF／Mega CD試験53件、両Browserの主PCM／追加RFの4 Worklet経路が成功。
元のMega CD exampleとサンプラーのファイル入力・mock mic・8 voice Keyboard／Stopも、両Browserのmainで確認した。
隔離npm配布物と型、Analyzer ZIPも成功。出力bytesと校正hashが変わらず、再測定や音量変更は不要だった。
詳細と最終結果・hashは[RF移行記録](wasm_sdk_rf5c164_adoption_01.md)とそのJSONを参照する。
個別catalogのchip_state.h列挙漏れは固定SDKに残し、全manifest検証と改変拒否試験で保護する。

この節はRF5C164移行時の記録。続く32X PWM移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — 32X PWM WASMの固定SDK参照

`scripts/build_pwm32x_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルとpin、公開API／Mixer値を保持し、先行14音源の記録・28生成物も維持した。
C++14／O2・ffp-contract=off・23 C exportとU8/U16/F32を維持する。
配布済み・旧手順再ビルド・SDK・docs・webのJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各864比較・2,607,960主比較フレームで差0。
16 routing・FIFO／timer／DAC／duty、own状態復元336回・raw相互復元216回・reset／再演奏312回を確認した。
raw Stateは72byte構造体でpadding／未使用slotを含むため、有効fieldとPCMを比較する。portable stateとは扱わない。
clock／rate／gain／mode／muteはsnapshot外。標準GenesisAudioEngineのSimplePwm defaultは維持する。
Python75件・既存PWM／Genesis試験は最終51件、両Browserの実Worklet4経路とpackage runtimeが成功した。
WAV比較の手組み参照に校正Mixerが抜けていた既存試験だけを修正し、音源とMixer値は変更していない。
配布sourceはmain shimへの依存を除き、pin検証済みSDKのstandalone recipeと7入力を同梱する。
source単体の実buildとJS／WASM一致、改変拒否、最終npm／Analyzer ZIPの収録も確認済み。
詳細と最終結果・hashは[PWM移行記録](wasm_sdk_pwm32x_adoption_01.md)とそのJSONを参照する。

この節は32X PWM移行時の記録。続くHuC6280移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — HuC6280 WASMの固定SDK参照

`scripts/build_huc6280_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルとpin、公開API／Mixer値を保持し、先行15音源の記録・30生成物も維持した。
C++14／O2・EXPORT_ALL・8 C exportとcwrap／F32を維持する。
配布済み・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済み版との各828比較・1,650,420主比較フレームで差0。
6CH・wave RAM・DDA・noise・LFO、host mute／低clock時の保持sampleとowned出力を確認した。
snapshotはなく、reset／再演奏252回と実VgmPlayerのB9／DDA stream・先頭からのseekを比較した。
両Browserで主／追加Workletの計4経路と6CH voice UI・波形編集・Guitar／PC Keyboard・Stopが成功した。
Python79件・既存HuC6280関連試験63件とnpm／Analyzer ZIPの検証が成功した。
詳細と最終結果・hashは[HuC6280移行記録](wasm_sdk_huc6280_adoption_01.md)とそのJSONを参照する。

この節はHuC6280移行時の記録。続くGame Boy移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — Game Boy APU WASMの固定SDK参照

`scripts/build_gameboy_apu_wasm.sh`も同梱SDK `0.1.1`のWASMレシピを使う。
固定379ファイルとpin、公開API／Mixer値を保持し、先行16音源の記録・32生成物も維持した。
C++17／O2・11 C exportとcwrap／F32を維持する。core headerはNative用friend宣言だけがSDK側に追加され、DSPと生成物には差がない。
配布済みdocs・旧手順再ビルド・SDK・通常出力のJS／WASMはすべてbyte一致した。

旧再ビルド／配布済みdocsとの各876比較・2,437,980主比較フレームで差0。
own復元192回・trusted raw相互復元132回・reset／再演奏276回を確認した。
Stateは同一buildの312byte objectコピーで、padding全体の一致ではなくheaderとPCM続行を比較する。
直接Web用だけ旧state非対応pairが残っていたため、共通APIの270比較・1,158,300フレームで差0を確認後、2生成物をSDK版へ同期した。
Python83件・既存Game Boy関連79件とnpm／Analyzer ZIPの検証が成功した。
両Browserで主／追加Workletの4経路と、既存editor／Keyboard試験を絞った4 voice・対象切替・release／Stopが成功した。
詳細と最終結果・hashは[Game Boy移行記録](wasm_sdk_gameboy_adoption_01.md)とそのJSONを参照する。

この節はGame Boy移行時の記録。続くNES APU／FDS移行は次の節に記載する。
SDK原本とTauriリポジトリも変更していない。
npm／アプリの公開とremote CI実行は未実施。

### 完了した作業 — NES APU／FDS WASMの固定SDK参照

`scripts/build_nesapu_wasm.sh`もSDK `0.1.1`のWASMレシピを使う。
固定379ファイルとpin、公開API／Mixer値を保持し、先行17音源の記録・34生成物も維持した。
C++17／例外・FP設定、18 C exportとloader／runtime各5項目を維持する。
配布済みdocs・旧再ビルド・SDK・通常出力・webのJS／WASMはすべてbyte一致した。

各912比較・2,354,100主比較フレームで差0。reset／再演奏276回と31項目のcontrol直後／終端観測・RAMを確認した。
400byte getStateは観測ABIで保存状態ではなく、WASM Player adapter／checkpointは追加していない。既存Analyzer／PlayerのJS referenceは維持する。
配布用ソースはSDK10入力を検証後に出力し、standalone recipeの2 vendor pathだけを既存third_party配置へ移す。
source単体buildと生成物一致、core／recipe／manifestの改変拒否、npm／Analyzer ZIPの収録も確認した。
Python87件・既存NES関連77件、両Browserの主／追加Worklet4経路・全6CH Keyboard／Operators／DMC／FDS／Stopが成功した。
詳細とhashは[NES移行記録](wasm_sdk_nesapu_adoption_01.md)とそのJSONを参照する。

この節はNES APU／FDS移行時の記録。続くSNES／SPC移行は次の節に記載する。


### 完了した作業 — SNES／SPC WASMの固定SDK参照

`scripts/build_spc_wasm.sh`もSDK `0.1.1`の`spc`ターゲットを使う。
着手時の本体は`ef783f2099a97cd8faed4ec5f1cf90efbd103059`でclean。固定379ファイルとpin、先行18生成記録・36出力を保持した。
C++14／O2・ASSERTIONS・accurate S-DSP、33 C export・runtime 3項目・Perl cleanupを維持する。
旧配布／旧再ビルドとSDKでWASM bytesは異なるが、SDKレシピのvendor path5箇所だけを旧配置へ移したsource単体buildで旧bytesを再現した。
旧再ビルド・配布済み・配布ソース単体の3組は、SDKとの各40シナリオ・80ケースでPCM／RAM／DSP／nativeFrames・trace／timeline差0。
各組の受渡し済み出力は両build計1,017,898ステレオフレーム、native位置の増分は1,017,766。解析用snapshotを保存状態とは扱わない。
配布source helperは26入力を全検証してから出力し、standalone recipeだけ5パスを移す。LGPL／由来・変更記録を保持する。
Python91件・既存SPC／SNES222件、FM npm・VGM npmの隔離offline検証とAnalyzer ZIPが成功した。
主／追加SNESの4 Worklet校正経路、SNES Mainの両browser、SPCファイル再生の両browser×2 output rateも成功した。
ただしWebKitの初期化中closeは2回失敗し、AbortError・nodeなしでもAudioContextがrunningのままだった。Chromiumは成功。
旧WASMのclose単独は成功したが、同じ再生順序を含む旧版試験は先に無音判定で停止し、移行との因果は未確定。
Browser全体の成功とは扱わず、元の試験・runtimeを保持して証拠と切り分け手順を残した。
詳細は[SNES／SPC移行](wasm_sdk_spc_adoption_01.md)と[検証JSON](wasm_sdk_spc_adoption_01.json)。証拠は`/private/tmp/tetorica-spc-wasm-sdk/`。

固定SDKへ切り替えたWASMは計19／27 artifact。次の移行候補はSega PCM。
残り8は`k051649`／`nuked_opn2`／`segapcm`／`ym3438`／`ymf276`／`ymf278b`／`ymf288`／`dx7`。
WebKit closeは、既存試験の再生→close順序・AudioContext所有／resume／closeと一時mute harnessの切り分けが必要。
SDK原本とTauri、Mixer数値は変更していない。commit／push・公開・remote CIは実施していない。
npm／アプリの公開とremote CI実行は未実施。

### その他の作業候補と未着手範囲

1. 通常22音源と代替NukedのNative側SDK参照切替・ローカル比較・ホスト試験・5構成CIが完了。Nukedの最終pinはSDK `0.1.1`／379ファイル、Tauri成功CIはrun `40175615215`。利用するOSのインストーラーでの起動・聴音確認は別途残る。
2. Master System／MSXと追加生成YM2413の再生・Stop・再Run、リズム・PSG／AY同時再生を実機でも聴いて確認する。先行するX68000等の実機確認も自動試験とは別。
3. 各成功CIの対象コミットを区別し、必要なOSのインストーラーで起動を確認する。実機の聴音・UI操作は自動試験とは別の確認。現在ステージ済みの差分はない。
4. 主要22音源IDとNuked別variantのSDK参照が揃った。今回の最終pin・ホスト試験と後続CIはNuked作業記録で確認する。機種用の補助処理とRustの所有・予約・混合はアプリ側に残る。
5. 高速レジスタ制御は [別メモ](todo_schedule_register_01.md) にある構想。現時点で着手済みと解釈しない。

### 一時成果物と記録の置き場所

- Tauriの `native-validation/`、`native-source-bundle/`、`src-tauri/target/` はignoredな生成物。
- 対応ソースZIP: `w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`。
  ローカルで生成したAY移行のCI入力ZIPのSHA-256: `cf24143b1449028742ff4e8490d63e5b5d66dc272f29cf87509c90164b1fc54a`。
  全1,796ファイルとSDK374ファイルを含む22件の固定記録の照合結果は`/private/tmp/tetorica-sdk-ay8910-sources.json`。
  追加SNES試験修正後のCI入力ZIPは全1,796ファイル、SHA-256は
  `2cafb70e38ffd8eecfab984253fc5cd01e696f3221a493da44850a5396a62e06`。
  `local-final-sources.json`で全照合成功、`local-final-manifest-diff.json`で差分がガイドと試験の2ファイルだけと確認した。
  このZIPは修正版CI結果をガイドへ追記する前のもの。そのCI結果のみを追記した旧ローカルZIPは全1,796ファイル、SHA-256は
  `ff6d69a7c1b701c9348ba51c037ee66ecc1fd5891bc2468989ee81864b4203bc`。
  `/private/tmp/tetorica-opl-ay-fixed-ci-40143851548/local-final-sources.json`で照合成功し、
  同ディレクトリの`local-final-manifest-diff.json`でCI入力との差分がガイド1ファイルのみと確認した。
  PSG移行直後の旧ZIPは全1,796ファイル、SHA-256は
  `c718713666283b34c8aa79ecdbf03d4f3760810877ad92cb44c43d21397cf875`。
  `/private/tmp/tetorica-sdk-segapsg-sources.json`でSDK374ファイルを含む22件の固定記録とZIPを照合した。
  PSG／RFのCI対象コミット時点のローカルZIPは全1,796ファイル、SHA-256は
  `e1433b213fc340762f0578944e8b5797fcff7af26af6ad308db4febb73db353e`。
  `/private/tmp/tetorica-sdk-rf5c164-sources.json`でSDK374ファイルを含む22件の固定記録とZIPを照合した。
  最初の照合で固定対象`native-megacd/README.md`への追記が検出されたため、そのファイルだけHEAD原本へ復元して再生成した。`PINNED`を変更した回避はしていない。
  PSG／RFのビルド参照切替も含むため、先行する成功CIの入力と同一ではない。
  今回のCI結果をガイドへ追記した後のローカルZIPも全1,796ファイル、SHA-256は
  `77c203bb0dc928ba7da75cdf0461525c9b531a438e8eaf8398eb6826fb0260e8`。
  `/private/tmp/tetorica-psg-rf-ci-40148943609/local-final-sources.json`で全照合成功、
  同ディレクトリの`local-final-source-delta.json`でCI入力との差分がガイド1ファイルのみと確認した。
  OPL接続移行直後の旧ZIPは`c2d20e9b...`で、今回のAY移行を含まない。
  前回CIの結果をガイドへ反映した直後の旧ZIPは`85850ce5...`で、今回のOPL接続移行を含まない。
  前回CI対象ZIPは`2829e9f9...`（macOS／Linux）。そのCI後の文書更新だけを行った時点では差分はガイド1ファイルだったが、最新ZIPには今回の接続参照・ビルド・文書の変更も入る。
  先行するOKIM6258移行後の旧ZIPは`7123fc45...`で、今回のYM2413差分を含まない。
  先行するYM2151移行後の旧ZIPは`b3c56199...`で、今回のOKIM6258差分を含まない。
  先行する全OPN CI後の文書更新だけを含む旧ZIPは`af8e3129...`で、今回のYM2151差分を含まない。
  再生成後に値が変わる場合は、その時点の作業ツリーとマニフェストを確認する。
- PWM移行直後のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `519b7c8853903f5bb34e33f3be201baa7cdf8e7bcddf1c831b4f0ff795fe07f3`。
  `/private/tmp/tetorica-sdk-pwm-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-pwm-adoption/source-manifest-delta.json`で着手時からの変更がTauriの5ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  今回のPWM差分を含むため、前回成功CIの入力と同一ではない。
- HuC6280移行後、run `40162092207`のCI対象時点のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `dcbc9710d9d89db204fec2d1841e82ca0976c73c192db7fc37a599a232a1c865`。
  `/private/tmp/tetorica-sdk-huc6280-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-huc6280-adoption/source-manifest-delta.json`で着手時からの変更がTauriの4ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  前回CIの入力にはないPWM／HuC6280移行を含むため、前回成功CIの入力と同一ではない。
- PWM／HuC6280 CIの証拠は`/private/tmp/tetorica-pwm-huc-ci-40162092207/`の`final-ci-summary.json`、`inspection-summary.json`、`jobs-audit.json`、`artifact-metadata.json`、`native-artifact-metadata.json`。
  全5構成で22件の固定記録・SDK374ファイル・ソースZIP1,796ファイル、22 mode・604,032フレーム・88 Run／Stop、3混合構成・7単独音源、受入れ／16台制限・Stop後の予算0が成功。両runnerはexit code 0・`deviceOpened: false`。
  非Windows4構成のCIソースZIPは上記`dcbc9710...`、Windowsは`167ae8219491e94f1624330875be1d2ecdecf64cd87e3b571c4c81994ad826b2`。各CIの照合は成功し、ハッシュ差の原因は断定しない。
  取得したのは検証レポートZIPだけで、インストーラー・ソースZIPのダウンロード・起動・独立照合は行っていない。実機の聴音・UI操作・OS間PCM一致と各OSでのWASM比較も別の確認とする。今回は新しいタグやreleaseを作成していない。
- PWM／HuC6280のCI結果ガイドを反映した直後のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `229d8eb929c1504baa65085be4bf38ca966966e42c69b3546b1de1361002f495`。
  `/private/tmp/tetorica-pwm-huc-ci-40162092207/local-final-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合し、
  同ディレクトリの`local-final-source-delta.json`でCI入力との差が`docs/native-sdk-ym2612.md`だけと確認した。
  コードと試験のコンパイル入力はCI対象から変更していない。
- Game Boy移行直後の旧ローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `1db0c76e87d531e9daf300bc3dc985d92b672e51425c72a65009168c3258575c`。
  `/private/tmp/tetorica-sdk-gameboy-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-gameboy-adoption/source-manifest-delta.json`で着手時からの変更がTauriの5ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  直前の成功CIにはないGame Boy移行を含むため、そのCIの入力と同一ではない。
- NES＋FDS移行後、run `40168462256`のCI対象時点のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `1fb6bf89c2a372abbad9190761b678ec611d944f12fabe7a0ac8f6ce8c7f0bec`。
  `/private/tmp/tetorica-sdk-nes-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-nes-adoption/source-manifest-delta.json`で着手時からの変更がTauriの4ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  先行する成功CI `40162092207`にはないGame Boy／NES移行を含むため、そのCIの入力と同一ではない。今回の非Windows 4構成のCIソースZIPとは一致した。
- Game Boy／NES CIの証拠は`/private/tmp/tetorica-gb-nes-ci-40168462256/`の`final-ci-summary.json`、`inspection-summary.json`、`test-log-summary.json`、`native-artifact-metadata.json`。
  全5構成の検証JSONと取得した検証ZIPのdigestを照合済み。インストーラーやCIソースZIPのpayloadはダウンロードしていない。
  ガイド確定後のローカル対応ソースZIPも全1,796ファイルを再生成・照合した。SHA-256は
  `63ff0c8eeab3e7153089f3d868cb9c806e6472ae30de98a18a4f9e0ae594f007`。
  同ディレクトリの`local-final-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合し、
  `local-final-source-delta.json`でCI入力との差が`docs/native-sdk-ym2612.md`だけと確認した。
  製品コードと試験のコンパイル入力はCI対象から変更していない。
- DX7移行直後の旧ローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `a0869853f65bce864ab7dec114a85e4ac4f58d4064054b14159028efb9d755a8`。
  `/private/tmp/tetorica-sdk-dx7-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-dx7-adoption/source-manifest-delta.json`で着手時からの変更がTauriの4ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  直前の成功CI `40168462256`にはないDX7移行を含むため、そのCIの入力と同一ではない。
- SNES／SPC移行後、run `40171879716`のCI入力時点のローカル対応ソースZIPは全1,796ファイル、SHA-256は
  `39cd14b113557665c039d0af3960839ed566c7ad2fdc49286859d8b5c53fa684`。
  `/private/tmp/tetorica-sdk-snes-spc-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合した。
  `/private/tmp/tetorica-sdk-snes-spc-adoption/source-manifest-delta.json`で着手時からの変更がTauriの4ファイルだけと確認し、
  同ディレクトリの`summary.json`へ比較・ホスト試験・ZIPの最終結果を集約した。
  直前の成功CI `40168462256`にはないDX7と今回のSNES／SPC移行を含むため、そのCI入力と同一ではない。
- DX7／SNES／SPCのCI結果をガイドへ反映した後の最新ローカル対応ソースZIPも全1,796ファイル、SHA-256は
  `3c18c7ca41db0477591881002501c0dbfeac39c9ba972a714e705666cfd99389`。
  `/private/tmp/tetorica-dx7-snes-spc-ci-40171879716/local-final-sources.json`で全22件の固定記録・SDK374ファイル・ZIPを照合し、
  同ディレクトリの`local-final-source-delta.json`でCI入力との差が`docs/native-sdk-ym2612.md`だけと確認した。
  製品と試験のコンパイル入力はCI対象から変更していない。
- 最新SDKの元ZIP: `/private/tmp/tetorica-sdk-nuked-adoption/release-fixed/tetorica-soundchip-native-0.1.1-sources.zip`。
  元コミット`e4b7d7ecef60e3927ac04815cd9f985f62c82f04`、全379ファイル、ZIP SHA-256
  `939fb035aef36c84cac3d1e058271ca3ddfc6ebd9ce5cfa4b3d04bc92876416b`。
  Tauriの同梱ソースと取り込み記録だけでオフライン照合できる。
- 先行移行で使ったSDKの旧元ZIP: `w/tetorica-soundchip-native/releases/tetorica-soundchip-native-0.1.0-sources.zip`。
  元ZIPが消えてもTauriの同梱ソースと取り込み記録だけでオフライン照合・ビルドできる。
- DX7移行の証拠は`/private/tmp/tetorica-sdk-dx7-adoption/`の`parity-summary.json`、`source-audit.json`、`self-tests.json`、`build-assembly-audit.json`。
  通常再生比較とNative Panic修正の確認は分けて記録した。ホストログと再生／混合レポートは上記DX7ローカル検証節を参照する。
- 検証ログ: `/private/tmp/tetorica-sdk-adoption-parity/`、`/private/tmp/tetorica-sdk-adoption-isolated.json`、
  `/private/tmp/tetorica-sdk-adoption-cargo-test-unrestricted.log`、`/private/tmp/tetorica-sdk-adoption-stability.json`、
  `/private/tmp/tetorica-sdk-adoption-extra-stability.json`。
  YM2203の最新検証は`/private/tmp/tetorica-sdk-ym2203-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2203-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2203-stability.json`、
  `/private/tmp/tetorica-sdk-ym2203-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2203-sources.json`。
  YM2608の最新検証は`/private/tmp/tetorica-sdk-ym2608-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2608-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2608-stability.json`、
  `/private/tmp/tetorica-sdk-ym2608-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2608-sources.json`。
  YM2610／YM2610Bの最新検証は`/private/tmp/tetorica-sdk-ym2610-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2610-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2610-stability.json`、
  `/private/tmp/tetorica-sdk-ym2610-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2610-sources.json`。
  YM2151／X68000の最新検証は`/private/tmp/tetorica-sdk-ym2151-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2151-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2151-stability.json`、
  `/private/tmp/tetorica-sdk-ym2151-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2151-sources.json`。
  OKIM6258の最新検証は`/private/tmp/tetorica-sdk-okim6258-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-okim6258-cargo-test.log`、`/private/tmp/tetorica-sdk-okim6258-stability.json`、
  `/private/tmp/tetorica-sdk-okim6258-extra-stability.json`、`/private/tmp/tetorica-sdk-okim6258-sources.json`。
  YM2413の最新検証は`/private/tmp/tetorica-sdk-ym2413-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ym2413-cargo-test.log`、`/private/tmp/tetorica-sdk-ym2413-stability.json`、
  `/private/tmp/tetorica-sdk-ym2413-extra-stability.json`、`/private/tmp/tetorica-sdk-ym2413-sources.json`。
  OPL接続の最新検証は`/private/tmp/tetorica-sdk-opl-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-opl-cargo-test.log`、`/private/tmp/tetorica-sdk-opl-stability.json`、
  `/private/tmp/tetorica-sdk-opl-extra-stability.json`、`/private/tmp/tetorica-sdk-opl-sources.json`。
  AY移行の最新検証は`/private/tmp/tetorica-sdk-ay8910-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-ay8910-cargo-test.log`、`/private/tmp/tetorica-sdk-ay8910-stability.json`、
  `/private/tmp/tetorica-sdk-ay8910-extra-stability.json`、`/private/tmp/tetorica-sdk-ay8910-sources.json`。
  OPL接続／AY移行を含むCIの確認先は`/private/tmp/tetorica-opl-ay-ci-40142510765/`。
  RF移行の最新検証は`/private/tmp/tetorica-sdk-rf5c164-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-rf5c164-cargo-test.log`、`/private/tmp/tetorica-sdk-rf5c164-stability.json`、
  `/private/tmp/tetorica-sdk-rf5c164-extra-stability.json`、`/private/tmp/tetorica-sdk-rf5c164-sources.json`。
  PSG／RFを含む全5構成成功CIは`/private/tmp/tetorica-psg-rf-ci-40148943609/`で確認する。
  PSG移行の最新検証は`/private/tmp/tetorica-sdk-segapsg-adoption/summary.json`、
  `/private/tmp/tetorica-sdk-segapsg-cargo-test.log`、`/private/tmp/tetorica-sdk-segapsg-stability.json`、
  `/private/tmp/tetorica-sdk-segapsg-extra-stability.json`。
  SNES試験修正後に全5構成が成功したCIは`/private/tmp/tetorica-opl-ay-fixed-ci-40143851548/`で確認する。
  前回のCI記録は`/private/tmp/tetorica-ym2413-ci-40137093552/`にあり、
  `inspection-summary.json`、`artifact-metadata.json`、`jobs-audit.json`、
  `local-final-sources.json`、`local-final-manifest-diff.json`を保存済み。
  `/private/tmp`は消える可能性があるため、再開の必須データとして扱わない。

ソースと由来の正本は各Gitコミット、Tauriの同梱SDK／取り込み記録、上記の手順書。
過去の作業メモにある「未コミット」は当時の状態。TauriのYM2612移行は`9ef583e...`、YM2203移行は`16610b0e...`、YM2608移行は`53ab3d27...`、YM2610／YM2610B移行は`5280f83a...`にコミット済み。
YM2151移行もTauriの`e4d68b27...`、本体の`f0e00dda...`、OKIM6258移行はTauriの`250489fd...`、本体の`fed03f7a...`、YM2413移行はTauriの`634e56f4...`、本体の`6c0b5770...`にコミット済み。前回CI記録とOPL接続移行も、本体の`4137e903...`、Tauriの`4451195...`にコミット済み。Tauriの前回CIガイド更新は`a8edd891...`。今回のAY移行は本体の`ce2ad308...`、Tauriの`276e744e...`にcommit／push済み。その後の追加SNES試験修正とCI結果の文書更新も、本体の`a278e1d5...`、Tauriの`842245dd...`にcommit／push済み。
Sega PSG移行は本体`1da2fb00...`／Tauri`51dca52...`、RF5C164移行は本体`1d35f48a...`／Tauri`4939ddc7...`へcommit／push済み。全5構成成功のCI結果ガイドはTauri`66004f00...`へcommit／push済み。本体の最終結果記録は本節とRF作業記録のみで、そのコミットはこの文書を含むgit logで確認する。

## 旧記録 — 2026-08-24以降の作業メモ

以下は履歴として保持する。この節以降の「Current」「Latest」「Next」は記録当時の意味で、現在の再開指示ではない。

## Latest Playground architecture direction

- `MegaSynth`
  now has listener support:
  - `addListener(listener)`
  - `removeListener(listener)`
- The intended responsibility split is now clearer:
  - `YM2612Synth`
    - readable low-level FM control layer
    - should stay thin
  - `MegaSynth`
    - browser/runtime wrapper
    - high-level FM event hub for demos/apps
  - `docs/playground`
    - subscribes to `MegaSynth.addListener(...)`
    - updates controller UI from those events
- `docs/playground/playground.js`
  has already started this shift:
  - Operator tab sync is no longer driven directly from the `fm` proxy
  - it now listens through `MegaSynth` events

## Important Playground direction

- Playground is expected to grow with:
  - TFI / VGI support
  - envelope UI imported from `docs/synth`
  - FX controller tab
  - guitar/fretboard-style input
  - more Sonic Pi-like live coding features
- Because of that, avoid letting `docs/playground/playground.js`
  become a "single giant file" again.
- The preferred long-term split is:
  1. `web/*`
     - shared library/runtime/features
  2. `docs/synth/*`
     - isolated learning/demo widgets
  3. `docs/playground/*`
     - orchestration/integration layer

## Suggested future Playground file split

- `playground_runtime.js`
  - `runCode`
  - `liveLoop`
  - `play`
  - `beat`
  - `sleep`
  - `livePrepare`
- `playground_editor.js`
  - Monaco init
  - completion / hover
  - fallback textarea
- `playground_console.js`
  - console tab
  - helper tab
  - log formatting
- `playground_sync.js`
  - subscribe to `MegaSynth`
  - push events into operator/future FX tabs
- `playground_examples.js`
  - example code strings
- `playground_operator_tab.js`
  - operator controller UI
- `playground_fx_tab.js`
  - future FX controller UI

## Recent browser/runtime observation

- A short temporary pause during playback was observed once or twice.
- It did not reproduce reliably afterwards.
- Current interpretation:
  - likely browser main-thread pause / GC / extension / temporary UI load
  - not yet strong evidence of a deterministic music-timing bug
- Also observed:
  - `Unchecked runtime.lastError: Could not establish connection...`
  - this does not appear to come from this repository code

## liveLoop error behavior reminder

- As of 2026-08-30, the intended distinction is:
  - top-level Run failure before `commitLiveLoops()`
    - keep the previously committed live loops running
  - error inside an already running liveLoop iteration
    - keep the loop alive
    - if the newly swapped callback fails, roll back to the last stable callback
    - if the current stable callback itself fails, report the error and retry
- This distinction should stay explicit in future Playground refactors.
- "Rollback to previous callback version for the same loop name" is now part of
  the live performance behavior when a hot-swapped callback fails.
  - likely browser extension / external page script noise
- For now:
  - treat both as investigation notes, not confirmed repo bugs

## Current sync status interpretation

- FM-side synchronization is now "organized enough" to move forward.
- Remaining sync work is mainly:
  - future FX-side synchronization
  - deciding how much raw low-level write sync is worth exposing
  - possible reuse of the same observer pattern in `docs/synth`

## Latest low-level YM2612 status

- `Ym2612` now exposes:
  - `write(offset, data)`
  - `read(offset)`
  - `readStatus()`
  - `getIrq()`
  - `setHooks({ onWrite, onRead, onIrq })`
- `YM2612Synth` now exposes readable low-level helpers:
  - `write(port, register, value)`
  - `writeAddress(port, register)`
  - `writeData(value)`
  - `read(offset)` on direct transport
  - `readStatus()` on direct transport
  - `setHooks({ onWrite, onRead, onIrq })`
- `AudioWorklet` side now forwards IRQ state back to the main thread.
- Remaining low-level gap:
  - synchronous `read()` does not make sense across `AudioWorklet`
  - if needed, add a separate `readAsync()` path
- After `readAsync()`, the next low-level work should be:
  - busy flag exposure
  - timer A / timer B exposure

## Latest Playground / FX / Monaco status

- `docs/playground/playground.js`
  now includes:
  - `livePrepare(name, async ({ fx, fm, log }) => { ... })`
  - `fx.gain(...)`
  - `fx.eq(...)`
  - `fx.filter(...)`
  - `fx.delay(...)`
  - `fx.reverb(...)`
  - `fx.setChain([...])`
  - `fx.clear()`
- `web/megasynth.js`
  / `docs/js/megasynth.js`
  now support a master FX chain after the YM2612 output:
  - `setFXChain()`
  - `getFXChain()`
  - `connect()`
  - `clearFXChain()`
  - `connectOutput()`
- `web/megasynth_fx.js`
  / `docs/js/megasynth_fx.js`
  now include:
  - `createGainFX(...)`
  - `createEqFX(...)`
  - `createFilterFX(...)`
  - `createDelayFX(...)`
  - `createReverbFX(...)`

## Important `livePrepare(...)` interpretation

- `livePrepare(name, fn)` is now the first mechanism for:
  - "do this once"
  - "reuse this across Run"
- Current behavior:
  - first time with a name:
    - execute `fn`
    - store result
  - later calls with the same name:
    - do not execute `fn` again
    - return the stored result
- This is useful especially for:
  - FX node creation
  - shared master chain objects
  - future browser-side live coding state
- Current limitation:
  - if the code inside `livePrepare("main-fx", ...)` changes
  - but the name stays the same
  - the old prepared result is still reused
- Likely future additions:
  - `livePrepareReset(name)`
  - `livePrepareClearAll()`

## Current Playground examples

- `FX Loop`
  now uses `livePrepare("fx-loop-chain", ...)`
  for reusable:
  - `filter`
  - `delay`
  - `reverb`
- `FX Motion`
  now uses `livePrepare("fx-motion-chain", ...)`
  for reusable:
  - `gain`
  - `eq`
  - `filter`
  - `delay`
  - `reverb`
- `FX Motion` also now proves that `liveLoop("fx-motion", ...)`
  can move:
  - `eq.bass`
  - `eq.mid`
  - `eq.treble`
  - `filter.cutoff`
  - `delay.mix`
  - `reverb.mix`
  while other loops are playing

## Current click-noise interpretation

- `Run` can still produce a short click / noise.
- Strong current suspect:
  - master FX chain is disconnected / reconnected
  - graph changes happen while audio is live
- `livePrepare(...)` reduces needless FX recreation,
  but does not fully solve routing click noise yet.
- Likely next fix:
  - fade master gain down briefly
  - rebuild chain
  - fade up again

## Monaco status

- `docs/playground/index.html`
  and `docs/playground/playground.js`
  now have a first Monaco-based editor path.
- Current behavior:
  - try loading Monaco from CDN
  - if it succeeds:
    - use Monaco
    - enable Tetorica-specific completion
  - if it fails:
    - keep fallback `textarea`
- Current Monaco completion focus:
  - `liveLoop`
  - `livePrepare`
  - `play`
  - `beat`
  - `nextBeat`
  - `setBpm`
  - `fx.`
  - `fm.`
  - `MEGADRIVE_FM_PRESETS["..."]`
- Current Monaco hover focus:
  - small explanations for:
    - `liveLoop`
    - `livePrepare`
    - `beat`
    - `nextBeat`
    - `fx`
    - `fm`

## Files to read first next time

1. `docs/playground/playground.js`
   - live runtime
   - `livePrepare(...)`
   - FX API
   - Monaco completion setup
2. `docs/playground/index.html`
   - Monaco host + fallback textarea
   - helper text
3. `docs/issues/playground_fx.md`
   - current FX design and implemented direction
4. `docs/issues/playground_autocomplete.md`
   - completion direction
   - Monaco-oriented next ideas

## Likely next steps

1. Verify Monaco behavior more deeply in browser:
   - completion quality
   - cursor behavior
   - fallback behavior
2. Decide whether `FX Motion` should become the default example.
3. Add `livePrepareReset(name)` / `livePrepareClearAll()`.
4. Reduce FX chain click noise on `Run`.
5. Expand Monaco completion:
   - object field completion
   - more snippets
   - better preset/value suggestions

## Playground status

- `docs/playground/index.html`
  now exists as a small browser-side JavaScript playground entry point.
- `docs/playground/playground.js`
  now has a first working runtime for:
  - `play(note, { channel, duration, preset })`
  - `sleep(seconds)`
  - `scale()`
  - `choose()`
  - `rand()` / `randInt()`
  - `setBpm()`
  - `beat()`
  - `nextBeat()`
  - `liveLoop(name, async () => {})`
  - `stopLoop(name)`
  - `stopAllLoops()`
  - raw `fm` access through `YM2612Synth`

## Important Playground interpretation

- The Playground is not only a demo page.
- It is meant to be the "this looks easy enough to try" entry point.
- That is why `docs/index.html` now links to:
  - `Playground`
  - above the normal `Demos` section
- The intent is:
  - show JavaScript first
  - make YM2612 feel approachable
  - then let people drop down into raw `fm` control later

## Current Playground sample state

- The default sample is now the `live-loop` example.
- It uses:
  - one bass loop
  - one lead loop
  - shared BPM / beat timing
- The original example bug:
  - sample code used `MEGADRIVE_FM_PRESETS["2op-bell"]`
  - but the actual preset key is `MEGADRIVE_FM_PRESETS["two-op-bell"]`
- This was fixed in:
  - `docs/playground/playground.js`

## Important note about `nextBeat()`

- `await nextBeat()` inside every `liveLoop()` cycle makes the loop re-attach to the next integer beat each time.
- Because of that, shortening:
  - `duration`
  - `beat(...)`
  may not feel effective if `nextBeat()` is still called every cycle.
- For faster lead patterns, removing per-cycle `nextBeat()` is currently more illustrative.

## Files to read first next time

1. `docs/playground/playground.js`
   - runtime behavior
   - helper API
   - sample examples
2. `docs/playground/index.html`
   - Playground page structure
   - helper list text
3. `docs/index.html`
   - top-level entry positioning
   - Playground is intentionally shown before Demos
4. `docs/issues/playground.md`
   - longer-term design notes
   - why JavaScript / why `liveLoop`

## Likely next Playground steps

1. Make the default `live-loop` sample feel musically better.
2. Decide whether `nextBeat()` should be:
   - a manual helper only, or
   - also have a "first loop only" convenience pattern.
3. Add safer live coding behavior:
   - replacing loops
   - stopping loops
   - handling broken user code
4. Continue toward the original direction:
   - Sonic Pi style `liveLoop`
   - but with YM2612 / Mega Drive specificity still visible.

## Looper direction changed

- The first `MegaSynthLooper` implementation used event replay:
  - record `noteOn` / `noteOff`
  - replay those events through YM2612 later
- That worked conceptually but still hit practical note cut problems.
  - YM2612 only has 6 FM channels.
  - Even after splitting live and loop synth instances, overdub units could still interfere.
- Current decision:
  - use recorded audio as the main looper playback source
  - keep events / patch snapshots as side metadata for export and analysis

## Latest looper observation

- Even after:
  - splitting live and playback synth instances
  - remapping playback channels per unit
  - scheduling new units into the current loop cycle immediately
- `unit 2` and later can still break up during playback.
- The audible result is:
  - notes sometimes cut partway through
  - overdub playback is not stable enough for the main user-facing looper path

Interpretation:

- this is no longer just a small scheduling bug
- it is strong evidence that the event-replay approach is the wrong primary looper playback model here

## Current looper-related code state

- `web/megasynth_looper.js`
  still contains the event-based looper implementation.
- `docs/js/megasynth_looper.js`
  is synced with the same event-based structure.
- `scripts/verify_megasynth_looper.mjs`
  now includes a 2-unit replay check and passes.
  This verifies the current event-looper channel remap behavior, but that is no longer the final target.

## Output bus preparation added to synth demo

- `docs/synth/synth_runtime.js`
  now accepts `outputNode` and passes it into `MegaDriveSynth`.
- `docs/synth/synth.js`
  now creates:
  - `liveOutputBus`
  - `loopOutputBus`
  - `liveCaptureNode`

Current graph direction:

- live YM2612 runtime
  - outputs to `liveOutputBus`
  - `liveOutputBus` goes to destination
  - `liveOutputBus` also goes to `liveCaptureNode`
- loop YM2612 runtime
  - outputs to `loopOutputBus`
  - `loopOutputBus` goes to destination

This was added so the next looper implementation can record only the live bus.

## Next likely steps for looper

1. Add audio recording for one unit from `liveCaptureNode`.
2. Store that result as unit audio.
3. Switch loop playback from event replay to audio replay.
4. Keep event log and patch snapshot as export-oriented metadata.

## Current UI / YM2612 learning demo status

- `docs/operator1.html`
  1-operator YM2612 learning demo now exists.
  It is no longer only a "play beep" page.
  It now tries to help the reader connect:
  - register parameters
  - envelope intent
  - actual generated sound
- The current demo exposes these parameters:
  - `MULTI`
  - `TL`
  - `AR`
  - `D1R`
  - `D2R`
  - `SL`
  - `RR`
  - `Pitch`
  - `Block`
- Layout was compacted so the parameter UI and `Envelope` panel fit in one desktop window more easily.
  - controls are smaller
  - `Envelope` is placed beside the controls
  - `Waveform` and `Spectrum` are below
- The `Envelope` panel now keeps its drawing after playback ends.
  - only `Waveform` and `Spectrum` return to idle
  - `Envelope` stays as a parameter/result reference view
- `docs/operator2.html`
  A 2-operator YM2612 learning demo now exists.
  It focuses on the jump from "single operator" to actual FM relationships:
  - `parallel`
  - `serial`
  - `feedback`
  The page currently lets the user compare:
  - operator 1 / operator 2 frequency multipliers
  - operator 1 / operator 2 total levels
  - shared `AR` / `RR`
  - `feedback`
  - `Pitch` / `Block`
  In the current design:
  - parallel mode uses algorithm 7 and leaves operator 1 + operator 2 audible
  - serial mode uses algorithm 4 and focuses on the `O1 -> O2` path while muting the other pair

## Important interpretation for `docs/operator1.html`

- The orange envelope line is not "real measured chip internals".
- It is a parameter guide built from:
  - `AR`
  - `D1R`
  - `D2R`
  - `SL`
  - `RR`
  - `TL`
- The cyan line is based on the actual generated audio output.
  - it is computed from the generated stereo samples
  - it is closer to an output amplitude trace than to an internal operator envelope
- This difference is expected.
  FM output amplitude can look very different from the intended parameter envelope because:
  - modulation changes harmonic balance
  - phase interaction changes visible amplitude
  - the final waveform is not a direct envelope plot

## What was added to `docs/operator1.html`

- parameter UI for:
  - `D1R`
  - `D2R`
  - `SL`
- register writes for operator 4:
  - `0x5c` for `AR`
  - `0x6c` for `D1R`
  - `0x7c` for `D2R`
  - `0x8c` for `SL/RR`
- actual output envelope overlay:
  - built from generated `left/right` sample arrays
  - uses short-window RMS buckets
  - normalized and drawn as the cyan overlay

## Current design decision

- For now, prefer "faithful to the actual heard sound" over "more smoothed and easier to read".
- That means:
  - keep the cyan line relatively honest to the generated output
  - do not over-smooth it just to make it look like the orange guide
- If a later toggle is added, it should be optional:
  - `raw output`
  - `slightly smoothed`

## Important unresolved point

- `docs/operator1.html` still does not show an explicitly staged `key on` -> `key off` boundary.
- A possible next improvement is:
  - generate a hold segment
  - then send `key off`
  - then generate the release segment
  - draw a vertical `key off` marker on the envelope panel
- This would make the `RR` / release part easier to understand.

## Another important unresolved point

- The cyan line is still derived from output audio, not YM2612 internal operator state.
- If "real internal envelope" is ever required:
  - JS/WASM interface changes alone are not enough
  - a C++-side export is needed
  - possibly a minimal debug getter in `ymfm` or a wrapper around it
- Current decision:
  - do not change `ymfm` yet
  - stay with output-based observation first

## Current status

- `docs/beep.html`
  YM2612 beep demo works in the browser.
- `docs/psg.html`
  Sega PSG demo works in the browser.
- `docs/vgm.html`
  VGM file can be parsed and played with YM2612 + PSG.
  Streaming playback now works in the browser.
  `Play`, `Pause`, `Resume`, `Replay`, `Stop`, and basic `Loop` controls now exist.
  `AudioWorklet` is now used when available, with `ScriptProcessorNode` fallback.
- `docs/embed.html`
  A small browser integration sample now exists to show both the VGM playback path and the direct chip control path.
- `docs/ym2612vgm.js`
  Minimal VGM support was expanded to reduce `SKIP`.

## VGM support added today

- YM2612 register write
  - `0x52`
  - `0x53`
- PSG write
  - `0x50`
- Wait / end
  - `0x61`
  - `0x62`
  - `0x63`
  - `0x66`
  - `0x70-0x7f`
- YM2612 DAC / stream related
  - `0x67` data block: store block data
  - `0x80-0x8f`: DAC write + wait
  - `0x90-0x95`: minimal DAC stream handling
  - `0xe0`: data bank seek

## What changed

- `docs/ym2612vgm.js`
  Added data block loading, YM2612 DAC handling, and minimal DAC stream playback.
- `web/ym2612vgm.js`
  Synced with `docs/ym2612vgm.js`.
- `docs/vgm.html`
  Wait rendering was split so DAC stream writes can happen during playback timing.
  Playback was moved from full offline rendering to chunked streaming playback.
  The page now uses `GenesisAudioEngine` + `VgmPlayer`.
  Browser audio output now prefers `AudioWorklet`.
- `docs/embed.html`
  Added a smaller sample that uses `GenesisAudioEngine` and `VgmPlayer` with a simpler UI.
  It now documents the decision to keep VGM playback and direct chip control as separate paths.

## What we observed

- The second VGM plays without `SKIP`.
- The first VGM also has no `SKIP` now, but sound starts after a long delay.
- That likely means:
  - the song has a long silent intro, or
  - the interesting part starts later, or
  - the track structure depends on data that is not ideal for this minimal player yet.

## Important interpretation

- "No sound at first" is not automatically a parser bug now.
- If there is no `SKIP`, the next thing to inspect is the VGM content itself:
  - long wait before first key-on
  - long wait before audible FM/PSG part
  - DAC-heavy intro
- The old "wait until 100% render" behavior was also a playback-model issue.
- After switching to streaming playback, audio starts before full rendering finishes.
- `Loop` now works both for:
  - VGM files with a loop offset
  - VGM files without a loop offset by restarting from the beginning
- queue draining after playback end needed a bug fix
  - audio must continue until `queuedFrames === 0`
- `Stop` is now distinct from `Pause`
  - `Pause` keeps the current position
  - `Resume` continues from that position
  - `Stop` resets to the beginning
- After switching to `AudioWorklet`, the progress text may feel a little less smooth.
  - This looks like a UI update timing difference, not an audio stability problem.
  - `queuedFrames` still stays healthy and scrolling does not become heavy.
- For practical browser/game design, VGM playback and direct chip control should be treated as separate paths for now.
  - VGM is good for prepared BGM.
  - direct chip control is good for experiments, realtime input, and future programmatic composition.
  - automatic coexistence is not guaranteed when the song already uses YM2612 / PSG resources tightly.

## Still not fully supported

- `0x68` PCM RAM write is still skipped.
- Special / uncommon `0x67` block types are still skipped.
- DAC stream handling is minimal.
- Real hardware accuracy is not the goal yet.
- `AudioWorklet` is used for output timing, but the player logic still runs on the main thread.

## Scope risk

- Building a serious "full VGM player" could easily consume 2-4 months.
- The expensive part is not only implementation.
- It also includes:
  - command coverage
  - DAC / PCM correctness
  - testing assets
  - result verification
  - compatibility differences between VGM files

## Practical scope for this repository

- This repository does not need to become a complete VGM player first.
- A more realistic target is:
  - a YM2612 + PSG learning-oriented VGM player
  - browser / WASM playback
  - support for a practical subset of Genesis / DefleMask-oriented VGM data
  - clear documentation about what is supported and what is not

## `examples/vgmrender` vs `web/ym2612vgm.js`

- `examples/vgmrender`
  - broader as a general VGM renderer
  - supports many `ymfm` chips, not only `YM2612`
  - renders to WAV offline
  - good as a reference for classic VGM command handling
- `web/ym2612vgm.js`
  - narrower, but closer to this repository's browser goal
  - focused on `YM2612 + PSG`
  - already has browser-oriented streaming playback
  - already has practical `0x90-0x95` DAC stream handling that is useful for some Genesis / DefleMask files

## What can still be borrowed from `examples/vgmrender`

- Priority 1: improve docs/comments around the classic YM2612 DAC route
  - explain `0x67` type `0x00` as the YM2612 PCM data bank
  - explain `0xE0` as seek within that PCM bank
  - explain `0x80-0x8f` as "write one DAC byte to `0x2A` and wait"
- Priority 2: make `0x68` more than a skip
  - current `web/ym2612vgm.js` only logs and skips `0x68`
  - first useful step is to parse and store:
    - data type
    - read offset
    - write offset
    - size
  - after that, decide whether target Genesis files actually need full behavior
- Priority 3: strengthen unsupported-command handling
  - when a command is not implemented, prefer:
    - known byte length
    - safe skip
    - clear log
  - this is safer than hard-failing on every uncommon command

## Important difference to remember

## 2026-08-21: TFI import/export status

- `web/tfi.js`
  - minimal TFI import/export helper now exists
  - current scope is 42-byte TFI
  - import:
    - `parseTfi(data)`
    - converts TFI operator file order `S1, S3, S2, S4` into logical operators `1, 2, 3, 4`
    - converts TFI detune values into YM2612 register detune values
  - export:
    - `createTfiFromPreset(preset)`
    - converts current logical operator preset data back into TFI byte layout
- `scripts/verify_tfi_import.mjs`
  - verifies:
    - operator order mapping
    - detune conversion
    - import/export round-trip

## `YM2612Synth` status for TFI

- `web/ym2612synth.js`
  - now accepts:
    - `rs`
    - `ssg`
    - `sr` as an alias for the same `0x70` register currently exposed as `d2r`
- important note:
  - current demo/UI naming still says `D2R`
  - TFI terminology would call the same register `SR`
  - this is a naming/UI issue more than a register support issue

## `docs/synth` status

- `docs/synth/index.html`
  - can now import TFI from the synth UI
  - can now export the current synth state as `.tfi`
- current flow:
  - choose a preset or edit knobs
  - import a `.tfi` file if needed
  - continue editing
  - export the current state back to `.tfi`

## `docs/synth` remaining work for TFI-friendly editing

- add `RS` control to the UI
- add `SSG-EG` control to the UI
- rename `D2R` to `SR` or `SR/D2R`
- possibly make a slightly more TFI-oriented operator panel later

## Packaging / release note

- `scripts/package_web_runtime_release.sh`
  - now includes `tfi.js`
- `scripts/sync_web_js_to_docs.sh`
  - now includes `tfi.js`
- `scripts/package_itch_synth.sh`
  - now includes `tfi.js`
  - rewrite for `docs/synth/synth.js` was generalized:
    - `../js/*.js` -> `./js/*.js`
  - this reduces future breakage when adding another shared JS file

## Important itch.io note

- the error
  - `Blocked a frame with origin ...`
  is mostly iframe noise from itch.io itself
- the real bug we hit was:
  - `tfi.js` 404 in the packaged synth build
- this was fixed by:
  - adding `tfi.js` to the package
  - rewriting the import path for packaged `synth.js`

- `examples/vgmrender` is not automatically "better" for this repository's goal.
- It is a stronger general VGM reference.
- But for this repository:
  - browser playback
  - `YM2612 + PSG`
  - DefleMask-oriented Genesis subset
  are more important than full generic coverage.

## Suggested next implementation order for `web/ym2612vgm.js`

1. Add clearer comments/doc for `0x67`, `0x80-0x8f`, and `0xE0`.
2. Add a structured `0x68` parser instead of pure skip.
3. Extend the raw command length table only for commands likely to appear in Genesis VGM files.
4. Only after that, decide whether to import more behavior from `vgmrender`.

## Progress added on 2026-08-17

- `0x68` is no longer only "skip and forget".
- `web/ym2612vgm.js` and `docs/ym2612vgm.js` now parse and store `0x68` PCM RAM write metadata:
  - `type`
  - `readOffset`
  - `writeOffset`
  - `size`
  - `commandOffset`
- A helper now exists:
  - `pcmRamWriteSummary()`
- Playback for `0x68` is still not implemented.
- But the parser can now preserve enough information to inspect real files and decide whether implementation is needed.

## `docs/vgm.html` status for `0x68`

- `docs/vgm.html` now has a dedicated section:
  - `0x68 PCM RAM Write`
- After loading a file, the page can now show:
  - where each `0x68` appears
  - its parsed offsets
  - its size
- This makes browser-side inspection possible before adding playback behavior.

## Safe-skip improvement added on 2026-08-17

- `web/ym2612vgm.js` and `docs/ym2612vgm.js` now have a small `ignoredCommandLength()` helper.
- Some known unsupported commands no longer hard-fail immediately.
- They are now:
  - length-checked
  - warned
  - safely skipped
- Current safe-skip coverage includes:
  - `0x30-0x3f`
  - `0x4f`
  - `0x40-0x4e`
  - `0x5d`
  - `0xb0-0xbf`
  - `0xc0-0xdf`
  - `0xe1-0xff`

## Why this matters

- This does not make the player "more correct" yet.
- It makes the parser more robust for mixed or broader VGM files.
- It reduces unnecessary hard parser stops when a file contains unrelated commands that this repository does not intend to render yet.

## Still intentionally not done

- `0x68` playback behavior
- full generic VGM compatibility
- broad support for non-Genesis chips
- automatic interpretation of every skipped command

## DefleMask-oriented finding

- At least one target Genesis VGM uses YM2612 DAC stream commands in a practical way.
- Observed pattern:
  - `0x67` data blocks
  - `0x90` stream target setup for YM2612 register `0x2a`
  - `0x91` data bank setup
  - repeated `0x92` with frequency `16000`
  - repeated `0x95` with block switching between `0x0000` and `0x0001`
  - final `0x94` stop
- This means `0x90-0x95` cannot always be ignored for DefleMask-oriented Genesis support.
- The good news is that this pattern still looks practical to support.

## Important reminder

- "Achieve this repository's goals" is not the same as "support all VGM files".
- Avoid accidentally turning this repository into a full compatibility project too early.

## Genesis-oriented work list

- Phase 1: keep the current base stable
  - keep `docs/beep.html` working
  - keep `docs/psg.html` working
  - keep `docs/vgm.html` working for the current sample VGMs
- Phase 2: clarify the Genesis audio model in docs
  - explain that Mega Drive / Genesis audio is mainly `YM2612 + PSG`
  - explain which part is FM and which part is PSG
  - explain where DAC / PCM belongs in YM2612
- Phase 3: strengthen VGM parsing for Genesis use
  - confirm handling for `0x50`
  - confirm handling for `0x52` / `0x53`
  - confirm handling for waits and loop-related behavior
  - document which DAC / PCM commands are supported now
  - inspect whether `0x68` matters for target Genesis VGM files
- Phase 4: prepare small test assets
  - one short FM-only Genesis VGM
  - one short PSG-including Genesis VGM
  - one short DAC / PCM-including Genesis VGM
  - keep them short enough for easy debugging
- Phase 5: improve debug visibility
  - show accumulated VGM time while parsing
  - show first YM2612 key-on timing
  - show first PSG write timing
  - show first DAC activity timing
  - show unsupported commands clearly
- Phase 6: define the practical compatibility target
  - write "supported Genesis VGM subset"
  - write "known unsupported patterns"
  - avoid claiming full VGM compatibility
- Phase 7: browser embedding path
  - keep the WASM build instructions simple
  - keep the JavaScript API simple
  - show the minimum code needed to connect to Web Audio
  - keep the demo pages as small reference implementations
- Phase 8: learning examples
  - add an example for YM2612 FM note playback
  - add an example for PSG tone playback
  - add an example for YM2612 DAC playback
  - add an example for mixed YM2612 + PSG playback
- Phase 9: optional later work
  - add better loop handling
  - add stricter DAC stream behavior
  - add more Genesis-focused VGM compatibility
  - consider DefleMask-oriented workflow notes

## Priority view

### Must

- keep `docs/beep.html`, `docs/psg.html`, and `docs/vgm.html` working
- document the Genesis audio model as `YM2612 + PSG`
- keep YM2612 / PSG / basic VGM playback understandable
- clarify the current supported VGM subset
- prepare short Genesis-focused VGM test assets
- keep the WASM + JavaScript browser path simple and reproducible
- add learning examples for:
  - YM2612 FM
  - PSG tone
  - YM2612 DAC
  - mixed YM2612 + PSG

### Nice to have

- improve debug visibility in `docs/vgm.html`
- show first key-on / first PSG / first DAC timing
- add better loop handling
- add clearer DefleMask-oriented workflow notes
- support more Genesis VGM command patterns as needed by real samples
- treat VGM DAC stream control `0x90-0x95` as a future compatibility target unless target Genesis / DefleMask files require it

### Not now

- full VGM compatibility
- real hardware accuracy tuning
- broad support for many non-Genesis chip targets
- turning this repository into a general-purpose VGM player project

## Current decision about `0x90-0x95`

- `0x90-0x95` DAC stream control is postponed for now.
- Reason:
  - it is part of broader VGM compatibility work
  - it can easily expand the scope too much
  - it should only be prioritized if target Genesis / DefleMask VGM files actually require it
- Important distinction:
  - YM2612 register writes such as `register=0x94` are normal FM register writes
  - that is different from VGM command `0x94`

## Game integration path

- Current playback style in `docs/vgm.html`
  - stream audio in chunks during playback
- This is good for:
  - debugging
  - command analysis
  - confirming that realtime audio can be generated
- This is closer to game use, but not finished yet because:
  - main-thread work still matters
  - loop handling is still basic
  - `AudioWorklet` output exists, but generation is not fully moved off the main thread yet

## What is needed for game-oriented playback

- audio generation that can feed Web Audio continuously
- start / stop / reset controls
- loop handling
- stable timing for long playback
- low enough main-thread cost for browser game use
- move from `ScriptProcessorNode` demo style toward `AudioWorklet` when needed

## Practical next steps toward game use

1. Keep the current streaming demo stable.
2. Keep `play / pause / resume / replay / stop / loop` behavior stable.
3. Confirm YM2612 + PSG + target DAC stream subset work during streaming.
4. Keep the `AudioWorklet` path stable and verify fallback behavior.
5. Move more generation/control work off the main thread only if needed.
6. Add a small game-like sample after streaming becomes stable.

## Proposed interface split

- Prefer a 3-layer structure for easier embedding:
  - chip layer

## Documentation direction added later

- `docs/index.html` is now being treated as the main browser-side entrance page.
- The page is now split into at least these entry sections:
  - `Demos`
  - `About YM2612`
  - `YM2612 Wasm`
- The direction is:
  - keep Markdown notes as repository source notes
  - add browser-readable HTML pages under `docs/info/`
  - let `docs/index.html` link to them as a small learning hub

## `docs/info/` direction

- `ex00.md`, `ex00_ja.md`, and `ex00_vgm.md` remain as original working notes.
- Browser-readable pages were added under `docs/info/`:
  - `info/index.html`
  - `info/ym2612.html`
  - `info/ym2612-ja.html`
  - `info/vgm.html`
  - `info/wasm.html`
  - `info/vgmplayer.html`
  - `info/audioworklet.html`
- Current interpretation:
  - Markdown files are the original notes / source material
  - `docs/info/*.html` are the public browser-reading path

## Demo page source links

- Source links were added to these browser demo pages:
  - `docs/beep.html`
  - `docs/psg.html`
  - `docs/embed.html`
  - `docs/vgm.html`
- The intent is:
  - demo first
  - source second
  - reduce the gap between "I heard it" and "where is the code?"

## Upstream-friendly reminder

- Do not treat upstream `examples` as project-owned documentation space.
- Keep `examples` easy to merge from upstream.
- Prefer:
  - repository notes in `ex00*.md`
  - browser-readable pages in `docs/info/`
  - demo implementations in `docs/*.html`

## Release packaging reminder

- A release zip was created for the first public browser-side runtime bundle:
  - `release/hello_ymfm_wasm_v0.0.1_web_runtime.zip`
- It currently contains:
  - `web/`
  - `docs/generated/`

## Current documentation/product split

- `hello_ymfm_wasm` is moving toward:
  - YM2612 / ymfm learning notes
  - browser demos
  - WASM / JavaScript integration examples
  - Genesis / DefleMask bridge notes
- The larger composer/tool idea should stay separate as another project.

## Good next steps after a break

1. Re-open `docs/index.html` and confirm the top-level site structure still feels right.
2. Continue growing `docs/info/` rather than pushing too much text into `README.md`.
3. Consider adding an FM-focused page next:
   - 1 operator
   - 2 operators in parallel
   - 2 operators in series
   - feedback
4. If possible later, connect parameter changes to:
   - audible output
   - waveform view
   - FFT view
  - player layer
  - audio output layer

### 1. Chip layer

- Purpose:
  - keep YM2612 / PSG handling low level
  - expose register writes and sample generation only
- Examples:
  - `Ym2612`
  - `SegaPSG`
  - optional combined `GenesisAudioEngine`

### 2. Player layer

- Purpose:
  - parse and drive VGM playback
  - hide chip-specific details from app / game code
- Candidate class:
  - `VgmPlayer`
- Candidate responsibilities:
  - `load(buffer)`
  - `reset()`
  - `play()`
  - `stop()`
  - `setLoopEnabled(enabled)`
  - `isPlaying()`
  - `sampleRate()`
  - `process(left, right, frames)`

### 3. Audio output layer

- Purpose:
  - connect the player to browser audio output
  - keep Web Audio details separate from VGM / chip logic
- Candidate implementations:
  - current demo-oriented `AudioWorklet` path
  - `ScriptProcessorNode` fallback path

## Why `process(left, right, frames)` is important

- It fits browser audio callback style well.
- It is reusable for:
  - streaming playback
  - offline rendering
  - future game-engine integration
- It gives a cleaner boundary than exposing raw register writes to app code.

## Interface direction for game use

- Do not force a single interface style.
- A practical split is:
  - high-level API for BGM
  - low-level API for SFX / realtime control

### High-level API

- Good for:
  - VGM playback
  - BGM handling
  - simple browser/game integration
- Prefer methods such as:
  - `load`
  - `play`
  - `stop`
  - `loop`
  - `process`

### Low-level API

- Good for:
  - sound effects
  - realtime note control
  - direct YM2612 / PSG experimentation
- Prefer methods such as:
  - `writeYm2612(port, register, value)`
  - `writePsg(value)`
  - possible future helpers like `noteOn` / `noteOff`

## Likely class direction

- `GenesisAudioEngine`
  - low-level YM2612 + PSG control
  - sample generation via `process(left, right, frames)`
- `VgmPlayer`
  - high-level VGM playback built on top of `GenesisAudioEngine`

## Why this split makes sense

- BGM and SFX do not always want the same API.
- VGM playback wants a higher-level player abstraction.
- Game SFX may still want direct register access.
- This keeps the repository useful for both:
  - embedding music playback
  - experimenting with chip-level sound design

## Good next steps

1. In `docs/vgm.html`, show more timing information:
   - total wait before first audible section
   - first key-on timing
   - first YM2612 DAC activity timing
2. Add a simple debug view:
   - command index
   - accumulated VGM samples
   - accumulated seconds
3. If needed, make the progress display smoother without changing the audio path:
   - UI-only refresh with `requestAnimationFrame` or a light timer
4. If the first VGM still feels suspicious, inspect which command appears just before the first audible sound.
5. Only after that, decide whether `0x68` or stricter DAC stream behavior is worth implementing.

## Files to reopen next time

- `docs/vgm.html`
- `docs/ym2612vgm.js`
- `web/ym2612vgm.js`

## Short reminder for future me

- The project is already past the "can browser/WASM make sound?" phase.
- The next work is mostly about VGM behavior, timing visibility, incremental compatibility, and game-oriented API cleanup.
- Do not overreact to silence if `SKIP` is already gone.
