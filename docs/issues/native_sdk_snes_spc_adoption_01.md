# Native SDK SNES／SPC取り込み

2026-10-25。選択中／独立追加SNES S-DSPと独立追加SPC700ファイルプレーヤーの共通コア・接続を、同梱済みの固定SDKへ切り替える。
着手時は本体`24ab8cbd5f7cbe1205cddd66807a67fb538005f0`、Tauri`469200109298ad3ba80ca1f0dca7ee0063b0eaa5`、
SDK`affd1059599f3c7598191c14f5a864b44963d4aa`で、すべてcleanだった。直前のDX7移行までコミット済み。
直前の全5構成成功CI run `40168462256`はGame Boy／NES移行までを含み、DX7と今回のSNES／SPCは含まない。
今回はローカルの実装・検証後、DX7とまとめて5構成CIで確認する。タグやreleaseの作成は行わない。

## ビルド境界

| 用途 | SDK内のパス |
| --- | --- |
| 選択中／独立追加SNES S-DSPの共通接続 | `native/reference/tauri/native_genesis_snes.cpp`と対応ヘッダー |
| 独立追加SPC700ファイルプレーヤーの接続 | `native/reference/tauri/native_genesis_spc.cpp`と対応ヘッダー |
| 共通S-DSP | `vendor/snes-spc/snes_spc/SPC_DSP.cpp`と対応ヘッダー |
| SPC700／load／状態・観測処理 | 同ディレクトリの`SNES_SPC.cpp`、`SNES_SPC_misc.cpp`、`SNES_SPC_state.cpp`と対応ヘッダー |

2接続cppと2 ABI header、SNES-SPCの24ファイルの合計28ファイルは旧コピーとbyte一致する。
既存の`tetorica_native_snes` archiveに接続2個＋コア4個の計6翻訳単位を維持し、`SPC_DSP.cpp`を一度だけコンパイルする。
SDK CMakeの独立した2ライブラリーを追加せず、`SPC_Filter.cpp`や別C ABIの`spc.cpp`／`dsp.cpp`も組み込まない。
C++17・O2・MSVC `/EHsc`・`-fwrapv`・`-fno-strict-aliasing`・`-ffp-contract=off`と既存のarchive順序を保持する。
新しいPython／CMakeのビルド依存や動的ライブラリーは追加しない。

CargoはSDKのSNES-SPCディレクトリと2接続cpp／headerを監視し、実消費元のない旧`native-snes/`とローカル接続のソース監視を外す。
旧接続、`native-snes/`の34件のスナップショットpin、由来・LGPL-2.1-or-laterのライセンスとsyncスクリプトは保持する。
旧コピーや`sync_native_snes.py`だけを更新しても実際のSDK入力は変わらない。
配布物を改変して再リンクするときは、実消費先のSDKコア・接続を変更する。手順はTauriの[NATIVE-SOURCES.md](../../w/tetorica-fm2612-playground-tauri/NATIVE-SOURCES.md)。
固定配布物の照合は意図的な改変をハッシュ不一致として検出するが、通常ビルドはその照合を必須にしない。原本pinや取り込み記録を改変版のために上書きしない。

SDKは`0.1.0`、元コミット`affd1059599f3c7598191c14f5a864b44963d4aa`の374ファイルをそのまま使う。
元ZIP SHA-256は`26db7518a55465b1e4dc58c19eb425fc6ea1ab282bd85920b0249556f5d1f6ce`。
SDK本体・取り込み記録、Browser／npmのWASMとTauriの`dist/`は変更しない。
これで通常の22音源IDのSDK参照が揃う。代替Nuked YM2612の別variantと機種用の補助処理はアプリ側に残る。

## 所有と再生制御

SNES S-DSPは8声のBRR楽器、ADSR／GAIN、noise／pitch modulation／echoを扱い、SPC700 CPUを実行しない。
RAMアップロードはコア所有の64 KiBへ即時コピーする。timelineは初期RAM／DSPとイベント列を借用し、
Rustが検証済みの不変`Arc<Timeline>`を再生・pause・完了後も保持し、置換／global Stop／破棄でcallback外へ回収する。
Native StopはRAM・設定を保持してgate／履歴を消すため、保持したecho RAMが鳴る場合がある。resetはRAMも消す。
生成は32 kHz固定で、既存の整数位相によるdevice rate変換を保持する。

SPCはSPC700 CPUとS-DSPを実行する別プレーヤー。読込みでCPU／RAM／DSP状態をコア内へコピーし、Rustが元ファイル全体を保持してStop／絶対seekのために再構築する。
生成・load・最大16,000 Nativeフレーム単位のseek・破棄はcontrol側で行い、準備した`Arc<Core>`を単一の音声ownerへ公開し、置換後はcallback外で回収する。
pauseは巻き戻さず、muteは将来の128フレームsource blockへ適用するため既存PCMやechoが残り得る。
観測用snapshotは保存状態ではなく、借用するbounded DSPイベント領域はコア変更を除外して読み出す。失敗は正常なreloadまで保持される。
IPL ROM、メタデータによる終了／fade、portable save stateやデバイスは追加しない。

Rustの転送payload・予約・owner／group・寿命・16台／予算管理、Keyboard、PCM・Stop・Mixer／FXとWebView／JS APIはアプリ側に残る。

## ローカル検証

旧／SDKを別々にコンパイルし、macOS ARM64／Clang・Nodeで音声デバイスを開かずに確認した。

| 対象 | Native入力数 | Nativeフレーム | 実WASM比較回数 | 比較フレーム |
| --- | ---: | ---: | ---: | ---: |
| 選択中SNES | 42 | 442,368 | 42 | 442,368 |
| 独立追加SNES | 75 | 761,856 | 225 | 2,285,568 |
| SNES固有入力（選択中の重複を除く） | 75 | 761,856 | 267 | 2,727,936 |
| 独立追加SPC | 84 | 688,128 | 252 | 2,064,384 |
| 合計（SNESとSPCの別入力） | 159 | 1,449,984 | 519 | 4,792,320 |

SNESの選択中42入力は追加側75入力の部分集合で、二重加算しない。
追加側は各Native入力を3通りのblock分割へ比較するため、入力数と比較回数を区別する。
全入力の旧／SDK stdoutとstderrはbyte一致し、実配布WASM／Workletとの全519比較の最大差は0。
既定経路の再確認、fixture指定と自己試験の実行はこの集計へ加算しない。
SNES／SPCが共有する実配布WASM SHA-256は`cbbe06819574249217f35da16eebd45a53274e53251f31242e7dd407b03d0d70`。

- SNESのTauri既存fixtureとSDK強化fixtureを旧／SDKでそれぞれ`--self-test`と`--self-test-extra`へ実行し、8回とも成功。152バイトの公開state ABI、ローカルのコア確保量67,280バイト、RAMのコピー・境界・全体reset、安定したread-only view、8声・保護KON／KOFF、保持Stopと独立性、借用timelineのpause／完了／再開を確認し、render／制御中のallocation／freeは0。
- SPCは従来の28シナリオを3出力rateで旧／SDKへ比較し、実WASMでPCMと定期的なRAM hash・DSP register・counter・順序付きDSP書込みを確認。比較全体で810 snapshotと358,056書込みを照合した。SDKの強化fixtureも旧／SDKで成功し、56バイトのstate ABIと16バイトのevent ABI、ローカルのコア確保量204,624バイト、コピーload、control側seek、pause、独立mute、非進行観測、bounded observer／overflow、失敗／reloadを確認。render中のallocation／freeは0。
- これらは公開状態の自己試験や限定された観測点の比較であり、毎フレームのCPU／DSP／resamplerのprivate全状態をdump比較したものではない。合成SPC／BRR素材を使い、外部ROMやゲーム音源を試験へ追加していない。
- 3本の既定checkerも固定SDKからコンパイルして成功。SNESの10入力／SPCの15入力のSHA-256を、コンパイラーの依存列とディスク上の実ファイルへ照合した。`--fixture`／`--out`のinline指定を保持し、不正な18形式をコンパイル前に拒否。指定されたfixtureは削除せず、一時生成物だけを回収する。
- 実Cargo archiveは既存の6 objectを保持し、35個の`native_snes_*`／`native_spc_*` C ABI exportは各1回だけ定義された。6 CPPの独立した依存preprocessはSDK側のheaderだけを解決。SDKディレクトリと2接続cpp／headerの監視を確認し、旧ローカルソースの監視は外した。ライセンス・対応ソースのresource監視は保持する。記録は`build-audit.json`。

`npm test`はPython 22件・Node 31件成功。Rust全試験は723成功・0失敗・明示実行用4件ignored。
MCPのローカルTCP bindのため初めから制限外で実行し、sandbox内の失敗や製品修正はない。
再生ライフサイクルは22 mode・604,032フレーム・88 Run／Stopが成功。
追加音源の3混合構成・7単独音源、受入れ／16台制限で17台目の拒否も成功し、受入れと台数制限の両方でStop後の予約予算は0へ戻った。
再生／混合の両runnerはexit code 0、`deviceOpened: false`。

ホストログは`/private/tmp/tetorica-sdk-snes-spc-npm-test.log`と`/private/tmp/tetorica-sdk-snes-spc-cargo-test-unrestricted.log`。
再生／混合レポートは`/private/tmp/tetorica-sdk-snes-spc-stability.json`と`/private/tmp/tetorica-sdk-snes-spc-extra-stability.json`。
ソース監査・比較集計・自己試験・独立監査は`/private/tmp/tetorica-sdk-snes-spc-adoption/`の
`source-audit.json`、`snes-parity-summary.json`、`spc-parity-summary.json`、`independent-checker-audit.json`、`build-audit.json`、`host-summary.json`。

本体`hello_ymfm`のルートから比較する。

```sh
node scripts/check_native_snes.mjs
node scripts/check_native_extra_snes.mjs
node scripts/check_native_extra_spc.mjs
```

同梱SDKと配布ソースの手順はTauriの[SDK取り込みガイド](../../w/tetorica-fm2612-playground-tauri/docs/native-sdk-ym2612.md)を参照する。
文書確定後の対応ソースZIPは全1,796ファイル、SHA-256は
`39cd14b113557665c039d0af3960839ed566c7ad2fdc49286859d8b5c53fa684`。
`/private/tmp/tetorica-sdk-snes-spc-sources.json`で全22件の固定記録とSDK374ファイルを含めて照合が成功した。
`/private/tmp/tetorica-sdk-snes-spc-adoption/source-manifest-delta.json`で着手時との差がTauriの
`src-tauri/build.rs`、`README.md`、`NATIVE-SOURCES.md`、`docs/native-sdk-ym2612.md`の4ファイルだけと確認し、
同ディレクトリの`summary.json`へ最終結果を集約した。SDK取り込み記録とfrontend archiveは変更していない。
ガイド自身へZIPの自己ハッシュは埋め込まない。
各OSのCI結果は実行後に別節へ記録する。実機聴音・UI操作、インストール後の起動、sanitizer、リアルタイム期限や処理速度の保証は別の確認。
