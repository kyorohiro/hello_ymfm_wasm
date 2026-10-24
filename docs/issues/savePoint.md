# Save Point

Last updated: 2026-10-25

## 最新の再開ポイント — 2026-10-25

この節が現在の作業状態。末尾まで残している旧記録には、現在と異なる構成・未実装扱い・次の作業案が含まれる。
再開時はこの節と実際の各リポジトリの状態を先に確認する。

### 現在地

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
最新の作業は、追加生成YM2413と共有OPL provider／PCM依存のSDK参照切替。
Master System／MSXの機種用接続・NativeOpllCore、PSG／AY、DOS PC／Y8950の接続はアプリ側に保持する。
今回のTauri実装と文書、本体の比較checkerと記録は未コミット。
先行する全OPNの5構成CI成功と、後続のYM2151／OKIM6258／YM2413差分のローカル検証は区別する。
新しいタグ、ドラフトリリース、一般公開は作成していない。

作業ルートは `/Users/kyorohiro/development8/wfm/hello_ymfm`。
`w/`以下はそれぞれ独立したGitリポジトリなので、本体だけのcommitで保存できたと判断しない。

| リポジトリ | ローカルパス | 保存時点のHEAD（すべてmain） |
| --- | --- | --- |
| 本体 | `hello_ymfm/` | `fed03f7a414898c511e67478bf7d43aa6a03f273` (OKIM6258移行のcheckerと記録) |
| Native SDK | `w/tetorica-soundchip-native/` | `affd1059599f3c7598191c14f5a864b44963d4aa` (`tetorica::spc`) |
| Playground Tauri | `w/tetorica-fm2612-playground-tauri/` | `250489fd0b6bc5ba2b97bd182834a41aaba60269` (OKIM6258移行。全OPN CIの対象は`5280f83a...`) |

本体には次のメモがある。今回のYM2413作業は、この保存時点のHEAD後の差分。

- [native_sdk_ym2612_adoption_01.md](native_sdk_ym2612_adoption_01.md)：YM2612移行と5構成のCI結果。
- [native_sdk_ym2203_adoption_01.md](native_sdk_ym2203_adoption_01.md)：YM2203移行とローカル検証。
- [native_sdk_ym2608_adoption_01.md](native_sdk_ym2608_adoption_01.md)：YM2608移行とローカル検証。
- [native_sdk_ym2610_adoption_01.md](native_sdk_ym2610_adoption_01.md)：YM2610／YM2610B移行と全OPNの5構成CI。
- [native_sdk_ym2151_adoption_01.md](native_sdk_ym2151_adoption_01.md)：YM2151／X68000移行とローカル検証。
- [native_sdk_okim6258_adoption_01.md](native_sdk_okim6258_adoption_01.md)：OKIM6258移行と初期化対策の保持。
- [native_sdk_ym2413_adoption_01.md](native_sdk_ym2413_adoption_01.md)：最新のYM2413／共有OPL provider移行。
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
- 追加生成YM2612の `native/reference/tauri/native_genesis_ym2612.cpp`。
- PC-98／追加生成YM2203の `native/reference/tauri/native_genesis_ym2203.cpp`。
- PC-98／追加生成YM2608の `native/reference/tauri/native_genesis_ym2608.cpp`。
- Neo Geo／追加生成YM2610・YM2610Bの `native/reference/tauri/native_genesis_ym2610b.cpp`。
- 追加生成YM2151の `native/reference/tauri/native_genesis_ym2151.cpp`。
- 追加生成YM2413の `native/reference/tauri/native_genesis_ym2413.cpp`。
- 追加生成OKIの `native/reference/tauri/native_genesis_extra_okim6258.cpp`。
- `vendor/mame-okim6258/okim6258.cpp`原本へ既存の初期化対策を適用して`OUT_DIR/tetorica_sdk_okim6258.cpp`へ生成したデコーダー。
- 共有 `native/src/ymfm_opn_provider.cpp`、`native/src/ymfm_opm_provider.cpp`、`native/src/ymfm_opl_provider.cpp` と `vendor/ymfm/ymfm_ssg.cpp`、`ymfm_adpcm.cpp`、`ymfm_pcm.cpp`。

共有providerは従来のarchive位置で一度だけコンパイルする。
上記のOPN接続は共通providerを使い、OPLL／OPL側も共通ADPCMを参照する。
共有OPL provider／PCMは従来の`tetorica_native_master_system` archive内で一度だけコンパイルする。
選択中Master System／MSXの機種用接続・NativeOpllCore、PSG／AYとDOS PC／Y8950の接続はアプリ側に残す。
追加生成YM2413はSDKの独立接続を使用する。独立接続はNativeOpllCoreを流用する構造ではない。
CargoはSDKのOPL provider／ymfmと独立YM2413接続を監視する。
実消費元のなくなった旧native-master-systemディレクトリの監視は外し、ローカルの機種用接続／NativeOpllCoreとAY実装を供給するnative-msxの監視は保持する。
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
Browser／npmのWASM配布とTauriの `dist/` は今回の取り込みで変更していない。
Cargoは取り込み記録、SDKのymfmディレクトリ、wasmディレクトリ等を監視し、明示更新時に再ビルドする。
YM2608のRhythm ROMはRustが従来の`native-ym2608/snapshot/web/`から読むため、同ディレクトリの監視も保持する。

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
今回もmacOS ARM64／Clangで音声デバイスを開かない検証。各OSのCIと実機確認は未実行。
最終文書を含む対応ソースZIP全1,796ファイルと、SDK374ファイルを含む22件の固定記録のオフライン照合も成功。

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

### 再開手順

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

### 次の作業候補と未着手範囲

1. 必要なOSのインストーラーを取得し、インストール後の起動を確認する。run `40130334227`の5構成と検証レポートは確認済み。
2. 今回のYM2413／共有OPL provider差分をcommit／push後、必要に応じてYM2151／OKIM6258移行とともに5構成のCIを実行する。全OPN移行のCI成功とは区別する。
3. Master System／MSXと追加生成YM2413の再生・Stop・再Run、リズム・PSG／AY同時再生を実機でも聴いて確認する。先行するX68000等の実機確認も自動試験とは別。
4. 次のSDK取り込みはアプリ側に残したDOS PC／Y8950の選択中／追加生成接続が候補。共有providerの重複と既存音への影響を確認する。
5. 高速レジスタ制御は [別メモ](todo_schedule_register_01.md) にある構想。現時点で着手済みと解釈しない。

### 一時成果物と記録の置き場所

- Tauriの `native-validation/`、`native-source-bundle/`、`src-tauri/target/` はignoredな生成物。
- 対応ソースZIP: `w/tetorica-fm2612-playground-tauri/native-source-bundle/application-sources.zip`。
  YM2413／共有OPL provider移行と最終文書の反映後のSHA-256: `2829e9f948e257535bf71aac86a702ffe75701ba878cc01cb5c8900787c5a2ee`。
  全1,796ファイルとSDK374ファイルを含む22件の固定記録を再照合済み。
  結果は`/private/tmp/tetorica-sdk-ym2413-sources.json`。
  先行するOKIM6258移行後の旧ZIPは`7123fc45...`で、今回のYM2413差分を含まない。
  先行するYM2151移行後の旧ZIPは`b3c56199...`で、今回のOKIM6258差分を含まない。
  先行する全OPN CI後の文書更新だけを含む旧ZIPは`af8e3129...`で、今回のYM2151差分を含まない。
  再生成後に値が変わる場合は、その時点の作業ツリーとマニフェストを確認する。
- SDKの元ZIP: `w/tetorica-soundchip-native/releases/tetorica-soundchip-native-0.1.0-sources.zip`。
  元ZIPが消えてもTauriの同梱ソースと取り込み記録だけでオフライン照合・ビルドできる。
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
  `/private/tmp`は消える可能性があるため、再開の必須データとして扱わない。

ソースと由来の正本は各Gitコミット、Tauriの同梱SDK／取り込み記録、上記の手順書。
過去の作業メモにある「未コミット」は当時の状態。TauriのYM2612移行は`9ef583e...`、YM2203移行は`16610b0e...`、YM2608移行は`53ab3d27...`、YM2610／YM2610B移行は`5280f83a...`にコミット済み。
YM2151移行もTauriの`e4d68b27...`、本体の`f0e00dda...`、OKIM6258移行はTauriの`250489fd...`、本体の`fed03f7a...`にコミット済み。現在の未コミット差分はYM2413／共有OPL provider移行。

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
